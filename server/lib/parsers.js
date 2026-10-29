import { convertCoordinate, normalizeSystem, PLATFORM_COORDS } from './coordinates.js';

const FIELD_ALIASES = {
  name: ['name', 'title', 'poiname', 'placename', 'locationname', '名称', '地点', '地点名称', '标题', '收藏点', '收藏名称', 'poi'],
  address: ['address', 'addr', 'fulladdress', 'location', 'place', '详细地址', '地址', '位置', '所在地'],
  lng: ['lng', 'lon', 'long', 'longitude', 'x', '经度', '经度gcj02', 'gcjlng', 'bd09lng', 'wgs84lng'],
  lat: ['lat', 'latitude', 'y', '纬度', '纬度gcj02', 'gcjlat', 'bd09lat', 'wgs84lat'],
  city: ['city', 'cityname', '城市', '市', '所在城市'],
  district: ['district', 'county', 'area', '区县', '区域', '行政区'],
  category: ['category', 'type', 'poitype', '分类', '类型', '地点类型'],
  tags: ['tags', 'tag', 'labels', 'label', '标签', '分组'],
  note: ['note', 'notes', 'description', 'desc', 'remark', '备注', '描述', '说明'],
  rating: ['rating', 'score', '评分', '星级'],
  url: ['url', 'link', 'uri', '链接', '详情链接'],
  externalId: ['id', 'uid', 'poiid', 'placeid', 'externalid', 'favoriteid', '收藏id', '地点id'],
  coordSystem: ['coordsystem', 'coordinatesystem', '坐标系', 'coordtype'],
};

const HEADER_HINTS = new Set([
  ...Object.values(FIELD_ALIASES).flat(),
  'coordinates', 'coordinate', 'point', 'geometry', '位置坐标', '坐标',
]);

function cleanText(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeKey(key) {
  return String(key).toLowerCase().replace(/[\s_\-()（）]/g, '');
}

function getValue(record, aliases) {
  if (!record || typeof record !== 'object') return undefined;
  const wanted = new Set(aliases.map(normalizeKey));
  for (const [key, value] of Object.entries(record)) {
    if (wanted.has(normalizeKey(key)) && value !== undefined && value !== null && value !== '') {
      return value;
    }
  }
  return undefined;
}

function getAny(record, aliases) {
  const direct = getValue(record, aliases);
  if (direct !== undefined) return direct;
  for (const value of Object.values(record || {})) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const nested = getValue(value, aliases);
      if (nested !== undefined) return nested;
    }
  }
  return undefined;
}

function parseNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const match = value.replace(',', '.').match(/-?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : null;
}

function parseCoordinateText(value) {
  if (!value) return null;
  if (typeof value === 'object') {
    if (Array.isArray(value.coordinates)) return parseCoordinateText(value.coordinates);
    const lng = value.lng ?? value.lon ?? value.longitude ?? value.x;
    const lat = value.lat ?? value.latitude ?? value.y;
    if (lng !== undefined && lat !== undefined) return { lng: Number(lng), lat: Number(lat) };
    return null;
  }
  if (Array.isArray(value)) {
    if (value.length >= 2 && Number.isFinite(Number(value[0])) && Number.isFinite(Number(value[1]))) {
      return { lng: Number(value[0]), lat: Number(value[1]) };
    }
    return null;
  }
  const text = String(value);
  const pointMatch = text.match(/POINT\s*\(\s*(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)/i);
  if (pointMatch) return { lng: Number(pointMatch[1]), lat: Number(pointMatch[2]) };
  const numbers = text.match(/-?\d+(?:\.\d+)?/g);
  if (numbers && numbers.length >= 2) return { lng: Number(numbers[0]), lat: Number(numbers[1]) };
  return null;
}

function extractLocation(record) {
  const lng = parseNumber(getValue(record, FIELD_ALIASES.lng));
  const lat = parseNumber(getValue(record, FIELD_ALIASES.lat));
  if (lng !== null && lat !== null) return { lng, lat };

  for (const key of ['coordinates', 'coordinate', 'point', 'geometry', 'location', '坐标', '位置坐标']) {
    for (const [recordKey, value] of Object.entries(record || {})) {
      if (normalizeKey(recordKey) === normalizeKey(key)) {
        const parsed = parseCoordinateText(value);
        if (parsed && Number.isFinite(parsed.lng) && Number.isFinite(parsed.lat)) return parsed;
      }
    }
  }

  if (typeof record.location === 'string') {
    const parsed = parseCoordinateText(record.location);
    if (parsed && parsed.lng > 1 && parsed.lat > 1) return parsed;
  }
  return null;
}

function inferCity(address, explicitCity) {
  if (explicitCity) return cleanText(explicitCity).replace(/市$/, '');
  const text = cleanText(address);
  const match = text.match(/([\u4e00-\u9fa5]{2,10}?(?:市|自治州|地区|盟))/);
  return match ? match[1].replace(/市$/, '') : '';
}

function inferDistrict(address, explicitDistrict) {
  if (explicitDistrict) return cleanText(explicitDistrict).replace(/[区县]$/, '');
  const text = cleanText(address);
  const match = text.match(/(?:市|自治州|地区|盟)([\u4e00-\u9fa5]{1,8}?(?:区|县|旗))/);
  return match ? match[1].replace(/[区县]$/, '') : '';
}

function normalizeTags(value) {
  if (!value) return [];
  if (Array.isArray(value)) return [...new Set(value.map(cleanText).filter(Boolean))].slice(0, 12);
  return [...new Set(String(value).split(/[,，;；|/、]/).map(cleanText).filter(Boolean))].slice(0, 12);
}

export function normalizeRecord(record, platform = 'amap', fallbackSystem = null) {
  const loc = extractLocation(record);
  const rawSystem = getAny(record, FIELD_ALIASES.coordSystem)
    || fallbackSystem
    || PLATFORM_COORDS[platform]
    || 'WGS84';
  const sourceSystem = normalizeSystem(rawSystem, PLATFORM_COORDS[platform] || 'WGS84');
  let canonical = null;
  if (loc && Number.isFinite(loc.lng) && Number.isFinite(loc.lat)) {
    let [lng, lat] = [loc.lng, loc.lat];
    if (Math.abs(lng) <= 90 && Math.abs(lat) > 90) [lng, lat] = [lat, lng];
    if (lng >= -180 && lng <= 180 && lat >= -90 && lat <= 90) {
      canonical = convertCoordinate(lng, lat, sourceSystem, 'WGS84');
    }
  }

  const name = cleanText(getAny(record, FIELD_ALIASES.name) || record?.properties?.name || record?.name || '');
  const address = cleanText(getAny(record, FIELD_ALIASES.address) || record?.properties?.address || '');
  const city = inferCity(address, getAny(record, FIELD_ALIASES.city) || record?.properties?.city);
  const district = inferDistrict(address, getAny(record, FIELD_ALIASES.district) || record?.properties?.district);
  const ratingValue = parseNumber(getAny(record, FIELD_ALIASES.rating));

  return {
    name,
    address,
    city,
    district,
    category: cleanText(getAny(record, FIELD_ALIASES.category) || record?.properties?.category || '未分类') || '未分类',
    tags: normalizeTags(getAny(record, FIELD_ALIASES.tags) || record?.properties?.tags),
    note: cleanText(getAny(record, FIELD_ALIASES.note) || record?.properties?.description || ''),
    rating: ratingValue && ratingValue <= 5 ? ratingValue : null,
    url: cleanText(getAny(record, FIELD_ALIASES.url) || record?.properties?.url || ''),
    externalId: cleanText(getAny(record, FIELD_ALIASES.externalId) || record?.properties?.id || ''),
    location: canonical ? { lng: canonical[0], lat: canonical[1] } : null,
    coordSystem: 'WGS84',
    sourceSystem,
    platform,
  };
}

function detectDelimiter(text) {
  const firstLine = text.split(/\r?\n/).find((line) => line.trim()) || '';
  const counts = [
    [',', (firstLine.match(/,/g) || []).length],
    ['\t', (firstLine.match(/\t/g) || []).length],
    [';', (firstLine.match(/;/g) || []).length],
  ].sort((a, b) => b[1] - a[1]);
  return counts[0][1] > 0 ? counts[0][0] : ',';
}

export function parseCsv(text) {
  const input = text.replace(/^\uFEFF/, '');
  const delimiter = detectDelimiter(input);
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;

  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];
    const next = input[i + 1];
    if (quoted) {
      if (char === '"' && next === '"') {
        field += '"';
        i += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === delimiter) {
      row.push(field);
      field = '';
    } else if (char === '\n' && input[i - 1] !== '\r') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (char !== '\r') {
      field += char;
    }
  }
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }

  const cleaned = rows.filter((r) => r.some((cell) => cleanText(cell)));
  if (!cleaned.length) return [];
  const first = cleaned[0].map(cleanText);
  const headerLooksReal = first.some((cell) => HEADER_HINTS.has(normalizeKey(cell)));
  const headers = headerLooksReal ? first : ['name', 'address', 'lng', 'lat', 'category', 'note'];
  const dataRows = headerLooksReal ? cleaned.slice(1) : cleaned;
  return dataRows.map((cells) => {
    const record = {};
    headers.forEach((header, index) => { if (header) record[header] = cells[index] ?? ''; });
    return record;
  });
}

function findJsonArray(value, depth = 0) {
  if (depth > 4 || value === null) return null;
  if (Array.isArray(value)) {
    if (!value.length || typeof value[0] === 'object') return value;
    return null;
  }
  if (typeof value !== 'object') return null;
  const keys = ['places', 'items', 'data', 'favorites', 'favourites', 'list', 'records', '收藏', '地点', 'pois'];
  for (const key of keys) {
    if (Array.isArray(value[key])) return value[key];
    if (value[key] && typeof value[key] === 'object') {
      const nested = findJsonArray(value[key], depth + 1);
      if (nested) return nested;
    }
  }
  if (value.type === 'FeatureCollection' && Array.isArray(value.features)) return value.features;
  for (const child of Object.values(value)) {
    if (Array.isArray(child) && child.length && typeof child[0] === 'object') return child;
  }
  return null;
}

export function parseJson(text) {
  const parsed = JSON.parse(text.replace(/^\uFEFF/, ''));
  const array = findJsonArray(parsed);
  if (!array) return parsed && typeof parsed === 'object' ? [parsed] : [];
  return array.map((item) => {
    if (item?.type === 'Feature') return { ...item.properties, geometry: item.geometry, id: item.id };
    return item;
  });
}

function readXmlTag(block, tag) {
  const match = block.match(new RegExp(`<${tag}\\b[^>]*>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?<\\/${tag}>`, 'i'));
  if (!match) return '';
  return match[1]
    .replace(/<!\[CDATA\[|\]\]>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

export function parseKml(text) {
  const source = text.replace(/^\uFEFF/, '');
  const placemarks = [...source.matchAll(/<Placemark\b[^>]*>([\s\S]*?)<\/Placemark>/gi)];
  return placemarks.map((match) => {
    const block = match[1];
    const name = readXmlTag(block, 'name');
    const description = cleanText(readXmlTag(block, 'description'));
    const coordText = readXmlTag(block, 'coordinates');
    const numbers = coordText.match(/-?\d+(?:\.\d+)?/g) || [];
    const addressMatch = description.match(/(?:地址|Address)[：:]\s*([^|\n]+)/i);
    return {
      name,
      address: addressMatch ? addressMatch[1] : description,
      note: description,
      lng: numbers[0] || '',
      lat: numbers[1] || '',
      category: '地图收藏',
    };
  }).filter((item) => item.name || item.lng);
}

export function parseGpx(text) {
  const source = text.replace(/^\uFEFF/, '');
  const points = [...source.matchAll(/<wpt\b([^>]*)>([\s\S]*?)<\/wpt>/gi)];
  return points.map((match) => {
    const attrs = match[1];
    const body = match[2];
    return {
      name: readXmlTag(body, 'name'),
      address: cleanText(readXmlTag(body, 'desc')),
      note: cleanText(readXmlTag(body, 'desc')),
      lng: attrs.match(/\blon=["']([^"']+)/i)?.[1] || '',
      lat: attrs.match(/\blat=["']([^"']+)/i)?.[1] || '',
      category: '地图收藏',
    };
  }).filter((item) => item.name || item.lng);
}

export function parseText(text) {
  const source = text.replace(/^\uFEFF/, '').trim();
  if (!source) return [];
  const blocks = source.split(/\n\s*\n/).map((block) => block.trim()).filter(Boolean);
  const records = [];

  for (const block of blocks) {
    const lines = block.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    if (lines.length === 1 && lines[0].includes('|')) {
      const cells = lines[0].split('|').map((cell) => cell.trim());
      records.push({ name: cells[0], address: cells[1], lng: cells[2], lat: cells[3], tags: cells[4] });
      continue;
    }
    const record = {};
    const positionals = [];
    for (const line of lines) {
      const pair = line.match(/^([^:：]{1,18})[:：]\s*(.+)$/);
      if (pair) {
        const key = normalizeKey(pair[1]);
        if (key.includes('名称') || key === 'name' || key.includes('地点')) record.name = pair[2];
        else if (key.includes('地址') || key === 'address' || key.includes('位置')) record.address = pair[2];
        else if (key.includes('坐标') || key.includes('经纬')) record.coordinates = pair[2];
        else if (key.includes('标签') || key === 'tags') record.tags = pair[2];
        else if (key.includes('备注') || key.includes('描述')) record.note = pair[2];
        else if (key.includes('分类') || key.includes('类型')) record.category = pair[2];
        else positionals.push(pair[2]);
      } else {
        positionals.push(line);
      }
    }
    if (!record.name && positionals.length) record.name = positionals.shift();
    if (!record.address && positionals.length) record.address = positionals.shift();
    if (!record.coordinates) {
      const coordCandidate = positionals.find((line) => (line.match(/-?\d+(?:\.\d+)?/g) || []).length >= 2);
      if (coordCandidate) record.coordinates = coordCandidate;
    }
    if (record.name || record.address) records.push(record);
  }
  return records;
}

export function detectFormat(fileName = '', content = '') {
  const ext = String(fileName).toLowerCase().split('.').pop();
  if (['kml'].includes(ext)) return 'kml';
  if (['gpx'].includes(ext)) return 'gpx';
  if (['json', 'geojson'].includes(ext)) return 'json';
  if (['csv', 'tsv'].includes(ext)) return 'csv';
  if (['txt', 'text'].includes(ext)) return 'text';
  const trimmed = content.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) return 'json';
  if (/<kml\b/i.test(trimmed)) return 'kml';
  if (/<gpx\b/i.test(trimmed)) return 'gpx';
  if (trimmed.includes(',') && trimmed.includes('\n')) return 'csv';
  return 'text';
}

export function parseImportContent({ content = '', fileName = '', format, platform = 'amap' }) {
  const detected = format && format !== 'auto' ? format : detectFormat(fileName, content);
  let rawRecords = [];
  const warnings = [];
  if (detected === 'csv') rawRecords = parseCsv(content);
  else if (detected === 'json') rawRecords = parseJson(content);
  else if (detected === 'kml') rawRecords = parseKml(content);
  else if (detected === 'gpx') rawRecords = parseGpx(content);
  else rawRecords = parseText(content);

  const places = rawRecords
    .map((record) => normalizeRecord(record, platform))
    .filter((place) => place.name || place.address);

  if (!places.length) warnings.push('没有识别到有效地点，请检查文件格式或分隔符。');
  const withoutLocation = places.filter((place) => !place.location).length;
  if (withoutLocation) warnings.push(`${withoutLocation} 个地点缺少有效经纬度，可保留但无法用于空间盘点。`);
  const withoutName = places.filter((place) => !place.name).length;
  if (withoutName) warnings.push(`${withoutName} 个地点缺少名称，已使用地址或“未命名地点”补齐。`);
  places.forEach((place, index) => { if (!place.name) place.name = place.address || `未命名地点 ${index + 1}`; });
  return {
    format: detected,
    places,
    warnings,
    sourceSystems: [...new Set(places.map((place) => place.sourceSystem))],
  };
}
