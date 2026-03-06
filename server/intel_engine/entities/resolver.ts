import { hashString } from '../../_shared/hash';
import type { UniversalRecord } from '../records/schema';
import { getEntityStore } from './storage';
import type { EntityType, TrackedEntity } from './types';

interface Candidate {
  entityType: EntityType;
  canonicalName: string;
  attributes: Record<string, unknown>;
}

const SOURCE_TO_ENTITY_TYPE: Record<string, EntityType> = {
  aviation: 'aircraft',
  maritime: 'vessel',
  seismology: 'earthquake',
  wildfire: 'wildfire',
  natural: 'storm',
  infrastructure: 'infrastructure',
  climate: 'storm',
  research: 'organization',
  conflict: 'location',
  military: 'aircraft',
};

function asObject(rawJson: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(rawJson);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function inferType(record: UniversalRecord, obj: Record<string, unknown> | null): EntityType {
  const fromSource = SOURCE_TO_ENTITY_TYPE[record.source_type];
  if (fromSource) return fromSource;
  const explicit = typeof obj?.entity_type === 'string' ? obj.entity_type : typeof obj?.type === 'string' ? obj.type : '';
  const lowered = explicit.toLowerCase();
  if (lowered.includes('vessel') || lowered.includes('ship')) return 'vessel';
  if (lowered.includes('air') || lowered.includes('flight')) return 'aircraft';
  if (lowered.includes('quake')) return 'earthquake';
  if (lowered.includes('fire')) return 'wildfire';
  if (lowered.includes('storm') || lowered.includes('cyclone') || lowered.includes('hurricane')) return 'storm';
  return 'location';
}

function pickIdentifier(entityType: EntityType, record: UniversalRecord, obj: Record<string, unknown> | null): string {
  const tryKeys = (...keys: string[]): string | null => {
    for (const k of keys) {
      const v = obj?.[k];
      if (typeof v === 'string' && v.trim()) return v.trim().toUpperCase();
      if (typeof v === 'number' && Number.isFinite(v)) return String(v);
    }
    return null;
  };

  switch (entityType) {
    case 'aircraft':
      return tryKeys('icao24', 'icao', 'hex', 'callsign', 'flight', 'flight_number')
        ?? record.title?.trim().toUpperCase()
        ?? record.id;
    case 'vessel':
      return tryKeys('mmsi', 'imo', 'vesselName', 'vessel_name', 'name')
        ?? record.title?.trim().toUpperCase()
        ?? record.id;
    case 'earthquake':
      return tryKeys('event_id', 'quake_id', 'id')
        ?? `${record.source_type}:${record.geo_lat ?? 'na'}:${record.geo_lon ?? 'na'}:${record.timestamp ?? 0}`;
    case 'wildfire':
      return tryKeys('fire_id', 'id', 'name')
        ?? `${record.source_type}:${record.geo_lat ?? 'na'}:${record.geo_lon ?? 'na'}:${record.timestamp ?? 0}`;
    case 'storm':
      return tryKeys('storm_name', 'name', 'storm_id', 'id')
        ?? `${record.source_type}:${record.title ?? record.id}`;
    case 'satellite':
      return tryKeys('satellite', 'norad_id', 'satellite_id', 'name')
        ?? `${record.source_type}:${record.title ?? record.id}`;
    case 'infrastructure':
      return tryKeys('site_id', 'asset_id', 'id', 'name')
        ?? `${record.source_type}:${record.title ?? record.id}`;
    case 'organization':
      return tryKeys('organization', 'org', 'name')
        ?? `${record.source_type}:${record.title ?? record.id}`;
    case 'location':
    default:
      return tryKeys('location', 'place', 'name')
        ?? `${record.source_type}:${record.geo_lat ?? 'na'}:${record.geo_lon ?? 'na'}:${record.title ?? record.id}`;
  }
}

function toCandidates(record: UniversalRecord): Candidate[] {
  const obj = asObject(record.raw_json);
  const entityType = inferType(record, obj);
  const canonicalName = pickIdentifier(entityType, record, obj);
  const attributes: Record<string, unknown> = {
    source_type: record.source_type,
    source_id: record.source_id,
    title: record.title,
    url: record.url,
    ...obj,
  };

  return [{ entityType, canonicalName, attributes }];
}

function entityIdFor(entityType: EntityType, canonicalName: string): string {
  return `ent_${hashString(`${entityType}|${canonicalName}`)}`;
}

function observationIdFor(entityId: string, recordId: string): string {
  return `eo_${hashString(`${entityId}|${recordId}`)}`;
}

function relationshipIdFor(a: string, b: string, t: string): string {
  const pair = [a, b].sort().join('|');
  return `er_${hashString(`${pair}|${t}`)}`;
}

export async function resolveEntitiesFromRecords(records: UniversalRecord[]): Promise<void> {
  if (records.length === 0) return;
  const store = getEntityStore();

  for (const record of records) {
    const candidates = toCandidates(record);
    const entityIds: string[] = [];

    for (const candidate of candidates) {
      const existing = await store.findEntityByCanonicalName(candidate.entityType, candidate.canonicalName);
      const entityId = existing?.id ?? entityIdFor(candidate.entityType, candidate.canonicalName);
      const ts = typeof record.timestamp === 'number' && Number.isFinite(record.timestamp)
        ? record.timestamp
        : Date.parse(record.published_at ?? record.fetched_at);
      const timestamp = Number.isNaN(ts) ? Date.now() : ts;

      const entity: TrackedEntity = {
        id: entityId,
        entity_type: candidate.entityType,
        canonical_name: candidate.canonicalName,
        first_seen: existing?.first_seen ?? timestamp,
        last_seen: Math.max(existing?.last_seen ?? 0, timestamp),
        metadata_json: JSON.stringify(candidate.attributes),
      };
      await store.upsertEntity(entity);

      await store.insertObservation({
        id: observationIdFor(entityId, record.id),
        entity_id: entityId,
        record_id: record.id,
        timestamp,
        lat: record.geo_lat,
        lon: record.geo_lon,
        attributes_json: JSON.stringify(candidate.attributes),
      });

      entityIds.push(entityId);
    }

    if (entityIds.length > 1) {
      for (let i = 0; i < entityIds.length; i++) {
        for (let j = i + 1; j < entityIds.length; j++) {
          const a = entityIds[i]!;
          const b = entityIds[j]!;
          await store.upsertRelationship({
            id: relationshipIdFor(a, b, 'co_observed'),
            entity_a: a,
            entity_b: b,
            relationship_type: 'co_observed',
            confidence: 0.6,
          });
        }
      }
    }
  }
}
