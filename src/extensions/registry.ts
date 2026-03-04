import type { Feed } from '@/types';
import type { ExtensionManifest } from '@/extensions/schema';
import { listExtensions } from '@/extensions/storage/web';

let extensions: ExtensionManifest[] = [];

function feedIdentifier(feed: Feed): string {
  const extId = (feed as Feed & { id?: string }).id;
  if (extId) return extId;
  return `${feed.name}:${typeof feed.url === 'string' ? feed.url : JSON.stringify(feed.url)}`;
}

export async function initExtensions(): Promise<ExtensionManifest[]> {
  extensions = await listExtensions();
  return extensions;
}

export function getInstalledExtensions(): ExtensionManifest[] {
  return extensions;
}

export function setExtensionsForTesting(items: ExtensionManifest[]): void {
  extensions = items;
}

export function getMergedFeeds(baseFeeds: Record<string, Feed[]>): Record<string, Feed[]> {
  const merged: Record<string, Feed[]> = Object.fromEntries(
    Object.entries(baseFeeds).map(([key, feeds]) => [key, [...feeds]])
  );

  const seen = new Set<string>();
  for (const feeds of Object.values(merged)) {
    for (const feed of feeds) seen.add(feedIdentifier(feed));
  }

  for (const extension of extensions) {
    if (!extension.enabled) continue;
    for (const feed of extension.contributions.feeds ?? []) {
      if (seen.has(feed.id)) continue;
      seen.add(feed.id);
      const categoryFeeds = merged[feed.category] ?? [];
      categoryFeeds.push({
        name: feed.name,
        url: feed.url,
        type: feed.type,
        region: feed.region,
        propagandaRisk: feed.propagandaRisk as Feed['propagandaRisk'],
        stateAffiliated: feed.stateAffiliated,
        lang: feed.lang,
      });
      merged[feed.category] = categoryFeeds;
    }
  }

  return merged;
}
