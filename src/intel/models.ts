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
