import { unzipSync } from 'fflate';
import { parseTile, globalPixelToLngLat } from '@tonybolivar/fog-of-world-parser';

const MAX_POINTS = 20000;
const METADATA_FILES = new Set(['01abfc750a', '3389dae361']);
const TILE_NAME = /^[a-z0-9]{6,24}$/;

function basename(value) {
  return String(value || '').replace(/^.*[\\/]/, '');
}

function isZip(buffer) {
  return buffer.length >= 4 && buffer[0] === 0x50 && buffer[1] === 0x4b;
}

function pickTileEntries(files) {
  const entries = Object.entries(files).filter(([name]) => !name.endsWith('/'));
  const model = entries.filter(([name]) => name.toLowerCase().includes('model/*/'));
  if (model.length) return model;
  const sync = entries.filter(([name]) => name.toLowerCase().includes('sync/'));
  if (sync.length) return sync;
  return entries;
}

function blockCenter(tile, block) {
  const gx = (tile.tileX * 128 + block.bx) * 64 + 32;
  const gy = (tile.tileY * 128 + block.by) * 64 + 32;
  const [lng, lat] = globalPixelToLngLat(gx, gy);
  return { lng: Math.round(lng * 1e6) / 1e6, lat: Math.round(lat * 1e6) / 1e6 };
}

export function isFogSnapshotName(fileName) {
  return /\.(fwss|fwdb)$/i.test(String(fileName || ''));
}

export function parseFogSnapshot(buffer, fileName = 'snapshot.fwss') {
  if (!Buffer.isBuffer(buffer)) buffer = Buffer.from(buffer);
  if (!isZip(buffer)) {
    if (buffer.slice(0, 16).toString('utf8').startsWith('SQLite format 3')) {
      throw new Error('这是 SQLite 数据库快照（.fwdb），目前还没有对应的表结构样例，请把文件发给开发者补充解析。');
    }
    throw new Error('快照不是可识别的 zip 包，无法读取。');
  }
  let files;
  try {
    files = unzipSync(new Uint8Array(buffer));
  } catch (error) {
    throw new Error(`快照解压失败：${error.message}`);
  }
  const entries = pickTileEntries(files).filter(([name]) => {
    const base = basename(name);
    return base && !METADATA_FILES.has(base) && TILE_NAME.test(base);
  });
  if (!entries.length) throw new Error('快照里没有找到世界迷雾瓦片文件（Model/*/）。');

  const tiles = [];
  let invalid = 0;
  for (const [name, data] of entries) {
    try {
      const tile = parseTile(basename(name), data);
      if (tile.blocks?.length) tiles.push(tile);
    } catch {
      invalid += 1;
    }
  }
  if (!tiles.length) throw new Error(`快照里的 ${entries.length} 个瓦片都无法解析。`);

  const points = [];
  let totalBlocks = 0;
  for (const tile of tiles) {
    for (const block of tile.blocks) {
      if (!block.bitmap.some(Boolean)) continue;
      totalBlocks += 1;
      points.push(blockCenter(tile, block));
    }
  }
  if (!points.length) throw new Error('快照里没有已探索的迷雾块。');

  const step = Math.max(1, Math.ceil(points.length / MAX_POINTS));
  const sampled = points.filter((_, index) => index % step === 0);
  const warnings = [];
  if (step > 1) warnings.push(`迷雾块较多，已按间隔抽稀到 ${sampled.length} 个 600 米探索块用于地图展示。`);
  if (invalid) warnings.push(`有 ${invalid} 个瓦片无法解析，已跳过。`);

  const bounds = sampled.reduce((acc, point) => ({
    minLng: Math.min(acc.minLng, point.lng),
    maxLng: Math.max(acc.maxLng, point.lng),
    minLat: Math.min(acc.minLat, point.lat),
    maxLat: Math.max(acc.maxLat, point.lat),
  }), { minLng: Infinity, maxLng: -Infinity, minLat: Infinity, maxLat: -Infinity });

  return {
    format: 'fwss',
    tracks: sampled.map((point) => ({ name: '世界迷雾探索块', points: [point] })),
    warnings,
    stats: {
      points: sampled.length,
      tracks: tiles.length,
      distanceMeters: 0,
      gridCells: sampled.length,
      startAt: null,
      endAt: null,
      bounds,
      blocks: totalBlocks,
    },
  };
}
