import { mkdir, stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { hashString } from '../../_shared/hash';
import { runRecordsCleanup } from './cleanup';
import type { RecordSearchFilters, UniversalRecord } from './schema';

const DB_PATH = resolve(process.cwd(), process.env.INTEL_RECORDS_DB_PATH ?? 'server/intel_engine/records/intel_records.db');
const CLEANUP_EVERY_INSERTS = Math.max(50, Number(process.env.RECORD_CLEANUP_EVERY_INSERTS ?? '500'));

function toTimestampMs(record: UniversalRecord): number {
  if (typeof record.timestamp === 'number' && Number.isFinite(record.timestamp)) return record.timestamp;
  const value = Date.parse(record.published_at ?? record.fetched_at);
  return Number.isNaN(value) ? Date.now() : value;
}

function toSource(record: UniversalRecord): string {
  return `${record.source_type}:${record.source_id}`;
}


function extractTitleUrl(rawJson: string): { title?: string; url?: string } {
  try {
    const parsed = JSON.parse(rawJson) as Record<string, unknown>;
    const title = typeof parsed.title === 'string' ? parsed.title : typeof parsed.name === 'string' ? parsed.name : undefined;
    const url = typeof parsed.url === 'string' ? parsed.url : typeof parsed.link === 'string' ? parsed.link : undefined;
    return { title, url };
  } catch {
    return {};
  }
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 6371 * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

export class UniversalRecordStore {
  private db: import('node:sqlite').DatabaseSync | null = null;
  private ready = false;
  private insertsSinceCleanup = 0;

  private async ensureReady(): Promise<void> {
    if (this.ready) return;
    this.ready = true;
    await mkdir(dirname(DB_PATH), { recursive: true });

    const { DatabaseSync } = await import('node:sqlite');
    this.db = new DatabaseSync(DB_PATH);
    this.db.exec(`
      PRAGMA journal_mode=WAL;
      PRAGMA synchronous=NORMAL;
      CREATE TABLE IF NOT EXISTS records (
        id TEXT PRIMARY KEY,
        source TEXT,
        entity_type TEXT,
        timestamp INTEGER,
        lat REAL,
        lon REAL,
        text_summary TEXT,
        raw_json TEXT,
        created_at INTEGER
      );
      CREATE TABLE IF NOT EXISTS metadata (
        key TEXT PRIMARY KEY,
        value TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_records_timestamp ON records(timestamp);
      CREATE INDEX IF NOT EXISTS idx_records_source ON records(source);
      CREATE INDEX IF NOT EXISTS idx_records_entity_type ON records(entity_type);

      CREATE VIRTUAL TABLE IF NOT EXISTS records_fts USING fts5(
        id UNINDEXED,
        text_summary,
        source,
        entity_type,
        content=''
      );

      CREATE VIRTUAL TABLE IF NOT EXISTS records_geo USING rtree(
        id,
        minLat, maxLat,
        minLon, maxLon
      );

      CREATE TRIGGER IF NOT EXISTS records_after_insert AFTER INSERT ON records BEGIN
        INSERT OR REPLACE INTO records_fts (id, text_summary, source, entity_type)
        VALUES (new.id, new.text_summary, new.source, new.entity_type);
        INSERT OR REPLACE INTO records_geo (id, minLat, maxLat, minLon, maxLon)
        SELECT new.id, new.lat, new.lat, new.lon, new.lon
        WHERE new.lat IS NOT NULL AND new.lon IS NOT NULL;
      END;

      CREATE TRIGGER IF NOT EXISTS records_after_update AFTER UPDATE ON records BEGIN
        INSERT OR REPLACE INTO records_fts (rowid, id, text_summary, source, entity_type)
        VALUES ((SELECT rowid FROM records_fts WHERE id = old.id), new.id, new.text_summary, new.source, new.entity_type);
        DELETE FROM records_geo WHERE id = old.id;
        INSERT OR REPLACE INTO records_geo (id, minLat, maxLat, minLon, maxLon)
        SELECT new.id, new.lat, new.lat, new.lon, new.lon
        WHERE new.lat IS NOT NULL AND new.lon IS NOT NULL;
      END;

      CREATE TRIGGER IF NOT EXISTS records_after_delete AFTER DELETE ON records BEGIN
        DELETE FROM records_fts WHERE id = old.id;
        DELETE FROM records_geo WHERE id = old.id;
      END;
    `);
  }

  private getDb(): import('node:sqlite').DatabaseSync {
    if (!this.db) throw new Error('Record DB not initialized');
    return this.db;
  }

  private dedupeKey(record: UniversalRecord): string {
    const urlKey = record.url ? hashString(record.url) : '';
    const rawKey = hashString(record.raw_json);
    return `${record.source_type}|${record.source_id}|${record.published_at ?? ''}|${urlKey}|${rawKey}`;
  }

  async ingest(input: UniversalRecord | UniversalRecord[]): Promise<{ inserted: number }> {
    await this.ensureReady();
    const db = this.getDb();

    const incoming = Array.isArray(input) ? input : [input];
    const existing = new Set<string>();
    const existingRows = db.prepare('SELECT id, raw_json, source FROM records').all() as Array<{ id: string; raw_json: string; source: string }>;
    for (const row of existingRows) {
      const [source_type = '', source_id = ''] = String(row.source).split(':');
      existing.add(`${source_type}|${source_id}|||${hashString(row.raw_json)}`);
    }

    let inserted = 0;
    const upsert = db.prepare(`
      INSERT INTO records (id, source, entity_type, timestamp, lat, lon, text_summary, raw_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        source=excluded.source,
        entity_type=excluded.entity_type,
        timestamp=excluded.timestamp,
        lat=excluded.lat,
        lon=excluded.lon,
        text_summary=excluded.text_summary,
        raw_json=excluded.raw_json
    `);

    db.exec('BEGIN');
    try {
      for (const record of incoming) {
        const key = this.dedupeKey(record);
        if (existing.has(key)) continue;

        upsert.run(
          record.id,
          toSource(record),
          record.entity_type ?? record.source_type,
          toTimestampMs(record),
          record.geo_lat ?? null,
          record.geo_lon ?? null,
          [record.title, record.text, record.url].filter(Boolean).join(' ').trim() || '',
          record.raw_json,
          Date.now(),
        );
        existing.add(key);
        inserted++;
      }
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }

    this.insertsSinceCleanup += inserted;
    if (this.insertsSinceCleanup >= CLEANUP_EVERY_INSERTS) {
      runRecordsCleanup(db);
      this.insertsSinceCleanup = 0;
    }

    return { inserted };
  }

  async getById(id: string): Promise<UniversalRecord | null> {
    await this.ensureReady();
    const db = this.getDb();

    const row = db.prepare('SELECT * FROM records WHERE id = ?').get(id) as {
      id: string;
      source: string;
      entity_type: string | null;
      timestamp: number;
      lat: number | null;
      lon: number | null;
      text_summary: string;
      raw_json: string;
    } | undefined;

    if (!row) return null;
    const [source_type = '', source_id = ''] = String(row.source).split(':');

    const aux = extractTitleUrl(row.raw_json);
    return {
      id: row.id,
      source_type,
      source_id,
      entity_type: row.entity_type ?? undefined,
      fetched_at: new Date(row.timestamp).toISOString(),
      published_at: new Date(row.timestamp).toISOString(),
      timestamp: row.timestamp,
      title: aux.title,
      url: aux.url,
      text: row.text_summary,
      geo_lat: row.lat ?? undefined,
      geo_lon: row.lon ?? undefined,
      raw_json: row.raw_json,
    };
  }

  async search(filters: RecordSearchFilters): Promise<UniversalRecord[]> {
    await this.ensureReady();
    const db = this.getDb();

    const clauses: string[] = [];
    const params: Array<string | number> = [];

    const sourceFilter = filters.source ?? (filters.source_type && filters.source_id ? `${filters.source_type}:${filters.source_id}` : undefined);
    if (sourceFilter) {
      clauses.push('r.source = ?');
      params.push(sourceFilter);
    } else if (filters.source_type) {
      clauses.push('r.source LIKE ?');
      params.push(`${filters.source_type}:%`);
    }

    if (filters.entity_type) {
      clauses.push('r.entity_type = ?');
      params.push(filters.entity_type);
    }

    const startTime = filters.start_time ?? (filters.from ? Date.parse(filters.from) : undefined);
    const endTime = filters.end_time ?? (filters.to ? Date.parse(filters.to) : undefined);
    if (typeof startTime === 'number' && Number.isFinite(startTime)) {
      clauses.push('r.timestamp >= ?');
      params.push(startTime);
    }
    if (typeof endTime === 'number' && Number.isFinite(endTime)) {
      clauses.push('r.timestamp <= ?');
      params.push(endTime);
    }

    if (
      typeof filters.min_lat === 'number' && typeof filters.max_lat === 'number'
      && typeof filters.min_lon === 'number' && typeof filters.max_lon === 'number'
    ) {
      clauses.push('r.id IN (SELECT id FROM records_geo WHERE minLat >= ? AND maxLat <= ? AND minLon >= ? AND maxLon <= ?)');
      params.push(filters.min_lat, filters.max_lat, filters.min_lon, filters.max_lon);
    }

    const limit = Math.max(1, Math.min(500, filters.limit ?? 100));
    const offset = Math.max(0, filters.offset ?? 0);

    const whereTail = clauses.length ? ` AND ${clauses.join(' AND ')}` : '';
    let sql = '';
    let queryParams: Array<string | number> = [];

    if (filters.q && filters.q.trim()) {
      sql = `
        SELECT r.*
        FROM records_fts f
        JOIN records r ON r.id = f.id
        WHERE f.records_fts MATCH ?${whereTail}
        ORDER BY r.timestamp DESC
        LIMIT ? OFFSET ?
      `;
      queryParams = [filters.q.trim(), ...params, limit, offset];
    } else {
      sql = `
        SELECT r.*
        FROM records r
        WHERE 1=1${whereTail}
        ORDER BY r.timestamp DESC
        LIMIT ? OFFSET ?
      `;
      queryParams = [...params, limit, offset];
    }

    let rows = db.prepare(sql).all(...queryParams) as Array<{
      id: string;
      source: string;
      entity_type: string | null;
      timestamp: number;
      lat: number | null;
      lon: number | null;
      text_summary: string;
      raw_json: string;
    }>;

    if (typeof filters.lat === 'number' && typeof filters.lon === 'number' && typeof filters.radius_km === 'number') {
      rows = rows.filter((row) => row.lat != null && row.lon != null
        && haversineKm(filters.lat!, filters.lon!, row.lat, row.lon) <= filters.radius_km!);
    }

    return rows.map((row) => {
      const [source_type = '', source_id = ''] = String(row.source).split(':');
      const aux = extractTitleUrl(row.raw_json);
      return {
        id: row.id,
        source_type,
        source_id,
        entity_type: row.entity_type ?? undefined,
        fetched_at: new Date(row.timestamp).toISOString(),
        published_at: new Date(row.timestamp).toISOString(),
        timestamp: row.timestamp,
        title: aux.title,
        url: aux.url,
        text: row.text_summary,
        geo_lat: row.lat ?? undefined,
        geo_lon: row.lon ?? undefined,
        raw_json: row.raw_json,
      } satisfies UniversalRecord;
    });
  }

  async cleanup(): Promise<{ removed: number }> {
    await this.ensureReady();
    const db = this.getDb();
    return runRecordsCleanup(db);
  }

  async stats(): Promise<{ total: number; perSource: Record<string, number>; estimatedBytes: number; total_records: number; jsonl_size_bytes: number; sqlite_size_bytes: number; index_enabled: boolean }> {
    await this.ensureReady();
    const db = this.getDb();

    const perSource: Record<string, number> = {};
    const rows = db.prepare('SELECT source, COUNT(1) AS c FROM records GROUP BY source').all() as Array<{ source: string; c: number }>;
    for (const row of rows) {
      const [sourceType = 'unknown'] = String(row.source).split(':');
      perSource[sourceType] = (perSource[sourceType] ?? 0) + Number(row.c ?? 0);
    }

    const total = Number((db.prepare('SELECT COUNT(1) AS c FROM records').get() as { c: number }).c ?? 0);
    const sqliteSize = (await stat(DB_PATH)).size;

    return {
      total,
      perSource,
      estimatedBytes: sqliteSize,
      total_records: total,
      jsonl_size_bytes: 0,
      sqlite_size_bytes: sqliteSize,
      index_enabled: true,
    };
  }
}

let sharedStore: UniversalRecordStore | null = null;

export function getUniversalRecordStore(): UniversalRecordStore {
  if (!sharedStore) sharedStore = new UniversalRecordStore();
  return sharedStore;
}
