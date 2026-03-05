import test from 'node:test';
import assert from 'node:assert/strict';
import { runHypothesisGeneration } from '../server/intel_engine/hypothesis_engine.ts';
import type { EventWithObservations } from '../server/intel_engine/schema.ts';

test('runHypothesisGeneration returns hypotheses with supporting/contradicting links', () => {
  const event: EventWithObservations = {
    id: 'evt-1',
    createdAt: '2026-01-01T00:00:00.000Z',
    fromTime: '2026-01-01T00:00:00.000Z',
    toTime: '2026-01-01T03:00:00.000Z',
    title: 'Power outage incident',
    summary: 'Outage and aviation impacts',
    tags: ['news'],
    observations: [
      {
        id: 'o1',
        type: 'news',
        source: 'feed-a',
        observedAt: '2026-01-01T00:00:00.000Z',
        text: 'Major outage reported across the city grid',
        raw: {},
      },
      {
        id: 'o2',
        type: 'aviation',
        source: 'flight_delays:faa',
        observedAt: '2026-01-01T01:00:00.000Z',
        text: 'Airport delays continue after outage',
        raw: {},
      },
    ],
  };

  const result = runHypothesisGeneration(event);
  assert.ok(result.hypotheses.length >= 1);
  assert.ok(result.evidence.length >= 1);
  const relations = new Set(result.evidence.map((row) => row.relation));
  assert.ok(relations.has('supports') || relations.has('contradicts'));
});
