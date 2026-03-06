import { z } from 'zod';
import { hashString } from '../../_shared/hash';

export const recordSchema = z.object({
  id: z.string(),
  source_id: z.string(),
  source_type: z.string(),
  entity_type: z.string().optional(),
  fetched_at: z.string(),
  published_at: z.string().optional(),
  timestamp: z.number().optional(),
  title: z.string().optional(),
  text: z.string().optional(),
  url: z.string().optional(),
  geo_lat: z.number().optional(),
  geo_lon: z.number().optional(),
  tags: z.array(z.string()).optional(),
  raw_json: z.string(),
});

export type UniversalRecord = import('zod').infer<typeof recordSchema>;

export interface RecordSearchFilters {
  q?: string;
  source?: string;
  source_type?: string;
  source_id?: string;
  entity_type?: string;
  lat?: number;
  lon?: number;
  radius_km?: number;
  min_lat?: number;
  min_lon?: number;
  max_lat?: number;
  max_lon?: number;
  start_time?: number;
  end_time?: number;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}

export function buildRecordId(input: {
  sourceType: string;
  sourceId: string;
  publishedAt?: string;
  url?: string;
  text?: string;
  rawJson: string;
}): string {
  const key = `${input.sourceType}|${input.sourceId}|${input.publishedAt ?? ''}|${input.url ?? ''}|${input.text ?? ''}|${hashString(input.rawJson)}`;
  return `rec_${hashString(key)}`;
}

export function parseUniversalRecord(input: unknown): UniversalRecord {
  return recordSchema.parse(input);
}
