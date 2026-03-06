import type { EntityType } from '../entities/types';
import type { InvestigationQuery } from './types';

const ENTITY_TYPE_KEYWORDS: Array<{ type: EntityType; keywords: string[] }> = [
  { type: 'aircraft', keywords: ['aircraft', 'flight', 'icao', 'callsign'] },
  { type: 'vessel', keywords: ['vessel', 'ship', 'mmsi', 'imo', 'maritime'] },
  { type: 'satellite', keywords: ['satellite', 'orbital', 'norad'] },
  { type: 'storm', keywords: ['storm', 'hurricane', 'cyclone', 'typhoon'] },
  { type: 'earthquake', keywords: ['earthquake', 'seismic', 'quake'] },
  { type: 'wildfire', keywords: ['wildfire', 'fire detection'] },
  { type: 'infrastructure', keywords: ['infrastructure', 'outage', 'cable', 'grid'] },
  { type: 'organization', keywords: ['organization', 'group', 'agency', 'company'] },
  { type: 'location', keywords: ['location', 'region', 'near'] },
];

export function parseInvestigationQuestion(question: string): InvestigationQuery {
  const q = question.trim();
  const lower = q.toLowerCase();

  const entity_type = ENTITY_TYPE_KEYWORDS.find((entry) => entry.keywords.some((kw) => lower.includes(kw)))?.type;

  const fromToMatch = lower.match(/(last|past)\s+(\d+)\s*(hour|hours|day|days|week|weeks)/);
  let from: string | undefined;
  if (fromToMatch) {
    const count = Number(fromToMatch[2]);
    const unit = fromToMatch[3];
    const now = Date.now();
    const multiplier = unit.startsWith('hour') ? 3600_000 : unit.startsWith('day') ? 86_400_000 : 7 * 86_400_000;
    from = new Date(now - (count * multiplier)).toISOString();
  }

  const nearMatch = lower.match(/near\s+(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/);
  const lat = nearMatch ? Number(nearMatch[1]) : undefined;
  const lon = nearMatch ? Number(nearMatch[2]) : undefined;

  const radiusMatch = lower.match(/within\s+(\d+(?:\.\d+)?)\s*(km|kilometer|kilometers)/);
  const radius_km = radiusMatch ? Number(radiusMatch[1]) : undefined;

  return {
    text: q,
    entity_type,
    from,
    lat: Number.isFinite(lat) ? lat : undefined,
    lon: Number.isFinite(lon) ? lon : undefined,
    radius_km: Number.isFinite(radius_km) ? radius_km : undefined,
    include_graph: lower.includes('graph') || lower.includes('relationship') || lower.includes('connected'),
    limit: 100,
    offset: 0,
  };
}
