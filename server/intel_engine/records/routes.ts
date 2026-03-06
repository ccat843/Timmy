import type { RouteDescriptor } from '../../router';
import { getUniversalRecordStore } from './storage_sqlite';
import { normalizeApiResponseToRecords } from './normalize';
import { parseUniversalRecord } from './schema';
import { processEntityResolution } from '../entities/routes';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function asNum(value: string | null): number | undefined {
  if (value == null || value === '') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseFilters(url: URL) {
  return {
    q: url.searchParams.get('q') ?? undefined,
    source: url.searchParams.get('source') ?? undefined,
    source_type: url.searchParams.get('source_type') ?? undefined,
    source_id: url.searchParams.get('source_id') ?? undefined,
    entity_type: url.searchParams.get('entity_type') ?? undefined,
    lat: asNum(url.searchParams.get('lat')),
    lon: asNum(url.searchParams.get('lon')),
    radius_km: asNum(url.searchParams.get('radius_km')),
    min_lat: asNum(url.searchParams.get('min_lat')),
    min_lon: asNum(url.searchParams.get('min_lon')),
    max_lat: asNum(url.searchParams.get('max_lat')),
    max_lon: asNum(url.searchParams.get('max_lon')),
    start_time: asNum(url.searchParams.get('start_time')),
    end_time: asNum(url.searchParams.get('end_time')),
    from: url.searchParams.get('from') ?? undefined,
    to: url.searchParams.get('to') ?? undefined,
    limit: Number(url.searchParams.get('limit') ?? '50'),
    offset: Number(url.searchParams.get('offset') ?? '0'),
  };
}

export async function ingestRecordsFromApiPayload(pathname: string, payload: unknown): Promise<void> {
  try {
    const records = normalizeApiResponseToRecords(pathname, payload);
    if (records.length === 0) return;
    const store = getUniversalRecordStore();
    await store.ingest(records);
    void processEntityResolution(records);
  } catch {
    // non-blocking capture path by design
  }
}

async function handleIngest(req: Request): Promise<Response> {
  const body = await req.json();
  const store = getUniversalRecordStore();
  const arr = Array.isArray(body) ? body : [body];
  const parsed = arr.map((item) => parseUniversalRecord(item));
  const result = await store.ingest(parsed);
  void processEntityResolution(parsed);
  return jsonResponse(result);
}

async function handleSearch(req: Request): Promise<Response> {
  const filters = parseFilters(new URL(req.url));
  const store = getUniversalRecordStore();
  const records = await store.search(filters);
  return jsonResponse({ records });
}

async function handleGetRecord(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const match = url.pathname.match(/\/api\/intel\/records\/([^/]+)$/);
  const id = match?.[1] ? decodeURIComponent(match[1]) : null;
  if (!id) return jsonResponse({ error: 'record id required' }, 400);

  const store = getUniversalRecordStore();
  const record = await store.getById(id);
  if (!record) return jsonResponse({ error: 'record not found' }, 404);
  return jsonResponse({ record });
}

async function handleCleanup(): Promise<Response> {
  const store = getUniversalRecordStore();
  const result = await store.cleanup();
  return jsonResponse(result);
}

async function handleStats(): Promise<Response> {
  const store = getUniversalRecordStore();
  const stats = await store.stats();
  return jsonResponse(stats);
}

export function createRecordRoutes(): RouteDescriptor[] {
  return [
    { method: 'POST', path: '/api/intel/records/ingest', handler: handleIngest },
    { method: 'GET', path: '/api/intel/records/search', handler: handleSearch },
    { method: 'GET', path: '/api/intel/records/{id}', handler: handleGetRecord },
    { method: 'POST', path: '/api/intel/records/cleanup', handler: handleCleanup },
    { method: 'GET', path: '/api/intel/records/stats', handler: handleStats },
  ];
}
