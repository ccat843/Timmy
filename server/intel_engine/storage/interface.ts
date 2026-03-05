import type { Observation, ObservationFilters } from '../schema';

export interface ObservationStorage {
  putObservation(obs: Observation): Promise<Observation>;
  listObservations(filters: ObservationFilters): Promise<Observation[]>;
  getObservation(id: string): Promise<Observation | null>;
}
