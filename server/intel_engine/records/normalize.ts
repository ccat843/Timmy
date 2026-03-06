import { hashString } from '../../_shared/hash';
import { buildRecordId, type UniversalRecord } from './schema';

const MAX_RAW_JSON_BYTES = Math.max(1024, Number(process.env.MAX_RAW_JSON_BYTES ?? '262144'));

function toBoundedRawJson(payload: unknown): string {
  const serialized = JSON.stringify(payload ?? null);
  if (serialized.length <= MAX_RAW_JSON_BYTES) return serialized;

  const truncated = serialized.slice(0, Math.max(0, MAX_RAW_JSON_BYTES - 64));
  return JSON.stringify({
    _truncated: true,
    _original_bytes: serialized.length,
    _max_bytes: MAX_RAW_JSON_BYTES,
    payload_preview: truncated,
  });
}

function asObject(input: unknown): Record<string, unknown> | null {
  return input && typeof input === 'object' && !Array.isArray(input) ? input as Record<string, unknown> : null;
}

function toIso(value: unknown): string | undefined {
  if (typeof value !== 'string' && !(value instanceof Date)) return undefined;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  return date.toISOString();
}

function fromPathToSourceType(pathname: string): string {
  const parts = pathname.split('/').filter(Boolean);
  if (parts.length >= 3 && parts[0] === 'api') return parts[1] ?? 'unknown';
  return 'unknown';
}

function flattenPayloadItems(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  const obj = asObject(payload);
  if (!obj) return [payload];

  const candidates: unknown[] = [];
  for (const key of ['items', 'events', 'alerts', 'records', 'observations', 'quotes', 'data', 'results']) {
    const value = obj[key];
    if (Array.isArray(value)) candidates.push(...value);
  }

  if (candidates.length > 0) return candidates;
  return [payload];
}

export function normalizeApiResponseToRecords(pathname: string, payload: unknown): UniversalRecord[] {
  const sourceType = fromPathToSourceType(pathname);
  const fetchedAt = new Date().toISOString();
  const items = flattenPayloadItems(payload);

  return items.map((item, index) => {
    const obj = asObject(item);
    const title = typeof obj?.title === 'string' ? obj.title : typeof obj?.name === 'string' ? obj.name : undefined;
    const text = typeof obj?.summary === 'string'
      ? obj.summary
      : typeof obj?.description === 'string'
        ? obj.description
        : typeof obj?.text === 'string'
          ? obj.text
          : undefined;
    const url = typeof obj?.url === 'string'
      ? obj.url
      : typeof obj?.link === 'string'
        ? obj.link
        : undefined;

    const lat = typeof obj?.lat === 'number'
      ? obj.lat
      : typeof obj?.latitude === 'number'
        ? obj.latitude
        : undefined;
    const lon = typeof obj?.lon === 'number'
      ? obj.lon
      : typeof obj?.longitude === 'number'
        ? obj.longitude
        : undefined;

    const publishedAt = toIso(obj?.published_at)
      ?? toIso(obj?.publishedAt)
      ?? toIso(obj?.date)
      ?? toIso(obj?.time)
      ?? toIso(obj?.updatedAt);

    const sourceId = typeof obj?.source === 'string'
      ? obj.source
      : typeof obj?.id === 'string'
        ? obj.id
        : `${sourceType}_${index}`;

    const tags = Array.isArray(obj?.tags)
      ? obj?.tags.filter((tag): tag is string => typeof tag === 'string')
      : undefined;

    const rawJson = toBoundedRawJson(item);
    const id = buildRecordId({
      sourceType,
      sourceId,
      publishedAt,
      url,
      text: `${title ?? ''} ${text ?? ''}`.trim(),
      rawJson,
    });

    return {
      id,
      source_id: sourceId,
      source_type: sourceType,
      fetched_at: fetchedAt,
      published_at: publishedAt,
      title,
      text,
      url,
      geo_lat: lat,
      geo_lon: lon,
      tags,
      raw_json: rawJson,
    } satisfies UniversalRecord;
  }).filter((record) => {
    const dedupeKey = `${record.url ?? ''}|${hashString(record.raw_json)}`;
    return dedupeKey.length > 1;
  });
}
