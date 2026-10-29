import express from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { initStore, getDb, mutateStore, addActivity, createBackup, paths } from './lib/store.js';
import { PLATFORMS, PLATFORM_MAP, PLATFORM_IDS } from './lib/platforms.js';
import { parseImportContent } from './lib/parsers.js';
import { findDuplicate, findDuplicateGroups, mergePlace } from './lib/dedupe.js';
import { buildExport, platformCoordinates } from './lib/exporters.js';
import { PLATFORM_COORDS, convertCoordinate, normalizeSystem } from './lib/coordinates.js';
import { cityFromAdcode } from './lib/adcodes.js';
import { nearestCity } from './lib/cities.js';
import { aggregateFootprints, parseFootprintContent, parseFootprintBuffer } from './lib/footprints.js';
import { seal, unseal } from './lib/secrets.js';
import { ONEDRIVE_REDIRECT_URI, oneDriveClientId, buildOneDriveAuthUrl, exchangeOneDriveCode, refreshOneDriveToken, getOneDriveProfile, listOneDriveFolder, downloadOneDriveFile, isSupportedOneDriveFile } from './lib/onedrive.js';

const app = express();
const PORT = Number(process.env.TUHE_PORT || process.env.API_PORT || 8787);
const activeJobs = new Map();
const oneDriveLoginStates = new Map();

app.disable('x-powered-by');
app.use(express.json({ limit: '30mb' }));

const ACCESS_TOKEN = String(process.env.TUHE_ACCESS_TOKEN || '').trim();
const BRIDGE_ADMIN_TOKEN = String(process.env.TUHE_BRIDGE_ADMIN_TOKEN || '').trim();

function tokenMatches(value) {
  if (!ACCESS_TOKEN || !value) return false;
  const a = Buffer.from(String(value));
  const b = Buffer.from(ACCESS_TOKEN);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function readCookie(req, name) {
  const source = String(req.headers.cookie || '');
  for (const part of source.split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    if (part.slice(0, index).trim() === name) return decodeURIComponent(part.slice(index + 1).trim());
  }
  return '';
}

if (ACCESS_TOKEN) {
  app.use((req, res, next) => {
    const cookieToken = readCookie(req, 'tuhe_access');
    const queryToken = typeof req.query.key === 'string' ? req.query.key : '';
    if (tokenMatches(queryToken)) {
      const secure = req.secure || String(req.headers['x-forwarded-proto'] || '').includes('https');
      res.setHeader('Set-Cookie', `tuhe_access=${encodeURIComponent(ACCESS_TOKEN)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800${secure ? '; Secure' : ''}`);
      const target = req.path || '/';
      return res.redirect(302, target);
    }
    if (tokenMatches(cookieToken)) return next();
    return res.status(401).type('html').send(`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>途合 · 访问验证</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f2eee5;font-family:system-ui,sans-serif;color:#17342b}.card{width:min(420px,90vw);padding:36px;border:1px solid #e2dacb;border-radius:20px;background:#fffdf8;box-shadow:0 24px 60px rgba(23,52,43,.1)}h1{margin:0 0 8px;font-size:26px}p{margin:0 0 20px;color:#7d8178;font-size:13px;line-height:1.7}input{width:100%;box-sizing:border-box;height:44px;padding:0 12px;border:1px solid #ddd4c5;border-radius:10px;background:#fff;font-size:14px;outline:none}button{margin-top:12px;width:100%;height:44px;border:0;border-radius:10px;background:#17342b;color:#fff;font-size:14px;font-weight:600}a{color:#b54f2e}</style></head><body><form class="card" method="get"><h1>途合</h1><p>这是一个受保护的私人地点库。请输入访问密钥，或使用带 <code>?key=</code> 的完整访问链接。</p><input name="key" type="password" placeholder="访问密钥" autofocus><button type="submit">进入地点库</button></form></body></html>`);
  });
}

function ok(res, data) { res.json({ ok: true, data }); }
function fail(res, status, message, details = null) { res.status(status).json({ ok: false, error: message, details }); }
function nowIso() { return new Date().toISOString(); }
function makeId(prefix) { return `${prefix}_${Date.now().toString(36)}_${crypto.randomBytes(3).toString('hex')}`; }
function clean(value, max = 500) { return String(value ?? '').trim().slice(0, max); }

function enabledPlatformIds(db) {
  return PLATFORM_IDS.filter((id) => db.connections?.[id]?.enabled !== false);
}

function placeSyncMeta(place, db) {
  const enabled = enabledPlatformIds(db);
  const linked = PLATFORM_IDS.filter((id) => place.links?.[id]);
  const synced = PLATFORM_IDS.filter((id) => place.links?.[id]?.status === 'synced');
  const pending = PLATFORM_IDS.filter((id) => place.links?.[id]?.status === 'pending');
  const missing = enabled.filter((id) => !place.links?.[id] || place.links[id].status !== 'synced');
  return {
    linkedCount: linked.length, syncedCount: synced.length, pendingCount: pending.length, missingCount: missing.length,
    coverage: enabled.length ? Math.round((enabled.filter((id) => place.links?.[id]?.status === 'synced').length / enabled.length) * 100) : 0,
    state: missing.length === 0 ? 'complete' : linked.length ? 'partial' : 'unlinked',
  };
}

function decoratePlace(place, db) { return { ...place, sync: placeSyncMeta(place, db) }; }

function buildDashboard(db) {
  const enabled = enabledPlatformIds(db);
  const places = db.places || [];
  const total = places.length;
  const linked = places.filter((place) => PLATFORM_IDS.some((id) => place.links?.[id])).length;
  const complete = places.filter((place) => enabled.every((id) => place.links?.[id]?.status === 'synced')).length;
  const pending = places.filter((place) => PLATFORM_IDS.some((id) => place.links?.[id]?.status === 'pending')).length;
  const citiesMap = new Map();
  const categoriesMap = new Map();
  for (const place of places) {
    if (place.city) citiesMap.set(place.city, (citiesMap.get(place.city) || 0) + 1);
    if (place.category) categoriesMap.set(place.category, (categoriesMap.get(place.category) || 0) + 1);
  }
  const topCities = [...citiesMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([name, count]) => ({ name, count }));
  const categories = [...categoriesMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([name, count]) => ({ name, count }));
  const platformStats = Object.fromEntries(PLATFORMS.map((platform) => {
    const linkedPlaces = places.filter((place) => place.links?.[platform.id]).length;
    const syncedPlaces = places.filter((place) => place.links?.[platform.id]?.status === 'synced').length;
    const pendingPlaces = places.filter((place) => place.links?.[platform.id]?.status === 'pending').length;
    return [platform.id, {
      ...platform, enabled: db.connections?.[platform.id]?.enabled !== false,
      mode: 'webhook', lastSyncAt: db.connections?.[platform.id]?.lastSyncAt || null,
      bridgeReady: Boolean(db.connections?.[platform.id]?.webhookUrl),
      linked: linkedPlaces, synced: syncedPlaces, pending: pendingPlaces,
      coverage: total ? Math.round((syncedPlaces / total) * 100) : 0,
    }];
  }));
  const duplicateGroups = findDuplicateGroups(places, db.settings?.dedupeDistance || 120);
  const totalLinks = enabled.length * total;
  const syncedLinks = places.reduce((sum, place) => sum + enabled.filter((id) => place.links?.[id]?.status === 'synced').length, 0);
  return {
    stats: {
      total, linked, complete, pending, incomplete: total - complete, cities: citiesMap.size,
      duplicates: duplicateGroups.length, syncRate: totalLinks ? Math.round((syncedLinks / totalLinks) * 100) : 0,
      platformCount: enabled.length, bridgeReady: enabled.filter((id) => Boolean(db.connections?.[id]?.webhookUrl)).length,
      located: places.filter((place) => place.location).length,
    },
    platformStats, topCities, categories, cityAnalysis: buildCityAnalysis(db),
    recentJobs: (db.jobs || []).slice(0, 5),
    recentPlaces: [...places].sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt))).slice(0, 6).map((place) => decoratePlace(place, db)),
    activities: (db.activities || []).slice(0, 7),
    syncedAt: db.meta?.updatedAt || nowIso(),
  };
}

function buildCityAnalysis(db) {
  const platforms = ['amap', 'baidu'];
  const platformLabels = { amap: '高德', baidu: '百度' };
  const candidates = (db.places || []).filter((place) => platforms.some((id) => place.links?.[id] || place.source?.platform === id));
  const platformTotals = Object.fromEntries(platforms.map((id) => [id, 0]));
  const categoryTotals = new Map();
  const cityMap = new Map();
  let crossPlatformCount = 0;
  for (const place of candidates) {
    const linked = platforms.filter((id) => place.links?.[id]);
    if (linked.length >= 2) crossPlatformCount += 1;
    const cityName = place.city || '未标注城市';
    if (!cityMap.has(cityName)) {
      cityMap.set(cityName, {
        name: cityName,
        count: 0,
        platforms: Object.fromEntries(platforms.map((id) => [id, 0])),
        categories: new Map(),
        topPlaces: [],
        located: 0,
      });
    }
    const city = cityMap.get(cityName);
    city.count += 1;
    if (place.location) city.located += 1;
    for (const id of linked) {
      city.platforms[id] += 1;
      platformTotals[id] += 1;
    }
    const category = place.category || '未分类';
    city.categories.set(category, (city.categories.get(category) || 0) + 1);
    categoryTotals.set(category, (categoryTotals.get(category) || 0) + 1);
    city.topPlaces.push({ id: place.id, name: place.name, category });
  }
  const cities = [...cityMap.values()].map((city) => ({
    ...city,
    categories: [...city.categories.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([name, count]) => ({ name, count })),
    topPlaces: city.topPlaces
      .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))
      .slice(0, 4),
  })).sort((a, b) => b.count - a.count);
  const categories = [...categoryTotals.entries()].sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, count }));
  const dominantPlatform = Object.entries(platformTotals).sort((a, b) => b[1] - a[1])[0];
  return {
    excludedPlatform: 'yuanzhou',
    sourcePlatforms: platforms.map((id) => ({ id, name: platformLabels[id] })),
    total: candidates.length,
    cityCount: cities.length,
    crossPlatformCount,
    crossPlatformRate: candidates.length ? Math.round((crossPlatformCount / candidates.length) * 100) : 0,
    platformTotals,
    dominantPlatform: dominantPlatform ? { id: dominantPlatform[0], name: platformLabels[dominantPlatform[0]], count: dominantPlatform[1] } : null,
    topCategory: categories[0] || null,
    categories: categories.slice(0, 8),
    cities,
  };
}

function filterPlaces(db, query) {
  let places = [...(db.places || [])];
  const q = clean(query.q).toLowerCase();
  if (q) places = places.filter((place) => [place.name, place.address, place.city, place.category, place.note, ...(place.tags || [])].filter(Boolean).join(' ').toLowerCase().includes(q));
  if (query.platform && PLATFORM_MAP[query.platform]) {
    if (query.platformState === 'pending') places = places.filter((place) => place.links?.[query.platform]?.status === 'pending');
    else if (query.platformState === 'missing') places = places.filter((place) => !place.links?.[query.platform]);
    else places = places.filter((place) => Boolean(place.links?.[query.platform]));
  }
  if (query.city) places = places.filter((place) => place.city === query.city);
  if (query.category) places = places.filter((place) => place.category === query.category);
  if (query.tag) places = places.filter((place) => (place.tags || []).includes(query.tag));
  if (query.status === 'complete') places = places.filter((place) => placeSyncMeta(place, db).state === 'complete');
  else if (query.status === 'incomplete') places = places.filter((place) => enabledPlatformIds(db).some((id) => place.links?.[id]?.status !== 'synced'));
  else if (query.status === 'unlinked') places = places.filter((place) => !PLATFORM_IDS.some((id) => place.links?.[id]));
  else if (query.status === 'pending') places = places.filter((place) => PLATFORM_IDS.some((id) => place.links?.[id]?.status === 'pending'));
  const sort = query.sort || 'updated';
  if (sort === 'name') places.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
  else if (sort === 'created') places.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  else if (sort === 'city') places.sort((a, b) => String(a.city).localeCompare(String(b.city), 'zh-CN') || a.name.localeCompare(b.name, 'zh-CN'));
  else places.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  return places;
}

function placePayload(body, existing = null) {
  const name = clean(body.name, 120);
  if (!name) throw Object.assign(new Error('地点名称不能为空'), { status: 400 });
  const lng = body.location?.lng !== undefined ? Number(body.location.lng) : body.lng !== undefined ? Number(body.lng) : null;
  const lat = body.location?.lat !== undefined ? Number(body.location.lat) : body.lat !== undefined ? Number(body.lat) : null;
  let location = existing?.location || null;
  if (Number.isFinite(lng) && Number.isFinite(lat) && lng >= -180 && lng <= 180 && lat >= -90 && lat <= 90) location = { lng: Math.round(lng * 1e6) / 1e6, lat: Math.round(lat * 1e6) / 1e6 };
  else if (lng === null && lat === null) location = null;
  const tags = Array.isArray(body.tags) ? body.tags.map((tag) => clean(tag, 24)).filter(Boolean).slice(0, 20) : clean(body.tags).split(/[,，;；|、]/).map((tag) => tag.trim()).filter(Boolean).slice(0, 20);
  const ratingRaw = body.rating === '' || body.rating === null || body.rating === undefined ? null : Number(body.rating);
  return {
    name, address: clean(body.address, 300), city: clean(body.city, 40).replace(/市$/, ''), district: clean(body.district, 40).replace(/[区县]$/, ''),
    category: clean(body.category, 40) || '未分类', tags, note: clean(body.note, 2000),
    rating: Number.isFinite(ratingRaw) && ratingRaw >= 0 && ratingRaw <= 5 ? ratingRaw : null,
    url: clean(body.url, 1000), location, coordSystem: 'WGS84',
  };
}

function importSummary(parsed, db) {
  const threshold = db.settings?.dedupeDistance || 120;
  const seen = [];
  let duplicates = 0;
  let newCount = 0;
  const preview = [];
  for (const place of parsed.places) {
    const dup = findDuplicate(place, [...db.places, ...seen], threshold);
    if (dup) duplicates += 1;
    else { newCount += 1; seen.push(place); }
    if (preview.length < 8) preview.push({ ...place, duplicate: Boolean(dup), duplicateOf: dup?.name || null });
  }
  return { format: parsed.format, total: parsed.places.length, newCount, duplicates, located: parsed.places.filter((place) => place.location).length, warnings: parsed.warnings, sourceSystems: parsed.sourceSystems, preview };
}

function importContent(body) {
  return parseImportContent({ content: String(body.content || ''), fileName: String(body.fileName || ''), format: body.format || 'auto', platform: PLATFORM_MAP[body.platform] ? body.platform : 'amap' });
}

app.get('/api/health', (req, res) => ok(res, { status: 'ok', product: '途合', time: nowIso() }));
app.get('/api/meta', (req, res) => ok(res, { platforms: PLATFORMS, coordSystems: PLATFORM_COORDS, version: '1.0.0' }));
app.get('/api/dashboard', (req, res) => ok(res, buildDashboard(getDb())));

app.get('/api/places', (req, res) => {
  const db = getDb();
  const filtered = filterPlaces(db, req.query);
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 12));
  const start = (page - 1) * limit;
  const items = filtered.slice(start, start + limit).map((place) => decoratePlace(place, db));
  const cities = [...new Set(db.places.map((place) => place.city).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'zh-CN'));
  const categories = [...new Set(db.places.map((place) => place.category).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'zh-CN'));
  const tags = [...new Set(db.places.flatMap((place) => place.tags || []))].sort((a, b) => a.localeCompare(b, 'zh-CN'));
  ok(res, { items, total: filtered.length, page, limit, pages: Math.max(1, Math.ceil(filtered.length / limit)), facets: { cities, categories, tags } });
});

app.get('/api/places/:id', (req, res) => {
  const db = getDb();
  const place = db.places.find((item) => item.id === req.params.id);
  if (!place) return fail(res, 404, '地点不存在');
  return ok(res, decoratePlace(place, db));
});

app.post('/api/places', async (req, res, next) => {
  try {
    const created = await mutateStore((db) => {
      const data = placePayload(req.body);
      const timestamp = nowIso();
      const place = { id: makeId('pl'), ...data, source: { platform: 'manual', externalId: null, importedAt: timestamp }, links: {}, createdAt: timestamp, updatedAt: timestamp };
      db.places.push(place);
      addActivity(db, { type: 'add', title: '添加地点', detail: `「${place.name}」已加入地点库`, platform: 'manual' });
      return place;
    });
    ok(res, decoratePlace(created, getDb()));
  } catch (error) { next(error); }
});

app.patch('/api/places/:id', async (req, res, next) => {
  try {
    const updated = await mutateStore((db) => {
      const place = db.places.find((item) => item.id === req.params.id);
      if (!place) throw Object.assign(new Error('地点不存在'), { status: 404 });
      Object.assign(place, placePayload(req.body, place));
      place.updatedAt = nowIso();
      addActivity(db, { type: 'edit', title: '编辑地点', detail: `「${place.name}」的信息已更新`, platform: place.source?.platform || 'manual' });
      return place;
    });
    ok(res, decoratePlace(updated, getDb()));
  } catch (error) { next(error); }
});

app.delete('/api/places', async (req, res, next) => {
  try {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
    if (!ids.length) return fail(res, 400, '请选择要删除的地点');
    const removed = await mutateStore((db) => {
      const before = db.places.length;
      db.places = db.places.filter((place) => !ids.includes(place.id));
      addActivity(db, { type: 'delete', title: '删除地点', detail: `已删除 ${before - db.places.length} 个地点`, platform: 'manual' });
      return { count: before - db.places.length };
    });
    ok(res, removed);
  } catch (error) { next(error); }
});

app.post('/api/places/bulk-tag', async (req, res, next) => {
  try {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
    const tag = clean(req.body?.tag, 24);
    const mode = req.body?.mode === 'remove' ? 'remove' : 'add';
    if (!ids.length || !tag) return fail(res, 400, '请选择地点并输入标签');
    const result = await mutateStore((db) => {
      let count = 0;
      for (const place of db.places) {
        if (!ids.includes(place.id)) continue;
        const tags = new Set(place.tags || []);
        if (mode === 'remove') tags.delete(tag); else tags.add(tag);
        place.tags = [...tags].slice(0, 20);
        place.updatedAt = nowIso();
        count += 1;
      }
      addActivity(db, { type: 'edit', title: mode === 'add' ? '批量添加标签' : '批量移除标签', detail: `${count} 个地点 · ${tag}`, platform: 'manual' });
      return { count, tag, mode };
    });
    ok(res, result);
  } catch (error) { next(error); }
});

app.post('/api/import/preview', (req, res, next) => {
  try { ok(res, importSummary(importContent(req.body || {}), getDb())); }
  catch (error) { next(Object.assign(error, { status: 400, message: `解析失败：${error.message}` })); }
});

app.post('/api/import/commit', async (req, res, next) => {
  try {
    const parsed = importContent(req.body || {});
    const platform = PLATFORM_MAP[req.body?.platform] ? req.body.platform : 'amap';
    const defaultTags = Array.isArray(req.body?.defaultTags) ? req.body.defaultTags.map((tag) => clean(tag, 24)).filter(Boolean) : [];
    const result = await mutateStore((db) => {
      const threshold = db.settings?.dedupeDistance || 120;
      const timestamp = nowIso();
      let imported = 0;
      let merged = 0;
      for (const raw of parsed.places) {
        const place = { ...raw, tags: [...new Set([...(raw.tags || []), ...defaultTags])] };
        const duplicate = findDuplicate(place, db.places, threshold);
        if (duplicate) {
          mergePlace(duplicate, place);
          duplicate.links = duplicate.links || {};
          duplicate.links[platform] = { externalId: place.externalId || duplicate.links[platform]?.externalId || `import_${platform}_${crypto.randomBytes(3).toString('hex')}`, status: 'synced', lastSyncedAt: timestamp };
          merged += 1;
        } else {
          const created = {
            id: makeId('pl'), name: place.name, address: place.address, city: place.city, district: place.district, category: place.category,
            tags: place.tags, note: place.note, rating: place.rating, url: place.url, location: place.location, coordSystem: 'WGS84',
            source: { platform, externalId: place.externalId || null, importedAt: timestamp },
            links: { [platform]: { externalId: place.externalId || `import_${platform}_${crypto.randomBytes(3).toString('hex')}`, status: 'synced', lastSyncedAt: timestamp } },
            createdAt: timestamp, updatedAt: timestamp,
          };
          db.places.push(created);
          imported += 1;
        }
      }
      const batch = { id: makeId('imp'), platform, fileName: clean(req.body?.fileName, 200), format: parsed.format, total: parsed.places.length, imported, merged, createdAt: timestamp };
      db.importBatches = [batch, ...(db.importBatches || [])].slice(0, 20);
      addActivity(db, { type: 'import', title: `导入${PLATFORM_MAP[platform]?.shortName || ''}收藏`, detail: `新增 ${imported} 个，合并 ${merged} 个地点`, platform });
      return { ...batch, warnings: parsed.warnings };
    });
    ok(res, result);
  } catch (error) { next(Object.assign(error, { status: 400, message: `导入失败：${error.message}` })); }
});

app.get('/api/export', (req, res, next) => {
  try {
    const db = getDb();
    const platform = PLATFORM_MAP[req.query.platform] ? req.query.platform : 'amap';
    const ids = typeof req.query.ids === 'string' && req.query.ids ? req.query.ids.split(',') : [];
    const scope = req.query.scope || 'all';
    let places = db.places;
    if (ids.length) places = places.filter((place) => ids.includes(place.id));
    else if (scope === 'synced') places = places.filter((place) => place.links?.[platform]?.status === 'synced');
    else if (scope === 'located') places = places.filter((place) => place.location);
    const result = buildExport({ platform, format: req.query.format, places });
    mutateStore((draft) => { addActivity(draft, { type: 'export', title: `导出${PLATFORM_MAP[platform]?.shortName || ''}收藏`, detail: `${places.length} 个地点 · ${result.format.toUpperCase()}`, platform }); }).catch(() => {});
    const asciiName = `tuhe-${platform}-${new Date().toISOString().slice(0, 10)}.${result.format}`;
    res.setHeader('Content-Type', result.contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(result.fileName)}`);
    res.send(result.content);
  } catch (error) { next(error); }
});

function connectionView(db, platform) {
  const connection = db.connections?.[platform.id] || {};
  const linked = db.places.filter((place) => place.links?.[platform.id]).length;
  const synced = db.places.filter((place) => place.links?.[platform.id]?.status === 'synced').length;
  const pending = db.places.filter((place) => place.links?.[platform.id]?.status === 'pending').length;
  return {
    ...platform, enabled: connection.enabled !== false, mode: 'webhook',
    webhookUrl: connection.webhookUrl || '', hasToken: Boolean(connection.token), lastSyncAt: connection.lastSyncAt || null,
    linked, synced, pending,
  };
}

app.get('/api/connections', (req, res) => {
  const db = getDb();
  const items = PLATFORMS.map((platform) => connectionView(db, platform));
  ok(res, items);
});

app.patch('/api/connections/:id', async (req, res, next) => {
  try {
    const id = req.params.id;
    if (!PLATFORM_MAP[id]) return fail(res, 404, '平台不存在');
    const updated = await mutateStore((db) => {
      const connection = db.connections?.[id] || {};
      if (typeof req.body?.enabled === 'boolean') connection.enabled = req.body.enabled;
      if (req.body?.webhookUrl !== undefined) {
        const url = clean(req.body.webhookUrl, 1000);
        if (url && !/^https?:\/\//i.test(url)) throw Object.assign(new Error('桥接地址必须以 http:// 或 https:// 开头'), { status: 400 });
        connection.webhookUrl = url;
      }
      if (req.body?.token !== undefined) connection.token = clean(req.body.token, 2000);
      connection.mode = 'webhook';
      connection.updatedAt = nowIso();
      db.connections[id] = connection;
      addActivity(db, { type: 'config', title: `更新${PLATFORM_MAP[id].shortName}桥接`, detail: connection.webhookUrl ? '桥接地址已更新' : '桥接地址已清空', platform: id });
      return id;
    });
    const db = getDb();
    ok(res, connectionView(db, PLATFORM_MAP[updated]));
  } catch (error) { next(error); }
});

app.post('/api/connections/:id/test', async (req, res, next) => {
  try {
    const id = req.params.id;
    if (!PLATFORM_MAP[id]) return fail(res, 404, '平台不存在');
    const connection = getDb().connections?.[id] || {};
    if (!connection.webhookUrl) return fail(res, 400, '请先填写 Cookie 桥接地址');
    const response = await fetch(connection.webhookUrl, {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...(connection.token ? { Authorization: `Bearer ${connection.token}` } : {}) },
      body: JSON.stringify({ event: 'ping', platform: id, sentAt: nowIso(), source: 'tuhe' }), signal: AbortSignal.timeout(8000),
    });
    const text = await response.text();
    if (!response.ok) return fail(res, 502, `Webhook 返回 ${response.status}`, text.slice(0, 400));
    return ok(res, { status: response.status, response: text.slice(0, 400) });
  } catch (error) { next(Object.assign(error, { status: 502, message: `Webhook 测试失败：${error.message}` })); }
});

function slugId(platform, placeId) { return `bridge_${platform}_${crypto.createHash('sha1').update(placeId).digest('hex').slice(0, 10)}`; }

async function callWebhook(connection, platform, place) {
  const coord = platformCoordinates(place, platform);
  const response = await fetch(connection.webhookUrl, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...(connection.token ? { Authorization: `Bearer ${connection.token}` } : {}) },
    body: JSON.stringify({
      event: 'place.upsert', source: 'tuhe', platform, coordSystem: PLATFORM_COORDS[platform], sentAt: nowIso(),
      place: { id: place.id, name: place.name, address: place.address, city: place.city, district: place.district, category: place.category, tags: place.tags || [], note: place.note, rating: place.rating, location: coord ? { lng: coord[0], lat: coord[1] } : null, externalId: place.links?.[platform]?.externalId || null },
    }),
    signal: AbortSignal.timeout(10000),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`HTTP ${response.status} ${text.slice(0, 120)}`);
  let parsed = {};
  try { parsed = JSON.parse(text); } catch { /* plain text */ }
  return { externalId: clean(parsed?.externalId || parsed?.data?.externalId || '', 200) || null };
}

async function runSyncJob(jobId, placeIds, platforms) {
  const started = Date.now();
  const db = getDb();
  const places = placeIds.map((id) => db.places.find((place) => place.id === id)).filter(Boolean);
  const connections = structuredClone(db.connections || {});
  const results = [];
  let succeeded = 0; let failed = 0; let skipped = 0; let processed = 0;

  const updateJob = async (patch) => {
    const runtime = activeJobs.get(jobId);
    if (runtime) Object.assign(runtime, patch);
    await mutateStore((draft) => {
      const job = draft.jobs.find((item) => item.id === jobId);
      if (job) Object.assign(job, patch, { updatedAt: nowIso() });
    });
  };

  try {
    for (const platform of platforms) {
      const connection = connections[platform] || {};
      for (const place of places) {
        let result;
        if (!connection.enabled) result = { placeId: place.id, placeName: place.name, platform, status: 'skipped', reason: '平台连接已停用' };
        else if (!connection.webhookUrl) result = { placeId: place.id, placeName: place.name, platform, status: 'failed', reason: '未配置 Cookie 桥接地址' };
        else {
          try {
            const response = await callWebhook(connection, platform, place);
            result = { placeId: place.id, placeName: place.name, platform, status: 'synced', externalId: response.externalId || place.links?.[platform]?.externalId || slugId(platform, place.id) };
          } catch (error) { result = { placeId: place.id, placeName: place.name, platform, status: 'failed', reason: error.message }; }
        }
        results.push(result);
        if (result.status === 'synced') succeeded += 1;
        else if (result.status === 'skipped' || result.status === 'pending') skipped += 1;
        else failed += 1;
        processed += 1;
        if (processed % 3 === 0 || processed === places.length * platforms.length) {
          await updateJob({ status: 'running', processed, succeeded, failed, skipped, progress: Math.round((processed / Math.max(1, places.length * platforms.length)) * 100) });
        }
      }
    }

    await mutateStore((draft) => {
      const byPlace = new Map();
      for (const result of results) {
        if (!byPlace.has(result.placeId)) byPlace.set(result.placeId, []);
        byPlace.get(result.placeId).push(result);
      }
      for (const [placeId, items] of byPlace) {
        const place = draft.places.find((item) => item.id === placeId);
        if (!place) continue;
        place.links = place.links || {};
        for (const result of items) {
          if (result.status === 'synced') place.links[result.platform] = { externalId: result.externalId || place.links[result.platform]?.externalId || slugId(result.platform, placeId), status: 'synced', lastSyncedAt: nowIso() };
          else if (result.status === 'pending') place.links[result.platform] = { externalId: place.links[result.platform]?.externalId || null, status: 'pending', lastSyncedAt: place.links[result.platform]?.lastSyncedAt || null };
          else if (result.status === 'failed' && place.links[result.platform]) place.links[result.platform] = { ...place.links[result.platform], status: 'failed' };
        }
        place.updatedAt = nowIso();
      }
      const finished = nowIso();
      const job = draft.jobs.find((item) => item.id === jobId);
      if (job) Object.assign(job, { status: failed && !succeeded ? 'failed' : 'completed', processed, succeeded, failed, skipped, progress: 100, finishedAt: finished, durationMs: Date.now() - started, results: results.slice(0, 200) });
      for (const platform of platforms) if (draft.connections?.[platform] && succeeded) draft.connections[platform].lastSyncAt = finished;
      addActivity(draft, { type: 'sync', title: failed ? '同步完成，部分失败' : '同步完成', detail: `${succeeded} 个成功 · ${failed} 个失败 · ${skipped} 个跳过`, platform: platforms.length === 1 ? platforms[0] : 'all' });
    });
    activeJobs.delete(jobId);
  } catch (error) {
    await updateJob({ status: 'failed', error: error.message, finishedAt: nowIso(), progress: 100, durationMs: Date.now() - started }).catch(() => {});
    activeJobs.delete(jobId);
  }
}

function bridgePullEndpoint(webhookUrl) {
  if (!webhookUrl) return '';
  const trimmed = String(webhookUrl).replace(/\/+$/, '');
  if (/\/webhook$/i.test(trimmed)) return `${trimmed}/pull`;
  return `${trimmed}/webhook/pull`;
}

function normalizePulledPlace(item, platform) {
  const name = clean(item?.name, 120);
  if (!name) return null;
  const lng = Number(item?.location?.lng);
  const lat = Number(item?.location?.lat);
  let location = null;
  const sourceSystem = item.coordSystem || PLATFORM_COORDS[platform] || 'WGS84';
  const isMeters = normalizeSystem(sourceSystem) === 'BD09MC';
  if (Number.isFinite(lng) && Number.isFinite(lat) && (isMeters || (Math.abs(lng) <= 180 && Math.abs(lat) <= 90))) {
    const system = sourceSystem;
    const [wlng, wlat] = convertCoordinate(lng, lat, system, 'WGS84');
    location = { lng: Math.round(wlng * 1e6) / 1e6, lat: Math.round(wlat * 1e6) / 1e6 };
  }
  const tags = Array.isArray(item.tags) ? item.tags.map((tag) => clean(tag, 24)).filter(Boolean) : clean(item.tags, 300).split(/[,，;；|、]/).map((tag) => tag.trim()).filter(Boolean);
  const externalId = clean(item.externalId, 200) || `pull_${platform}_${crypto.createHash('sha1').update(`${name}|${location?.lng || ''}|${location?.lat || ''}`).digest('hex').slice(0, 10)}`;
  const city = clean(item.city, 60).replace(/市$/, '') || cityFromAdcode(item.adcode) || nearestCity(location);
  return {
    name,
    address: clean(item.address, 300),
    city,
    district: clean(item.district, 60).replace(/[区县]$/, ''),
    category: clean(item.category, 60),
    tags: [...new Set(tags)].slice(0, 20),
    note: clean(item.note, 500),
    rating: Number.isFinite(Number(item.rating)) ? Number(item.rating) : null,
    location,
    coordSystem: 'WGS84',
    externalId,
    platform,
  };
}

async function fetchBridgePull(connection, platform) {
  const endpoint = bridgePullEndpoint(connection.webhookUrl);
  if (!endpoint) throw Object.assign(new Error('尚未配置桥接地址'), { status: 400 });
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(connection.token ? { Authorization: `Bearer ${connection.token}` } : {}) },
    body: JSON.stringify({ platform }),
    signal: AbortSignal.timeout(60000),
  });
  const text = await response.text();
  if (!response.ok) throw Object.assign(new Error(`桥接器返回 ${response.status}：${text.slice(0, 200)}`), { status: 502 });
  let payload = null;
  try { payload = JSON.parse(text); } catch { throw Object.assign(new Error('桥接器返回的不是 JSON'), { status: 502 }); }
  if (!Array.isArray(payload.items)) throw Object.assign(new Error('桥接器没有返回地点列表'), { status: 502 });
  return payload.items;
}

async function pullConnectionPlaces(id, commit) {
  if (!PLATFORM_MAP[id]) throw Object.assign(new Error('平台不存在'), { status: 404 });
  const db = getDb();
  const connection = db.connections?.[id] || {};
  if (!connection.enabled) throw Object.assign(new Error('平台连接已停用'), { status: 400 });
  const items = await fetchBridgePull(connection, id);
  const threshold = db.settings?.dedupeDistance || 120;
  const normalized = items.map((item) => normalizePulledPlace(item, id)).filter(Boolean);
  const preview = [];
  let newCount = 0;
  let mergedCount = 0;
  let located = 0;
  for (const place of normalized) {
    if (place.location) located += 1;
    const duplicate = findDuplicate(place, db.places, threshold);
    if (duplicate) mergedCount += 1; else newCount += 1;
    if (preview.length < 8) preview.push({ name: place.name, address: place.address, city: place.city, location: place.location, duplicate: Boolean(duplicate), externalId: place.externalId });
  }
  if (!commit) {
    return { platform: id, total: normalized.length, newCount, mergedCount, located, preview };
  }
  return mutateStore((draft) => {
    const timestamp = nowIso();
    let imported = 0;
    let merged = 0;
    for (const place of normalized) {
      const duplicate = findDuplicate(place, draft.places, threshold);
      if (duplicate) {
        mergePlace(duplicate, place);
        duplicate.links = duplicate.links || {};
        duplicate.links[id] = { externalId: place.externalId, status: 'synced', lastSyncedAt: timestamp };
        duplicate.updatedAt = timestamp;
        merged += 1;
      } else {
        draft.places.push({
          id: makeId('pl'),
          name: place.name,
          address: place.address,
          city: place.city,
          district: place.district,
          category: place.category || '未分类',
          tags: place.tags,
          note: place.note,
          rating: place.rating,
          url: '',
          location: place.location,
          coordSystem: 'WGS84',
          source: { platform: id, externalId: place.externalId, importedAt: timestamp },
          links: { [id]: { externalId: place.externalId, status: 'synced', lastSyncedAt: timestamp } },
          createdAt: timestamp,
          updatedAt: timestamp,
        });
        imported += 1;
      }
    }
    draft.connections = draft.connections || {};
    draft.connections[id] = { ...(draft.connections[id] || {}), lastSyncAt: timestamp };
    const batch = { id: makeId('pull'), platform: id, fileName: '平台拉取', format: 'api', total: normalized.length, imported, merged, createdAt: timestamp };
    draft.importBatches = [batch, ...(draft.importBatches || [])].slice(0, 20);
    addActivity(draft, { type: 'import', title: `从${PLATFORM_MAP[id].shortName}拉取收藏`, detail: `新增 ${imported} 个，合并 ${merged} 个地点`, platform: id });
    return { platform: id, total: normalized.length, newCount: imported, mergedCount: merged, located, batchId: batch.id };
  });
}

app.post('/api/connections/:id/pull', async (req, res, next) => {
  try {
    ok(res, await pullConnectionPlaces(req.params.id, req.body?.commit === true));
  } catch (error) { next(Object.assign(error, { status: error.status || 502 })); }
});

app.post('/api/connections/pull-all', async (req, res, next) => {
  try {
    const db = getDb();
    const requested = Array.isArray(req.body?.platforms) ? req.body.platforms.filter((id) => PLATFORM_MAP[id]) : [];
    const ids = (requested.length ? requested : Object.keys(db.connections || {})).filter((id) => PLATFORM_MAP[id] && db.connections?.[id]?.enabled);
    if (!ids.length) return fail(res, 400, '没有启用的平台连接');
    const results = [];
    for (const id of ids) {
      try {
        const result = await pullConnectionPlaces(id, req.body?.commit !== false);
        results.push({ id, name: PLATFORM_MAP[id].shortName, ok: true, ...result });
      } catch (error) {
        results.push({ id, name: PLATFORM_MAP[id].shortName, ok: false, error: error.message || '拉取失败' });
      }
    }
    ok(res, {
      items: results,
      total: results.reduce((sum, item) => sum + (item.total || 0), 0),
      newCount: results.reduce((sum, item) => sum + (item.newCount || 0), 0),
      mergedCount: results.reduce((sum, item) => sum + (item.mergedCount || 0), 0),
      located: results.reduce((sum, item) => sum + (item.located || 0), 0),
    });
  } catch (error) { next(Object.assign(error, { status: error.status || 502 })); }
});

app.post('/api/sync', async (req, res, next) => {
  try {
    const db = getDb();
    const requestedPlatforms = Array.isArray(req.body?.platforms) ? req.body.platforms.filter((id) => PLATFORM_MAP[id]) : [];
    if (!requestedPlatforms.length) return fail(res, 400, '请至少选择一个同步平台');
    let ids = Array.isArray(req.body?.placeIds) ? req.body.placeIds : [];
    if (!ids.length) {
      let candidates = db.places;
      if (req.body?.scope === 'unsynced') candidates = candidates.filter((place) => requestedPlatforms.some((id) => place.links?.[id]?.status !== 'synced'));
      ids = candidates.slice(0, 500).map((place) => place.id);
    }
    ids = [...new Set(ids)].filter((id) => db.places.some((place) => place.id === id)).slice(0, 500);
    if (!ids.length) return fail(res, 400, '没有可同步的地点');
    const job = {
      id: makeId('job'), status: 'queued', platforms: requestedPlatforms, total: ids.length * requestedPlatforms.length,
      processed: 0, succeeded: 0, failed: 0, skipped: 0, progress: 0,
      strategy: req.body?.strategy || 'merge', trigger: req.body?.trigger || 'manual', createdAt: nowIso(), updatedAt: nowIso(),
    };
    await mutateStore((draft) => { draft.jobs = [job, ...(draft.jobs || [])].slice(0, 40); });
    activeJobs.set(job.id, { ...job });
    setTimeout(() => runSyncJob(job.id, ids, requestedPlatforms), 80);
    return ok(res, job);
  } catch (error) { next(error); }
});

app.get('/api/jobs', (req, res) => ok(res, (getDb().jobs || []).slice(0, 30)));
function bridgeAdminBase(webhookUrl) {
  try {
    const url = new URL(String(webhookUrl || ''));
    if (url.port && url.port !== '80' && url.port !== '443') return `${url.protocol}//${url.host}`;
    return `${url.protocol}//${url.hostname}:8790`;
  } catch {
    return '';
  }
}

app.get('/api/jobs/:id/bridge-logs', async (req, res, next) => {
  try {
    const db = getDb();
    const job = (db.jobs || []).find((item) => item.id === req.params.id);
    if (!job) return fail(res, 404, '同步任务不存在');
    if (!BRIDGE_ADMIN_TOKEN) return ok(res, { logs: [], warning: '尚未配置桥接器管理令牌' });
    const connection = db.connections?.[job.platforms?.[0]];
    const base = bridgeAdminBase(connection?.webhookUrl);
    if (!base) return ok(res, { logs: [], warning: '无法推导桥接器地址' });
    const response = await fetch(`${base}/api/status`, { headers: { 'x-bridge-token': BRIDGE_ADMIN_TOKEN }, signal: AbortSignal.timeout(10000) });
    if (!response.ok) return ok(res, { logs: [], warning: `桥接器日志读取失败（HTTP ${response.status}）` });
    const payload = await response.json();
    const start = Date.parse(job.createdAt || '') - 5000;
    const end = Date.parse(job.finishedAt || job.updatedAt || job.createdAt || '') + 5000;
    const platforms = new Set(job.platforms || []);
    const logs = (payload?.data?.logs || []).filter((item) => {
      if (!platforms.has(item.platform)) return false;
      const at = Date.parse(item.at || item.time || '');
      return Number.isFinite(at) ? at >= start && at <= end : true;
    }).slice(0, 200).map((item) => {
      let status = item.status;
      let error = item.error || null;
      const text = String(item.response || '');
      if (status === 'synced' && text) {
        try {
          const parsed = JSON.parse(text);
          if (parsed?.result === false || Number(parsed?.code) === 3 || (Number(parsed?.code) === 0 && /Unexpected error/i.test(String(parsed?.message || '')))) {
            status = 'failed';
            error = `高德返回 code=${parsed.code}：${parsed.message || '失败'}`;
          }
        } catch { /* keep original */ }
      }
      return { ...item, status, error };
    });
    ok(res, { logs });
  } catch (error) { next(error); }
});

app.get('/api/jobs/:id', (req, res) => {
  const runtime = activeJobs.get(req.params.id);
  if (runtime) return ok(res, runtime);
  const job = (getDb().jobs || []).find((item) => item.id === req.params.id);
  if (!job) return fail(res, 404, '同步任务不存在');
  return ok(res, job);
});

async function saveFootprintRecord({ content, buffer, fileName, name, source = 'onedrive', footprintId = null }) {
  if (!buffer && !String(content || '').trim()) throw Object.assign(new Error('足迹文件为空'), { status: 400 });
  const parsed = buffer
    ? parseFootprintBuffer({ buffer, fileName: fileName || 'world-fog.fwss' })
    : parseFootprintContent({ content, fileName: fileName || 'world-fog.gpx', format: 'auto' });
  if (!parsed.stats) throw Object.assign(new Error(parsed.warnings[0] || '没有识别到足迹点'), { status: 400 });
  return mutateStore((db) => {
    const timestamp = nowIso();
    const title = clean(name, 120) || String(fileName || '').replace(/\.[^.]+$/, '') || '世界迷雾足迹';
    db.footprints = db.footprints || [];
    let item = footprintId ? db.footprints.find((footprint) => footprint.id === footprintId) : null;
    if (item) {
      item.name = title;
      item.fileName = clean(fileName, 200);
      item.format = parsed.format;
      item.stats = parsed.stats;
      item.tracks = parsed.tracks;
      item.warnings = parsed.warnings;
      item.updatedAt = timestamp;
    } else {
      item = {
        id: makeId('fp'),
        name: title,
        source: clean(source, 40) || 'world-fog',
        fileName: clean(fileName, 200),
        format: parsed.format,
        stats: parsed.stats,
        tracks: parsed.tracks,
        warnings: parsed.warnings,
        createdAt: timestamp,
      };
      db.footprints = [item, ...db.footprints].slice(0, 100);
    }
    addActivity(db, {
      type: 'footprint',
      title: item.updatedAt ? '更新 OneDrive 足迹' : '导入足迹数据',
      detail: `${item.name} · ${parsed.stats.points} 个点 · ${(parsed.stats.distanceMeters / 1000).toFixed(1)} km`,
      platform: 'world-fog',
    });
    return item;
  });
}

function oneDriveStatusPayload() {
  const integration = getDb().integrations?.onedrive || null;
  return {
    connected: Boolean(integration?.tokens || integration?.refreshToken),
    accountName: integration?.accountName || '',
    accountEmail: integration?.accountEmail || '',
    driveType: integration?.driveType || '',
    connectedAt: integration?.connectedAt || null,
    lastSyncAt: integration?.lastSyncAt || null,
    lastPath: integration?.lastPath || '',
    importedCount: Object.keys(integration?.imported || {}).length,
    redirectUri: ONEDRIVE_REDIRECT_URI,
    clientId: oneDriveClientId(),
  };
}

function readOneDriveTokens(integration) {
  if (integration?.tokens) {
    try { return JSON.parse(unseal(integration.tokens)); } catch { return null; }
  }
  if (integration?.refreshToken) return integration;
  return null;
}

async function oneDriveAccessToken() {
  const integration = getDb().integrations?.onedrive;
  const current = readOneDriveTokens(integration);
  if (!current?.refreshToken) throw Object.assign(new Error('尚未登录 OneDrive'), { status: 401 });
  if (current.accessToken && Number(current.expiresAt) > Date.now() + 60000) return current.accessToken;
  let tokens;
  try {
    tokens = await refreshOneDriveToken(current.refreshToken);
  } catch (error) {
    throw Object.assign(new Error(`OneDrive 登录已过期，请重新登录：${error.message}`), { status: 401 });
  }
  const nextTokens = { ...tokens, refreshToken: tokens.refreshToken || current.refreshToken };
  await mutateStore((db) => {
    db.integrations = db.integrations || {};
    db.integrations.onedrive = {
      ...(db.integrations.onedrive || {}),
      tokens: seal(JSON.stringify(nextTokens)),
      refreshedAt: nowIso(),
    };
  });
  return nextTokens.accessToken;
}

async function completeOneDriveLogin(code, state) {
  if (!code) throw Object.assign(new Error('缺少 Microsoft 返回的授权码'), { status: 400 });
  if (!state || !oneDriveLoginStates.has(state)) {
    throw Object.assign(new Error('登录状态已过期，请重新点击“登录 OneDrive”'), { status: 400 });
  }
  oneDriveLoginStates.delete(state);
  const tokens = await exchangeOneDriveCode(code);
  if (!tokens.refreshToken) throw Object.assign(new Error('Microsoft 没有返回长期令牌，请重新登录'), { status: 502 });
  let profile = { accountId: '', accountName: 'OneDrive', accountEmail: '', driveId: '', driveType: '' };
  let profileWarning = '';
  try {
    profile = await getOneDriveProfile(tokens.accessToken);
  } catch (error) {
    profileWarning = error.message;
  }
  await mutateStore((db) => {
    db.integrations = db.integrations || {};
    const previous = db.integrations.onedrive || {};
    db.integrations.onedrive = {
      ...previous,
      ...profile,
      tokens: seal(JSON.stringify(tokens)),
      imported: previous.imported || {},
      connectedAt: nowIso(),
      profileWarning,
    };
  });
  return { ...oneDriveStatusPayload(), profileWarning };
}

async function collectOneDriveFiles(accessToken, rootPath) {
  const queue = [{ path: rootPath || '', depth: 0 }];
  const files = [];
  let visited = 0;
  while (queue.length && visited < 80 && files.length < 200) {
    const current = queue.shift();
    visited += 1;
    const listing = await listOneDriveFolder(accessToken, current.path);
    for (const file of listing.files) {
      if (file.supported) files.push({ ...file, path: listing.path });
    }
    if (current.depth < 6) {
      for (const folder of listing.folders) queue.push({ path: `${listing.path}/${folder.name}`, depth: current.depth + 1 });
    }
  }
  return { files, visited, truncated: queue.length > 0 || files.length >= 200 };
}

app.get('/api/onedrive/status', (req, res) => ok(res, oneDriveStatusPayload()));

app.get('/api/onedrive/diagnostics', (req, res) => {
  const integration = getDb().integrations?.onedrive;
  const tokens = readOneDriveTokens(integration);
  let claims = null;
  try {
    claims = JSON.parse(Buffer.from(String(tokens?.accessToken || '').split('.')[1] || '', 'base64url').toString('utf8'));
  } catch { /* ignore */ }
  ok(res, {
    connected: Boolean(tokens?.refreshToken),
    audience: claims?.aud || null,
    scopes: claims?.scp || null,
    tenantId: claims?.tid || null,
    account: claims?.upn || claims?.preferred_username || null,
    expiresAt: claims?.exp ? new Date(claims.exp * 1000).toISOString() : null,
    profileWarning: integration?.profileWarning || null,
  });
});

app.post('/api/onedrive/auth/start', (req, res) => {
  const state = crypto.randomBytes(18).toString('hex');
  const now = Date.now();
  for (const [key, value] of oneDriveLoginStates) {
    if (now - value.at > 20 * 60 * 1000) oneDriveLoginStates.delete(key);
  }
  oneDriveLoginStates.set(state, { at: now });
  ok(res, { url: buildOneDriveAuthUrl(state), state, redirectUri: ONEDRIVE_REDIRECT_URI });
});

app.post('/api/onedrive/auth/complete', async (req, res, next) => {
  try {
    let code = clean(req.body?.code, 8000);
    let state = clean(req.body?.state, 200);
    const redirectUrl = clean(req.body?.redirectUrl, 12000);
    if (redirectUrl) {
      try {
        const parsed = new URL(redirectUrl);
        code = parsed.searchParams.get('code') || code;
        state = parsed.searchParams.get('state') || state;
      } catch { /* allow a bare code below */ }
      if (!code && redirectUrl.length < 8000 && !redirectUrl.includes('://')) code = redirectUrl;
    }
    ok(res, await completeOneDriveLogin(code, state));
  } catch (error) { next(error); }
});

app.post('/api/onedrive/disconnect', async (req, res, next) => {
  try {
    await mutateStore((db) => {
      if (db.integrations) delete db.integrations.onedrive;
    });
    ok(res, oneDriveStatusPayload());
  } catch (error) { next(error); }
});

app.get('/api/onedrive/items', async (req, res, next) => {
  try {
    const accessToken = await oneDriveAccessToken();
    const listing = await listOneDriveFolder(accessToken, clean(req.query?.path, 1000));
    ok(res, listing);
  } catch (error) { next(error); }
});

app.post('/api/onedrive/sync', async (req, res, next) => {
  try {
    const accessToken = await oneDriveAccessToken();
    const rootPath = clean(req.body?.path, 1000);
    const collected = await collectOneDriveFiles(accessToken, rootPath);
    const integration = getDb().integrations?.onedrive || {};
    const importedMap = { ...(integration.imported || {}) };
    const existingIds = new Set((getDb().footprints || []).map((item) => item.id));
    const results = [];
    let imported = 0;
    let updated = 0;
    let skipped = 0;
    let failed = 0;
    for (const file of collected.files.slice(0, 40)) {
      const previous = importedMap[file.id];
      if (previous?.eTag && previous.eTag === file.eTag) {
        skipped += 1;
        results.push({ name: file.name, path: file.path, status: 'skipped' });
        continue;
      }
      if (file.size > 25 * 1024 * 1024) {
        failed += 1;
        results.push({ name: file.name, path: file.path, status: 'failed', error: '文件超过 25MB' });
        continue;
      }
      try {
        const buffer = await downloadOneDriveFile(accessToken, file.id);
        const keepId = previous?.footprintId && existingIds.has(previous.footprintId) ? previous.footprintId : null;
        const footprint = await saveFootprintRecord({
          buffer,
          fileName: file.name,
          name: file.name.replace(/\.[^.]+$/, ''),
          source: 'onedrive',
          footprintId: keepId,
        });
        importedMap[file.id] = {
          eTag: file.eTag,
          footprintId: footprint.id,
          name: file.name,
          path: file.path,
          importedAt: nowIso(),
        };
        if (keepId) updated += 1; else imported += 1;
        results.push({ name: file.name, path: file.path, status: keepId ? 'updated' : 'imported', points: footprint.stats?.points || 0 });
      } catch (error) {
        failed += 1;
        results.push({ name: file.name, path: file.path, status: 'failed', error: error.message });
      }
    }
    const timestamp = nowIso();
    await mutateStore((db) => {
      db.integrations = db.integrations || {};
      db.integrations.onedrive = {
        ...(db.integrations.onedrive || {}),
        imported: importedMap,
        lastSyncAt: timestamp,
        lastPath: rootPath,
      };
    });
    if (imported || updated) {
      await mutateStore((db) => {
        addActivity(db, {
          type: 'footprint',
          title: '从 OneDrive 同步足迹',
          detail: `新增 ${imported} 个，更新 ${updated} 个，跳过 ${skipped} 个`,
          platform: 'world-fog',
        });
      });
    }
    ok(res, {
      path: rootPath,
      scanned: collected.files.length,
      imported,
      updated,
      skipped,
      failed,
      truncated: collected.truncated || collected.files.length > 40,
      results,
      at: timestamp,
    });
  } catch (error) { next(error); }
});

app.get('/api/footprints', (req, res) => {
  const footprints = getDb().footprints || [];
  const items = footprints.map(({ tracks, ...footprint }) => footprint);
  ok(res, { items, totals: aggregateFootprints(footprints) });
});

app.get('/api/footprints/:id', (req, res) => {
  const footprint = (getDb().footprints || []).find((item) => item.id === req.params.id);
  if (!footprint) return fail(res, 404, '足迹档案不存在');
  return ok(res, footprint);
});

app.post('/api/footprints/import', async (req, res, next) => {
  try {
    const content = String(req.body?.content || '');
    const contentBase64 = String(req.body?.contentBase64 || '');
    const buffer = contentBase64 ? Buffer.from(contentBase64, 'base64') : null;
    if (!buffer && !content.trim()) return fail(res, 400, '请选择世界迷雾导出文件或粘贴轨迹数据');
    const footprint = await saveFootprintRecord({
      content,
      buffer,
      fileName: req.body?.fileName || 'world-fog.gpx',
      name: req.body?.name,
      source: req.body?.source || 'world-fog',
    });
    const { tracks, ...summary } = footprint;
    ok(res, summary);
  } catch (error) {
    next(Object.assign(error, { status: error.status || 400, message: error.message || '足迹导入失败' }));
  }
});

app.patch('/api/footprints/:id', async (req, res, next) => {
  try {
    const name = clean(req.body?.name, 120);
    if (!name) return fail(res, 400, '请输入足迹名称');
    const updated = await mutateStore((db) => {
      const item = (db.footprints || []).find((footprint) => footprint.id === req.params.id);
      if (!item) throw Object.assign(new Error('足迹档案不存在'), { status: 404 });
      item.name = name;
      item.updatedAt = nowIso();
      return item;
    });
    const { tracks, ...summary } = updated;
    ok(res, summary);
  } catch (error) { next(error); }
});

app.delete('/api/footprints/:id', async (req, res, next) => {
  try {
    const result = await mutateStore((db) => {
      const before = (db.footprints || []).length;
      db.footprints = (db.footprints || []).filter((item) => item.id !== req.params.id);
      addActivity(db, { type: 'footprint', title: '删除足迹档案', detail: '足迹数据已从本地移除', platform: 'world-fog' });
      return { count: before - db.footprints.length };
    });
    ok(res, result);
  } catch (error) { next(error); }
});

app.get('/api/activities', (req, res) => ok(res, (getDb().activities || []).slice(0, 50)));

app.get('/api/duplicates', (req, res) => {
  const db = getDb();
  const groups = findDuplicateGroups(db.places, db.settings?.dedupeDistance || 120);
  ok(res, { groups, count: groups.length });
});

app.post('/api/duplicates/merge', async (req, res, next) => {
  try {
    const keepId = clean(req.body?.keepId, 100);
    const mergeIds = Array.isArray(req.body?.mergeIds) ? req.body.mergeIds : [];
    if (!keepId || !mergeIds.length) return fail(res, 400, '请选择保留地点与待合并地点');
    const result = await mutateStore((db) => {
      const keep = db.places.find((place) => place.id === keepId);
      if (!keep) throw Object.assign(new Error('保留地点不存在'), { status: 404 });
      const others = db.places.filter((place) => mergeIds.includes(place.id) && place.id !== keepId);
      for (const other of others) { mergePlace(keep, other); keep.links = { ...(other.links || {}), ...(keep.links || {}) }; }
      db.places = db.places.filter((place) => !mergeIds.includes(place.id) || place.id === keepId);
      addActivity(db, { type: 'dedupe', title: '合并重复地点', detail: `保留「${keep.name}」，合并 ${others.length} 条记录`, platform: 'manual' });
      return { kept: keep.name, merged: others.length };
    });
    ok(res, result);
  } catch (error) { next(error); }
});

app.post('/api/backup', async (req, res, next) => {
  try { const file = await createBackup(); ok(res, { file: path.basename(file), createdAt: nowIso() }); }
  catch (error) { next(error); }
});
app.get('/api/backup/download', (req, res) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="tuhe-backup-${new Date().toISOString().slice(0, 10)}.json"`);
  res.send(JSON.stringify(getDb(), null, 2));
});

app.use('/api', (req, res) => fail(res, 404, '接口不存在'));

const distDir = path.join(paths.ROOT, 'dist');
if (fs.existsSync(path.join(distDir, 'index.html'))) {
  const indexHtml = fs.readFileSync(path.join(distDir, 'index.html'), 'utf8');
  app.use(express.static(distDir, { maxAge: '1h', index: false }));
  app.use((req, res, next) => {
    if (req.method !== 'GET' || req.path.startsWith('/api')) return next();
    return res.status(200).type('html').send(indexHtml);
  });
}

app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  const status = error.status || 500;
  if (status >= 500) console.error(error);
  return fail(res, status, error.message || '服务器内部错误');
});

await initStore();
await mutateStore((draft) => {
  for (const job of draft.jobs || []) {
    if (job.status === 'running' || job.status === 'queued') {
      job.status = 'interrupted';
      job.error = '服务重启，任务已中断；已完成的关联会保留，可重新发起同步继续补齐。';
    } else if (job.status === 'failed' && /服务重启/.test(String(job.error || ''))) {
      job.status = 'interrupted';
    }
  }
});
const db = getDb();
app.listen(PORT, '0.0.0.0', () => {
  console.log(`途合 API 已启动：http://127.0.0.1:${PORT}`);
  console.log(`数据文件：${paths.DB_FILE}`);
});
