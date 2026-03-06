import type { EntityType } from '../entities/types';
import type { UniversalRecord } from '../records/schema';
import type { EntityRelationship, TrackedEntity } from '../entities/types';

export interface InvestigationQuery {
  text?: string;
  source_type?: string;
  source_id?: string;
  entity_type?: EntityType;
  entity_id?: string;
  related_to_entity_id?: string;
  relationship_type?: string;
  from?: string;
  to?: string;
  lat?: number;
  lon?: number;
  radius_km?: number;
  min_lat?: number;
  min_lon?: number;
  max_lat?: number;
  max_lon?: number;
  limit?: number;
  offset?: number;
  include_graph?: boolean;
}

export interface InvestigationPlan {
  steps: string[];
  estimatedCost: 'low' | 'medium' | 'high';
}

export interface InvestigationResult {
  plan: InvestigationPlan;
  records: UniversalRecord[];
  entities: TrackedEntity[];
  relationships: EntityRelationship[];
  graph?: {
    nodes: Array<Record<string, unknown>>;
    edges: Array<Record<string, unknown>>;
  };
}

export interface InvestigationAskRequest {
  question: string;
  context?: Record<string, unknown>;
}

export interface InvestigationAskResponse {
  structured_query: InvestigationQuery;
  result: InvestigationResult;
}
