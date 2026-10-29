import { PLATFORM_IDS } from './platforms.js';
import { createDemoData } from './demoSeed.js';

export function createSeedData() {
  if (process.env.TUHE_DEMO !== '0') return createDemoData();
  const now = new Date().toISOString();
  const bridgeUrl = process.env.TUHE_BRIDGE_URL || '';
  const bridgeToken = process.env.TUHE_BRIDGE_TOKEN || '';
  const connections = Object.fromEntries(PLATFORM_IDS.map((id) => [id, {
    enabled: true,
    mode: 'webhook',
    webhookUrl: bridgeUrl,
    token: bridgeToken,
    hasToken: Boolean(bridgeToken),
    lastSyncAt: null,
    createdAt: now,
  }]));

  return {
    meta: {
      version: 1,
      product: '途合',
      createdAt: now,
      updatedAt: now,
    },
    places: [],
    connections,
    jobs: [],
    activities: [],
    settings: {
      dedupeDistance: 120,
      defaultPlatformView: 'all',
      autoBackup: true,
    },
    importBatches: [],
    footprints: [],
  };
}
