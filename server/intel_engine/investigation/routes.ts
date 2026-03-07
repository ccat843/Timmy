import type { RouteDescriptor } from '../../router';
import { executeInvestigationQuery } from './executor';
import { parseInvestigationQuestion } from './nl_parser';
import type { InvestigationAskRequest, InvestigationQuery } from './types';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function asNum(value: string | null): number | undefined {
  if (value == null || value === '') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

async function handleQuery(req: Request): Promise<Response> {
  const query = await req.json() as InvestigationQuery;
  const result = await executeInvestigationQuery(query);
  return jsonResponse(result);
}

async function handleAsk(req: Request): Promise<Response> {
  const body = await req.json() as InvestigationAskRequest;
  if (!body?.question || typeof body.question !== 'string') {
    return jsonResponse({ error: 'question is required' }, 400);
  }

  const structured = parseInvestigationQuestion(body.question);
  const result = await executeInvestigationQuery(structured);
  return jsonResponse({ structured_query: structured, result });
}

async function handleQueryGet(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const query: InvestigationQuery = {
    text: url.searchParams.get('q') ?? undefined,
    source_type: url.searchParams.get('source_type') ?? undefined,
    source_id: url.searchParams.get('source_id') ?? undefined,
    entity_type: (url.searchParams.get('entity_type') ?? undefined) as InvestigationQuery['entity_type'],
    entity_id: url.searchParams.get('entity_id') ?? undefined,
    related_to_entity_id: url.searchParams.get('related_to_entity_id') ?? undefined,
    relationship_type: url.searchParams.get('relationship_type') ?? undefined,
    from: url.searchParams.get('from') ?? undefined,
    to: url.searchParams.get('to') ?? undefined,
    lat: asNum(url.searchParams.get('lat')),
    lon: asNum(url.searchParams.get('lon')),
    radius_km: asNum(url.searchParams.get('radius_km')),
    min_lat: asNum(url.searchParams.get('min_lat')),
    min_lon: asNum(url.searchParams.get('min_lon')),
    max_lat: asNum(url.searchParams.get('max_lat')),
    max_lon: asNum(url.searchParams.get('max_lon')),
    limit: asNum(url.searchParams.get('limit')),
    offset: asNum(url.searchParams.get('offset')),
    include_graph: url.searchParams.get('include_graph') === 'true',
  };

  const result = await executeInvestigationQuery(query);
  return jsonResponse(result);
}

export function createInvestigationRoutes(): RouteDescriptor[] {
  return [
    { method: 'POST', path: '/api/intel/investigation/query', handler: handleQuery },
    { method: 'GET', path: '/api/intel/investigation/query', handler: handleQueryGet },
    { method: 'POST', path: '/api/intel/investigation/ask', handler: handleAsk },
  ];
}
