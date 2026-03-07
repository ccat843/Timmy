import { hashString } from '../_shared/hash';
import type { EventWithObservations, Hypothesis, HypothesisEvidence, Observation } from './schema';

interface Candidate {
  key: string;
  label: string;
  description: string;
  seedScore: number;
}

function lowerText(observation: Observation): string {
  return (observation.text ?? '').toLowerCase();
}

function observationHasAny(observation: Observation, terms: string[]): boolean {
  const text = lowerText(observation);
  return terms.some((term) => text.includes(term));
}

function buildCandidates(event: EventWithObservations): Candidate[] {
  const candidates = new Map<string, Candidate>();

  const pushCandidate = (candidate: Candidate): void => {
    const existing = candidates.get(candidate.key);
    if (!existing || existing.seedScore < candidate.seedScore) {
      candidates.set(candidate.key, candidate);
    }
  };

  const hasAviation = event.observations.some((obs) => obs.type.includes('aviation') || obs.source.includes('flight'));
  if (hasAviation) {
    pushCandidate({
      key: 'aviation_disruption',
      label: 'Aviation disruption',
      description: 'Operational disruptions in aviation are driving this event.',
      seedScore: 0.56,
    });
  }

  const hasNatural = event.observations.some((obs) => obs.type.includes('remote_sensing') || obs.source.toLowerCase().includes('nasa'));
  if (hasNatural) {
    pushCandidate({
      key: 'natural_hazard',
      label: 'Natural hazard escalation',
      description: 'Natural hazard signals indicate the event is environment-driven.',
      seedScore: 0.58,
    });
  }

  const outageHits = event.observations.filter((obs) => observationHasAny(obs, ['outage', 'blackout', 'power grid'])).length;
  if (outageHits > 0) {
    pushCandidate({
      key: 'infrastructure_outage',
      label: 'Infrastructure outage',
      description: 'Critical infrastructure degradation is likely contributing to the event.',
      seedScore: 0.55 + Math.min(0.2, outageHits * 0.04),
    });
  }

  const conflictHits = event.observations.filter((obs) => observationHasAny(obs, ['attack', 'strike', 'military', 'missile', 'explosion'])).length;
  if (conflictHits > 0) {
    pushCandidate({
      key: 'conflict_activity',
      label: 'Conflict-driven activity',
      description: 'Kinetic/conflict indicators suggest deliberate hostile activity.',
      seedScore: 0.57 + Math.min(0.2, conflictHits * 0.03),
    });
  }

  if (candidates.size === 0) {
    pushCandidate({
      key: 'mixed_signals',
      label: 'Mixed-cause event',
      description: 'Signals are mixed; event may involve multiple overlapping drivers.',
      seedScore: 0.5,
    });
  }

  return Array.from(candidates.values());
}

export function generateHypotheses(event: EventWithObservations): Hypothesis[] {
  const createdAt = new Date().toISOString();
  return buildCandidates(event).map((candidate) => ({
    id: `hyp_${hashString(`${event.id}|${candidate.key}`)}`,
    eventId: event.id,
    label: candidate.label,
    description: candidate.description,
    confidence: Math.min(0.95, Math.max(0.2, candidate.seedScore)),
    createdAt,
  }));
}

export function scoreHypotheses(
  event: EventWithObservations,
  hypotheses: Hypothesis[],
): { hypotheses: Hypothesis[]; evidence: HypothesisEvidence[] } {
  const evidence: HypothesisEvidence[] = [];
  const updated = hypotheses.map((hypothesis) => ({ ...hypothesis }));

  for (const observation of event.observations) {
    const text = lowerText(observation);

    for (const hypothesis of updated) {
      let relation: HypothesisEvidence['relation'] | null = null;
      let weight = 0;

      if (hypothesis.label.toLowerCase().includes('aviation')) {
        if (observation.type.includes('aviation') || observation.source.includes('flight')) {
          relation = 'supports';
          weight = 0.12;
        } else if (observation.type.includes('remote_sensing')) {
          relation = 'contradicts';
          weight = 0.05;
        }
      } else if (hypothesis.label.toLowerCase().includes('natural')) {
        if (observation.type.includes('remote_sensing') || text.includes('earthquake') || text.includes('wildfire')) {
          relation = 'supports';
          weight = 0.12;
        } else if (text.includes('military') || text.includes('strike')) {
          relation = 'contradicts';
          weight = 0.05;
        }
      } else if (hypothesis.label.toLowerCase().includes('infrastructure')) {
        if (text.includes('outage') || text.includes('blackout') || text.includes('grid')) {
          relation = 'supports';
          weight = 0.1;
        } else if (text.includes('festival') || text.includes('sports')) {
          relation = 'contradicts';
          weight = 0.04;
        }
      } else if (hypothesis.label.toLowerCase().includes('conflict')) {
        if (text.includes('attack') || text.includes('missile') || text.includes('military') || text.includes('strike')) {
          relation = 'supports';
          weight = 0.11;
        } else if (text.includes('weather') || text.includes('storm')) {
          relation = 'contradicts';
          weight = 0.05;
        }
      } else if (hypothesis.label.toLowerCase().includes('mixed-cause')) {
        relation = 'supports';
        weight = 0.03;
      }

      if (relation) {
        evidence.push({
          hypothesisId: hypothesis.id,
          observationId: observation.id,
          relation,
          weight,
        });
        hypothesis.confidence = Math.max(
          0.05,
          Math.min(0.99, hypothesis.confidence + (relation === 'supports' ? weight : -weight)),
        );
      }
    }
  }

  return { hypotheses: updated, evidence };
}

export function runHypothesisGeneration(event: EventWithObservations): { hypotheses: Hypothesis[]; evidence: HypothesisEvidence[] } {
  const initial = generateHypotheses(event);
  return scoreHypotheses(event, initial);
}
