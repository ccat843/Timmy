import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeNewsItem, normalizeNaturalEventItem, normalizeFlightDelayItem } from '../src/intel_bridge/normalize.ts';
import type { NewsItem, NaturalEvent } from '../src/types/index.ts';
import type { AirportDelayAlert } from '../src/services/aviation/index.ts';

test('normalizeNewsItem creates stable id and shape', () => {
  const item: NewsItem = {
    source: 'test-news',
    title: 'Bridge test headline',
    link: 'https://example.com/story',
    pubDate: new Date('2026-01-01T10:00:00.000Z'),
    isAlert: false,
  };

  const first = normalizeNewsItem(item);
  const second = normalizeNewsItem(item);
  assert.equal(first.id, second.id);
  assert.equal(first.type, 'news');
  assert.equal(first.source, 'test-news');
  assert.equal(first.observedAt, '2026-01-01T10:00:00.000Z');
});

test('normalizeNaturalEventItem includes geo and remote_sensing type', () => {
  const item: NaturalEvent = {
    id: 'nat-1',
    title: 'Wildfire plume',
    category: 'wildfires',
    categoryTitle: 'Wildfires',
    lat: 12.2,
    lon: 43.1,
    date: new Date('2026-01-02T00:00:00.000Z'),
    closed: false,
    sourceName: 'NASA EONET',
  };

  const normalized = normalizeNaturalEventItem(item);
  assert.equal(normalized.type, 'remote_sensing');
  assert.equal(normalized.geo?.lat, 12.2);
  assert.equal(normalized.geo?.lon, 43.1);
});

test('normalizeFlightDelayItem maps aviation source and geo', () => {
  const item: AirportDelayAlert = {
    id: 'flt-1',
    iata: 'LHR',
    icao: 'EGLL',
    name: 'Heathrow',
    city: 'London',
    country: 'UK',
    lat: 51.47,
    lon: -0.45,
    region: 'europe',
    delayType: 'ground_delay',
    severity: 'major',
    avgDelayMinutes: 50,
    source: 'faa',
    updatedAt: new Date('2026-01-03T08:00:00.000Z'),
  };

  const normalized = normalizeFlightDelayItem(item);
  assert.equal(normalized.type, 'aviation');
  assert.equal(normalized.source, 'flight_delays:faa');
  assert.equal(normalized.geo?.name, 'Heathrow');
});
