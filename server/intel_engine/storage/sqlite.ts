import type {
  EventFilters,
  EventWithObservations,
  Hypothesis,
  HypothesisEvidence,
  HypothesisWithEvidence,
  IntelEvent,
  Observation,
  ObservationFilters,
} from '../schema';
import type { ObservationStorage } from './interface';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

const DEFAULT_STORAGE_PATH = process.env.INTEL_ENGINE_STORAGE_PATH ?? '.local/intel_engine/observations.jsonl';

type EventObservationLink = { eventId: string; observationId: string };

function normalizeId(id: string): string {
  return id.trim();
}

function inBbox(
  geo: Observation['geo'] | { lat?: number; lon?: number } | undefined,
  bbox: ObservationFilters['bbox'] | EventFilters['bbox'] | undefined,
): boolean {
  if (!bbox) return true;
  if (!geo || typeof geo.lat !== 'number' || typeof geo.lon !== 'number') return false;
  return geo.lat >= bbox.minLat
    && geo.lat <= bbox.maxLat
    && geo.lon >= bbox.minLon
    && geo.lon <= bbox.maxLon;
}

function filterObservations(observations: Observation[], filters: ObservationFilters): Observation[] {
  const fromEpoch = filters.from ? Date.parse(filters.from) : undefined;
  const toEpoch = filters.to ? Date.parse(filters.to) : undefined;

  return observations.filter((obs) => {
    const observedEpoch = Date.parse(obs.observedAt);
    if (fromEpoch !== undefined && observedEpoch < fromEpoch) return false;
    if (toEpoch !== undefined && observedEpoch > toEpoch) return false;
    if (filters.type && obs.type !== filters.type) return false;
    if (filters.source && obs.source !== filters.source) return false;
    if (!inBbox(obs.geo, filters.bbox)) return false;
    return true;
  });
}

function filterEvents(events: IntelEvent[], filters: EventFilters): IntelEvent[] {
  const fromEpoch = filters.from ? Date.parse(filters.from) : undefined;
  const toEpoch = filters.to ? Date.parse(filters.to) : undefined;
  const requiredTags = filters.tags && filters.tags.length > 0 ? new Set(filters.tags.map((t) => t.toLowerCase())) : null;

  let filtered = events.filter((event) => {
    const fromTimeEpoch = Date.parse(event.fromTime);
    const toTimeEpoch = Date.parse(event.toTime);
    if (fromEpoch !== undefined && toTimeEpoch < fromEpoch) return false;
    if (toEpoch !== undefined && fromTimeEpoch > toEpoch) return false;
    if (!inBbox({ lat: event.centroidLat, lon: event.centroidLon }, filters.bbox)) return false;
    if (requiredTags) {
      const eventTags = new Set((event.tags ?? []).map((tag) => tag.toLowerCase()));
      for (const tag of requiredTags) {
        if (!eventTags.has(tag)) return false;
      }
    }
    return true;
  });

  filtered = filtered.sort((a, b) => b.toTime.localeCompare(a.toTime));
  const offset = Math.max(0, filters.offset ?? 0);
  const limit = Math.max(1, filters.limit ?? 100);
  return filtered.slice(offset, offset + limit);
}

export class JsonlObservationStorage implements ObservationStorage {
  private readonly obsPath: string;
  private readonly eventsPath: string;
  private readonly linksPath: string;
  private readonly hypothesesPath: string;
  private readonly hypothesisEvidencePath: string;
  private loaded = false;
  private readonly observations = new Map<string, Observation>();
  private readonly events = new Map<string, IntelEvent>();
  private readonly hypotheses = new Map<string, Hypothesis>();
  private readonly hypothesesByEvent = new Map<string, Set<string>>(); // idx_hyp_event
  private links: EventObservationLink[] = [];
  private hypothesisEvidence: HypothesisEvidence[] = [];

  constructor(filePath = DEFAULT_STORAGE_PATH) {
    this.obsPath = filePath;
    const baseDir = filePath.includes('/') ? filePath.slice(0, filePath.lastIndexOf('/')) : '.';
    this.eventsPath = `${baseDir}/events.jsonl`;
    this.linksPath = `${baseDir}/event_observations.jsonl`;
    this.hypothesesPath = `${baseDir}/hypotheses.jsonl`;
    this.hypothesisEvidencePath = `${baseDir}/hypothesis_evidence.jsonl`;
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;

    const readLines = async (path: string): Promise<string[]> => {
      try {
        const content = await readFile(path, 'utf8');
        return content.split('\n').map((line) => line.trim()).filter(Boolean);
      } catch {
        return [];
      }
    };

    for (const line of await readLines(this.obsPath)) {
      try {
        const parsed = JSON.parse(line) as Observation;
        const normalized = normalizeId(parsed.id);
        if (normalized) this.observations.set(normalized, parsed);
      } catch {
        // ignore malformed line
      }
    }

    for (const line of await readLines(this.eventsPath)) {
      try {
        const parsed = JSON.parse(line) as IntelEvent;
        const normalized = normalizeId(parsed.id);
        if (normalized) this.events.set(normalized, parsed);
      } catch {
        // ignore malformed line
      }
    }

    const links: EventObservationLink[] = [];
    for (const line of await readLines(this.linksPath)) {
      try {
        const parsed = JSON.parse(line) as EventObservationLink;
        if (parsed.eventId && parsed.observationId) links.push(parsed);
      } catch {
        // ignore malformed line
      }
    }
    this.links = links;

    for (const line of await readLines(this.hypothesesPath)) {
      try {
        const parsed = JSON.parse(line) as Hypothesis;
        const id = normalizeId(parsed.id);
        if (!id) continue;
        const eventId = normalizeId(parsed.eventId);
        if (!eventId) continue;
        const normalizedHyp: Hypothesis = { ...parsed, id, eventId };
        this.hypotheses.set(id, normalizedHyp);
        const existing = this.hypothesesByEvent.get(eventId) ?? new Set<string>();
        existing.add(id);
        this.hypothesesByEvent.set(eventId, existing);
      } catch {
        // ignore malformed line
      }
    }

    const evidence: HypothesisEvidence[] = [];
    for (const line of await readLines(this.hypothesisEvidencePath)) {
      try {
        const parsed = JSON.parse(line) as HypothesisEvidence;
        if (!parsed.hypothesisId || !parsed.observationId) continue;
        if (parsed.relation !== 'supports' && parsed.relation !== 'contradicts') continue;
        evidence.push({
          hypothesisId: normalizeId(parsed.hypothesisId),
          observationId: normalizeId(parsed.observationId),
          relation: parsed.relation,
          weight: typeof parsed.weight === 'number' ? parsed.weight : 0,
        });
      } catch {
        // ignore malformed line
      }
    }
    this.hypothesisEvidence = evidence;
  }

  private async ensureDir(): Promise<void> {
    const lastSlash = this.obsPath.lastIndexOf('/');
    const dir = lastSlash > 0 ? this.obsPath.slice(0, lastSlash) : '';
    if (dir) await mkdir(dir, { recursive: true });
  }

  private async flushObservations(): Promise<void> {
    const body = Array.from(this.observations.values())
      .sort((a, b) => a.observedAt.localeCompare(b.observedAt))
      .map((obs) => JSON.stringify(obs))
      .join('\n');
    await writeFile(this.obsPath, body.length > 0 ? `${body}\n` : '', 'utf8');
  }

  private async flushEvents(): Promise<void> {
    const eventsBody = Array.from(this.events.values())
      .sort((a, b) => a.fromTime.localeCompare(b.fromTime))
      .map((event) => JSON.stringify(event))
      .join('\n');

    const linksBody = this.links.map((link) => JSON.stringify(link)).join('\n');

    await writeFile(this.eventsPath, eventsBody.length > 0 ? `${eventsBody}\n` : '', 'utf8');
    await writeFile(this.linksPath, linksBody.length > 0 ? `${linksBody}\n` : '', 'utf8');
  }

  private async flushHypotheses(): Promise<void> {
    const hypothesesBody = Array.from(this.hypotheses.values())
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map((hypothesis) => JSON.stringify(hypothesis))
      .join('\n');

    const evidenceBody = this.hypothesisEvidence
      .map((row) => JSON.stringify(row))
      .join('\n');

    await writeFile(this.hypothesesPath, hypothesesBody.length > 0 ? `${hypothesesBody}\n` : '', 'utf8');
    await writeFile(this.hypothesisEvidencePath, evidenceBody.length > 0 ? `${evidenceBody}\n` : '', 'utf8');
  }

  async putObservation(obs: Observation): Promise<Observation> {
    await this.ensureLoaded();
    await this.ensureDir();
    const id = normalizeId(obs.id);
    if (!id) throw new Error('Observation.id cannot be empty');
    const next: Observation = { ...obs, id };
    this.observations.set(id, next);
    await this.flushObservations();
    return next;
  }

  async listObservations(filters: ObservationFilters): Promise<Observation[]> {
    await this.ensureLoaded();
    const all = Array.from(this.observations.values());
    return filterObservations(all, filters).sort((a, b) => b.observedAt.localeCompare(a.observedAt));
  }

  async getObservation(id: string): Promise<Observation | null> {
    await this.ensureLoaded();
    return this.observations.get(normalizeId(id)) ?? null;
  }

  async replaceEvents(events: IntelEvent[], links: EventObservationLink[]): Promise<void> {
    await this.ensureLoaded();
    await this.ensureDir();
    this.events.clear();
    for (const event of events) {
      const normalized = normalizeId(event.id);
      if (normalized) this.events.set(normalized, { ...event, id: normalized });
    }

    const dedupe = new Set<string>();
    this.links = [];
    for (const link of links) {
      const eventId = normalizeId(link.eventId);
      const observationId = normalizeId(link.observationId);
      if (!eventId || !observationId) continue;
      const key = `${eventId}|${observationId}`;
      if (dedupe.has(key)) continue;
      dedupe.add(key);
      this.links.push({ eventId, observationId });
    }

    await this.flushEvents();
  }

  async listEvents(filters: EventFilters): Promise<IntelEvent[]> {
    await this.ensureLoaded();
    return filterEvents(Array.from(this.events.values()), filters);
  }

  async getEvent(id: string): Promise<EventWithObservations | null> {
    await this.ensureLoaded();
    const event = this.events.get(normalizeId(id));
    if (!event) return null;

    const observationIds = this.links
      .filter((link) => link.eventId === event.id)
      .map((link) => link.observationId);

    const observations = observationIds
      .map((obsId) => this.observations.get(obsId))
      .filter((obs): obs is Observation => Boolean(obs))
      .sort((a, b) => a.observedAt.localeCompare(b.observedAt));

    return { ...event, observations };
  }

  async replaceHypotheses(eventId: string, hypotheses: Hypothesis[], evidence: HypothesisEvidence[]): Promise<void> {
    await this.ensureLoaded();
    await this.ensureDir();
    const normalizedEventId = normalizeId(eventId);

    const existingIds = this.hypothesesByEvent.get(normalizedEventId) ?? new Set<string>();
    for (const hypId of existingIds) {
      this.hypotheses.delete(hypId);
    }
    this.hypothesesByEvent.delete(normalizedEventId);
    this.hypothesisEvidence = this.hypothesisEvidence.filter((row) => !existingIds.has(row.hypothesisId));

    const nextIds = new Set<string>();
    for (const hypothesis of hypotheses) {
      const normalizedId = normalizeId(hypothesis.id);
      if (!normalizedId) continue;
      const nextHypothesis: Hypothesis = {
        ...hypothesis,
        id: normalizedId,
        eventId: normalizedEventId,
      };
      this.hypotheses.set(normalizedId, nextHypothesis);
      nextIds.add(normalizedId);
    }
    if (nextIds.size > 0) this.hypothesesByEvent.set(normalizedEventId, nextIds);

    const dedupe = new Set<string>();
    for (const row of evidence) {
      const hypothesisId = normalizeId(row.hypothesisId);
      const observationId = normalizeId(row.observationId);
      if (!nextIds.has(hypothesisId) || !observationId) continue;
      if (row.relation !== 'supports' && row.relation !== 'contradicts') continue;
      const key = `${hypothesisId}|${observationId}`;
      if (dedupe.has(key)) continue;
      dedupe.add(key);
      this.hypothesisEvidence.push({
        hypothesisId,
        observationId,
        relation: row.relation,
        weight: row.weight,
      });
    }

    await this.flushHypotheses();
  }

  async listHypothesesForEvent(eventId: string): Promise<HypothesisWithEvidence[]> {
    await this.ensureLoaded();
    const hypothesisIds = this.hypothesesByEvent.get(normalizeId(eventId));
    if (!hypothesisIds || hypothesisIds.size === 0) return [];

    const hypotheses = Array.from(hypothesisIds)
      .map((id) => this.hypotheses.get(id))
      .filter((hypothesis): hypothesis is Hypothesis => Boolean(hypothesis))
      .sort((a, b) => b.confidence - a.confidence);

    return hypotheses.map((hypothesis) => this.toHypothesisWithEvidence(hypothesis));
  }

  async getHypothesis(id: string): Promise<HypothesisWithEvidence | null> {
    await this.ensureLoaded();
    const hypothesis = this.hypotheses.get(normalizeId(id));
    if (!hypothesis) return null;
    return this.toHypothesisWithEvidence(hypothesis);
  }

  private toHypothesisWithEvidence(hypothesis: Hypothesis): HypothesisWithEvidence {
    const rows = this.hypothesisEvidence.filter((row) => row.hypothesisId === hypothesis.id);
    const supportingObservations = rows
      .filter((row) => row.relation === 'supports')
      .map((row) => this.observations.get(row.observationId))
      .filter((obs): obs is Observation => Boolean(obs));

    const contradictingObservations = rows
      .filter((row) => row.relation === 'contradicts')
      .map((row) => this.observations.get(row.observationId))
      .filter((obs): obs is Observation => Boolean(obs));

    return {
      hypothesis,
      confidence: hypothesis.confidence,
      supportingObservations,
      contradictingObservations,
    };
  }
}

export function createDefaultObservationStorage(): ObservationStorage {
  return new JsonlObservationStorage();
}
