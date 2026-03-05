export interface CaseRecord {
  id: string;
  title: string;
  description?: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export type EvidenceSourceType = 'feed' | 'channel' | 'custom';

export interface EvidenceItem {
  id: string;
  caseId: string;
  createdAt: string;
  sourceType: EvidenceSourceType;
  sourceId: string;
  title: string;
  url?: string;
  summary?: string;
  raw: unknown;
  entities?: string[];
  notes?: string;
}

export type EntityType = 'person' | 'org' | 'location' | 'country' | 'other';

export interface Entity {
  id: string;
  caseId: string;
  label: string;
  type?: EntityType;
  createdAt: string;
}

export interface EvidenceEntityEdge {
  caseId: string;
  evidenceId: string;
  entityId: string;
}

export type AlertSeverity = 'low' | 'med' | 'high';

export interface AlertRule {
  id: string;
  name: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  match: {
    keywords: string[];
    keywordMode?: 'AND' | 'OR';
    entities?: string[];
    tags?: string[];
    sources?: string[];
    caseId?: string;
  };
  severity: AlertSeverity;
  throttleMinutes?: number;
}

export interface AlertEvent {
  id: string;
  ruleId: string;
  createdAt: string;
  severity: AlertSeverity;
  title: string;
  reason: string;
  evidenceRef?: { caseId: string; evidenceId: string };
  feedRef?: { feedId: string; itemId?: string; url?: string };
  status: 'new' | 'read' | 'archived';
}
