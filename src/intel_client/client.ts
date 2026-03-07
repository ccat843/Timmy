import { getIntelEngineBaseUrl } from '@/config/intel-engine';

const DEFAULT_TIMEOUT_MS = 20000;

export interface IntelObservation {
  id: string;
  type: string;
  source: string;
  observedAt: string;
  geo?: { lat: number; lon: number; name?: string };
  text?: string;
  raw: unknown;
  tags?: string[];
  confidence?: number;
}

export interface IntelObservationFilters {
  from?: string;
  to?: string;
  type?: string;
  source?: string;
}

export interface IntelEventObservation {
  id: string;
  observedAt: string;
  type: string;
  source: string;
  text?: string;
  raw: unknown;
}

export interface IntelEvent {
  id: string;
  title?: string;
  summary?: string;
  observedAt?: string;
  startAt?: string;
  endAt?: string;
  fromTime?: string;
  toTime?: string;
  location?: { lat?: number; lon?: number; name?: string };
  centroidLat?: number;
  centroidLon?: number;
  confidence?: number;
  tags?: string[];
  observations?: IntelEventObservation[];
}

export interface IntelHypothesis {
  id: string;
  eventId: string;
  label: string;
  description: string;
  confidence: number;
  createdAt: string;
}

export interface IntelHypothesisResult {
  hypothesis: IntelHypothesis;
  confidence: number;
  supportingObservations: IntelObservation[];
  contradictingObservations: IntelObservation[];
}

export interface ListEventsFilters {
  from?: string;
  to?: string;
  bbox?: string;
  limit?: number;
  offset?: number;
}

export interface IntelClientResult<T> {
  ok: boolean;
  data?: T;
  error?: string;
}

export interface UniversalRecord {
  id: string;
  source_id: string;
  source_type: string;
  entity_type?: string;
  fetched_at: string;
  published_at?: string;
  timestamp?: number;
  title?: string;
  text?: string;
  url?: string;
  geo_lat?: number;
  geo_lon?: number;
  tags?: string[];
  raw_json: string;
}


export interface InvestigationQuery {
  text?: string;
  source_type?: string;
  source_id?: string;
  entity_type?: string;
  entity_id?: string;
  related_to_entity_id?: string;
  relationship_type?: string;
  from?: string;
  to?: string;
  lat?: number;
  lon?: number;
  radius_km?: number;
  min_lat?: number;
  min_lon?: number;
  max_lat?: number;
  max_lon?: number;
  limit?: number;
  offset?: number;
  include_graph?: boolean;
}

export interface InvestigationResult {
  plan: { steps: string[]; estimatedCost: 'low' | 'medium' | 'high' };
  records: UniversalRecord[];
  entities: Array<{ id: string; entity_type: string; canonical_name: string; first_seen: number; last_seen: number; metadata_json: string }>;
  relationships: Array<{ id: string; entity_a: string; entity_b: string; relationship_type: string; confidence: number }>;
  graph?: { nodes: Array<Record<string, unknown>>; edges: Array<Record<string, unknown>> };
}

export interface RecordSearchFilters {
  q?: string;
  source?: string;
  source_type?: string;
  source_id?: string;
  entity_type?: string;
  from?: string;
  to?: string;
  start_time?: number;
  end_time?: number;
  lat?: number;
  lon?: number;
  radius_km?: number;
  min_lat?: number;
  min_lon?: number;
  max_lat?: number;
  max_lon?: number;
  limit?: number;
  offset?: number;
}

function buildIntelUrl(path: string, params?: Record<string, string | undefined>): string {
  const base = getIntelEngineBaseUrl();
  const url = new URL(path, base || window.location.origin);

  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value) url.searchParams.set(key, value);
    }
  }

  return base ? `${base}${url.pathname}${url.search}` : `${url.pathname}${url.search}`;
}

async function fetchJsonWithTimeout<T>(
  url: string,
  init?: RequestInit,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<IntelClientResult<T>> {
  const parseResponseJson = async (response: Response): Promise<IntelClientResult<T>> => {
    const contentType = (response.headers.get('Content-Type') ?? '').toLowerCase();
    if (!contentType.includes('application/json')) {
      const preview = (await response.text()).slice(0, 120).trim();
      if (preview.startsWith('<!DOCTYPE') || preview.startsWith('<html')) {
        return { ok: false, error: 'Intel API returned HTML instead of JSON. Check VITE_INTEL_ENGINE_BASE_URL and /api/intel routes.' };
      }
      return { ok: false, error: 'Intel API returned non-JSON response.' };
    }

    try {
      const data = await response.json() as T;
      return { ok: true, data };
    } catch {
      return { ok: false, error: 'Intel API returned invalid JSON.' };
    }
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    if (!response.ok) {
      return { ok: false, error: `Request failed (${response.status})` };
    }
    return await parseResponseJson(response);
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      if ((init?.method ?? 'GET').toUpperCase() === 'GET') {
        try {
          const retryResponse = await fetch(url, { ...init });
          if (retryResponse.ok) {
            return await parseResponseJson(retryResponse);
          }
        } catch {
          // fall through to timeout error
        }
      }
      return { ok: false, error: 'Request timed out' };
    }
    return { ok: false, error: error instanceof Error ? error.message : 'Request failed' };
  } finally {
    clearTimeout(timer);
  }
}

export async function ingestObservations(payload: IntelObservation | IntelObservation[]): Promise<IntelObservation[]> {
  const result = await fetchJsonWithTimeout<{ observations?: IntelObservation[] }>(buildIntelUrl('/api/intel/ingest'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!result.ok) {
    throw new Error(result.error ?? 'Failed to ingest observations');
  }

  return result.data?.observations ?? [];
}

export async function queryObservations(filters: IntelObservationFilters = {}): Promise<IntelObservation[]> {
  const result = await fetchJsonWithTimeout<{ observations?: IntelObservation[] }>(buildIntelUrl('/api/intel/observations', {
    from: filters.from,
    to: filters.to,
    type: filters.type,
    source: filters.source,
  }));

  if (!result.ok) {
    throw new Error(result.error ?? 'Failed to query observations');
  }

  return result.data?.observations ?? [];
}

export async function health(): Promise<{ ok: boolean; storedObservations?: number; error?: string }> {
  const result = await fetchJsonWithTimeout<{ ok: boolean; storedObservations: number }>(buildIntelUrl('/api/intel/health'));
  if (!result.ok) return { ok: false, error: result.error };
  return { ok: Boolean(result.data?.ok), storedObservations: result.data?.storedObservations };
}

export async function listEvents(filters: ListEventsFilters = {}): Promise<{ ok: boolean; events: IntelEvent[]; error?: string }> {
  const result = await fetchJsonWithTimeout<{ events?: IntelEvent[] }>(buildIntelUrl('/api/intel/events', {
    from: filters.from,
    to: filters.to,
    bbox: filters.bbox,
    limit: filters.limit !== undefined ? String(filters.limit) : undefined,
    offset: filters.offset !== undefined ? String(filters.offset) : undefined,
  }));

  if (!result.ok) return { ok: false, events: [], error: result.error };
  return { ok: true, events: result.data?.events ?? [] };
}

export async function getEvent(id: string): Promise<{ ok: boolean; event: IntelEvent | null; error?: string }> {
  const result = await fetchJsonWithTimeout<{ event?: IntelEvent }>(buildIntelUrl(`/api/intel/events/${encodeURIComponent(id)}`));
  if (!result.ok) return { ok: false, event: null, error: result.error };
  return { ok: true, event: result.data?.event ?? null };
}

export async function generateHypotheses(eventId: string): Promise<{ ok: boolean; created?: number; error?: string }> {
  const result = await fetchJsonWithTimeout<{ created?: number }>(buildIntelUrl(`/api/intel/events/${encodeURIComponent(eventId)}/generate-hypotheses`), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
  if (!result.ok) return { ok: false, error: result.error };
  return { ok: true, created: result.data?.created ?? 0 };
}

export async function listEventHypotheses(eventId: string): Promise<{ ok: boolean; hypotheses: IntelHypothesisResult[]; error?: string }> {
  const result = await fetchJsonWithTimeout<{ hypotheses?: IntelHypothesisResult[] }>(buildIntelUrl(`/api/intel/events/${encodeURIComponent(eventId)}/hypotheses`));
  if (!result.ok) return { ok: false, hypotheses: [], error: result.error };
  return { ok: true, hypotheses: result.data?.hypotheses ?? [] };
}

export async function getHypothesis(id: string): Promise<{ ok: boolean; hypothesis?: IntelHypothesisResult; error?: string }> {
  const result = await fetchJsonWithTimeout<IntelHypothesisResult>(buildIntelUrl(`/api/intel/hypotheses/${encodeURIComponent(id)}`));
  if (!result.ok) return { ok: false, error: result.error };
  return { ok: true, hypothesis: result.data };
}

export async function getIntelHealth(): Promise<{ ok: boolean; storedObservations: number }> {
  const status = await health();
  if (!status.ok) {
    throw new Error(status.error ?? 'Failed to query intel engine health');
  }
  return { ok: true, storedObservations: status.storedObservations ?? 0 };
}


export async function searchRecords(filters: RecordSearchFilters = {}): Promise<{ ok: boolean; records: UniversalRecord[]; error?: string }> {
  const result = await fetchJsonWithTimeout<{ records?: UniversalRecord[] }>(buildIntelUrl('/api/intel/records/search', {
    q: filters.q,
    source: filters.source,
    source_type: filters.source_type,
    source_id: filters.source_id,
    entity_type: filters.entity_type,
    from: filters.from,
    to: filters.to,
    start_time: filters.start_time !== undefined ? String(filters.start_time) : undefined,
    end_time: filters.end_time !== undefined ? String(filters.end_time) : undefined,
    lat: filters.lat !== undefined ? String(filters.lat) : undefined,
    lon: filters.lon !== undefined ? String(filters.lon) : undefined,
    radius_km: filters.radius_km !== undefined ? String(filters.radius_km) : undefined,
    min_lat: filters.min_lat !== undefined ? String(filters.min_lat) : undefined,
    min_lon: filters.min_lon !== undefined ? String(filters.min_lon) : undefined,
    max_lat: filters.max_lat !== undefined ? String(filters.max_lat) : undefined,
    max_lon: filters.max_lon !== undefined ? String(filters.max_lon) : undefined,
    limit: filters.limit !== undefined ? String(filters.limit) : undefined,
    offset: filters.offset !== undefined ? String(filters.offset) : undefined,
  }));
  if (!result.ok) return { ok: false, records: [], error: result.error };
  return { ok: true, records: result.data?.records ?? [] };
}

export async function ingestRecords(payload: UniversalRecord | UniversalRecord[]): Promise<{ ok: boolean; inserted?: number; error?: string }> {
  const result = await fetchJsonWithTimeout<{ inserted?: number }>(buildIntelUrl('/api/intel/records/ingest'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!result.ok) return { ok: false, error: result.error };
  return { ok: true, inserted: result.data?.inserted ?? 0 };
}

export async function getRecordById(id: string): Promise<{ ok: boolean; record?: UniversalRecord; error?: string }> {
  const result = await fetchJsonWithTimeout<{ record?: UniversalRecord }>(buildIntelUrl(`/api/intel/records/${encodeURIComponent(id)}`));
  if (!result.ok) return { ok: false, error: result.error };
  return { ok: true, record: result.data?.record };
}

export async function cleanupRecords(): Promise<{ ok: boolean; removed?: number; error?: string }> {
  const result = await fetchJsonWithTimeout<{ removed?: number }>(buildIntelUrl('/api/intel/records/cleanup'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
  if (!result.ok) return { ok: false, error: result.error };
  return { ok: true, removed: result.data?.removed ?? 0 };
}

export async function getRecordStats(): Promise<{ ok: boolean; total?: number; perSource?: Record<string, number>; estimatedBytes?: number; error?: string }> {
  const result = await fetchJsonWithTimeout<{ total: number; perSource: Record<string, number>; estimatedBytes: number }>(buildIntelUrl('/api/intel/records/stats'));
  if (!result.ok) return { ok: false, error: result.error };
  return { ok: true, total: result.data?.total, perSource: result.data?.perSource, estimatedBytes: result.data?.estimatedBytes };
}


export async function queryInvestigation(payload: InvestigationQuery): Promise<{ ok: boolean; result?: InvestigationResult; error?: string }> {
  const result = await fetchJsonWithTimeout<InvestigationResult>(buildIntelUrl('/api/intel/investigation/query'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!result.ok) return { ok: false, error: result.error };
  return { ok: true, result: result.data };
}

export async function askInvestigation(question: string): Promise<{ ok: boolean; structured_query?: InvestigationQuery; result?: InvestigationResult; error?: string }> {
  const result = await fetchJsonWithTimeout<{ structured_query: InvestigationQuery; result: InvestigationResult }>(buildIntelUrl('/api/intel/investigation/ask'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question }),
  });
  if (!result.ok) return { ok: false, error: result.error };
  return { ok: true, structured_query: result.data?.structured_query, result: result.data?.result };
}


export async function rebuildEvents(days = 14): Promise<{ ok: boolean; built?: number; error?: string }> {
  const result = await fetchJsonWithTimeout<{ built?: number }>(buildIntelUrl('/api/intel/rebuild-events'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ days }),
  }, 30000);
  if (!result.ok) return { ok: false, error: result.error };
  return { ok: true, built: result.data?.built ?? 0 };
}
