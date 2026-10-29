import express from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const DATA_DIR = process.env.BRIDGE_DATA_DIR || path.join(ROOT, 'data');
const DB_FILE = path.join(DATA_DIR, 'bridge.json');
const SECRET_FILE = path.join(DATA_DIR, 'secret');
const PORT = Number(process.env.BRIDGE_PORT || 8790);
const ADMIN_TOKEN = process.env.BRIDGE_ADMIN_TOKEN || '';
const WEBHOOK_TOKEN = process.env.BRIDGE_WEBHOOK_TOKEN || '';
const ALLOW_LIVE = process.env.BRIDGE_ALLOW_LIVE !== '0';
const PLATFORMS = [
  { id: 'amap', name: '高德地图', short: '高德', color: '#1b74e4', coord: 'GCJ02' },
  { id: 'baidu', name: '百度地图', short: '百度', color: '#3448d2', coord: 'BD09' },
  { id: 'yuanzhou', name: '圆周旅迹', short: '圆周', color: '#b96a31', coord: 'GCJ02' },
];
const PLATFORM_MAP = Object.fromEntries(PLATFORMS.map((item) => [item.id, item]));
const MAX_LOGS = 300;

let state = { platforms: {}, logs: [] };
let key = null;
let persistChain = Promise.resolve();
const lastSent = new Map();
const queues = new Map();

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function httpError(status, message, extra = {}) {
  const error = new Error(message);
  error.status = status;
  error.extra = extra;
  return error;
}

function clean(value, max = 2000) {
  return String(value ?? '').trim().slice(0, max);
}

function nowIso() { return new Date().toISOString(); }

function parseCookiePairs(raw) {
  let text = String(raw || '').trim();
  if (!text) return [];
  if (text.startsWith('{') || text.startsWith('[')) {
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) {
        return parsed.filter((item) => item && typeof item === 'object' && item.name).map((item) => [String(item.name).trim(), String(item.value ?? '').trim()]).filter(([name]) => Boolean(name));
      }
      if (parsed && typeof parsed === 'object') {
        return Object.entries(parsed).map(([name, value]) => [String(name).trim(), String(value ?? '').trim()]).filter(([name]) => Boolean(name));
      }
    } catch { /* treat as raw text */ }
  }
  const match = text.match(/(?:^|\n)\s*cookie\s*:\s*([^\n]+)/i);
  if (match) text = match[1];
  if (text.includes('\n')) {
    text = text.split('\n').map((line) => {
      const m = line.match(/^\s*cookie\s*:\s*(.+)$/i);
      return m ? m[1] : line.trim();
    }).filter(Boolean).join('; ');
  }
  const pairs = [];
  for (const part of text.split(';')) {
    const trimmed = part.trim();
    const index = trimmed.indexOf('=');
    if (index <= 0) continue;
    pairs.push([trimmed.slice(0, index).trim(), trimmed.slice(index + 1).trim()]);
  }
  return pairs;
}

function sanitizeCookie(raw) {
  const pairs = parseCookiePairs(raw);
  if (!pairs.length) return '';
  const deduped = new Map();
  for (const [name, value] of pairs) deduped.set(name, value);
  return [...deduped.entries()].map(([name, value]) => `${name}=${value}`).join('; ').slice(0, 20000);
}

function cookieMeta(encrypted) {
  if (!encrypted) return null;
  let cookie = '';
  try { cookie = decrypt(encrypted); } catch { return { count: 0, names: [], readable: false }; }
  const pairs = parseCookiePairs(cookie);
  return { count: pairs.length, names: pairs.map(([name]) => name).slice(0, 40), readable: true };
}

function sanitizeHeaders(input) {
  let value = input;
  if (typeof value === 'string') {
    try { value = JSON.parse(value); } catch { throw httpError(400, '请求头必须是合法 JSON 对象'); }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) value = {};
  const result = {};
  for (const [name, raw] of Object.entries(value).slice(0, 30)) {
    const header = clean(name, 80).replace(/[^A-Za-z0-9-]/g, '');
    if (!header) continue;
    if (['host', 'content-length', 'cookie'].includes(header.toLowerCase())) continue;
    result[header] = clean(raw, 4000).replace(/[\r\n]/g, ' ');
  }
  return result;
}

function sanitizeConfig(input = {}) {
  const url = clean(input.url, 2000);
  if (url && !/^https?:\/\//i.test(url)) throw httpError(400, '请求地址必须以 http:// 或 https:// 开头');
  const verifyUrl = clean(input.verifyUrl, 2000);
  if (verifyUrl && !/^https?:\/\//i.test(verifyUrl)) throw httpError(400, '验活地址必须以 http:// 或 https:// 开头');
  const method = clean(input.method || 'POST', 10).toUpperCase();
  if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) throw httpError(400, '不支持的请求方法');
  const interval = Number(input.minIntervalMs);
  return {
    url,
    method,
    headers: sanitizeHeaders(input.headers),
    body: String(input.body || '').slice(0, 30000),
    externalIdPath: clean(input.externalIdPath || 'data.id', 120),
    verifyUrl,
    dryRun: input.dryRun !== false,
    minIntervalMs: Number.isFinite(interval) ? Math.min(10000, Math.max(200, Math.round(interval))) : 800,
    adapter: ['amap', 'baidu'].includes(String(input.adapter || '')) ? String(input.adapter) : '',
    ver: clean(input.ver || '', 80),
  };
}

function sanitizeCollectionPull(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const detailUrl = clean(input.detailUrl, 2000);
  if (!detailUrl) return null;
  if (!/^https?:\/\//i.test(detailUrl)) throw httpError(400, '收藏夹详情地址必须以 http:// 或 https:// 开头');
  const method = clean(input.detailMethod || 'POST', 10).toUpperCase();
  if (!['GET', 'POST', 'PUT', 'PATCH'].includes(method)) throw httpError(400, '收藏夹详情请求方法不支持');
  const pages = Number(input.maxCollections);
  return {
    idPath: clean(input.idPath || 'collection_id', 120),
    namePath: clean(input.namePath || 'name', 120),
    detailUrl,
    detailMethod: method,
    detailHeaders: sanitizeHeaders(input.detailHeaders),
    detailBody: String(input.detailBody || '').slice(0, 30000),
    itemsPath: clean(input.itemsPath || 'items', 120),
    totalPath: clean(input.totalPath || '', 120),
    maxCollections: Number.isFinite(pages) ? Math.min(100, Math.max(1, Math.round(pages))) : 50,
  };
}

function sanitizePullConfig(input = {}) {
  const url = clean(input.url, 2000);
  if (url && !/^https?:\/\//i.test(url)) throw httpError(400, '拉取地址必须以 http:// 或 https:// 开头');
  const method = clean(input.method || 'GET', 10).toUpperCase();
  if (!['GET', 'POST', 'PUT', 'PATCH'].includes(method)) throw httpError(400, '拉取请求方法不支持');
  const defaults = { name: 'name', address: 'address', city: 'city', district: 'district', category: 'category', tags: 'tags', note: 'note', rating: 'rating', lng: 'lng', lat: 'lat', id: 'id', adcode: 'adcode' };
  const fieldMap = {};
  for (const key of Object.keys(defaults)) fieldMap[key] = clean(input.fieldMap?.[key] || defaults[key], 120);
  const pages = Number(input.maxPages);
  const size = Number(input.pageSize);
  const coordSystem = ['GCJ02', 'BD09', 'BD09MC', 'WGS84'].includes(String(input.coordSystem || '').toUpperCase()) ? String(input.coordSystem).toUpperCase() : '';
  return {
    url,
    method,
    headers: sanitizeHeaders(input.headers),
    body: String(input.body || '').slice(0, 30000),
    itemsPath: clean(input.itemsPath || 'items', 120),
    fieldMap,
    coordSystem,
    maxPages: Number.isFinite(pages) ? Math.min(20, Math.max(1, Math.round(pages))) : 1,
    pageSize: Number.isFinite(size) ? Math.min(500, Math.max(1, Math.round(size))) : 100,
    lastver: clean(input.lastver || '', 80),
    lastverPath: clean(input.lastverPath || '', 120),
    collection: sanitizeCollectionPull(input.collection),
  };
}

function encrypt(text) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(String(text), 'utf8'), cipher.final()]);
  return { iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') };
}

function decrypt(payload) {
  if (!payload?.data) return '';
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(payload.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(payload.tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(payload.data, 'base64')), decipher.final()]).toString('utf8');
  } catch {
    throw httpError(500, 'Cookie 解密失败：密钥可能发生变化');
  }
}

async function loadState() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  let secret = process.env.BRIDGE_SECRET || '';
  if (!secret) {
    try { secret = (await fs.readFile(SECRET_FILE, 'utf8')).trim(); } catch { /* create below */ }
  }
  if (!secret) {
    secret = crypto.randomBytes(32).toString('hex');
    await fs.writeFile(SECRET_FILE, secret, { mode: 0o600 });
  }
  key = crypto.scryptSync(secret, 'tuhe-bridge-v1', 32);
  try {
    const raw = JSON.parse(await fs.readFile(DB_FILE, 'utf8'));
    state.platforms = raw.platforms && typeof raw.platforms === 'object' ? raw.platforms : {};
    state.logs = Array.isArray(raw.logs) ? raw.logs.slice(0, MAX_LOGS) : [];
  } catch {
    state = { platforms: {}, logs: [] };
  }
}

function persist() {
  const snapshot = JSON.stringify(state);
  persistChain = persistChain.catch(() => {}).then(async () => {
    const tmp = `${DB_FILE}.tmp`;
    await fs.writeFile(tmp, snapshot, { mode: 0o600 });
    await fs.rename(tmp, DB_FILE);
  });
  return persistChain;
}

function schedulePersist() {
  clearTimeout(schedulePersist.timer);
  schedulePersist.timer = setTimeout(() => { persist().catch(() => {}); }, 120);
}

function addLog(entry) {
  state.logs.unshift({
    id: `log_${Date.now().toString(36)}_${crypto.randomBytes(2).toString('hex')}`,
    at: nowIso(),
    ...entry,
  });
  state.logs = state.logs.slice(0, MAX_LOGS);
  schedulePersist();
}

function readPath(obj, dotted) {
  if (!dotted) return null;
  return dotted.split('.').reduce((acc, part) => (acc == null ? null : acc[part]), obj);
}

function templateContext(payload, platform) {
  const place = payload?.place || {};
  const location = place.location || {};
  return {
    'place.id': place.id,
    'place.name': place.name,
    'place.address': place.address,
    'place.city': place.city,
    'place.district': place.district,
    'place.category': place.category,
    'place.tags': Array.isArray(place.tags) ? place.tags.join(',') : '',
    'place.tagsJson': JSON.stringify(Array.isArray(place.tags) ? place.tags : []),
    'place.note': place.note,
    'place.rating': place.rating,
    'place.externalId': place.externalId,
    'place.location.lng': location.lng,
    'place.location.lat': location.lat,
    'place.locationJson': JSON.stringify(place.location || null),
    'payloadJson': JSON.stringify(payload || {}),
    platform,
    coordSystem: payload?.coordSystem || '',
    sentAt: payload?.sentAt || '',
  };
}

function render(template, context, mode = 'json') {
  return String(template || '').replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, name) => {
    const value = context[name];
    if (value === undefined || value === null) return '';
    if (name.endsWith('Json')) return String(value);
    if (mode === 'url') return encodeURIComponent(String(value));
    if (mode === 'form') return encodeURIComponent(String(value)).replace(/%20/g, '+');
    if (mode === 'json') return JSON.stringify(String(value)).slice(1, -1);
    return String(value);
  });
}

function redactSecrets(text, cookie) {
  let output = String(text || '');
  if (cookie) output = output.split(String(cookie)).join('***');
  for (const part of String(cookie || '').split(';')) {
    const trimmed = part.trim();
    if (trimmed.length >= 3) output = output.split(trimmed).join('***');
    const value = part.split('=').slice(1).join('=').trim();
    if (value && value.length >= 3) output = output.split(value).join('***');
  }
  return output.slice(0, 240);
}

function previewHeaders(headers) {
  return Object.fromEntries(Object.entries(headers || {}).map(([name, value]) => [
    name, /authorization|token|secret|key/i.test(name) ? '***' : value,
  ]));
}

function publicPlatform(platform) {
  const stored = state.platforms[platform.id] || {};
  const last = state.logs.find((item) => item.platform === platform.id) || null;
  return {
    ...platform,
    configured: Boolean(stored.cookieEnc),
    hasTemplate: Boolean(stored.config?.url),
    cookieUpdatedAt: stored.cookieUpdatedAt || null,
    cookieMeta: cookieMeta(stored.cookieEnc),
    config: stored.config ? { ...stored.config, headers: { ...stored.config.headers } } : null,
    pull: stored.pull ? { ...stored.pull, headers: { ...stored.pull.headers }, fieldMap: { ...stored.pull.fieldMap } } : null,
    pullReady: Boolean(stored.pull?.url && stored.cookieEnc),
    lastLog: last,
  };
}

function adminAuth(req, res, next) {
  if (!ADMIN_TOKEN) return next();
  const header = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const token = req.headers['x-bridge-token'] || header;
  if (token === ADMIN_TOKEN) return next();
  return res.status(401).json({ ok: false, error: '管理令牌无效' });
}

function webhookAuth(req, res, next) {
  if (!WEBHOOK_TOKEN) return next();
  const header = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const token = req.headers['x-bridge-token'] || header;
  if (token === WEBHOOK_TOKEN) return next();
  return res.status(401).json({ ok: false, error: 'Webhook 令牌无效' });
}

async function fetchWithRetry(url, init, retries = 2) {
  let lastError = null;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await fetch(url, { ...init, signal: AbortSignal.timeout(18000) });
      if ((response.status === 429 || response.status >= 500) && attempt < retries) {
        const retryAfter = Number(response.headers.get('retry-after'));
        await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter * 1000, 5000) : 900 * (attempt + 1));
        continue;
      }
      return response;
    } catch (error) {
      lastError = error;
      if (attempt < retries) await sleep(900 * (attempt + 1));
    }
  }
  throw lastError || new Error('请求失败');
}

function enqueue(platform, task) {
  const previous = queues.get(platform) || Promise.resolve();
  const next = previous.catch(() => {}).then(task);
  queues.set(platform, next);
  return next;
}


function amapPixel(lat, lng) {
  const r = 6378137;
  const pi = Math.PI;
  const full = 2 * pi * r;
  const clippedLat = Math.min(85.0511287798, Math.max(-85.0511287798, Number(lat)));
  const clippedLng = Math.min(180, Math.max(-180, Number(lng)));
  const radLat = clippedLat * pi / 180;
  const radLng = clippedLng * pi / 180;
  const sinLat = Math.sin(radLat);
  const p = r * radLng;
  const l = Math.log((1 + sinLat) / (1 - sinLat));
  const u = Math.trunc(r / 2) * l;
  const v = 256 << 20;
  const h = full / v;
  const gx = Math.min(v - 1, Math.max(0, Math.trunc((full / 2 + p) / h + 0.5)));
  const gy = Math.min(v - 1, Math.max(0, Math.trunc((full / 2 - u) / h + 0.5)));
  return { x: gx, y: gy };
}

function buildAmapFavPayload(place, ver) {
  if (!place?.location) throw httpError(400, '高德同步需要地点坐标');
  const { x, y } = amapPixel(place.location.lat, place.location.lng);
  const id = crypto.createHash('md5').update(`${x}+${y}+${place.name || ''}`).digest('hex');
  return {
    id,
    type: 101,
    ver: ver || '',
    data: {
      item_id: id,
      custom_address: place.address || '',
      poiid: /^B[0-9A-Z]{8,}$/.test(String(place.externalId || '')) ? place.externalId : '',
      custom_name: place.name || '',
      type: '0',
      address: place.address || '',
      phone_numbers: '',
      comment: place.note || '',
      name: place.name || '',
      point_x: x,
      point_y: y,
      top_time: '',
      city_code: '',
      custom_phone_numbers: '',
      city_name: place.city || '',
      tag: Array.isArray(place.tags) ? place.tags.join(',') : '',
    },
  };
}


const BAIDU_LLBAND = [75, 60, 45, 30, 15, 0];
const BAIDU_LL2MC = [
  [-0.0015702102444, 111320.7020616939, 1704480524535203, -10338987376042340, 26112667856603880, -35149669176653700, 26595700718403920, -10725012454188240, 1800819912950474, 82.5],
  [0.0008277824516172526, 111320.7020463578, 647795574.6671607, -4082003173.641316, 10774905663.51142, -15171875531.51559, 12053065338.62167, -5124939663.577472, 913311935.9512032, 67.5],
  [0.00337398766765, 111320.7020202162, 4481351.045890365, -23393751.19931662, 79682215.47186455, -115964993.2797253, 97236711.15602145, -43661946.33752821, 8477230.501135234, 52.5],
  [0.00220636496208, 111320.7020209128, 51751.86112841131, 3796837.749470245, 992013.7397791013, -1221952.21711287, 1340652.697009075, -620943.6990984312, 144416.9293806241, 37.5],
  [-0.0003441963504368392, 111320.7020576856, 278.2353980772752, 2485758.690035394, 6070.750963243378, 54821.18345352118, 9540.606633304236, -2710.55326746645, 1405.483844121726, 22.5],
  [-0.0003218135878613132, 111320.7020701615, 0.00369383431289, 823725.6402795718, 0.46104986909093, 2351.343141331292, 1.58060784298199, 8.77738589078284, 0.37238884252424, 7.45],
];

function bd09ToMc(lng, lat) {
  const x = Number(lng);
  const y = Number(lat);
  let factors = BAIDU_LL2MC[BAIDU_LL2MC.length - 1];
  for (let i = 0; i < BAIDU_LLBAND.length; i += 1) {
    if (Math.abs(y) > BAIDU_LLBAND[i]) { factors = BAIDU_LL2MC[i]; break; }
  }
  const cc = Math.abs(y) / factors[9];
  const xt = factors[0] + factors[1] * Math.abs(x);
  const yt = factors[2] + factors[3] * cc + factors[4] * cc ** 2 + factors[5] * cc ** 3 + factors[6] * cc ** 4 + factors[7] * cc ** 5 + factors[8] * cc ** 6;
  return [xt * (x < 0 ? -1 : 1), yt * (y < 0 ? -1 : 1)];
}

function buildBaiduFavPayload(place) {
  if (!place?.location) throw httpError(400, '百度同步需要地点坐标');
  const [mx, my] = bd09ToMc(place.location.lng, place.location.lat);
  return {
    type: '11',
    sourceid: '',
    plateform: 3,
    fromapp: '百度地图',
    extdata: {
      name: place.name || '',
      content: place.address || '',
      geoptx: mx.toFixed(2),
      geopty: my.toFixed(2),
    },
  };
}

function cookieValue(cookie, name) {
  for (const part of String(cookie || '').split(';')) {
    const index = part.indexOf('=');
    if (index > 0 && part.slice(0, index).trim() === name) return part.slice(index + 1).trim();
  }
  return '';
}

function platformFailure(platform, parsed) {
  if (!parsed || typeof parsed !== 'object') return null;
  if (platform === 'baidu') {
    if (parsed.result && Number(parsed.result.error) !== 0) return `百度返回错误 ${parsed.result.error}`;
    if (!parsed.sync && !parsed.favindexs) return '百度没有返回同步结果';
    return null;
  }
  if (platform === 'amap' && parsed.status !== undefined && Number(parsed.status) !== 1) {
    const message = parsed.info || parsed.message || parsed.data || parsed.msg || '平台返回失败';
    return `高德返回 status=${parsed.status}：${String(message).slice(0, 160)}`;
  }
  if (platform === 'amap' && parsed.data && typeof parsed.data === 'object' && parsed.data.result === false) {
    return `高德返回失败：${String(parsed.data.message || parsed.data.code || '').slice(0, 160)}`;
  }
  if (parsed.result === false) {
    return `${platform === 'amap' ? '高德' : platform}返回失败：${String(parsed.message || parsed.msg || '').slice(0, 160)}`;
  }
  if (parsed.success === false) {
    return `${platform}返回失败：${String(parsed.message || parsed.msg || '').slice(0, 160)}`;
  }
  if (parsed.code !== undefined && !['0', '1', '200', 0, 1, 200].includes(parsed.code)) {
    return `${platform}返回 code=${parsed.code}：${String(parsed.message || parsed.msg || '').slice(0, 160)}`;
  }
  return null;
}

async function forward(platformId, payload) {
  const platform = PLATFORM_MAP[platformId];
  const stored = state.platforms[platformId];
  if (!stored?.config?.url) throw httpError(400, `${platform?.short || platformId} 尚未配置请求模板`);
  if (!stored.cookieEnc) throw httpError(400, `${platform?.short || platformId} 尚未配置 Cookie`);
  const config = stored.config;
  if (!config.dryRun && !ALLOW_LIVE) throw httpError(403, '服务端已禁用真实请求（BRIDGE_ALLOW_LIVE=0）');
  const context = templateContext(payload, platformId);
  let url = render(config.url, context, 'url');
  const cookie = decrypt(stored.cookieEnc);
  const headers = { ...config.headers, Cookie: cookie, 'User-Agent': config.headers?.['User-Agent'] || 'TuheBridge/1.0' };
  const isForm = /x-www-form-urlencoded/i.test(headers['Content-Type'] || headers['content-type'] || '');
  let body = !['GET', 'HEAD'].includes(config.method) && config.body.trim() ? render(config.body, context, isForm ? 'form' : 'json') : undefined;
  let adapterItem = null;
  if (config.adapter === 'amap') {
    for (const key of Object.keys(headers)) {
      if (key.toLowerCase() === 'content-type') delete headers[key];
    }
    headers['Content-Type'] = 'application/json';
    adapterItem = buildAmapFavPayload(payload?.place || {}, config.ver);
    body = JSON.stringify({ data: [adapterItem] });
  } else if (config.adapter === 'baidu') {
    for (const key of Object.keys(headers)) {
      if (key.toLowerCase() === 'content-type') delete headers[key];
    }
    headers['Content-Type'] = 'application/x-www-form-urlencoded; charset=UTF-8';
    const validate = cookieValue(cookie, 'validate');
    adapterItem = buildBaiduFavPayload(payload?.place || {});
    body = new URLSearchParams({ data: JSON.stringify(adapterItem), validate }).toString();
    const urlObj = new URL(url);
    urlObj.searchParams.set('mode', 'add');
    urlObj.searchParams.set('type', 'favdata');
    urlObj.searchParams.set('lastver', config.ver || '0');
    url = urlObj.toString();
  }
  const placeName = payload?.place?.name || '未命名地点';
  const started = Date.now();

  if (config.dryRun) {
    addLog({ platform: platformId, status: 'dry-run', placeName, method: config.method, url, durationMs: Date.now() - started, dryRun: true });
    throw httpError(409, '预览模式：请求未发送', { preview: { method: config.method, url, headers: previewHeaders(headers), body } });
  }

  await sleep(Math.max(0, (lastSent.get(platformId) || 0) + config.minIntervalMs - Date.now()));
  lastSent.set(platformId, Date.now());

  try {
    const response = await fetchWithRetry(url, { method: config.method, headers, body });
    const text = await response.text();
    let parsed = null;
    try { parsed = JSON.parse(text); } catch { /* plain text */ }
    const failure = platformFailure(platformId, parsed);
    const success = response.ok && !failure;
    const externalId = config.adapter === 'amap'
      ? (clean(payload?.place?.externalId, 200) || adapterItem.id)
      : config.adapter === 'baidu'
        ? (clean(readPath(parsed, 'sync.newdata.0.detail.data.fid'), 200) || clean(readPath(parsed, 'sync.newdata.0.sid'), 200) || `bridge_baidu_${crypto.createHash('sha1').update(String(payload?.place?.name || Date.now())).digest('hex').slice(0, 10)}`)
        : (clean(readPath(parsed, config.externalIdPath), 200)
          || clean(readPath(parsed, 'data.items.0.id'), 200)
          || `bridge_${platformId}_${crypto.createHash('sha1').update(String(payload?.place?.id || payload?.place?.name || Date.now())).digest('hex').slice(0, 10)}`);
    addLog({
      platform: platformId, status: success ? 'synced' : 'failed', placeName,
      method: config.method, url, httpStatus: response.status, externalId: success ? externalId : null,
      durationMs: Date.now() - started, dryRun: false,
      response: redactSecrets(text, cookie), error: success ? null : (failure || `HTTP ${response.status}`),
    });
    if (!success) throw httpError(502, failure || `平台返回 HTTP ${response.status}：${text.slice(0, 180)}`);
    const nextVer = clean(readPath(parsed, config.adapter === 'baidu' ? 'sync.lastver' : 'data.ver'), 80);
    if ((config.adapter === 'amap' || config.adapter === 'baidu') && nextVer) {
      config.ver = nextVer;
      stored.updatedAt = nowIso();
      schedulePersist();
    }
    return { status: 'synced', externalId, httpStatus: response.status };
  } catch (error) {
    if (!error.status) {
      addLog({ platform: platformId, status: 'failed', placeName, method: config.method, url, durationMs: Date.now() - started, dryRun: false, error: error.message });
      throw httpError(502, `请求平台失败：${error.message}`);
    }
    throw error;
  }
}

function pullValue(item, path) {
  if (!path) return undefined;
  return path.split('.').reduce((value, part) => (value == null ? undefined : value[part]), item);
}

function normalizePullItems(rawItems, platform, config) {
  const seen = new Set();
  const items = [];
  for (const raw of Array.isArray(rawItems) ? rawItems : []) {
    const map = config.fieldMap;
    const name = clean(pullValue(raw, map.name), 160);
    if (!name) continue;
    const lngRaw = pullValue(raw, map.lng);
    const latRaw = pullValue(raw, map.lat);
    const lng = Number(lngRaw);
    const lat = Number(latRaw);
    const tagsRaw = pullValue(raw, map.tags);
    const tags = Array.isArray(tagsRaw)
      ? tagsRaw.map((tag) => clean(tag, 24)).filter(Boolean)
      : clean(tagsRaw, 300).split(/[,，;；|、]/).map((tag) => tag.trim()).filter(Boolean);
    const item = {
      name,
      address: clean(pullValue(raw, map.address), 300),
      city: clean(pullValue(raw, map.city), 60).replace(/市$/, ''),
      district: clean(pullValue(raw, map.district), 60).replace(/[区县]$/, ''),
      category: clean(pullValue(raw, map.category), 60),
      tags: [...new Set(tags)].slice(0, 20),
      note: clean(pullValue(raw, map.note), 500),
      rating: Number.isFinite(Number(pullValue(raw, map.rating))) ? Number(pullValue(raw, map.rating)) : null,
      location: Number.isFinite(lng) && Number.isFinite(lat) && (config.coordSystem === 'BD09MC' || (Math.abs(lng) <= 180 && Math.abs(lat) <= 90)) ? { lng, lat } : null,
      coordSystem: config.coordSystem || PLATFORM_MAP[platform]?.coord || 'WGS84',
      externalId: clean(pullValue(raw, map.id), 200) || null,
      adcode: clean(pullValue(raw, map.adcode), 20) || null,
    };
    const key = item.externalId || `${item.name}|${item.location?.lng || ''}|${item.location?.lat || ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    items.push(item);
  }
  return items;
}

async function fetchPullPage(platform, stored, page, pageSize, lastver = '') {
  const config = stored.pull;
  const cookie = decrypt(stored.cookieEnc);
  const context = { platform, page: String(page), pageSize: String(pageSize), lastver: String(lastver || '') };
  let url = render(config.url, context, 'url');
  if (lastver !== '' && /[?&]lastver=/.test(url)) {
    const urlObj = new URL(url);
    urlObj.searchParams.set('lastver', String(lastver));
    url = urlObj.toString();
  }
  const headers = { ...config.headers, Cookie: cookie, 'User-Agent': config.headers?.['User-Agent'] || 'TuheBridge/1.0' };
  const isForm = /x-www-form-urlencoded/i.test(headers['Content-Type'] || headers['content-type'] || '');
  const body = !['GET', 'HEAD'].includes(config.method) && config.body.trim() ? render(config.body, context, isForm ? 'form' : 'json') : undefined;
  const response = await fetchWithRetry(url, { method: config.method, headers, body });
  const text = await response.text();
  if (!response.ok) throw httpError(502, `平台返回 HTTP ${response.status}：${redactSecrets(text, cookie)}`);
  let payload = null;
  try { payload = JSON.parse(text); } catch { throw httpError(502, '平台返回的不是 JSON，无法解析收藏列表'); }
  let rawItems = readPath(payload, config.itemsPath);
  if (!Array.isArray(rawItems) && Array.isArray(payload) && !config.itemsPath) rawItems = payload;
  if (!Array.isArray(rawItems)) throw httpError(502, `没有在响应中找到数组：itemsPath=${config.itemsPath}`, { keys: Object.keys(payload || {}), preview: JSON.stringify(payload).slice(0, 700) });
  return { rawItems, payload, text };
}

async function fetchCollectionPage(platform, stored, collection, page, pageSize) {
  const config = stored.pull;
  const detail = config.collection;
  const cookie = decrypt(stored.cookieEnc);
  const context = {
    platform,
    page: String(page),
    pageSize: String(pageSize),
    'collection.id': pullValue(collection, detail.idPath),
    'collection.name': pullValue(collection, detail.namePath),
    'collectionJson': JSON.stringify(collection || {}),
  };
  const url = render(detail.detailUrl, context, 'url');
  const headers = { ...config.headers, ...detail.detailHeaders, Cookie: cookie, 'User-Agent': config.headers?.['User-Agent'] || 'TuheBridge/1.0' };
  const isForm = /x-www-form-urlencoded/i.test(headers['Content-Type'] || headers['content-type'] || '');
  const body = !['GET', 'HEAD'].includes(detail.detailMethod) && detail.detailBody.trim()
    ? render(detail.detailBody, context, isForm ? 'form' : 'json')
    : undefined;
  const response = await fetchWithRetry(url, { method: detail.detailMethod, headers, body });
  const text = await response.text();
  if (!response.ok) throw httpError(502, `平台返回 HTTP ${response.status}：${redactSecrets(text, cookie)}`);
  let payload = null;
  try { payload = JSON.parse(text); } catch { throw httpError(502, '平台返回的不是 JSON，无法解析收藏夹'); }
  const rawItems = readPath(payload, detail.itemsPath);
  if (!Array.isArray(rawItems)) throw httpError(502, `没有在收藏夹详情中找到数组：itemsPath=${detail.itemsPath}`, { keys: Object.keys(payload || {}), preview: JSON.stringify(payload).slice(0, 700) });
  const total = Number(readPath(payload, detail.totalPath));
  return { rawItems, payload, text, total: Number.isFinite(total) ? total : null };
}

async function pullPlatform(platform, preview = false) {
  const stored = state.platforms[platform];
  if (!stored?.pull?.url) throw httpError(400, `${PLATFORM_MAP[platform]?.short || platform} 尚未配置拉取模板`);
  if (!stored.cookieEnc) throw httpError(400, `${PLATFORM_MAP[platform]?.short || platform} 尚未配置 Cookie`);
  const config = stored.pull;
  const pages = preview ? 1 : config.maxPages;
  const collected = [];
  let rawSample = null;
  let payload = null;
  if (config.collection) {
    const listResult = await fetchPullPage(platform, stored, 1, config.pageSize);
    payload = listResult.payload;
    const collections = listResult.rawItems.slice(0, config.collection.maxCollections);
    for (const collection of collections) {
      for (let page = 1; page <= pages; page += 1) {
        const result = await fetchCollectionPage(platform, stored, collection, page, config.pageSize);
        if (!rawSample) rawSample = result.rawItems[0] || null;
        const normalized = normalizePullItems(result.rawItems, platform, config);
        collected.push(...normalized);
        if (result.rawItems.length < config.pageSize) break;
      }
    }
  } else {
    let lastver = config.lastver || '';
    for (let page = 1; page <= pages; page += 1) {
      const result = await fetchPullPage(platform, stored, page, config.pageSize, lastver);
      if (!rawSample) { rawSample = result.rawItems[0] || null; payload = result.payload; }
      const normalized = normalizePullItems(result.rawItems, platform, config);
      collected.push(...normalized);
      const previousVer = lastver;
      const nextVer = config.lastverPath ? clean(readPath(result.payload, config.lastverPath), 80) : '';
      if (config.lastverPath && !preview && nextVer) {
        lastver = nextVer;
        if (stored.pull) { stored.pull.lastver = nextVer; schedulePersist(); }
      }
      if (config.lastverPath && (!nextVer || (page > 1 && nextVer === previousVer) || result.rawItems.length === 0)) break;
      if (!config.lastverPath && result.rawItems.length < config.pageSize) break;
    }
  }
  const seen = new Set();
  const items = collected.filter((item) => {
    const key = item.externalId || `${item.name}|${item.location?.lng || ''}|${item.location?.lat || ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return { items, rawSample, payload, config };
}

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(ROOT, 'public')));

app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'tuhe-bridge', time: nowIso(), configured: Object.values(state.platforms).filter((item) => item.cookieEnc).length, live: ALLOW_LIVE, adminTokenRequired: Boolean(ADMIN_TOKEN), webhookTokenRequired: Boolean(WEBHOOK_TOKEN) });
});

app.get('/api/status', adminAuth, (req, res) => {
  res.json({
    ok: true,
    data: {
      platforms: PLATFORMS.map(publicPlatform),
      logs: state.logs.slice(0, 80),
      settings: { allowLive: ALLOW_LIVE, adminTokenRequired: Boolean(ADMIN_TOKEN), webhookTokenRequired: Boolean(WEBHOOK_TOKEN) },
    },
  });
});

app.put('/api/platforms/:id', adminAuth, async (req, res, next) => {
  try {
    const id = req.params.id;
    if (!PLATFORM_MAP[id]) return res.status(404).json({ ok: false, error: '平台不存在' });
    const existing = state.platforms[id] || {};
    const incoming = req.body?.config !== undefined ? sanitizeConfig(req.body.config) : existing.config;
    const hasCookie = typeof req.body?.cookie === 'string' && Boolean(req.body.cookie.trim());
    if (!incoming && !hasCookie && req.body?.clearCookie !== true) throw httpError(400, '缺少 Cookie 或请求模板配置');
    const nextState = { ...existing, updatedAt: nowIso() };
    if (incoming) nextState.config = incoming;
    if (hasCookie) {
      const cookie = sanitizeCookie(req.body.cookie);
      if (!cookie) throw httpError(400, '没有解析到有效的 name=value Cookie');
      nextState.cookieEnc = encrypt(cookie);
      nextState.cookieUpdatedAt = nowIso();
    }
    if (req.body?.clearCookie === true) { delete nextState.cookieEnc; delete nextState.cookieUpdatedAt; }
    state.platforms[id] = nextState;
    schedulePersist();
    addLog({ platform: id, status: 'config', placeName: incoming ? '保存配置' : '保存 Cookie', dryRun: incoming ? incoming.dryRun : null, error: null });
    res.json({ ok: true, data: publicPlatform(PLATFORM_MAP[id]) });
  } catch (error) { next(error); }
});

app.delete('/api/platforms/:id', adminAuth, (req, res) => {
  const id = req.params.id;
  if (!PLATFORM_MAP[id]) return res.status(404).json({ ok: false, error: '平台不存在' });
  delete state.platforms[id];
  schedulePersist();
  addLog({ platform: id, status: 'config', placeName: '删除配置', dryRun: null, error: null });
  res.json({ ok: true });
});

app.post('/api/platforms/:id/test', adminAuth, async (req, res, next) => {
  try {
    const id = req.params.id;
    if (!PLATFORM_MAP[id]) return res.status(404).json({ ok: false, error: '平台不存在' });
    const stored = state.platforms[id];
    if (!stored?.cookieEnc) throw httpError(400, '请先保存 Cookie');
    if (!stored.config?.url) throw httpError(400, '请先保存请求模板');
    const sample = {
      event: 'place.upsert', source: 'tuhe', platform: id, coordSystem: 'WGS84', sentAt: nowIso(),
      place: { id: 'preview_place', name: '桥接测试地点', address: '浙江省杭州市西湖区测试路 1 号', city: '杭州', district: '西湖', category: '测试', tags: ['测试', '桥接'], note: '来自途合桥接器的测试请求', rating: null, location: { lng: 120.15, lat: 30.26 } },
    };
    const context = templateContext(sample, id);
    const config = stored.config;
    const cookie = decrypt(stored.cookieEnc);
    if (config.verifyUrl) {
      const response = await fetch(config.verifyUrl, { headers: { Cookie: cookie, 'User-Agent': config.headers?.['User-Agent'] || 'TuheBridge/1.0' }, signal: AbortSignal.timeout(15000) });
      const text = await response.text();
      addLog({ platform: id, status: response.ok ? 'verify-ok' : 'verify-failed', placeName: 'Cookie 验活', method: 'GET', url: config.verifyUrl, httpStatus: response.status, durationMs: 0, dryRun: false, response: redactSecrets(text, cookie), error: response.ok ? null : `HTTP ${response.status}` });
      return res.json({ ok: true, data: { mode: 'verify', httpStatus: response.status, snippet: redactSecrets(text, cookie) } });
    }
    const isForm = /x-www-form-urlencoded/i.test(config.headers['Content-Type'] || '');
    let body = !['GET', 'HEAD'].includes(config.method) && config.body.trim() ? render(config.body, context, isForm ? 'form' : 'json') : undefined;
    if (config.adapter === 'amap') body = JSON.stringify({ data: [buildAmapFavPayload(sample.place, config.ver)] });
    res.json({
      ok: true,
      data: {
        mode: 'preview',
        preview: {
          method: config.method,
          url: render(config.url, context, 'url'),
          headers: previewHeaders({ ...config.headers, Cookie: cookie }),
          body,
          externalIdPath: config.externalIdPath,
          dryRun: config.dryRun,
        },
      },
    });
  } catch (error) { next(error); }
});

app.delete('/api/logs', adminAuth, (req, res) => {
  state.logs = [];
  schedulePersist();
  res.json({ ok: true });
});

app.put('/api/platforms/:id/pull', adminAuth, async (req, res, next) => {
  try {
    const id = req.params.id;
    if (!PLATFORM_MAP[id]) return res.status(404).json({ ok: false, error: '平台不存在' });
    const existing = state.platforms[id] || {};
    const pull = sanitizePullConfig(req.body?.config || {});
    if (!pull.url) throw httpError(400, '请填写拉取地址');
    const nextState = { ...existing, pull, updatedAt: nowIso() };
    if (typeof req.body?.cookie === 'string' && req.body.cookie.trim()) {
      const cookie = sanitizeCookie(req.body.cookie);
      if (!cookie) throw httpError(400, '没有解析到有效的 Cookie');
      nextState.cookieEnc = encrypt(cookie);
      nextState.cookieUpdatedAt = nowIso();
    }
    state.platforms[id] = nextState;
    schedulePersist();
    addLog({ platform: id, status: 'config', placeName: '保存拉取模板', dryRun: null, error: null });
    res.json({ ok: true, data: publicPlatform(PLATFORM_MAP[id]) });
  } catch (error) { next(error); }
});

app.delete('/api/platforms/:id/pull', adminAuth, (req, res) => {
  const id = req.params.id;
  if (!PLATFORM_MAP[id]) return res.status(404).json({ ok: false, error: '平台不存在' });
  const existing = state.platforms[id];
  if (existing) { delete existing.pull; schedulePersist(); }
  addLog({ platform: id, status: 'config', placeName: '删除拉取模板', dryRun: null, error: null });
  res.json({ ok: true });
});

app.post('/api/platforms/:id/pull/test', adminAuth, async (req, res, next) => {
  try {
    const id = req.params.id;
    if (!PLATFORM_MAP[id]) return res.status(404).json({ ok: false, error: '平台不存在' });
    const result = await pullPlatform(id, true);
    addLog({ platform: id, status: 'pull-test', placeName: `预览 ${result.items.length} 个地点`, dryRun: null, error: null });
    res.json({ ok: true, data: { total: result.items.length, items: result.items.slice(0, 5), rawSample: result.rawSample, itemsPath: result.config.itemsPath } });
  } catch (error) { next(error); }
});

app.post('/webhook/pull', webhookAuth, async (req, res, next) => {
  try {
    const platform = clean(req.body?.platform, 40);
    if (!PLATFORM_MAP[platform]) return res.status(400).json({ ok: false, error: '未知平台' });
    const result = await pullPlatform(platform, false);
    addLog({ platform, status: 'pulled', placeName: `拉取 ${result.items.length} 个地点`, dryRun: null, error: null });
    res.json({ ok: true, platform, total: result.items.length, items: result.items, at: nowIso() });
  } catch (error) {
    const status = error.status && error.status >= 400 ? error.status : 502;
    res.status(status).json({ ok: false, error: error.message, ...(error.extra || {}) });
  }
});

app.post('/webhook', webhookAuth, async (req, res, next) => {
  try {
    const platform = clean(req.body?.platform, 40);
    if (!PLATFORM_MAP[platform]) return res.status(400).json({ ok: false, error: '未知平台' });
    if (req.body?.event && req.body.event !== 'place.upsert') return res.status(202).json({ ok: true, ignored: true });
    if (!req.body?.place?.name) return res.status(400).json({ ok: false, error: '缺少 place.name' });
    const result = await enqueue(platform, () => forward(platform, req.body));
    res.json({ ok: true, platform, status: result.status, externalId: result.externalId, at: nowIso() });
  } catch (error) {
    const status = error.status && error.status >= 400 ? error.status : 502;
    res.status(status).json({ ok: false, error: error.message, ...(error.extra || {}) });
  }
});

app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  const status = error.status && error.status >= 400 ? error.status : 500;
  res.status(status).json({ ok: false, error: error.message, ...(error.extra || {}) });
});

await loadState();
app.listen(PORT, () => {
  console.log(`途合桥接器已启动：http://127.0.0.1:${PORT}`);
  console.log(`数据目录：${DATA_DIR}`);
  console.log(`管理令牌：${ADMIN_TOKEN ? '已启用' : '未启用（局域网内开放）'}`);
  console.log(`Webhook 令牌：${WEBHOOK_TOKEN ? '已启用' : '未启用'}`);
  console.log(`真实请求：${ALLOW_LIVE ? '允许（单个平台仍需关闭预览模式）' : '已禁用'}`);
});
