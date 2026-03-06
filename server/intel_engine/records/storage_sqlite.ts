import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { hashString } from '../../_shared/hash';
import type { RecordSearchFilters, UniversalRecord } from './schema';
import { getSQLiteRecordIndex } from './index_sqlite';

const STORAGE_PATH = process.env.INTEL_RECORDS_PATH ?? '.local/intel_engine/records.jsonl';
const RETENTION_DAYS = Number(process.env.RECORD_RETENTION_DAYS ?? '14');
const MAX_PER_SOURCE = Number(process.env.RECORD_MAX_PER_SOURCE ?? '10000');
const MAX_TOTAL = Number(process.env.RECORD_MAX_TOTAL ?? '200000');
const DISK_BUDGET_BYTES = Number(process.env.RECORD_DISK_BUDGET_BYTES ?? '0');

function tokensFor(record: UniversalRecord): Set<string> {
  const text = `${record.title ?? ''} ${record.text ?? ''}`.toLowerCase().replace(/[^a-z0-9\s]/g, ' ');
  return new Set(text.split(/\s+/).map((t) => t.trim()).filter((t) => t.length >= 2));
}

export class UniversalRecordStore {
  private loaded = false;
  private readonly records = new Map<string, UniversalRecord>();
  private readonly bySource = new Map<string, string[]>();
  private readonly fts = new Map<string, Set<string>>(); // token -> record ids (FTS5-like index)

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;

    try {
      const content = await readFile(STORAGE_PATH, 'utf8');
      for (const line of content.split('\n').map((l) => l.trim()).filter(Boolean)) {
        try {
          const parsed = JSON.parse(line) as UniversalRecord;
          this.records.set(parsed.id, parsed);
        } catch {
          // ignore malformed lines
        }
      }
      this.rebuildIndexes();
    } catch {
      // first run
    }
  }

  private rebuildIndexes(): void {
    this.bySource.clear();
    this.fts.clear();

    for (const record of this.records.values()) {
      const sourceKey = `${record.source_type}:${record.source_id}`;
      const list = this.bySource.get(sourceKey) ?? [];
      list.push(record.id);
      this.bySource.set(sourceKey, list);

      for (const token of tokensFor(record)) {
        const ids = this.fts.get(token) ?? new Set<string>();
        ids.add(record.id);
        this.fts.set(token, ids);
      }
    }

    for (const key of this.bySource.keys()) {
      const ordered = (this.bySource.get(key) ?? []).sort((a, b) => {
        const ra = this.records.get(a);
        const rb = this.records.get(b);
        return (rb?.fetched_at ?? '').localeCompare(ra?.fetched_at ?? '');
      });
      this.bySource.set(key, ordered);
    }
  }

  private async ensureDir(): Promise<void> {
    const slash = STORAGE_PATH.lastIndexOf('/');
    if (slash > 0) {
      await mkdir(STORAGE_PATH.slice(0, slash), { recursive: true });
    }
  }

  private async flush(): Promise<void> {
    await this.ensureDir();
    const body = Array.from(this.records.values())
      .sort((a, b) => a.fetched_at.localeCompare(b.fetched_at))
      .map((r) => JSON.stringify(r))
      .join('\n');
    await writeFile(STORAGE_PATH, body ? `${body}\n` : '', 'utf8');
  }

  private dedupeKey(record: UniversalRecord): string {
    const urlKey = record.url ? hashString(record.url) : '';
    const rawKey = hashString(record.raw_json);
    return `${record.source_type}|${record.source_id}|${record.published_at ?? ''}|${urlKey}|${rawKey}`;
  }

  async ingest(input: UniversalRecord | UniversalRecord[]): Promise<{ inserted: number }> {
    await this.ensureLoaded();
    const incoming = Array.isArray(input) ? input : [input];
    const existingByDedupe = new Map<string, string>();
    for (const rec of this.records.values()) {
      existingByDedupe.set(this.dedupeKey(rec), rec.id);
    }

    let inserted = 0;
    for (const record of incoming) {
      const key = this.dedupeKey(record);
      if (existingByDedupe.has(key)) continue;
      this.records.set(record.id, record);
      existingByDedupe.set(key, record.id);
      inserted++;
    }

    await this.cleanup();
    await this.flush();
    this.rebuildIndexes();

    if (inserted > 0) {
      const index = getSQLiteRecordIndex();
      index.enqueue(incoming.filter((record) => this.records.has(record.id)));
    }

    return { inserted };
  }

  async getById(id: string): Promise<UniversalRecord | null> {
    await this.ensureLoaded();
    return this.records.get(id) ?? null;
  }

  private searchInMemory(filters: RecordSearchFilters): UniversalRecord[] {
    let ids: Set<string> | null = null;

    if (filters.q && filters.q.trim()) {
      const tokens = filters.q.toLowerCase().split(/\s+/).map((t) => t.trim()).filter(Boolean);
      for (const token of tokens) {
        const set = this.fts.get(token) ?? new Set<string>();
        ids = ids ? new Set(Array.from(ids).filter((id) => set.has(id))) : new Set(set);
      }
      if (!ids) ids = new Set();
    }

    let rows = Array.from(this.records.values()).filter((row) => !ids || ids.has(row.id));
    if (filters.source_type) rows = rows.filter((r) => r.source_type === filters.source_type);
    if (filters.source_id) rows = rows.filter((r) => r.source_id === filters.source_id);
    if (filters.from) rows = rows.filter((r) => r.fetched_at >= filters.from!);
    if (filters.to) rows = rows.filter((r) => r.fetched_at <= filters.to!);

    rows.sort((a, b) => b.fetched_at.localeCompare(a.fetched_at));
    const offset = Math.max(0, filters.offset ?? 0);
    const limit = Math.max(1, Math.min(500, filters.limit ?? 50));
    return rows.slice(offset, offset + limit);
  }

  async search(filters: RecordSearchFilters): Promise<UniversalRecord[]> {
    await this.ensureLoaded();

    const index = getSQLiteRecordIndex();
    const indexedIds = await index.searchIds(filters);
    if (indexedIds) {
      const rows = indexedIds.map((id) => this.records.get(id)).filter((row): row is UniversalRecord => Boolean(row));
      if (rows.length > 0 || !filters.q) return rows;
    }

    return this.searchInMemory(filters);
  }

  async cleanup(): Promise<{ removed: number }> {
    await this.ensureLoaded();
    const allBeforeCleanup = new Set(this.records.keys());
    let removed = 0;
    const now = Date.now();
    const retentionMs = Math.max(1, RETENTION_DAYS) * 24 * 60 * 60 * 1000;

    for (const record of Array.from(this.records.values())) {
      if (now - Date.parse(record.fetched_at) > retentionMs) {
        this.records.delete(record.id);
        removed++;
      }
    }

    this.rebuildIndexes();

    for (const [sourceKey, ids] of this.bySource.entries()) {
      if (ids.length <= MAX_PER_SOURCE) continue;
      const overflow = ids.slice(MAX_PER_SOURCE);
      for (const id of overflow) {
        if (this.records.delete(id)) removed++;
      }
      this.bySource.set(sourceKey, ids.slice(0, MAX_PER_SOURCE));
    }

    if (this.records.size > MAX_TOTAL) {
      const ordered = Array.from(this.records.values()).sort((a, b) => b.fetched_at.localeCompare(a.fetched_at));
      const keepIds = new Set(ordered.slice(0, MAX_TOTAL).map((r) => r.id));
      for (const id of Array.from(this.records.keys())) {
        if (!keepIds.has(id) && this.records.delete(id)) removed++;
      }
    }

    if (DISK_BUDGET_BYTES > 0) {
      await this.flush();
      try {
        const details = await stat(STORAGE_PATH);
        if (details.size > DISK_BUDGET_BYTES) {
          const ordered = Array.from(this.records.values()).sort((a, b) => b.fetched_at.localeCompare(a.fetched_at));
          while (ordered.length > 0) {
            const last = ordered.pop();
            if (!last) break;
            this.records.delete(last.id);
            removed++;
            await this.flush();
            const next = await stat(STORAGE_PATH);
            if (next.size <= DISK_BUDGET_BYTES) break;
          }
        }
      } catch {
        // ignore
      }
    }

    const remaining = new Set(this.records.keys());
    const removedIds = Array.from(allBeforeCleanup).filter((id) => !remaining.has(id));

    this.rebuildIndexes();
    await getSQLiteRecordIndex().cleanupIndexedIds(removedIds);
    return { removed };
  }

  async stats(): Promise<{ total: number; perSource: Record<string, number>; estimatedBytes: number; total_records: number; jsonl_size_bytes: number; sqlite_size_bytes: number; index_enabled: boolean }> {
    await this.ensureLoaded();
    const perSource: Record<string, number> = {};
    for (const record of this.records.values()) {
      perSource[record.source_type] = (perSource[record.source_type] ?? 0) + 1;
    }

    let estimatedBytes = 0;
    try {
      estimatedBytes = (await stat(STORAGE_PATH)).size;
    } catch {
      estimatedBytes = 0;
    }

    const sqliteStats = await getSQLiteRecordIndex().stats();

    return {
      total: this.records.size,
      perSource,
      estimatedBytes,
      total_records: this.records.size,
      jsonl_size_bytes: estimatedBytes,
      sqlite_size_bytes: sqliteStats.sqlite_size_bytes,
      index_enabled: sqliteStats.index_enabled,
    };
  }
}

let sharedStore: UniversalRecordStore | null = null;

export function getUniversalRecordStore(): UniversalRecordStore {
  if (!sharedStore) sharedStore = new UniversalRecordStore();
  return sharedStore;
}
