import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import type { UniversalRecord } from '../records/schema';
import type { EntityObservation, EntityRelationship, EntitySearchFilters, TrackedEntity } from './types';

const DB_PATH = resolve(process.cwd(), process.env.INTEL_RECORDS_DB_PATH ?? 'server/intel_engine/records/intel_records.db');

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 6371 * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

export class EntityStore {
  private db: import('node:sqlite').DatabaseSync | null = null;
  private ready = false;

  private async ensureReady(): Promise<void> {
    if (this.ready) return;
    this.ready = true;
    await mkdir(dirname(DB_PATH), { recursive: true });
    const { DatabaseSync } = await import('node:sqlite');
    this.db = new DatabaseSync(DB_PATH);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS entities (
        id TEXT PRIMARY KEY,
        entity_type TEXT,
        canonical_name TEXT,
        first_seen INTEGER,
        last_seen INTEGER,
        metadata_json TEXT
      );

      CREATE TABLE IF NOT EXISTS entity_observations (
        id TEXT PRIMARY KEY,
        entity_id TEXT,
        record_id TEXT,
        timestamp INTEGER,
        lat REAL,
        lon REAL,
        attributes_json TEXT
      );

      CREATE TABLE IF NOT EXISTS entity_relationships (
        id TEXT PRIMARY KEY,
        entity_a TEXT,
        entity_b TEXT,
        relationship_type TEXT,
        confidence REAL
      );

      CREATE INDEX IF NOT EXISTS idx_entities_type ON entities(entity_type);
      CREATE INDEX IF NOT EXISTS idx_entity_observations_entity_id ON entity_observations(entity_id);
      CREATE INDEX IF NOT EXISTS idx_entity_observations_timestamp ON entity_observations(timestamp);
    `);
  }

  private getDb(): import('node:sqlite').DatabaseSync {
    if (!this.db) throw new Error('Entity DB not initialized');
    return this.db;
  }

  async upsertEntity(entity: TrackedEntity): Promise<void> {
    await this.ensureReady();
    const db = this.getDb();
    db.prepare(`
      INSERT INTO entities (id, entity_type, canonical_name, first_seen, last_seen, metadata_json)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        canonical_name=excluded.canonical_name,
        last_seen=MAX(entities.last_seen, excluded.last_seen),
        first_seen=MIN(entities.first_seen, excluded.first_seen),
        metadata_json=excluded.metadata_json
    `).run(entity.id, entity.entity_type, entity.canonical_name, entity.first_seen, entity.last_seen, entity.metadata_json);
  }

  async insertObservation(obs: EntityObservation): Promise<void> {
    await this.ensureReady();
    const db = this.getDb();
    db.prepare(`
      INSERT OR IGNORE INTO entity_observations (id, entity_id, record_id, timestamp, lat, lon, attributes_json)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(obs.id, obs.entity_id, obs.record_id, obs.timestamp, obs.lat ?? null, obs.lon ?? null, obs.attributes_json);

    db.prepare('UPDATE entities SET last_seen = MAX(last_seen, ?) WHERE id = ?').run(obs.timestamp, obs.entity_id);
  }

  async upsertRelationship(rel: EntityRelationship): Promise<void> {
    await this.ensureReady();
    const db = this.getDb();
    db.prepare(`
      INSERT INTO entity_relationships (id, entity_a, entity_b, relationship_type, confidence)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        confidence=MAX(entity_relationships.confidence, excluded.confidence)
    `).run(rel.id, rel.entity_a, rel.entity_b, rel.relationship_type, rel.confidence);
  }

  async findEntityByCanonicalName(entityType: string, canonicalName: string): Promise<TrackedEntity | null> {
    await this.ensureReady();
    const row = this.getDb().prepare('SELECT * FROM entities WHERE entity_type = ? AND canonical_name = ? LIMIT 1').get(entityType, canonicalName) as TrackedEntity | undefined;
    return row ?? null;
  }

  async search(filters: EntitySearchFilters): Promise<TrackedEntity[]> {
    await this.ensureReady();
    const db = this.getDb();

    const clauses: string[] = [];
    const params: Array<string | number> = [];

    if (filters.entity_type) {
      clauses.push('e.entity_type = ?');
      params.push(filters.entity_type);
    }
    if (filters.q) {
      clauses.push('e.canonical_name LIKE ?');
      params.push(`%${filters.q}%`);
    }
    if (
      typeof filters.min_lat === 'number' && typeof filters.max_lat === 'number'
      && typeof filters.min_lon === 'number' && typeof filters.max_lon === 'number'
    ) {
      clauses.push('e.id IN (SELECT DISTINCT entity_id FROM entity_observations WHERE lat >= ? AND lat <= ? AND lon >= ? AND lon <= ?)');
      params.push(filters.min_lat, filters.max_lat, filters.min_lon, filters.max_lon);
    }

    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const limit = Math.max(1, Math.min(500, filters.limit ?? 100));
    const offset = Math.max(0, filters.offset ?? 0);

    let rows = db.prepare(`
      SELECT e.* FROM entities e
      ${where}
      ORDER BY e.last_seen DESC
      LIMIT ? OFFSET ?
    `).all(...params, limit, offset) as TrackedEntity[];

    if (typeof filters.lat === 'number' && typeof filters.lon === 'number' && typeof filters.radius_km === 'number') {
      const latestObs = db.prepare(`
        SELECT entity_id, lat, lon, MAX(timestamp) AS latest
        FROM entity_observations
        WHERE lat IS NOT NULL AND lon IS NOT NULL
        GROUP BY entity_id
      `).all() as Array<{ entity_id: string; lat: number; lon: number }>;
      const nearby = new Set(
        latestObs
          .filter((o) => haversineKm(filters.lat!, filters.lon!, o.lat, o.lon) <= filters.radius_km!)
          .map((o) => o.entity_id),
      );
      rows = rows.filter((e) => nearby.has(e.id));
    }

    return rows;
  }


  async getEntitiesByIds(ids: string[]): Promise<TrackedEntity[]> {
    await this.ensureReady();
    if (ids.length === 0) return [];
    const placeholders = ids.map(() => '?').join(',');
    return this.getDb().prepare(`SELECT * FROM entities WHERE id IN (${placeholders})`).all(...ids) as TrackedEntity[];
  }

  async getRelatedEntities(entityId: string, relationshipType?: string): Promise<TrackedEntity[]> {
    await this.ensureReady();
    const db = this.getDb();
    const rels = relationshipType
      ? db.prepare('SELECT * FROM entity_relationships WHERE (entity_a = ? OR entity_b = ?) AND relationship_type = ? ORDER BY confidence DESC').all(entityId, entityId, relationshipType)
      : db.prepare('SELECT * FROM entity_relationships WHERE entity_a = ? OR entity_b = ? ORDER BY confidence DESC').all(entityId, entityId);
    const relationships = rels as EntityRelationship[];
    const relatedIds = Array.from(new Set(relationships.map((r) => (r.entity_a === entityId ? r.entity_b : r.entity_a))));
    return this.getEntitiesByIds(relatedIds);
  }

  async getEntity(id: string): Promise<TrackedEntity | null> {
    await this.ensureReady();
    const row = this.getDb().prepare('SELECT * FROM entities WHERE id = ?').get(id) as TrackedEntity | undefined;
    return row ?? null;
  }

  async getObservations(entityId: string): Promise<EntityObservation[]> {
    await this.ensureReady();
    return this.getDb().prepare(
      'SELECT * FROM entity_observations WHERE entity_id = ? ORDER BY timestamp ASC',
    ).all(entityId) as EntityObservation[];
  }

  async getRelationships(entityId: string): Promise<EntityRelationship[]> {
    await this.ensureReady();
    return this.getDb().prepare(
      'SELECT * FROM entity_relationships WHERE entity_a = ? OR entity_b = ? ORDER BY confidence DESC',
    ).all(entityId, entityId) as EntityRelationship[];
  }

  async getRecordsForEntity(entityId: string): Promise<UniversalRecord[]> {
    await this.ensureReady();
    const rows = this.getDb().prepare(`
      SELECT r.id, r.source, r.entity_type, r.timestamp, r.lat, r.lon, r.text_summary, r.raw_json
      FROM records r
      JOIN entity_observations eo ON eo.record_id = r.id
      WHERE eo.entity_id = ?
      ORDER BY r.timestamp ASC
    `).all(entityId) as Array<{
      id: string;
      source: string;
      entity_type: string;
      timestamp: number;
      lat: number | null;
      lon: number | null;
      text_summary: string;
      raw_json: string;
    }>;

    return rows.map((r) => {
      const [source_type = '', source_id = ''] = String(r.source).split(':');
      return {
        id: r.id,
        source_type,
        source_id,
        entity_type: r.entity_type,
        fetched_at: new Date(r.timestamp).toISOString(),
        published_at: new Date(r.timestamp).toISOString(),
        timestamp: r.timestamp,
        text: r.text_summary,
        geo_lat: r.lat ?? undefined,
        geo_lon: r.lon ?? undefined,
        raw_json: r.raw_json,
      } satisfies UniversalRecord;
    });
  }
}

let sharedEntityStore: EntityStore | null = null;

export function getEntityStore(): EntityStore {
  if (!sharedEntityStore) sharedEntityStore = new EntityStore();
  return sharedEntityStore;
}
