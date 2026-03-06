import { ingestObservations, type IntelObservation } from '@/intel_client/client';
import { getObservationBridgeEnabled } from './settings';

const MAX_RETRIES = 3;
const BASE_BACKOFF_MS = 1000;
const DEDUPE_WINDOW_MS = 30 * 60 * 1000;

interface QueueItem {
  observation: IntelObservation;
  retryCount: number;
}

const queue: QueueItem[] = [];
const seenIds = new Map<string, number>();
let processing = false;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function shouldEnqueue(observation: IntelObservation): boolean {
  const now = Date.now();
  const lastSeen = seenIds.get(observation.id);
  if (lastSeen && now - lastSeen < DEDUPE_WINDOW_MS) {
    return false;
  }

  seenIds.set(observation.id, now);

  for (const [id, timestamp] of seenIds.entries()) {
    if (now - timestamp > DEDUPE_WINDOW_MS * 2) {
      seenIds.delete(id);
    }
  }

  return true;
}

async function flushQueue(): Promise<void> {
  if (processing) return;
  processing = true;

  try {
    while (queue.length > 0) {
      const batch = queue.splice(0, Math.min(50, queue.length));
      const payload = batch.map((entry) => entry.observation);

      try {
        await ingestObservations(payload);
      } catch (error) {
        for (const entry of batch) {
          if (entry.retryCount < MAX_RETRIES) {
            queue.push({ observation: entry.observation, retryCount: entry.retryCount + 1 });
          }
        }
        const maxRetry = Math.max(...batch.map((entry) => entry.retryCount));
        const backoff = BASE_BACKOFF_MS * (2 ** maxRetry);
        await sleep(backoff);
        if (maxRetry >= MAX_RETRIES) {
          console.warn('[intel-bridge] Observation ingest failed after retries', error);
        }
      }
    }
  } finally {
    processing = false;
  }
}

export function emitObservations(observations: IntelObservation[]): void {
  if (!getObservationBridgeEnabled()) return;
  const accepted = observations.filter(shouldEnqueue);
  if (accepted.length === 0) return;

  for (const observation of accepted) {
    queue.push({ observation, retryCount: 0 });
  }

  void flushQueue();
}
