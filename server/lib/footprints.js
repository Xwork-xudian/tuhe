import { haversineMeters } from './coordinates.js';
import { parseFogSnapshot, isFogSnapshotName } from './fogSnapshot.js';

const MAX_POINTS = 150000;

function cleanNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function makePoint(lng, lat, time = null) {
  const x = cleanNumber(lng);
  const y = cleanNumber(lat);
  if (x === null || y === null) return null;
  if (x < -180 || x > 180 || y < -90 || y > 90) return null;
  return { lng: Math.round(x * 1e5) / 1e5, lat: Math.round(y * 1e5) / 1e5, ...(time ? { t: time } : {}) };
}

function parsePair(value) {
  if (Array.isArray(value) && value.length >= 2) return makePoint(value[0], value[1], value[2]);
  if (value && typeof value === 'object') {
    const lng = value.lng ?? value.lon ?? value.longitude ?? value.x;
    const lat = value.lat ?? value.latitude ?? value.y;
    return makePoint(lng, lat, value.time ?? value.t ?? value.timestamp ?? null);
  }
  if (typeof value === 'string') {
    const numbers = value.match(/-?\d+(?:\.\d+)?/g) || [];
    if (numbers.length >= 2) return makePoint(numbers[0], numbers[1]);
  }
  return null;
}

function dedupePoints(points) {
  const result = [];
  for (const point of points) {
    const previous = result[result.length - 1];
    if (previous && previous.lng === point.lng && previous.lat === point.lat) continue;
    result.push(point);
  }
  return result;
}

function downsample(tracks, limit = MAX_POINTS) {
  const total = tracks.reduce((sum, track) => sum + track.points.length, 0);
  if (total <= limit) return { tracks, truncated: false };
  const ratio = total / limit;
  return {
    tracks: tracks.map((track) => ({
      ...track,
      points: track.points.filter((_, index) => index % Math.ceil(ratio) === 0 || index === track.points.length - 1),
    })).filter((track) => track.points.length > 0),
    truncated: true,
  };
}

export function parseGpxTracks(text) {
  const tracks = [];
  const segments = [...text.matchAll(/<trkseg\b[^>]*>([\s\S]*?)<\/trkseg>/gi)];
  for (const segment of segments) {
    const points = [];
    for (const match of segment[1].matchAll(/<trkpt\b([^>]*)>([\s\S]*?)<\/trkpt>/gi)) {
      const attrs = match[1];
      const lat = attrs.match(/\blat=["']([^"']+)/i)?.[1];
      const lon = attrs.match(/\blon=["']([^"']+)/i)?.[1];
      const time = match[2].match(/<time>([^<]+)<\/time>/i)?.[1] || null;
      const point = makePoint(lon, lat, time);
      if (point) points.push(point);
    }
    const line = dedupePoints(points);
    if (line.length) tracks.push({ name: `GPX 轨迹 ${tracks.length + 1}`, points: line });
  }

  if (!tracks.length) {
    const points = [];
    for (const match of text.matchAll(/<wpt\b([^>]*)>([\s\S]*?)<\/wpt>/gi)) {
      const attrs = match[1];
      const lat = attrs.match(/\blat=["']([^"']+)/i)?.[1];
      const lon = attrs.match(/\blon=["']([^"']+)/i)?.[1];
      const point = makePoint(lon, lat);
      if (point) points.push(point);
    }
    if (points.length) tracks.push({ name: 'GPX 足迹点', points: dedupePoints(points) });
  }
  return tracks;
}

export function parseKmlTracks(text) {
  const tracks = [];
  for (const match of text.matchAll(/<LineString\b[^>]*>([\s\S]*?)<\/LineString>/gi)) {
    const coordinateText = match[1].match(/<coordinates\b[^>]*>([\s\S]*?)<\/coordinates>/i)?.[1] || '';
    const tuples = coordinateText.trim().split(/\s+/).filter(Boolean);
    const points = [];
    for (const tuple of tuples) {
      const parts = tuple.split(',');
      const point = makePoint(parts[0], parts[1]);
      if (point) points.push(point);
    }
    const line = dedupePoints(points);
    if (line.length) tracks.push({ name: `KML 轨迹 ${tracks.length + 1}`, points: line });
  }
  if (!tracks.length) {
    const points = [];
    for (const match of text.matchAll(/<Point\b[^>]*>([\s\S]*?)<\/Point>/gi)) {
      const coordinateText = match[1].match(/<coordinates\b[^>]*>([\s\S]*?)<\/coordinates>/i)?.[1] || '';
      const parts = coordinateText.trim().split(',');
      const point = makePoint(parts[0], parts[1]);
      if (point) points.push(point);
    }
    if (points.length) tracks.push({ name: 'KML 足迹点', points: dedupePoints(points) });
  }
  return tracks;
}

function tracksFromArray(items) {
  if (!Array.isArray(items) || !items.length) return [];
  const points = items.map(parsePair).filter(Boolean);
  if (points.length) return [{ name: 'JSON 足迹', points: dedupePoints(points) }];
  return [];
}

export function parseJsonTracks(text) {
  const parsed = JSON.parse(text.replace(/^\uFEFF/, ''));
  const tracks = [];

  function visit(value, depth = 0) {
    if (!value || depth > 5) return;
    if (Array.isArray(value)) {
      if (value.length && (Array.isArray(value[0]) || typeof value[0] === 'string' || (value[0] && typeof value[0] === 'object' && ('lat' in value[0] || 'latitude' in value[0] || 'y' in value[0] || 'lng' in value[0])))) {
        const points = value.map(parsePair).filter(Boolean);
        if (points.length >= 2) tracks.push({ name: `JSON 轨迹 ${tracks.length + 1}`, points: dedupePoints(points) });
      } else {
        for (const child of value) visit(child, depth + 1);
      }
      return;
    }
    if (typeof value !== 'object') return;
    if (value.type === 'FeatureCollection' && Array.isArray(value.features)) {
      for (const feature of value.features) visit(feature, depth + 1);
      return;
    }
    if (value.type === 'Feature' && value.geometry) {
      visit(value.geometry, depth + 1);
      return;
    }
    if (value.type === 'LineString' && Array.isArray(value.coordinates)) {
      const points = value.coordinates.map(parsePair).filter(Boolean);
      if (points.length) tracks.push({ name: `GeoJSON 轨迹 ${tracks.length + 1}`, points: dedupePoints(points) });
      return;
    }
    if (value.type === 'MultiLineString' && Array.isArray(value.coordinates)) {
      for (const line of value.coordinates) {
        const points = line.map(parsePair).filter(Boolean);
        if (points.length) tracks.push({ name: `GeoJSON 轨迹 ${tracks.length + 1}`, points: dedupePoints(points) });
      }
      return;
    }
    if (value.type === 'Point' && value.coordinates) {
      const point = parsePair(value.coordinates);
      if (point) tracks.push({ name: 'GeoJSON 足迹点', points: [point] });
      return;
    }
    for (const key of ['tracks', 'segments', 'points', 'locations', 'data', 'items', 'records', '足迹']) {
      if (value[key] !== undefined) visit(value[key], depth + 1);
    }
  }

  visit(parsed);
  if (!tracks.length) {
    if (Array.isArray(parsed)) tracks.push(...tracksFromArray(parsed));
    else if (parsed && typeof parsed === 'object') {
      const points = [parsed].map(parsePair).filter(Boolean);
      if (points.length) tracks.push({ name: 'JSON 足迹', points });
    }
  }
  return tracks;
}

export function parseCsvTracks(text) {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter((line) => line.trim());
  if (!lines.length) return [];
  const delimiter = (lines[0].match(/\t/g) || []).length > (lines[0].match(/,/g) || []).length ? '\t' : ',';
  const first = lines[0].split(delimiter).map((cell) => cell.trim().toLowerCase());
  const latIndex = first.findIndex((cell) => ['lat', 'latitude', '纬度', 'y'].includes(cell));
  const lngIndex = first.findIndex((cell) => ['lng', 'lon', 'longitude', '经度', 'x'].includes(cell));
  const timeIndex = first.findIndex((cell) => ['time', 'timestamp', '时间'].includes(cell));
  const hasHeader = latIndex >= 0 && lngIndex >= 0;
  const rows = hasHeader ? lines.slice(1) : lines;
  const points = rows.map((line) => {
    const cells = line.split(delimiter).map((cell) => cell.trim());
    return hasHeader
      ? makePoint(cells[lngIndex], cells[latIndex], timeIndex >= 0 ? cells[timeIndex] : null)
      : makePoint(cells[0], cells[1], cells[2] || null);
  }).filter(Boolean);
  return points.length ? [{ name: 'CSV 足迹', points: dedupePoints(points) }] : [];
}

export function parseTextTracks(text) {
  const points = [];
  for (const line of text.split(/\r?\n/)) {
    const numbers = line.match(/-?\d+(?:\.\d+)?/g);
    if (numbers && numbers.length >= 2) {
      const point = makePoint(numbers[0], numbers[1]);
      if (point) points.push(point);
    }
  }
  return points.length ? [{ name: '文本足迹', points: dedupePoints(points) }] : [];
}

export function detectFootprintFormat(fileName = '', content = '') {
  const ext = String(fileName).toLowerCase().split('.').pop();
  if (ext === 'gpx') return 'gpx';
  if (ext === 'kml') return 'kml';
  if (ext === 'json' || ext === 'geojson') return 'json';
  if (ext === 'csv' || ext === 'tsv') return 'csv';
  if (ext === 'txt') return 'text';
  const trimmed = content.trim();
  if (/^[\[{]/.test(trimmed)) return 'json';
  if (/<gpx\b/i.test(trimmed)) return 'gpx';
  if (/<kml\b/i.test(trimmed)) return 'kml';
  if (trimmed.includes(',') && trimmed.includes('\n')) return 'csv';
  return 'text';
}

export function parseFootprintContent({ content = '', fileName = '', format = 'auto' }) {
  const detected = format && format !== 'auto' ? format : detectFootprintFormat(fileName, content);
  let tracks = [];
  const warnings = [];
  try {
    if (detected === 'gpx') tracks = parseGpxTracks(content);
    else if (detected === 'kml') tracks = parseKmlTracks(content);
    else if (detected === 'json') tracks = parseJsonTracks(content);
    else if (detected === 'csv') tracks = parseCsvTracks(content);
    else tracks = parseTextTracks(content);
  } catch (error) {
    throw new Error(`足迹数据解析失败：${error.message}`);
  }
  const sampled = downsample(tracks);
  tracks = sampled.tracks;
  if (sampled.truncated) warnings.push('足迹点数量较多，已按固定间隔抽稀以保证地图流畅，里程统计仍基于抽稀后的轨迹。');
  if (!tracks.length) warnings.push('没有识别到轨迹点。支持 GPX、KML、GeoJSON/JSON、CSV 或每行一个经纬度的文本。');
  const points = tracks.flatMap((track) => track.points);
  if (!points.length) return { format: detected, tracks: [], warnings, stats: null };

  let distance = 0;
  for (const track of tracks) {
    for (let i = 1; i < track.points.length; i += 1) distance += haversineMeters(track.points[i - 1], track.points[i]);
  }
  const grids = new Set(points.map((point) => `${Math.floor(point.lng / 0.05)}:${Math.floor(point.lat / 0.05)}`));
  const bounds = points.reduce((acc, point) => ({
    minLng: Math.min(acc.minLng, point.lng), maxLng: Math.max(acc.maxLng, point.lng),
    minLat: Math.min(acc.minLat, point.lat), maxLat: Math.max(acc.maxLat, point.lat),
  }), { minLng: Infinity, maxLng: -Infinity, minLat: Infinity, maxLat: -Infinity });
  const times = points.map((point) => point.t).filter(Boolean).map((value) => new Date(value)).filter((date) => !Number.isNaN(date.getTime()));
  times.sort((a, b) => a - b);
  return {
    format: detected,
    tracks,
    warnings,
    stats: {
      points: points.length,
      tracks: tracks.length,
      distanceMeters: Math.round(distance),
      gridCells: grids.size,
      startAt: times[0]?.toISOString() || null,
      endAt: times[times.length - 1]?.toISOString() || null,
      bounds,
    },
  };
}

export function parseFootprintBuffer({ buffer, fileName = 'world-fog.gpx', format = 'auto' }) {
  const data = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || []);
  const name = String(fileName || '');
  const zip = data.length >= 4 && data[0] === 0x50 && data[1] === 0x4b;
  if (zip || isFogSnapshotName(name)) {
    return parseFogSnapshot(data, name);
  }
  return parseFootprintContent({ content: data.toString('utf8'), fileName: name, format });
}

export function aggregateFootprints(footprints = []) {
  const totals = { sets: footprints.length, points: 0, tracks: 0, distanceMeters: 0, gridCells: 0, startAt: null, endAt: null };
  const grids = new Set();
  const starts = [];
  const ends = [];
  for (const footprint of footprints) {
    totals.points += footprint.stats?.points || 0;
    totals.tracks += footprint.stats?.tracks || 0;
    totals.distanceMeters += footprint.stats?.distanceMeters || 0;
    if (footprint.stats?.startAt) starts.push(footprint.stats.startAt);
    if (footprint.stats?.endAt) ends.push(footprint.stats.endAt);
    for (const track of footprint.tracks || []) {
      for (const point of track.points || []) grids.add(`${Math.floor(point.lng / 0.05)}:${Math.floor(point.lat / 0.05)}`);
    }
  }
  totals.gridCells = grids.size;
  starts.sort();
  ends.sort();
  totals.startAt = starts[0] || null;
  totals.endAt = ends[ends.length - 1] || null;
  return totals;
}
