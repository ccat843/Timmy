import { buildEvents } from './events';
import { runHypothesisGeneration } from './hypothesis_engine';
import {
  parseObservation,
  type EventFilters,
  type EventWithObservations,
  type HypothesisWithEvidence,
  type Observation,
  type ObservationFilters,
} from './schema';
import { createDefaultObservationStorage } from './storage/sqlite';
import type { ObservationStorage } from './storage/interface';

export class IntelEngine {
  constructor(private readonly storage: ObservationStorage = createDefaultObservationStorage()) {}

  async ingestObservation(input: unknown): Promise<Observation> {
    const observation = parseObservation(input);
    return this.storage.putObservation(observation);
  }

  async queryObservations(filters: ObservationFilters = {}): Promise<Observation[]> {
    return this.storage.listObservations(filters);
  }

  async getObservation(id: string): Promise<Observation | null> {
    return this.storage.getObservation(id);
  }

  async rebuildEvents(days = 14): Promise<{ rebuilt: number; linkedObservations: number }> {
    const from = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    const observations = await this.storage.listObservations({ from });
    const { events, links } = buildEvents(observations, { windowHours: 6, radiusKm: 50, minTextOverlap: 0.2 });
    await this.storage.replaceEvents(events, links);
    return { rebuilt: events.length, linkedObservations: links.length };
  }

  async listEvents(filters: EventFilters = {}) {
    return this.storage.listEvents(filters);
  }

  async getEvent(id: string): Promise<EventWithObservations | null> {
    return this.storage.getEvent(id);
  }

  async generateHypotheses(eventId: string): Promise<{ created: number }> {
    const event = await this.storage.getEvent(eventId);
    if (!event) throw new Error('Event not found');
    const result = runHypothesisGeneration(event);
    await this.storage.replaceHypotheses(eventId, result.hypotheses, result.evidence);
    return { created: result.hypotheses.length };
  }

  async listHypotheses(eventId: string): Promise<HypothesisWithEvidence[]> {
    return this.storage.listHypothesesForEvent(eventId);
  }

  async getHypothesis(id: string): Promise<HypothesisWithEvidence | null> {
    return this.storage.getHypothesis(id);
  }

  async health(): Promise<{ ok: true; storedObservations: number }> {
    const all = await this.storage.listObservations({});
    return { ok: true, storedObservations: all.length };
  }
}

let sharedEngine: IntelEngine | null = null;

export function getIntelEngine(): IntelEngine {
  if (!sharedEngine) {
    sharedEngine = new IntelEngine();
  }
  return sharedEngine;
}
