/**
 * Universal source adapters for ALL documented WorldMonitor source types.
 * Coverage is aligned to `server/intel_engine/records/source_inventory.ts`.
 *
 * Runtime usage:
 * - server passive capture path: server/gateway.ts -> server/intel_engine/records/normalize.ts
 * - browser-only sources path: src/app/data-loader.ts -> emitSourceRecords() -> this module
 */
import { hashString } from '@/utils/hash';

export interface BridgeRecord {
  id: string;
  source_id: string;
  source_type: string;
  fetched_at: string;
  published_at?: string;
  title?: string;
  text?: string;
  url?: string;
  geo_lat?: number;
  geo_lon?: number;
  tags?: string[];
  raw_json: string;
}

function asObj(input: unknown): Record<string, unknown> | null {
  return input && typeof input === 'object' && !Array.isArray(input) ? input as Record<string, unknown> : null;
}

function pickIso(obj: Record<string, unknown> | null): string | undefined {
  if (!obj) return undefined;
  for (const key of ['published_at', 'publishedAt', 'date', 'time', 'updatedAt', 'timestamp']) {
    const v = obj[key];
    if (typeof v !== 'string') continue;
    const d = new Date(v);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  return undefined;
}

function genericToRecord(sourceType: string, item: unknown, sourceIdHint?: string): BridgeRecord {
  const obj = asObj(item);
  const title = typeof obj?.title === 'string' ? obj.title : typeof obj?.name === 'string' ? obj.name : undefined;
  const text = typeof obj?.summary === 'string' ? obj.summary : typeof obj?.description === 'string' ? obj.description : typeof obj?.text === 'string' ? obj.text : undefined;
  const url = typeof obj?.url === 'string' ? obj.url : typeof obj?.link === 'string' ? obj.link : undefined;
  const geo_lat = typeof obj?.lat === 'number' ? obj.lat : typeof obj?.latitude === 'number' ? obj.latitude : undefined;
  const geo_lon = typeof obj?.lon === 'number' ? obj.lon : typeof obj?.longitude === 'number' ? obj.longitude : undefined;
  const source_id = sourceIdHint
    ?? (typeof obj?.source === 'string' ? obj.source : typeof obj?.id === 'string' ? obj.id : sourceType);
  const fetched_at = new Date().toISOString();
  const published_at = pickIso(obj);
  const raw_json = JSON.stringify(item ?? null);
  const id = `rec_${hashString(`${sourceType}|${source_id}|${published_at ?? ''}|${url ?? ''}|${hashString(raw_json)}`)}`;
  return { id, source_id, source_type: sourceType, fetched_at, published_at, title, text, url, geo_lat, geo_lon, raw_json };
}

const COVERED_SOURCE_TYPES = [
  'news', 'economic', 'market', 'intelligence', 'cyber', 'positive-events', 'giving',
  'military', 'climate', 'infrastructure', 'research', 'aviation', 'prediction', 'seismology',
  'supply-chain', 'wildfire', 'displacement', 'maritime', 'conflict', 'trade', 'natural', 'unrest',
  'frontend-live-channels', 'frontend-news-panels',
] as const;

export type CoveredSourceType = typeof COVERED_SOURCE_TYPES[number];

export const SOURCE_ADAPTERS: Record<CoveredSourceType, (item: unknown, sourceIdHint?: string) => BridgeRecord> = {
  'news': (item, sourceIdHint) => genericToRecord('news', item, sourceIdHint),
  'economic': (item, sourceIdHint) => genericToRecord('economic', item, sourceIdHint),
  'market': (item, sourceIdHint) => genericToRecord('market', item, sourceIdHint),
  'intelligence': (item, sourceIdHint) => genericToRecord('intelligence', item, sourceIdHint),
  'cyber': (item, sourceIdHint) => genericToRecord('cyber', item, sourceIdHint),
  'positive-events': (item, sourceIdHint) => genericToRecord('positive-events', item, sourceIdHint),
  'giving': (item, sourceIdHint) => genericToRecord('giving', item, sourceIdHint),
  'military': (item, sourceIdHint) => genericToRecord('military', item, sourceIdHint),
  'climate': (item, sourceIdHint) => genericToRecord('climate', item, sourceIdHint),
  'infrastructure': (item, sourceIdHint) => genericToRecord('infrastructure', item, sourceIdHint),
  'research': (item, sourceIdHint) => genericToRecord('research', item, sourceIdHint),
  'aviation': (item, sourceIdHint) => genericToRecord('aviation', item, sourceIdHint),
  'prediction': (item, sourceIdHint) => genericToRecord('prediction', item, sourceIdHint),
  'seismology': (item, sourceIdHint) => genericToRecord('seismology', item, sourceIdHint),
  'supply-chain': (item, sourceIdHint) => genericToRecord('supply-chain', item, sourceIdHint),
  'wildfire': (item, sourceIdHint) => genericToRecord('wildfire', item, sourceIdHint),
  'displacement': (item, sourceIdHint) => genericToRecord('displacement', item, sourceIdHint),
  'maritime': (item, sourceIdHint) => genericToRecord('maritime', item, sourceIdHint),
  'conflict': (item, sourceIdHint) => genericToRecord('conflict', item, sourceIdHint),
  'trade': (item, sourceIdHint) => genericToRecord('trade', item, sourceIdHint),
  'natural': (item, sourceIdHint) => genericToRecord('natural', item, sourceIdHint),
  'unrest': (item, sourceIdHint) => genericToRecord('unrest', item, sourceIdHint),
  'frontend-live-channels': (item, sourceIdHint) => genericToRecord('frontend-live-channels', item, sourceIdHint),
  'frontend-news-panels': (item, sourceIdHint) => genericToRecord('frontend-news-panels', item, sourceIdHint),
};

export function normalizeAllSourceItem(sourceType: CoveredSourceType, item: unknown, sourceIdHint?: string): BridgeRecord {
  return SOURCE_ADAPTERS[sourceType](item, sourceIdHint);
}
