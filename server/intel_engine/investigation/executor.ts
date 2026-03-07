import { getEntityStore } from '../entities/storage';
import { getUniversalRecordStore } from '../records/storage_sqlite';
import { buildInvestigationPlan } from './planner';
import type { InvestigationQuery, InvestigationResult } from './types';

export async function executeInvestigationQuery(query: InvestigationQuery): Promise<InvestigationResult> {
  const plan = buildInvestigationPlan(query);
  const entityStore = getEntityStore();
  const recordStore = getUniversalRecordStore();

  const limit = Math.max(1, Math.min(500, query.limit ?? 100));
  const offset = Math.max(0, query.offset ?? 0);

  let entities = await entityStore.search({
    q: undefined,
    entity_type: query.entity_type,
    lat: query.lat,
    lon: query.lon,
    radius_km: query.radius_km,
    min_lat: query.min_lat,
    min_lon: query.min_lon,
    max_lat: query.max_lat,
    max_lon: query.max_lon,
    limit,
    offset,
  });

  if (query.entity_id) {
    const found = await entityStore.getEntity(query.entity_id);
    entities = found ? [found] : [];
  }

  if (query.related_to_entity_id) {
    const related = await entityStore.getRelatedEntities(query.related_to_entity_id, query.relationship_type);
    entities = mergeById(entities, related);
  }

  if (query.text) {
    const textMatched = await entityStore.search({
      q: query.text,
      entity_type: query.entity_type,
      limit,
      offset,
    });
    entities = mergeById(entities, textMatched);
  }

  const entityIdSet = new Set(entities.map((e) => e.id));
  const relationships = await collectRelationships(entityStore, Array.from(entityIdSet), query.relationship_type);

  const records = await collectRecords({
    recordStore,
    entityStore,
    query,
    entities,
    limit,
    offset,
  });

  const graph = query.include_graph
    ? {
      nodes: [
        ...entities.map((e) => ({ id: e.id, type: 'entity', label: e.canonical_name, entity_type: e.entity_type })),
        ...records.map((r) => ({ id: `rec:${r.id}`, type: 'record', label: r.title ?? r.id, source_type: r.source_type })),
      ],
      edges: [
        ...relationships.map((r) => ({ from: r.entity_a, to: r.entity_b, type: r.relationship_type, confidence: r.confidence })),
      ],
    }
    : undefined;

  return { plan, records, entities, relationships, graph };
}

function mergeById<T extends { id: string }>(a: T[], b: T[]): T[] {
  const map = new Map<string, T>();
  for (const item of [...a, ...b]) map.set(item.id, item);
  return Array.from(map.values());
}

async function collectRelationships(
  entityStore: ReturnType<typeof getEntityStore>,
  entityIds: string[],
  relationshipType?: string,
) {
  const collected = new Map<string, Awaited<ReturnType<typeof entityStore.getRelationships>>[number]>();
  for (const entityId of entityIds) {
    const rels = await entityStore.getRelationships(entityId);
    for (const rel of rels) {
      if (relationshipType && rel.relationship_type !== relationshipType) continue;
      collected.set(rel.id, rel);
    }
  }
  return Array.from(collected.values());
}

async function collectRecords(args: {
  recordStore: ReturnType<typeof getUniversalRecordStore>;
  entityStore: ReturnType<typeof getEntityStore>;
  query: InvestigationQuery;
  entities: Array<{ id: string }>;
  limit: number;
  offset: number;
}) {
  const { recordStore, entityStore, query, entities, limit, offset } = args;

  const indexedRecords = await recordStore.search({
    q: query.text,
    source_type: query.source_type,
    source_id: query.source_id,
    from: query.from,
    to: query.to,
    lat: query.lat,
    lon: query.lon,
    radius_km: query.radius_km,
    min_lat: query.min_lat,
    min_lon: query.min_lon,
    max_lat: query.max_lat,
    max_lon: query.max_lon,
    limit,
    offset,
  });

  if (entities.length === 0) return indexedRecords;

  const relatedBatches = await Promise.all(entities.slice(0, 50).map((e) => entityStore.getRecordsForEntity(e.id)));
  const related = relatedBatches.flat();
  return mergeById(indexedRecords, related).slice(0, limit);
}
