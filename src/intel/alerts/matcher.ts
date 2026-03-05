import type { AlertRule } from '@/intel/models';

const normalize = (v: string): string => v.trim().toLowerCase();

export interface AlertMatchInput {
  title: string;
  summary?: string;
  notes?: string;
  entities?: string[];
  tags?: string[];
  sourceId?: string;
  caseId?: string;
}

export function doesRuleMatch(rule: AlertRule, input: AlertMatchInput): boolean {
  if (!rule.enabled) return false;
  if (rule.match.caseId && rule.match.caseId !== input.caseId) return false;

  const text = [input.title, input.summary ?? '', input.notes ?? ''].join(' ').toLowerCase();
  const keywords = (rule.match.keywords ?? []).map(normalize).filter(Boolean);
  const mode = rule.match.keywordMode ?? 'OR';
  const keywordMatch = keywords.length === 0
    ? true
    : mode === 'AND'
      ? keywords.every((kw) => text.includes(kw))
      : keywords.some((kw) => text.includes(kw));
  if (!keywordMatch) return false;

  const sourceNeed = (rule.match.sources ?? []).map(normalize).filter(Boolean);
  if (sourceNeed.length > 0) {
    const source = normalize(input.sourceId ?? '');
    if (!sourceNeed.includes(source)) return false;
  }

  const entityNeed = (rule.match.entities ?? []).map(normalize).filter(Boolean);
  if (entityNeed.length > 0) {
    const entities = (input.entities ?? []).map(normalize);
    if (!entityNeed.some((entity) => entities.includes(entity))) return false;
  }

  const tagsNeed = (rule.match.tags ?? []).map(normalize).filter(Boolean);
  if (tagsNeed.length > 0) {
    const tags = (input.tags ?? []).map(normalize);
    if (!tagsNeed.some((tag) => tags.includes(tag))) return false;
  }

  return true;
}
