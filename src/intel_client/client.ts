import { getIntelEngineBaseUrl } from '@/config/intel-engine';

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

export async function ingestObservations(payload: IntelObservation | IntelObservation[]): Promise<IntelObservation[]> {
  const response = await fetch(buildIntelUrl('/api/intel/ingest'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`Failed to ingest observations (${response.status})`);
  }

  const data = await response.json() as { observations?: IntelObservation[] };
  return data.observations ?? [];
}

export async function queryObservations(filters: IntelObservationFilters = {}): Promise<IntelObservation[]> {
  const response = await fetch(buildIntelUrl('/api/intel/observations', {
    from: filters.from,
    to: filters.to,
    type: filters.type,
    source: filters.source,
  }));
  if (!response.ok) {
    throw new Error(`Failed to query observations (${response.status})`);
  }

  const data = await response.json() as { observations?: IntelObservation[] };
  return data.observations ?? [];
}

export async function getIntelHealth(): Promise<{ ok: boolean; storedObservations: number }> {
  const response = await fetch(buildIntelUrl('/api/intel/health'));
  if (!response.ok) {
    throw new Error(`Failed to query intel engine health (${response.status})`);
  }

  return response.json() as Promise<{ ok: boolean; storedObservations: number }>;
}
