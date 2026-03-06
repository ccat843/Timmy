import { hashString } from '../_shared/hash';
import type { IntelEvent, Observation } from './schema';

export interface BuildEventsOptions {
  windowHours?: number;
  radiusKm?: number;
  minTextOverlap?: number;
}

interface Cluster {
  observations: Observation[];
  centroidLat?: number;
  centroidLon?: number;
  tokenSet: Set<string>;
  fromTime: string;
  toTime: string;
}

function tokenize(text: string | undefined): Set<string> {
  if (!text) return new Set();
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .map((part) => part.trim())
      .filter((part) => part.length >= 3),
  );
}

function overlapScore(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let overlap = 0;
  for (const token of a) {
    if (b.has(token)) overlap++;
  }
  return overlap / Math.min(a.size, b.size);
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (v: number): number => (v * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function withinTimeWindow(observation: Observation, cluster: Cluster, windowHours: number): boolean {
  const obsEpoch = Date.parse(observation.observedAt);
  const fromEpoch = Date.parse(cluster.fromTime);
  const toEpoch = Date.parse(cluster.toTime);
  const windowMs = windowHours * 60 * 60 * 1000;
  return obsEpoch >= fromEpoch - windowMs && obsEpoch <= toEpoch + windowMs;
}

function withinGeo(observation: Observation, cluster: Cluster, radiusKm: number): boolean {
  if (!observation.geo || cluster.centroidLat === undefined || cluster.centroidLon === undefined) {
    return true;
  }
  return haversineKm(observation.geo.lat, observation.geo.lon, cluster.centroidLat, cluster.centroidLon) <= radiusKm;
}

function updateCluster(cluster: Cluster, observation: Observation): Cluster {
  const nextObservations = [...cluster.observations, observation].sort((a, b) => a.observedAt.localeCompare(b.observedAt));
  const tokenSet = new Set(cluster.tokenSet);
  for (const token of tokenize(observation.text)) tokenSet.add(token);

  const withGeo = nextObservations.filter((obs) => obs.geo);
  const centroidLat = withGeo.length > 0
    ? withGeo.reduce((sum, obs) => sum + (obs.geo?.lat ?? 0), 0) / withGeo.length
    : cluster.centroidLat;
  const centroidLon = withGeo.length > 0
    ? withGeo.reduce((sum, obs) => sum + (obs.geo?.lon ?? 0), 0) / withGeo.length
    : cluster.centroidLon;

  return {
    observations: nextObservations,
    centroidLat,
    centroidLon,
    tokenSet,
    fromTime: nextObservations[0]?.observedAt ?? cluster.fromTime,
    toTime: nextObservations[nextObservations.length - 1]?.observedAt ?? cluster.toTime,
  };
}

function createCluster(observation: Observation): Cluster {
  return {
    observations: [observation],
    centroidLat: observation.geo?.lat,
    centroidLon: observation.geo?.lon,
    tokenSet: tokenize(observation.text),
    fromTime: observation.observedAt,
    toTime: observation.observedAt,
  };
}

export function buildEvents(
  observations: Observation[],
  options: BuildEventsOptions = {},
): { events: IntelEvent[]; links: Array<{ eventId: string; observationId: string }> } {
  const windowHours = options.windowHours ?? 6;
  const radiusKm = options.radiusKm ?? 50;
  const minTextOverlap = options.minTextOverlap ?? 0.2;

  const sorted = [...observations].sort((a, b) => a.observedAt.localeCompare(b.observedAt));
  const clusters: Cluster[] = [];

  for (const observation of sorted) {
    const obsTokens = tokenize(observation.text);
    let matchedIndex = -1;

    for (let i = clusters.length - 1; i >= 0; i--) {
      const cluster = clusters[i];
      if (!cluster) continue;
      if (!withinTimeWindow(observation, cluster, windowHours)) continue;
      if (!withinGeo(observation, cluster, radiusKm)) continue;
      const score = overlapScore(obsTokens, cluster.tokenSet);
      if (score >= minTextOverlap || cluster.observations.length < 2) {
        matchedIndex = i;
        break;
      }
    }

    if (matchedIndex >= 0) {
      const cluster = clusters[matchedIndex];
      if (cluster) clusters[matchedIndex] = updateCluster(cluster, observation);
    } else {
      clusters.push(createCluster(observation));
    }
  }

  const now = new Date().toISOString();
  const events: IntelEvent[] = [];
  const links: Array<{ eventId: string; observationId: string }> = [];

  for (const cluster of clusters) {
    const seed = cluster.observations.map((obs) => obs.id).join('|');
    const eventId = `evt_${hashString(seed)}`;
    const sortedObs = [...cluster.observations].sort((a, b) => a.observedAt.localeCompare(b.observedAt));
    const first = sortedObs[0];
    const types = Array.from(new Set(sortedObs.map((obs) => obs.type)));
    const sources = Array.from(new Set(sortedObs.map((obs) => obs.source)));

    const event: IntelEvent = {
      id: eventId,
      createdAt: now,
      fromTime: cluster.fromTime,
      toTime: cluster.toTime,
      centroidLat: cluster.centroidLat,
      centroidLon: cluster.centroidLon,
      title: first?.text?.slice(0, 120) || first?.type || eventId,
      summary: `${sortedObs.length} observations from ${sources.length} sources`,
      confidence: Math.min(0.99, 0.3 + sortedObs.length * 0.08),
      tags: Array.from(new Set([...types, ...sources])).slice(0, 20),
    };

    events.push(event);
    for (const obs of sortedObs) {
      links.push({ eventId, observationId: obs.id });
    }
  }

  events.sort((a, b) => b.toTime.localeCompare(a.toTime));
  return { events, links };
}
