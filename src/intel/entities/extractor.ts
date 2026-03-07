import type { EvidenceItem, EntityType } from '@/intel/models';

export interface ExtractedEntity {
  label: string;
  normalizedLabel: string;
  type: EntityType;
}

function normalizeLabel(label: string): string {
  return label.trim().replace(/^[\s,.;:()\[\]{}"'`]+|[\s,.;:()\[\]{}"'`]+$/g, '').replace(/\s+/g, ' ').toLowerCase();
}

function buildCountrySet(): Set<string> {
  const out = new Set<string>(['united states', 'usa', 'uk', 'united kingdom']);
  try {
    const intlAny = Intl as unknown as { DisplayNames?: typeof Intl.DisplayNames; supportedValuesOf?: (k: string) => string[] };
    if (intlAny.DisplayNames && intlAny.supportedValuesOf) {
      const dn = new intlAny.DisplayNames(['en'], { type: 'region' });
      for (const code of intlAny.supportedValuesOf('region')) {
        if (!/^[A-Z]{2}$/.test(code)) continue;
        const name = dn.of(code);
        if (name) out.add(name.toLowerCase());
      }
    }
  } catch {}
  return out;
}

const COUNTRY_SET = buildCountrySet();

export function extractEntitiesFromEvidence(evidence: Pick<EvidenceItem, 'title' | 'summary' | 'notes'>): ExtractedEntity[] {
  const text = [evidence.title, evidence.summary ?? '', evidence.notes ?? ''].join('. ').replace(/\s+/g, ' ').trim();
  if (!text) return [];

  const entities = new Map<string, ExtractedEntity>();
  const add = (label: string, type: EntityType) => {
    const normalizedLabel = normalizeLabel(label);
    if (!normalizedLabel || normalizedLabel.length < 2) return;
    const existing = entities.get(normalizedLabel);
    if (!existing || (existing.type === 'other' && type !== 'other')) entities.set(normalizedLabel, { label: label.trim(), normalizedLabel, type });
  };

  for (const token of text.split(/\s+/)) {
    if (COUNTRY_SET.has(normalizeLabel(token))) add(token, 'country');
  }

  const parts = text.split(/[.!?;]+/).map((s) => s.trim()).filter(Boolean);
  for (const part of parts) {
    for (const m of part.matchAll(/\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2}),\s*([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})\b/g)) {
      if (!m[1] || !m[2]) continue;
      add(m[1], 'location');
      add(m[2], COUNTRY_SET.has(normalizeLabel(m[2])) ? 'country' : 'location');
    }

    for (const m of part.matchAll(/\b(?:in|near)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,3})\b/g)) {
      if (!m[1]) continue;
      add(m[1], COUNTRY_SET.has(normalizeLabel(m[1])) ? 'country' : 'location');
    }

    for (const m of part.matchAll(/\b([A-Z][\w&.-]*(?:\s+[A-Z][\w&.-]*){0,3}\s+(?:Ltd|Inc|PLC|Corp|Corporation|Company|Ministry|Army|Police|University|Bank))\b/g)) {
      if (m[1]) add(m[1], 'org');
    }

    for (const m of part.matchAll(/\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3})\b/g)) {
      if (m[1]) add(m[1], 'other');
    }
  }

  return Array.from(entities.values());
}
