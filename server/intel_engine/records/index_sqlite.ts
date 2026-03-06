import { mkdir, stat } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { RecordSearchFilters, UniversalRecord } from './schema';

const INDEX_PATH = process.env.INTEL_RECORDS_INDEX_PATH ?? '.local/intel_engine/records_index.sqlite';
const MAX_SQLITE_DB_BYTES = Number(process.env.MAX_SQLITE_DB_BYTES ?? '536870912');

function toSource(record: UniversalRecord): string {
  return `${record.source_type}:${record.source_id}`;
}

function toTimestampMs(record: UniversalRecord): number {
  const candidate = record.published_at ?? record.fetched_at;
  const value = Date.parse(candidate);
  return Number.isNaN(value) ? Date.now() : value;
}

function toTimestampBound(value?: string): number | undefined {
  if (!value) return undefined;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? undefined : parsed;
}

function escapeLike(input: string): string {
  return input.replace(/[%_]/g, (m) => `\\${m}`);
}

export class SQLiteRecordIndex {
  private db: import('node:sqlite').DatabaseSync | null = null;
  private enabled = false;
  private initialized = false;
  private readonly queue: UniversalRecord[] = [];
  private flushing = false;

  private async ensureInitialized(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;

    try {
      await mkdir(dirname(INDEX_PATH), { recursive: true });
      const { DatabaseSync } = await import('node:sqlite');
      const db = new DatabaseSync(INDEX_PATH);
      db.exec(`
        PRAGMA journal_mode=WAL;
        PRAGMA synchronous=NORMAL;
        CREATE TABLE IF NOT EXISTS records (
          id TEXT PRIMARY KEY,
          source TEXT,
          title TEXT,
          text TEXT,
          url TEXT,
          timestamp INTEGER
        );
        CREATE INDEX IF NOT EXISTS idx_records_source ON records(source);
        CREATE INDEX IF NOT EXISTS idx_records_timestamp ON records(timestamp);
        CREATE VIRTUAL TABLE IF NOT EXISTS records_fts USING fts5(
          title,
          text,
          content='records',
          content_rowid='rowid'
        );
        CREATE TRIGGER IF NOT EXISTS records_ai AFTER INSERT ON records BEGIN
          INSERT INTO records_fts(rowid, title, text) VALUES (new.rowid, new.title, new.text);
        END;
        CREATE TRIGGER IF NOT EXISTS records_ad AFTER DELETE ON records BEGIN
          INSERT INTO records_fts(records_fts, rowid, title, text) VALUES('delete', old.rowid, old.title, old.text);
        END;
        CREATE TRIGGER IF NOT EXISTS records_au AFTER UPDATE ON records BEGIN
          INSERT INTO records_fts(records_fts, rowid, title, text) VALUES('delete', old.rowid, old.title, old.text);
          INSERT INTO records_fts(rowid, title, text) VALUES (new.rowid, new.title, new.text);
        END;
      `);
      this.db = db;
      this.enabled = true;
    } catch {
      this.enabled = false;
      this.db = null;
    }
  }

  enqueue(records: UniversalRecord[]): void {
    if (records.length === 0) return;
    this.queue.push(...records);
    void this.flushQueue();
  }

  private async flushQueue(): Promise<void> {
    if (this.flushing) return;
    this.flushing = true;
    try {
      await this.ensureInitialized();
      if (!this.enabled || !this.db) return;

      while (this.queue.length > 0) {
        const batch = this.queue.splice(0, 500);
        const db = this.db;
        db.exec('BEGIN');
        try {
          const upsert = db.prepare(`
            INSERT INTO records (id, source, title, text, url, timestamp)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
              source=excluded.source,
              title=excluded.title,
              text=excluded.text,
              url=excluded.url,
              timestamp=excluded.timestamp
          `);
          for (const record of batch) {
            upsert.run(
              record.id,
              toSource(record),
              record.title ?? null,
              record.text ?? null,
              record.url ?? null,
              toTimestampMs(record),
            );
          }
          db.exec('COMMIT');
        } catch {
          db.exec('ROLLBACK');
        }

        await this.enforceDiskBudget();
      }
    } finally {
      this.flushing = false;
    }
  }

  private async enforceDiskBudget(): Promise<void> {
    if (!this.enabled || !this.db || MAX_SQLITE_DB_BYTES <= 0) return;

    try {
      let currentSize = (await stat(INDEX_PATH)).size;
      if (currentSize <= MAX_SQLITE_DB_BYTES) return;

      while (currentSize > MAX_SQLITE_DB_BYTES) {
        this.db.exec(`
          DELETE FROM records
          WHERE id IN (
            SELECT id FROM records ORDER BY timestamp ASC LIMIT 1000
          )
        `);
        currentSize = (await stat(INDEX_PATH)).size;
        if ((this.db.prepare('SELECT COUNT(1) as c FROM records').get() as { c: number }).c === 0) {
          break;
        }
      }
      this.db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    } catch {
      // ignore disk budget errors for non-blocking behavior
    }
  }

  async searchIds(filters: RecordSearchFilters): Promise<string[] | null> {
    await this.ensureInitialized();
    if (!this.enabled || !this.db) return null;

    const clauses: string[] = [];
    const params: Array<string | number> = [];

    const fromMs = toTimestampBound(filters.from);
    const toMs = toTimestampBound(filters.to);
    if (fromMs !== undefined) {
      clauses.push('r.timestamp >= ?');
      params.push(fromMs);
    }
    if (toMs !== undefined) {
      clauses.push('r.timestamp <= ?');
      params.push(toMs);
    }
    if (filters.source_id) {
      const type = filters.source_type ?? '';
      clauses.push('r.source = ?');
      params.push(`${type}:${filters.source_id}`);
    } else if (filters.source_type) {
      clauses.push("r.source LIKE ? ESCAPE '\\'");
      params.push(`${escapeLike(filters.source_type)}:%`);
    }

    const limit = Math.max(1, Math.min(500, filters.limit ?? 50));
    const offset = Math.max(0, filters.offset ?? 0);

    if (filters.q && filters.q.trim()) {
      const where = clauses.length > 0 ? ` AND ${clauses.join(' AND ')}` : '';
      const sql = `
        SELECT r.id
        FROM records_fts f
        JOIN records r ON r.rowid = f.rowid
        WHERE records_fts MATCH ?${where}
        ORDER BY r.timestamp DESC
        LIMIT ? OFFSET ?
      `;
      const rows = this.db.prepare(sql).all(filters.q.trim(), ...params, limit, offset) as Array<{ id: string }>;
      return rows.map((row) => row.id);
    }

    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    const rows = this.db.prepare(`
      SELECT r.id
      FROM records r
      ${where}
      ORDER BY r.timestamp DESC
      LIMIT ? OFFSET ?
    `).all(...params, limit, offset) as Array<{ id: string }>;

    return rows.map((row) => row.id);
  }

  async cleanupIndexedIds(idsToDelete: string[]): Promise<void> {
    if (idsToDelete.length === 0) return;
    await this.ensureInitialized();
    if (!this.enabled || !this.db) return;

    this.db.exec('BEGIN');
    try {
      const stmt = this.db.prepare('DELETE FROM records WHERE id = ?');
      for (const id of idsToDelete) {
        stmt.run(id);
      }
      this.db.exec('COMMIT');
    } catch {
      this.db.exec('ROLLBACK');
    }
  }

  async stats(): Promise<{ sqlite_size_bytes: number; index_enabled: boolean }> {
    await this.ensureInitialized();
    if (!this.enabled) return { sqlite_size_bytes: 0, index_enabled: false };

    try {
      return { sqlite_size_bytes: (await stat(INDEX_PATH)).size, index_enabled: true };
    } catch {
      return { sqlite_size_bytes: 0, index_enabled: true };
    }
  }
}

let sharedIndex: SQLiteRecordIndex | null = null;

export function getSQLiteRecordIndex(): SQLiteRecordIndex {
  if (!sharedIndex) sharedIndex = new SQLiteRecordIndex();
  return sharedIndex;
}
