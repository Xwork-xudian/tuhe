import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSeedData } from './seed.js';
import { PLATFORM_IDS } from './platforms.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DATA_DIR = process.env.TUHE_DATA_DIR || path.join(ROOT, 'data');
const DB_FILE = process.env.TUHE_DB_FILE || path.join(DATA_DIR, 'db.json');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');

let cache = null;
let queue = Promise.resolve();

async function ensureDirs() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.mkdir(BACKUP_DIR, { recursive: true });
}

async function writeAtomic(db) {
  await ensureDirs();
  const temp = `${DB_FILE}.${process.pid}.tmp`;
  await fs.writeFile(temp, `${JSON.stringify(db, null, 2)}\n`, 'utf8');
  await fs.rename(temp, DB_FILE);
}

async function backupIfNeeded(db) {
  try {
    const entries = await fs.readdir(BACKUP_DIR);
    if (entries.length >= 8) return;
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    await fs.writeFile(path.join(BACKUP_DIR, `db-${stamp}.json`), JSON.stringify(db, null, 2), 'utf8');
  } catch (error) {
    console.warn('backup skipped:', error.message);
  }
}

export async function initStore() {
  await ensureDirs();
  if (cache) return cache;
  if (fsSync.existsSync(DB_FILE)) {
    try {
      cache = JSON.parse(await fs.readFile(DB_FILE, 'utf8'));
    } catch (error) {
      const broken = `${DB_FILE}.broken-${Date.now()}`;
      await fs.rename(DB_FILE, broken).catch(() => {});
      console.warn(`database could not be parsed, moved to ${broken}:`, error.message);
      cache = createSeedData();
      await writeAtomic(cache);
    }
  } else {
    cache = createSeedData();
    await writeAtomic(cache);
    await backupIfNeeded(cache);
  }
  if (!cache.settings) cache.settings = { dedupeDistance: 120, defaultPlatformView: 'all', autoBackup: true };
  if (!Array.isArray(cache.importBatches)) cache.importBatches = [];
  if (!Array.isArray(cache.jobs)) cache.jobs = [];
  if (!Array.isArray(cache.activities)) cache.activities = [];
  if (!Array.isArray(cache.footprints)) cache.footprints = [];

  let migrated = false;
  const bridgeUrl = process.env.TUHE_BRIDGE_URL || '';
  const bridgeToken = process.env.TUHE_BRIDGE_TOKEN || '';
  const now = new Date().toISOString();
  const connections = cache.connections && typeof cache.connections === 'object' ? cache.connections : {};
  for (const id of Object.keys(connections)) {
    if (!PLATFORM_IDS.includes(id)) { delete connections[id]; migrated = true; }
  }
  for (const id of PLATFORM_IDS) {
    const current = connections[id] || {};
    const next = {
      ...current,
      enabled: current.enabled !== false,
      mode: 'webhook',
      webhookUrl: current.webhookUrl || bridgeUrl,
      token: current.token || bridgeToken,
      hasToken: Boolean(current.token || bridgeToken),
      lastSyncAt: current.lastSyncAt || null,
      createdAt: current.createdAt || now,
    };
    delete next.account;
    if (JSON.stringify(next) !== JSON.stringify(current)) migrated = true;
    connections[id] = next;
  }
  cache.connections = connections;
  if (migrated) await writeAtomic(cache);
  return cache;
}

export function getDb() {
  if (!cache) throw new Error('Store not initialized');
  return cache;
}

export function mutateStore(mutator) {
  const run = async () => {
    if (!cache) await initStore();
    const draft = structuredClone(cache);
    const result = await mutator(draft);
    draft.meta = draft.meta || {};
    draft.meta.updatedAt = new Date().toISOString();
    await writeAtomic(draft);
    cache = draft;
    return result;
  };
  queue = queue.then(run, run);
  return queue;
}

export function addActivity(db, activity) {
  const item = {
    id: `act_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    createdAt: new Date().toISOString(),
    ...activity,
  };
  db.activities = [item, ...(db.activities || [])].slice(0, 80);
  return item;
}

export async function createBackup() {
  if (!cache) await initStore();
  await ensureDirs();
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = path.join(BACKUP_DIR, `manual-${stamp}.json`);
  await fs.writeFile(file, JSON.stringify(cache, null, 2), 'utf8');
  return file;
}

export const paths = { ROOT, DATA_DIR, DB_FILE, BACKUP_DIR };
