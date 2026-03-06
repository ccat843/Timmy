import test from 'node:test';
import assert from 'node:assert/strict';
import { parseExtensionManifest } from '../src/extensions/schema.ts';

test('parseExtensionManifest accepts a minimal valid manifest', () => {
  const manifest = parseExtensionManifest({
    id: 'ext.valid',
    name: 'Valid Extension',
    version: '0.1.0',
    enabled: true,
    contributions: {
      feeds: [
        {
          id: 'feed.valid.1',
          category: 'tech',
          name: 'Tech Feed',
          url: 'https://example.com/rss.xml',
        },
      ],
    },
  });

  assert.equal(manifest.id, 'ext.valid');
  assert.equal(manifest.contributions.feeds.length, 1);
});

test('parseExtensionManifest rejects invalid manifest payloads', () => {
  assert.throws(() => {
    parseExtensionManifest({
      id: '',
      name: 'Broken',
      version: '1.0.0',
      enabled: true,
      contributions: { feeds: [] },
    });
  });

  assert.throws(() => {
    parseExtensionManifest({
      id: 'ext.invalid',
      name: 'Broken URL',
      version: '1.0.0',
      enabled: true,
      contributions: {
        feeds: [{ id: 'feed-1', category: 'tech', name: 'Bad', url: 123 }],
      },
    });
  });
});
