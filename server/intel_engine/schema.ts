export interface ObservationGeo {
  lat: number;
  lon: number;
  name?: string;
}

export interface Observation {
  id: string;
  type: string;
  source: string;
  observedAt: string;
  geo?: ObservationGeo;
  text?: string;
  raw: unknown;
  tags?: string[];
  confidence?: number;
}

export interface IntelEvent {
  id: string;
  type: string;
  observedAt: string;
}

export interface IntelEntity {
  id: string;
  label: string;
  type?: string;
}

export interface ObservationFilters {
  from?: string;
  to?: string;
  type?: string;
  source?: string;
  bbox?: {
    minLat: number;
    minLon: number;
    maxLat: number;
    maxLon: number;
  };
}

export function isIsoDateString(value: string): boolean {
  const epoch = Date.parse(value);
  if (Number.isNaN(epoch)) return false;
  return new Date(epoch).toISOString() === value;
}

export function parseObservation(input: unknown): Observation {
  if (!input || typeof input !== 'object') {
    throw new Error('Observation payload must be an object');
  }

  const candidate = input as Partial<Observation>;
  if (!candidate.id || typeof candidate.id !== 'string') throw new Error('Observation.id is required');
  if (!candidate.type || typeof candidate.type !== 'string') throw new Error('Observation.type is required');
  if (!candidate.source || typeof candidate.source !== 'string') throw new Error('Observation.source is required');
  if (!candidate.observedAt || typeof candidate.observedAt !== 'string' || !isIsoDateString(candidate.observedAt)) {
    throw new Error('Observation.observedAt must be an ISO timestamp');
  }

  if (candidate.geo) {
    if (typeof candidate.geo !== 'object') throw new Error('Observation.geo must be an object');
    if (typeof candidate.geo.lat !== 'number' || typeof candidate.geo.lon !== 'number') {
      throw new Error('Observation.geo.lat/lon must be numbers');
    }
  }

  if (candidate.tags && (!Array.isArray(candidate.tags) || candidate.tags.some((tag) => typeof tag !== 'string'))) {
    throw new Error('Observation.tags must be a string[]');
  }

  if (candidate.confidence !== undefined && (typeof candidate.confidence !== 'number' || candidate.confidence < 0 || candidate.confidence > 1)) {
    throw new Error('Observation.confidence must be between 0 and 1');
  }

  return {
    id: candidate.id,
    type: candidate.type,
    source: candidate.source,
    observedAt: candidate.observedAt,
    geo: candidate.geo,
    text: typeof candidate.text === 'string' ? candidate.text : undefined,
    raw: candidate.raw,
    tags: candidate.tags,
    confidence: candidate.confidence,
  };
}
