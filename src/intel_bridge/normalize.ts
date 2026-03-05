import type { NewsItem, NaturalEvent } from '@/types';
import type { AirportDelayAlert } from '@/services/aviation';
import type { IntelObservation } from '@/intel_client/client';
import { hashString } from '@/utils/hash';

function toIso(value: Date | string | undefined): string {
  if (!value) return new Date().toISOString();
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return new Date().toISOString();
  return date.toISOString();
}

function buildObservationId(source: string, observedAt: string, identity: string): string {
  return `obs_${hashString(`${source}|${observedAt}|${identity}`)}`;
}

export function normalizeNewsItem(item: NewsItem): IntelObservation {
  const observedAt = toIso(item.pubDate);
  const identity = item.link || item.title;

  return {
    id: buildObservationId(`news:${item.source}`, observedAt, identity),
    type: 'news',
    source: item.source,
    observedAt,
    geo: (typeof item.lat === 'number' && typeof item.lon === 'number')
      ? { lat: item.lat, lon: item.lon, name: item.locationName }
      : undefined,
    text: [item.title, item.link].filter(Boolean).join(' — '),
    raw: item,
    tags: ['bridge', 'news'],
  };
}

export function normalizeNaturalEventItem(item: NaturalEvent): IntelObservation {
  const observedAt = toIso(item.date);
  const identity = item.sourceUrl || item.id || item.title;

  return {
    id: buildObservationId(`natural:${item.sourceName ?? 'eonet'}`, observedAt, identity),
    type: 'remote_sensing',
    source: item.sourceName ?? 'NASA EONET',
    observedAt,
    geo: { lat: item.lat, lon: item.lon, name: item.title },
    text: [item.title, item.description].filter(Boolean).join(' — '),
    raw: item,
    tags: ['bridge', 'natural', item.category],
  };
}

export function normalizeFlightDelayItem(item: AirportDelayAlert): IntelObservation {
  const observedAt = toIso(item.updatedAt);
  const identity = `${item.iata}|${item.delayType}|${item.reason ?? ''}`;

  return {
    id: buildObservationId(`aviation:${item.source}`, observedAt, identity),
    type: 'aviation',
    source: `flight_delays:${item.source}`,
    observedAt,
    geo: { lat: item.lat, lon: item.lon, name: item.name },
    text: [`${item.name} (${item.iata})`, item.reason, item.delayType].filter(Boolean).join(' — '),
    raw: item,
    tags: ['bridge', 'aviation', item.severity],
  };
}

export function normalizeNewsItems(items: NewsItem[]): IntelObservation[] {
  return items.map(normalizeNewsItem);
}

export function normalizeNaturalEvents(items: NaturalEvent[]): IntelObservation[] {
  return items.map(normalizeNaturalEventItem);
}

export function normalizeFlightDelays(items: AirportDelayAlert[]): IntelObservation[] {
  return items.map(normalizeFlightDelayItem);
}
