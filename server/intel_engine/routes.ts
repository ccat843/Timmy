import type { RouteDescriptor } from '../router';
import { getIntelEngine } from './engine';
import type { ObservationFilters } from './schema';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function parseObservationFilters(url: URL): ObservationFilters {
  const from = url.searchParams.get('from') ?? undefined;
  const to = url.searchParams.get('to') ?? undefined;
  const type = url.searchParams.get('type') ?? undefined;
  const source = url.searchParams.get('source') ?? undefined;

  return { from, to, type, source };
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

export function createIntelEngineRoutes(): RouteDescriptor[] {
  return [
    { method: 'POST', path: '/api/intel/ingest', handler: handleIngest },
    { method: 'GET', path: '/api/intel/observations', handler: handleList },
    { method: 'GET', path: '/api/intel/health', handler: handleHealth },
  ];
}
