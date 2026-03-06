import test from 'node:test';
import assert from 'node:assert/strict';
import type { AlertRule } from '../src/intel/models.ts';
import { doesRuleMatch } from '../src/intel/alerts/matcher.ts';

const baseRule: AlertRule = {
  id: 'rule-1',
  name: 'Test rule',
  enabled: true,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  severity: 'med',
  throttleMinutes: 10,
  match: {
    keywords: ['pipeline', 'outage'],
    keywordMode: 'AND',
    entities: ['nigeria'],
    sources: ['reuters'],
  },
};

test('doesRuleMatch handles AND keywords + entities + sources', () => {
  const matched = doesRuleMatch(baseRule, {
    title: 'Pipeline outage impacts region',
    summary: 'Major outage reported overnight',
    entities: ['Nigeria'],
    sourceId: 'Reuters',
  });
  assert.equal(matched, true);

  const missed = doesRuleMatch(baseRule, {
    title: 'Pipeline issue',
    entities: ['Nigeria'],
    sourceId: 'Reuters',
  });
  assert.equal(missed, false);
});
