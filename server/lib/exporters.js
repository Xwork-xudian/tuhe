import { convertCoordinate, PLATFORM_COORDS } from './coordinates.js';
import { PLATFORM_MAP } from './platforms.js';

function escapeCsv(value) {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function csv(rows) {
  return `\uFEFF${rows.map((row) => row.map(escapeCsv).join(',')).join('\r\n')}\r\n`;
}

function xmlEscape(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function platformCoordinates(place, platform) {
  if (!place.location) return null;
  return convertCoordinate(place.location.lng, place.location.lat, 'WGS84', PLATFORM_COORDS[platform] || 'WGS84');
}

function commonRows(places, platform) {
  return places.map((place) => {
    const coord = platformCoordinates(place, platform) || ['', ''];
    return { place, lng: coord[0], lat: coord[1] };
  });
}

function toCsv(places, platform) {
  const rows = commonRows(places, platform);
  const headers = ['名称', '地址', '经度', '纬度', '城市', '区县', '分类', '标签', '评分', '备注', '来源ID', '更新时间'];
  const body = rows.map(({ place, lng, lat }) => [
    place.name, place.address, lng, lat, place.city, place.district, place.category,
    (place.tags || []).join('|'), place.rating ?? '', place.note,
    place.links?.[platform]?.externalId || place.id, place.updatedAt,
  ]);
  return csv([headers, ...body]);
}

function toJson(places, platform) {
  const data = places.map((place) => {
    const coord = platformCoordinates(place, platform);
    return {
      名称: place.name,
      地址: place.address,
      经度: coord?.[0] ?? null,
      纬度: coord?.[1] ?? null,
      城市: place.city,
      区县: place.district,
      分类: place.category,
      标签: place.tags,
      评分: place.rating,
      备注: place.note,
      来源ID: place.links?.[platform]?.externalId || place.id,
      坐标系: PLATFORM_COORDS[platform] || 'WGS84',
      更新时间: place.updatedAt,
    };
  });
  return JSON.stringify({ app: '途合', platform, coordSystem: PLATFORM_COORDS[platform] || 'WGS84', exportedAt: new Date().toISOString(), places: data }, null, 2);
}

function toKml(places, platform) {
  const items = places.map((place) => {
    const coord = platformCoordinates(place, platform);
    if (!coord) return '';
    const description = [
      place.address ? `地址：${place.address}` : '',
      place.category ? `分类：${place.category}` : '',
      place.note ? `备注：${place.note}` : '',
      place.tags?.length ? `标签：${place.tags.join('、')}` : '',
    ].filter(Boolean).join('\n');
    return `  <Placemark>
    <name>${xmlEscape(place.name)}</name>
    <description>${xmlEscape(description)}</description>
    <ExtendedData>
      <Data name="category"><value>${xmlEscape(place.category)}</value></Data>
      <Data name="tags"><value>${xmlEscape((place.tags || []).join(','))}</value></Data>
    </ExtendedData>
    <Point><coordinates>${coord[0]},${coord[1]},0</coordinates></Point>
  </Placemark>`;
  }).filter(Boolean).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
<Document>
  <name>途合 · ${xmlEscape(PLATFORM_MAP[platform]?.name || platform)}收藏</name>
${items}
</Document>
</kml>`;
}

function toGpx(places, platform) {
  const items = places.map((place) => {
    const coord = platformCoordinates(place, platform);
    if (!coord) return '';
    const description = [
      place.address,
      place.category,
      place.note,
      place.tags?.length ? place.tags.join('、') : '',
    ].filter(Boolean).join(' · ');
    return `  <wpt lat="${coord[1]}" lon="${coord[0]}">
    <name>${xmlEscape(place.name)}</name>
    <desc>${xmlEscape(description)}</desc>
    <type>${xmlEscape(place.category)}</type>
  </wpt>`;
  }).filter(Boolean).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="TUHE" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata><name>途合 · ${xmlEscape(PLATFORM_MAP[platform]?.name || platform)}收藏</name></metadata>
${items}
</gpx>`;
}

export function buildExport({ platform, format, places }) {
  const allowed = PLATFORM_MAP[platform]?.exportFormats || ['json'];
  const chosen = allowed.includes(format) ? format : allowed[0];
  let content;
  let contentType;

  if (chosen === 'csv') {
    content = toCsv(places, platform);
    contentType = 'text/csv; charset=utf-8';
  } else if (chosen === 'kml') {
    content = toKml(places, platform);
    contentType = 'application/vnd.google-earth.kml+xml; charset=utf-8';
  } else if (chosen === 'gpx') {
    content = toGpx(places, platform);
    contentType = 'application/gpx+xml; charset=utf-8';
  } else {
    content = toJson(places, platform);
    contentType = 'application/json; charset=utf-8';
  }

  const date = new Date().toISOString().slice(0, 10);
  const name = `tuhe-${platform}-${date}.${chosen}`;
  return { content, contentType, fileName: name, format: chosen };
}
