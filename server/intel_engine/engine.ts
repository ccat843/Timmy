import { parseObservation, type Observation, type ObservationFilters } from './schema';
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
