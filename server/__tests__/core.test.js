import test from 'node:test';
import assert from 'node:assert/strict';
import { convertCoordinate, haversineMeters } from '../lib/coordinates.js';
import { parseImportContent } from '../lib/parsers.js';
import { findDuplicate, mergePlace } from '../lib/dedupe.js';
import { buildExport } from '../lib/exporters.js';
import { parseFootprintContent } from '../lib/footprints.js';
import { PLATFORM_IDS } from '../lib/platforms.js';
import { deflateSync } from 'node:zlib';
import { zipSync } from 'fflate';
import { tileToFilename } from '@tonybolivar/fog-of-world-parser';
import { parseFogSnapshot } from '../lib/fogSnapshot.js';

test('WGS84 / GCJ02 roundtrip stays within a few meters', () => {
  const original = { lng: 121.4385, lat: 31.2082 };
  const [glng, glat] = convertCoordinate(original.lng, original.lat, 'WGS84', 'GCJ02');
  const [wlng, wlat] = convertCoordinate(glng, glat, 'GCJ02', 'WGS84');
  const distance = haversineMeters(original, { lng: wlng, lat: wlat });
  assert.ok(distance < 3, `roundtrip distance was ${distance}m`);
});

test('BD09 conversion produces a meaningful offset then roundtrips', () => {
  const original = { lng: 116.3907, lat: 39.9166 };
  const [blng, blat] = convertCoordinate(original.lng, original.lat, 'WGS84', 'BD09');
  assert.ok(Math.abs(blng - original.lng) > 0.001);
  const [wlng, wlat] = convertCoordinate(blng, blat, 'BD09', 'WGS84');
  assert.ok(haversineMeters(original, { lng: wlng, lat: wlat }) < 3);
});

test('CSV import understands Chinese headers and converts GCJ02 to WGS84', () => {
  const csv = '\uFEFF名称,地址,经度,纬度,城市,分类,标签,备注\n武康大楼,上海市徐汇区淮海中路1850号,121.4455,31.2059,上海,城市地标,街拍|建筑,清晨人少\n';
  const parsed = parseImportContent({ content: csv, fileName: 'amap.csv', platform: 'amap' });
  assert.equal(parsed.format, 'csv');
  assert.equal(parsed.places.length, 1);
  assert.equal(parsed.places[0].name, '武康大楼');
  assert.equal(parsed.places[0].city, '上海');
  assert.equal(parsed.places[0].sourceSystem, 'GCJ02');
  assert.ok(parsed.places[0].location.lng < 121.4455);
  assert.deepEqual(parsed.places[0].tags, ['街拍', '建筑']);
});

test('JSON import handles nested location and tags', () => {
  const json = JSON.stringify({ places: [{ name: '沙溪古镇', address: '云南省大理州剑川县', location: { lng: 99.8503, lat: 26.3167 }, tags: ['安静'], note: '周五集市' }] });
  const parsed = parseImportContent({ content: json, fileName: 'yuanzhou.json', platform: 'yuanzhou' });
  assert.equal(parsed.format, 'json');
  assert.equal(parsed.places[0].name, '沙溪古镇');
  assert.ok(Math.abs(parsed.places[0].location.lat - 26.3167) < 0.01);
  assert.ok(parsed.places[0].location.lat !== 26.3167);
});

test('KML and GPX imports are supported', () => {
  const kml = '<kml><Document><Placemark><name>西湖</name><description>地址：杭州市西湖区</description><Point><coordinates>120.1531,30.2612,0</coordinates></Point></Placemark></Document></kml>';
  const gpx = '<gpx><wpt lat="25.505" lon="119.7907"><name>平潭岛</name><desc>福建省福州市</desc></wpt></gpx>';
  assert.equal(parseImportContent({ content: kml, fileName: 'baidu.kml', platform: 'baidu' }).places[0].name, '西湖');
  const point = parseImportContent({ content: gpx, fileName: 'baidu.gpx', platform: 'baidu' }).places[0];
  assert.equal(point.name, '平潭岛');
  assert.ok(Math.abs(point.location.lat - 25.505) < 0.01);
  assert.notEqual(point.location.lat, 25.505);
});

test('text import handles grouped key-value blocks', () => {
  const text = '名称：沙溪古镇\n地址：云南省大理州剑川县沙溪镇\n坐标：99.8503, 26.3167\n\n名称：喜洲古镇\n地址：云南省大理州大理市喜洲镇';
  const parsed = parseImportContent({ content: text, fileName: 'notes.txt', platform: 'yuanzhou' });
  assert.equal(parsed.places.length, 2);
  assert.equal(parsed.places[0].name, '沙溪古镇');
  assert.equal(parsed.places[1].name, '喜洲古镇');
});

test('dedupe merges same-name places within threshold', () => {
  const existing = { name: '阿那亚礼堂', address: '秦皇岛', city: '秦皇岛', tags: ['海边'], links: { amap: { status: 'synced' } } };
  const incoming = { name: '阿那亚礼堂', address: '昌黎县黄金海岸', city: '秦皇岛', tags: ['日出'], location: { lng: 119.3031, lat: 39.7877 }, platform: 'baidu' };
  const duplicate = findDuplicate(incoming, [existing], 120);
  assert.equal(duplicate, existing);
  mergePlace(existing, incoming);
  assert.deepEqual(existing.tags, ['海边', '日出']);
  assert.equal(existing.address, '秦皇岛');
});

test('platform exports convert coordinates and include UTF-8 BOM CSV', () => {
  const place = { id: '1', name: '武康大楼', address: '上海', city: '上海', district: '徐汇', category: '地标', tags: ['街拍'], note: '', rating: 4.8, location: { lng: 121.4385, lat: 31.2082 }, updatedAt: new Date().toISOString(), links: {} };
  const amap = buildExport({ platform: 'amap', format: 'csv', places: [place] });
  const baidu = buildExport({ platform: 'baidu', format: 'csv', places: [place] });
  assert.ok(amap.content.startsWith('\uFEFF'));
  assert.notEqual(amap.content, baidu.content);
  assert.match(amap.content, /名称,地址,经度,纬度/);
  const yuanzhou = buildExport({ platform: 'yuanzhou', format: 'json', places: [place] });
  assert.equal(yuanzhou.format, 'json');
  assert.match(yuanzhou.content, /武康大楼/);
});

test('platform registry only contains supported platforms', () => {
  assert.deepEqual(PLATFORM_IDS, ['amap', 'baidu', 'yuanzhou']);
  assert.ok(!PLATFORM_IDS.includes('petal'));
  assert.ok(!PLATFORM_IDS.includes('apple'));
});

test('GPX footprint import computes distance, grids and time range', () => {
  const gpx = '<gpx><trk><trkseg><trkpt lat="31.2" lon="121.4"><time>2026-01-01T00:00:00Z</time></trkpt><trkpt lat="31.3" lon="121.5"><time>2026-01-01T01:00:00Z</time></trkpt></trkseg></trk></gpx>';
  const parsed = parseFootprintContent({ content: gpx, fileName: 'world-fog.gpx' });
  assert.equal(parsed.format, 'gpx');
  assert.equal(parsed.tracks.length, 1);
  assert.equal(parsed.stats.points, 2);
  assert.ok(parsed.stats.distanceMeters > 14000);
  assert.equal(parsed.stats.gridCells, 2);
});

test('GeoJSON footprint import works', () => {
  const json = JSON.stringify({ type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'LineString', coordinates: [[120.1, 30.1], [120.2, 30.2]] } }] });
  const parsed = parseFootprintContent({ content: json, fileName: 'world-fog.geojson' });
  assert.equal(parsed.tracks.length, 1);
});


test('Fog of World FWSS snapshot parses visited blocks', () => {
  const name = tileToFilename(0);
  const header = Buffer.alloc(128 * 128 * 2);
  header.writeUInt16LE(1, 0);
  const block = Buffer.alloc(515);
  block[0] = 1;
  const tile = deflateSync(Buffer.concat([header, block]));
  const zip = zipSync({ [`Model/*/${name}`]: new Uint8Array(tile) });
  const parsed = parseFogSnapshot(Buffer.from(zip), 'snapshot.fwss');
  assert.equal(parsed.format, 'fwss');
  assert.equal(parsed.stats.points, 1);
  assert.equal(parsed.stats.blocks, 1);
  assert.equal(parsed.tracks.length, 1);
});
