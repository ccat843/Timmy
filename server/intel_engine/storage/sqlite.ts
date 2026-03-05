import type { Observation, ObservationFilters } from '../schema';
import type { ObservationStorage } from './interface';

// Local-first default adapter implemented as JSONL for zero dependency overhead.
// File name remains sqlite.ts so callers can keep a stable import path.
import { mkdir, readFile, writeFile } from 'node:fs/promises';

const DEFAULT_STORAGE_PATH = process.env.INTEL_ENGINE_STORAGE_PATH ?? '.local/intel_engine/observations.jsonl';

function normalizeId(id: string): string {
  return id.trim();
}

function inBbox(
  geo: Observation['geo'] | undefined,
  bbox: ObservationFilters['bbox'] | undefined,
): boolean {
  if (!bbox) return true;
  if (!geo) return false;
  return geo.lat >= bbox.minLat
    && geo.lat <= bbox.maxLat
    && geo.lon >= bbox.minLon
    && geo.lon <= bbox.maxLon;
}

function filterObservations(observations: Observation[], filters: ObservationFilters): Observation[] {
  const fromEpoch = filters.from ? Date.parse(filters.from) : undefined;
  const toEpoch = filters.to ? Date.parse(filters.to) : undefined;

  return observations.filter((obs) => {
    const observedEpoch = Date.parse(obs.observedAt);
    if (fromEpoch !== undefined && observedEpoch < fromEpoch) return false;
    if (toEpoch !== undefined && observedEpoch > toEpoch) return false;
    if (filters.type && obs.type !== filters.type) return false;
    if (filters.source && obs.source !== filters.source) return false;
    if (!inBbox(obs.geo, filters.bbox)) return false;
    return true;
  });
}

export class JsonlObservationStorage implements ObservationStorage {
  private readonly filePath: string;
  private loaded = false;
  private readonly cache = new Map<string, Observation>();

  constructor(filePath = DEFAULT_STORAGE_PATH) {
    this.filePath = filePath;
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;

    try {
      const content = await readFile(this.filePath, 'utf8');
      const lines = content.split('\n').map((line) => line.trim()).filter(Boolean);
      for (const line of lines) {
        try {
          const parsed = JSON.parse(line) as Observation;
          const normalized = normalizeId(parsed.id);
          if (normalized) this.cache.set(normalized, parsed);
        } catch {
          // Ignore malformed lines and continue loading the rest.
        }
      }
    } catch {
      // Missing file is expected on first run.
    }
  }

  private async flush(): Promise<void> {
    const lastSlash = this.filePath.lastIndexOf('/');
    const dir = lastSlash > 0 ? this.filePath.slice(0, lastSlash) : '';
    if (dir) {
      await mkdir(dir, { recursive: true });
    }

    const body = Array.from(this.cache.values())
      .sort((a, b) => a.observedAt.localeCompare(b.observedAt))
      .map((obs) => JSON.stringify(obs))
      .join('\n');

    await writeFile(this.filePath, body.length > 0 ? `${body}\n` : '', 'utf8');
  }

  async putObservation(obs: Observation): Promise<Observation> {
    await this.ensureLoaded();
    const id = normalizeId(obs.id);
    if (!id) throw new Error('Observation.id cannot be empty');
    const next: Observation = { ...obs, id };
    this.cache.set(id, next);
    await this.flush();
    return next;
  }

  async listObservations(filters: ObservationFilters): Promise<Observation[]> {
    await this.ensureLoaded();
    const all = Array.from(this.cache.values());
    return filterObservations(all, filters).sort((a, b) => b.observedAt.localeCompare(a.observedAt));
  }

  async getObservation(id: string): Promise<Observation | null> {
    await this.ensureLoaded();
    return this.cache.get(normalizeId(id)) ?? null;
  }
}

export function createDefaultObservationStorage(): ObservationStorage {
  return new JsonlObservationStorage();
}
