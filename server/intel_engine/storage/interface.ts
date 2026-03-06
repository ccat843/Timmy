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

export interface ObservationStorage {
  putObservation(obs: Observation): Promise<Observation>;
  listObservations(filters: ObservationFilters): Promise<Observation[]>;
  getObservation(id: string): Promise<Observation | null>;
  replaceEvents(events: IntelEvent[], links: Array<{ eventId: string; observationId: string }>): Promise<void>;
  listEvents(filters: EventFilters): Promise<IntelEvent[]>;
  getEvent(id: string): Promise<EventWithObservations | null>;
  replaceHypotheses(eventId: string, hypotheses: Hypothesis[], evidence: HypothesisEvidence[]): Promise<void>;
  listHypothesesForEvent(eventId: string): Promise<HypothesisWithEvidence[]>;
  getHypothesis(id: string): Promise<HypothesisWithEvidence | null>;
}
