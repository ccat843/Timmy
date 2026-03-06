import type { RouteDescriptor } from '../../router';
import { getEntityStore } from './storage';
import { resolveEntitiesFromRecords } from './resolver';
import type { UniversalRecord } from '../records/schema';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function asNum(value: string | null): number | undefined {
  if (value == null || value === '') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export async function processEntityResolution(records: UniversalRecord[]): Promise<void> {
  try {
    await resolveEntitiesFromRecords(records);
  } catch {
    // non-blocking resolution path
  }
}

async function handleSearch(req: Request): Promise<Response> {
  const store = getEntityStore();
  const url = new URL(req.url);
  const entities = await store.search({
    q: url.searchParams.get('q') ?? undefined,
    entity_type: (url.searchParams.get('entity_type') ?? undefined) as any,
    min_lat: asNum(url.searchParams.get('min_lat')),
    min_lon: asNum(url.searchParams.get('min_lon')),
    max_lat: asNum(url.searchParams.get('max_lat')),
    max_lon: asNum(url.searchParams.get('max_lon')),
    lat: asNum(url.searchParams.get('lat')),
    lon: asNum(url.searchParams.get('lon')),
    radius_km: asNum(url.searchParams.get('radius_km')),
    limit: asNum(url.searchParams.get('limit')),
    offset: asNum(url.searchParams.get('offset')),
  });

  if (url.searchParams.get('graph') === 'true') {
    return jsonResponse({
      entities,
      nodes: entities.map((e) => ({ id: e.id, type: 'entity', label: e.canonical_name, entity_type: e.entity_type })),
      edges: [],
    });
  }

  return jsonResponse({ entities });
}

async function handleGet(req: Request): Promise<Response> {
  const store = getEntityStore();
  const url = new URL(req.url);
  const match = url.pathname.match(/\/api\/intel\/entities\/([^/]+)$/);
  const id = match?.[1] ? decodeURIComponent(match[1]) : null;
  if (!id) return jsonResponse({ error: 'entity id required' }, 400);

  const entity = await store.getEntity(id);
  if (!entity) return jsonResponse({ error: 'entity not found' }, 404);

  const observations = await store.getObservations(id);
  const relationships = await store.getRelationships(id);
  const records = await store.getRecordsForEntity(id);

  if (url.searchParams.get('graph') === 'true') {
    const nodes = [
      { id: entity.id, type: 'entity', label: entity.canonical_name, entity_type: entity.entity_type },
      ...records.map((r) => ({ id: `rec:${r.id}`, type: 'record', label: r.title ?? r.id })),
      ...relationships.map((r) => ({ id: r.entity_a === entity.id ? r.entity_b : r.entity_a, type: 'entity' })),
    ];
    const edges = [
      ...observations.map((o) => ({ from: entity.id, to: `rec:${o.record_id}`, type: 'observation' })),
      ...relationships.map((r) => ({ from: r.entity_a, to: r.entity_b, type: r.relationship_type, confidence: r.confidence })),
    ];
    return jsonResponse({ entity, observations, relationships, records, nodes, edges });
  }

  return jsonResponse({ entity, observations, relationships, records });
}

async function handleObservations(req: Request): Promise<Response> {
  const store = getEntityStore();
  const url = new URL(req.url);
  const match = url.pathname.match(/\/api\/intel\/entities\/([^/]+)\/observations$/);
  const id = match?.[1] ? decodeURIComponent(match[1]) : null;
  if (!id) return jsonResponse({ error: 'entity id required' }, 400);

  const observations = await store.getObservations(id);
  return jsonResponse({ observations });
}

async function handleNearby(req: Request): Promise<Response> {
  const store = getEntityStore();
  const url = new URL(req.url);
  const lat = asNum(url.searchParams.get('lat'));
  const lon = asNum(url.searchParams.get('lon'));
  const radius_km = asNum(url.searchParams.get('radius_km'));
  if (lat === undefined || lon === undefined || radius_km === undefined) {
    return jsonResponse({ error: 'lat/lon/radius_km required' }, 400);
  }

  const entities = await store.search({ lat, lon, radius_km, entity_type: (url.searchParams.get('entity_type') ?? undefined) as any, limit: asNum(url.searchParams.get('limit')) });
  return jsonResponse({ entities });
}

export function createEntityRoutes(): RouteDescriptor[] {
  return [
    { method: 'GET', path: '/api/intel/entities/search', handler: handleSearch },
    { method: 'GET', path: '/api/intel/entities/nearby', handler: handleNearby },
    { method: 'GET', path: '/api/intel/entities/{id}', handler: handleGet },
    { method: 'GET', path: '/api/intel/entities/{id}/observations', handler: handleObservations },
  ];
}
