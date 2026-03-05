import test from 'node:test';
import assert from 'node:assert/strict';
import { SOURCE_ADAPTERS } from '../src/intel_bridge/normalize_all_sources.ts';

test('normalize_all_sources includes all documented source types', () => {
  const keys = Object.keys(SOURCE_ADAPTERS);
  assert.ok(keys.includes('news'));
  assert.ok(keys.includes('natural'));
  assert.ok(keys.includes('maritime'));
  assert.ok(keys.includes('frontend-live-channels'));
  assert.ok(keys.includes('frontend-news-panels'));
  assert.ok(keys.length >= 24);
});
