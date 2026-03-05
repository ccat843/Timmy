import test from 'node:test';
import assert from 'node:assert/strict';
import { extractEntitiesFromEvidence } from '../src/intel/entities/extractor.ts';

test('extractEntitiesFromEvidence captures countries, orgs, and locations deterministically', () => {
  const entities = extractEntitiesFromEvidence({
    title: 'Ministry of Health in Lagos, Nigeria meets Zenith Bank PLC',
    summary: 'Police near Abuja coordinated with Acme Inc',
    notes: 'Follow-up with University of Lagos',
  });

  const labels = new Set(entities.map((e) => e.label.toLowerCase()));
  assert.ok(labels.has('nigeria'));
  assert.ok(labels.has('lagos'));
  assert.ok(labels.has('zenith bank plc'));
  assert.ok(labels.has('acme inc'));
});
