export type EntityType =
  | 'aircraft'
  | 'vessel'
  | 'satellite'
  | 'storm'
  | 'earthquake'
  | 'wildfire'
  | 'infrastructure'
  | 'organization'
  | 'location';

export interface TrackedEntity {
  id: string;
  entity_type: EntityType;
  canonical_name: string;
  first_seen: number;
  last_seen: number;
  metadata_json: string;
}

export interface EntityObservation {
  id: string;
  entity_id: string;
  record_id: string;
  timestamp: number;
  lat?: number;
  lon?: number;
  attributes_json: string;
}

export interface EntityRelationship {
  id: string;
  entity_a: string;
  entity_b: string;
  relationship_type: string;
  confidence: number;
}

export interface EntitySearchFilters {
  q?: string;
  entity_type?: EntityType;
  min_lat?: number;
  min_lon?: number;
  max_lat?: number;
  max_lon?: number;
  lat?: number;
  lon?: number;
  radius_km?: number;
  limit?: number;
  offset?: number;
}
