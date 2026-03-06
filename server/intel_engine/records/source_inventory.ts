/**
 * WorldMonitor source coverage inventory (Phase 10 universal records).
 *
 * Origin discovery method:
 * - server/worldmonitor/*/v1/handler.ts domain handlers (all documented RPC domains)
 * - frontend source surfaces that produce item lists rendered in panels
 *
 * NOTE: This file intentionally lists every worldmonitor domain handler path so
 * coverage can be audited when upstream adds/removes domains.
 *
 * Normalization coverage report:
 * - Server passive capture for all API handlers: server/gateway.ts -> records/normalize.ts
 * - Browser-only items: src/intel_bridge/normalize_all_sources.ts via records_emitter.ts
 * - Investigation/query layer consumers: server/intel_engine/investigation/* uses records + entities stores only
 */

export interface SourceInventoryItem {
  sourceType: string;
  origin: string;
  shapeSummary: string;
}

export const WORLDMONITOR_HANDLER_SOURCES: SourceInventoryItem[] = [
  { sourceType: 'news', origin: 'server/worldmonitor/news/v1/handler.ts', shapeSummary: 'feed digest + article/news items' },
  { sourceType: 'economic', origin: 'server/worldmonitor/economic/v1/handler.ts', shapeSummary: 'time series/macroeconomic records' },
  { sourceType: 'market', origin: 'server/worldmonitor/market/v1/handler.ts', shapeSummary: 'quotes/market snapshots' },
  { sourceType: 'intelligence', origin: 'server/worldmonitor/intelligence/v1/handler.ts', shapeSummary: 'scores/classifications/briefs' },
  { sourceType: 'cyber', origin: 'server/worldmonitor/cyber/v1/handler.ts', shapeSummary: 'threat/advisory items' },
  { sourceType: 'positive-events', origin: 'server/worldmonitor/positive-events/v1/handler.ts', shapeSummary: 'positive geoevents feed items' },
  { sourceType: 'giving', origin: 'server/worldmonitor/giving/v1/handler.ts', shapeSummary: 'donation/aid summary items' },
  { sourceType: 'military', origin: 'server/worldmonitor/military/v1/handler.ts', shapeSummary: 'flight/vessel/base records' },
  { sourceType: 'climate', origin: 'server/worldmonitor/climate/v1/handler.ts', shapeSummary: 'climate anomaly records' },
  { sourceType: 'infrastructure', origin: 'server/worldmonitor/infrastructure/v1/handler.ts', shapeSummary: 'outage/status/cable records' },
  { sourceType: 'research', origin: 'server/worldmonitor/research/v1/handler.ts', shapeSummary: 'papers/repos/events/news records' },
  { sourceType: 'aviation', origin: 'server/worldmonitor/aviation/v1/handler.ts', shapeSummary: 'airport delay/aviation records' },
  { sourceType: 'prediction', origin: 'server/worldmonitor/prediction/v1/handler.ts', shapeSummary: 'prediction market items' },
  { sourceType: 'seismology', origin: 'server/worldmonitor/seismology/v1/handler.ts', shapeSummary: 'earthquake observations' },
  { sourceType: 'supply-chain', origin: 'server/worldmonitor/supply-chain/v1/handler.ts', shapeSummary: 'shipping/chokepoint/mineral records' },
  { sourceType: 'wildfire', origin: 'server/worldmonitor/wildfire/v1/handler.ts', shapeSummary: 'fire detection items' },
  { sourceType: 'displacement', origin: 'server/worldmonitor/displacement/v1/handler.ts', shapeSummary: 'UNHCR/HAPI displacement records' },
  { sourceType: 'maritime', origin: 'server/worldmonitor/maritime/v1/handler.ts', shapeSummary: 'AIS/nav warning/vessel items' },
  { sourceType: 'conflict', origin: 'server/worldmonitor/conflict/v1/handler.ts', shapeSummary: 'ACLED/UCDP/iran conflict records' },
  { sourceType: 'trade', origin: 'server/worldmonitor/trade/v1/handler.ts', shapeSummary: 'trade restriction/tariff/flow records' },
  { sourceType: 'natural', origin: 'server/worldmonitor/natural/v1/handler.ts', shapeSummary: 'NASA EONET-like natural event records' },
  { sourceType: 'unrest', origin: 'server/worldmonitor/unrest/v1/handler.ts', shapeSummary: 'civil unrest incident records' },
  { sourceType: 'frontend-live-channels', origin: 'src/live-channels-window.ts + src/components/LiveNewsPanel.ts', shapeSummary: 'live channel metadata cards' },
  { sourceType: 'frontend-news-panels', origin: 'src/app/data-loader.ts loadNews*', shapeSummary: 'news items shown in category panels' },
];

export const ALL_SOURCE_TYPES = WORLDMONITOR_HANDLER_SOURCES.map((item) => item.sourceType);
