import type { InvestigationPlan, InvestigationQuery } from './types';

export function buildInvestigationPlan(query: InvestigationQuery): InvestigationPlan {
  const steps: string[] = [];

  if (query.entity_id || query.related_to_entity_id || query.entity_type) {
    steps.push('entity_index_lookup');
  }
  if (query.relationship_type || query.related_to_entity_id) {
    steps.push('relationship_graph_join');
  }
  if (query.text || query.source_type || query.source_id) {
    steps.push('records_fts_and_source_filter');
  }
  if (query.lat !== undefined || query.min_lat !== undefined) {
    steps.push('geo_filter');
  }
  if (query.from || query.to) {
    steps.push('time_window_filter');
  }
  if (steps.length === 0) {
    steps.push('default_recent_activity_probe');
  }

  const estimatedCost: InvestigationPlan['estimatedCost'] = steps.length <= 2
    ? 'low'
    : steps.length <= 4
      ? 'medium'
      : 'high';

  return { steps, estimatedCost };
}
