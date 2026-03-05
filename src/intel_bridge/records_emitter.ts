import { ingestRecords, type UniversalRecord } from '@/intel_client/client';
import { normalizeAllSourceItem, type CoveredSourceType } from './normalize_all_sources';

const QUEUE: UniversalRecord[] = [];
let flushing = false;

async function flushQueue(): Promise<void> {
  if (flushing) return;
  flushing = true;
  try {
    while (QUEUE.length > 0) {
      const batch = QUEUE.splice(0, 100);
      const result = await ingestRecords(batch);
      if (!result.ok) {
        // fire-and-forget path: avoid breaking UI data loading
        break;
      }
    }
  } finally {
    flushing = false;
  }
}

export function emitSourceRecords(sourceType: CoveredSourceType, items: unknown[], sourceIdHint?: string): void {
  if (!Array.isArray(items) || items.length === 0) return;
  for (const item of items) {
    try {
      QUEUE.push(normalizeAllSourceItem(sourceType, item, sourceIdHint));
    } catch {
      // ignore single-item normalization errors
    }
  }
  void flushQueue();
}
