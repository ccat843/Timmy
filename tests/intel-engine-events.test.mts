import test from 'node:test';
import assert from 'node:assert/strict';
import { buildEvents } from '../server/intel_engine/events.ts';
import type { Observation } from '../server/intel_engine/schema.ts';

test('buildEvents clusters nearby observations by time and text overlap', () => {
  const observations: Observation[] = [
    {
      id: 'o1',
      type: 'news',
      source: 'feed-a',
      observedAt: '2026-01-01T10:00:00.000Z',
      geo: { lat: 40.0, lon: -74.0 },
      text: 'Power outage reported in New York city',
      raw: {},
    },
    {
      id: 'o2',
      type: 'news',
      source: 'feed-b',
      observedAt: '2026-01-01T12:00:00.000Z',
      geo: { lat: 40.1, lon: -74.05 },
      text: 'City officials confirm New York outage',
      raw: {},
    },
    {
      id: 'o3',
      type: 'aviation',
      source: 'faa',
      observedAt: '2026-01-02T03:00:00.000Z',
      geo: { lat: 34.0, lon: -118.2 },
      text: 'Airport closure in Los Angeles',
      raw: {},
    },
  ];

  const { events, links } = buildEvents(observations);
  assert.equal(events.length, 2);
  assert.equal(links.length, 3);
  const sizes = events.map((event) => links.filter((link) => link.eventId === event.id).length).sort((a, b) => b - a);
  assert.deepEqual(sizes, [2, 1]);
});
