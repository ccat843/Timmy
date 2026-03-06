import test from 'node:test';
import assert from 'node:assert/strict';
import type { Feed } from '../src/types/index.ts';
import { getMergedFeeds, setExtensionsForTesting, subscribeExtensions } from '../src/extensions/registry.ts';

test('getMergedFeeds appends enabled extension feeds and de-dupes by id', () => {
  const baseFeeds: Record<string, Feed[]> = {
    politics: [{ name: 'Base Feed', url: 'https://example.com/rss' }],
  };

  setExtensionsForTesting([
    {
      id: 'ext.one',
      name: 'Ext One',
      version: '1.0.0',
      enabled: true,
      contributions: {
        feeds: [
          { id: 'feed-1', category: 'politics', name: 'Extra Feed', url: 'https://example.com/extra' },
          { id: 'feed-1', category: 'politics', name: 'Duplicate Feed', url: 'https://example.com/dup' },
        ],
      },
    },
    {
      id: 'ext.two',
      name: 'Disabled',
      version: '1.0.0',
      enabled: false,
      contributions: {
        feeds: [{ id: 'feed-2', category: 'tech', name: 'Should Not Add', url: 'https://example.com/tech' }],
      },
    },
  ]);

  const merged = getMergedFeeds(baseFeeds);

  assert.equal(merged.politics?.length, 2);
  assert.equal(merged.politics?.[1]?.name, 'Extra Feed');
  assert.equal(merged.tech, undefined);
});


test('subscribeExtensions notifies listeners on extension state changes', () => {
  let called = 0;
  const unsubscribe = subscribeExtensions(() => {
    called += 1;
  });

  setExtensionsForTesting([]);
  assert.equal(called, 1);

  unsubscribe();
  setExtensionsForTesting([]);
  assert.equal(called, 1);
});
