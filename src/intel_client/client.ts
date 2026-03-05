import { getIntelEngineBaseUrl } from '@/config/intel-engine';

const DEFAULT_TIMEOUT_MS = 8000;

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
  fetched_at: string;
  published_at?: string;
  title?: string;
  text?: string;
  url?: string;
  geo_lat?: number;
  geo_lon?: number;
  tags?: string[];
  raw_json: string;
}

export interface RecordSearchFilters {
  q?: string;
  source_type?: string;
  source_id?: string;
  from?: string;
  to?: string;
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
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    if (!response.ok) {
      return { ok: false, error: `Request failed (${response.status})` };
    }
    const data = await response.json() as T;
    return { ok: true, data };
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
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
    source_type: filters.source_type,
    source_id: filters.source_id,
    from: filters.from,
    to: filters.to,
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
