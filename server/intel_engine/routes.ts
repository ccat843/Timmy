import type { RouteDescriptor } from '../router';
import { getIntelEngine } from './engine';
import { createRecordRoutes } from './records/routes';
import type { EventFilters, ObservationFilters } from './schema';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function parseBbox(raw: string | null): EventFilters['bbox'] {
  if (!raw) return undefined;
  const parts = raw.split(',').map((p) => Number(p.trim()));
  if (parts.length !== 4 || parts.some((v) => Number.isNaN(v))) return undefined;
  return {
    minLat: parts[0] ?? 0,
    minLon: parts[1] ?? 0,
    maxLat: parts[2] ?? 0,
    maxLon: parts[3] ?? 0,
  };
}

function parseObservationFilters(url: URL): ObservationFilters {
  const from = url.searchParams.get('from') ?? undefined;
  const to = url.searchParams.get('to') ?? undefined;
  const type = url.searchParams.get('type') ?? undefined;
  const source = url.searchParams.get('source') ?? undefined;

  return { from, to, type, source };
}

function parseEventFilters(url: URL): EventFilters {
  const from = url.searchParams.get('from') ?? undefined;
  const to = url.searchParams.get('to') ?? undefined;
  const bbox = parseBbox(url.searchParams.get('bbox'));
  const tags = (url.searchParams.get('tags') ?? '')
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean);
  const limitRaw = Number(url.searchParams.get('limit') ?? '100');
  const offsetRaw = Number(url.searchParams.get('offset') ?? '0');
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(1000, Math.floor(limitRaw))) : 100;
  const offset = Number.isFinite(offsetRaw) ? Math.max(0, Math.floor(offsetRaw)) : 0;

  return { from, to, bbox, tags: tags.length > 0 ? tags : undefined, limit, offset };
}

function parseEventId(url: URL): string | null {
  const match = url.pathname.match(/\/api\/intel\/events\/([^/]+)(?:\/generate-hypotheses|\/hypotheses)?$/);
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

async function handleIngest(req: Request): Promise<Response> {
  const engine = getIntelEngine();
  const payload = await req.json();

  if (Array.isArray(payload)) {
    const saved = [];
    for (const item of payload) {
      saved.push(await engine.ingestObservation(item));
    }
    return jsonResponse({ ingested: saved.length, observations: saved });
  }

  const observation = await engine.ingestObservation(payload);
  return jsonResponse({ ingested: 1, observations: [observation] });
}

async function handleList(req: Request): Promise<Response> {
  const engine = getIntelEngine();
  const filters = parseObservationFilters(new URL(req.url));
  const observations = await engine.queryObservations(filters);
  return jsonResponse({ observations });
}

async function handleHealth(): Promise<Response> {
  const engine = getIntelEngine();
  const health = await engine.health();
  return jsonResponse(health);
}

async function handleRebuildEvents(req: Request): Promise<Response> {
  const engine = getIntelEngine();
  const payload = await req.json().catch(() => ({})) as { days?: number };
  const days = typeof payload.days === 'number' && Number.isFinite(payload.days) ? Math.max(1, Math.floor(payload.days)) : 14;
  const result = await engine.rebuildEvents(days);
  return jsonResponse(result);
}

async function handleListEvents(req: Request): Promise<Response> {
  const engine = getIntelEngine();
  const filters = parseEventFilters(new URL(req.url));
  const events = await engine.listEvents(filters);
  return jsonResponse({ events });
}

async function handleGetEvent(req: Request): Promise<Response> {
  const engine = getIntelEngine();
  const url = new URL(req.url);
  const eventId = parseEventId(url);
  if (!eventId) return jsonResponse({ error: 'Event id required' }, 400);

  const event = await engine.getEvent(eventId);
  if (!event) return jsonResponse({ error: 'Event not found' }, 404);
  return jsonResponse({ event });
}

async function handleGenerateHypotheses(req: Request): Promise<Response> {
  const engine = getIntelEngine();
  const eventId = parseEventId(new URL(req.url));
  if (!eventId) return jsonResponse({ error: 'Event id required' }, 400);

  try {
    const result = await engine.generateHypotheses(eventId);
    return jsonResponse(result);
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : 'Failed to generate hypotheses' }, 404);
  }
}

async function handleListEventHypotheses(req: Request): Promise<Response> {
  const engine = getIntelEngine();
  const eventId = parseEventId(new URL(req.url));
  if (!eventId) return jsonResponse({ error: 'Event id required' }, 400);

  const hypotheses = await engine.listHypotheses(eventId);
  return jsonResponse({ hypotheses });
}

async function handleGetHypothesis(req: Request): Promise<Response> {
  const engine = getIntelEngine();
  const url = new URL(req.url);
  const match = url.pathname.match(/\/api\/intel\/hypotheses\/([^/]+)$/);
  const hypothesisId = match?.[1] ? decodeURIComponent(match[1]) : null;
  if (!hypothesisId) return jsonResponse({ error: 'Hypothesis id required' }, 400);

  const hypothesis = await engine.getHypothesis(hypothesisId);
  if (!hypothesis) return jsonResponse({ error: 'Hypothesis not found' }, 404);
  return jsonResponse(hypothesis);
}

export function createIntelEngineRoutes(): RouteDescriptor[] {
  return [
    { method: 'POST', path: '/api/intel/ingest', handler: handleIngest },
    { method: 'GET', path: '/api/intel/observations', handler: handleList },
    { method: 'GET', path: '/api/intel/health', handler: handleHealth },
    { method: 'POST', path: '/api/intel/rebuild-events', handler: handleRebuildEvents },
    { method: 'GET', path: '/api/intel/events', handler: handleListEvents },
    { method: 'GET', path: '/api/intel/events/{id}', handler: handleGetEvent },
    { method: 'POST', path: '/api/intel/events/{id}/generate-hypotheses', handler: handleGenerateHypotheses },
    { method: 'GET', path: '/api/intel/events/{id}/hypotheses', handler: handleListEventHypotheses },
    { method: 'GET', path: '/api/intel/hypotheses/{id}', handler: handleGetHypothesis },
    ...createRecordRoutes(),
  ];
}
