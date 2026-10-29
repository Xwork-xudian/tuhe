const PI = Math.PI;
const A = 6378245.0;
const EE = 0.00669342162296594323;

function outOfChina(lng, lat) {
  return lng < 72.004 || lng > 137.8347 || lat < 0.8293 || lat > 55.8271;
}

function transformLat(x, y) {
  let ret = -100.0 + 2.0 * x + 3.0 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x));
  ret += (20.0 * Math.sin(6.0 * x * PI) + 20.0 * Math.sin(2.0 * x * PI)) * 2.0 / 3.0;
  ret += (20.0 * Math.sin(y * PI) + 40.0 * Math.sin(y / 3.0 * PI)) * 2.0 / 3.0;
  ret += (160.0 * Math.sin(y / 12.0 * PI) + 320.0 * Math.sin(y * PI / 30.0)) * 2.0 / 3.0;
  return ret;
}

function transformLng(x, y) {
  let ret = 300.0 + x + 2.0 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
  ret += (20.0 * Math.sin(6.0 * x * PI) + 20.0 * Math.sin(2.0 * x * PI)) * 2.0 / 3.0;
  ret += (20.0 * Math.sin(x * PI) + 40.0 * Math.sin(x / 3.0 * PI)) * 2.0 / 3.0;
  ret += (150.0 * Math.sin(x / 12.0 * PI) + 300.0 * Math.sin(x / 30.0 * PI)) * 2.0 / 3.0;
  return ret;
}

export function wgs84ToGcj02(lng, lat) {
  if (outOfChina(lng, lat)) return [lng, lat];
  let dLat = transformLat(lng - 105.0, lat - 35.0);
  let dLng = transformLng(lng - 105.0, lat - 35.0);
  const radLat = lat / 180.0 * PI;
  let magic = Math.sin(radLat);
  magic = 1 - EE * magic * magic;
  const sqrtMagic = Math.sqrt(magic);
  dLat = (dLat * 180.0) / ((A * (1 - EE)) / (magic * sqrtMagic) * PI);
  dLng = (dLng * 180.0) / (A / sqrtMagic * Math.cos(radLat) * PI);
  return [lng + dLng, lat + dLat];
}

export function gcj02ToWgs84(lng, lat) {
  if (outOfChina(lng, lat)) return [lng, lat];
  let [wLng, wLat] = [lng, lat];
  for (let i = 0; i < 3; i += 1) {
    const [gLng, gLat] = wgs84ToGcj02(wLng, wLat);
    wLng += lng - gLng;
    wLat += lat - gLat;
  }
  return [wLng, wLat];
}

export function gcj02ToBd09(lng, lat) {
  const z = Math.sqrt(lng * lng + lat * lat) + 0.00002 * Math.sin(lat * PI * 3000.0 / 180.0);
  const theta = Math.atan2(lat, lng) + 0.000003 * Math.cos(lng * PI * 3000.0 / 180.0);
  return [z * Math.cos(theta) + 0.0065, z * Math.sin(theta) + 0.006];
}

const MCBAND = [12890594.86, 8362377.87, 5591021, 3481989.83, 1678043.12, 0];
const MC2LL = [
  [1.410526172116255e-8, 0.00000898305509648872, -1.9939833816331, 200.9824383106796, -187.2403703815547, 91.6087516669843, -23.38765649603339, 2.57121317296198, -0.03801003308653, 17337981.2],
  [-7.435856389565537e-9, 0.000008983055097726239, -0.78625201886289, 96.32687599759846, -1.85204757529826, -59.36935905485877, 47.40033549296737, -16.50741931063887, 2.28786674699375, 10260144.86],
  [-3.030883460898826e-8, 0.00000898305509983578, 0.30071316287616, 59.74293618442277, 7.357984074871, -25.38371002664745, 13.45380521110908, -3.29883767235584, 0.32710905363475, 6856817.37],
  [-1.981981304930552e-8, 0.000008983055099779535, 0.03278182852591, 40.31678527705744, 0.65659298677277, -4.44255534477492, 0.85341911805263, 0.12923347998204, -0.04625736007561, 4482777.06],
  [3.09191371068437e-9, 0.000008983055096812155, 0.00006995724062, 23.10934304144901, -0.00023663490511, -0.6321817810242, -0.00663494467273, 0.03430082397953, -0.00466043876332, 2555164.4],
  [2.890871144776878e-9, 0.000008983055095805407, -3.068298e-8, 7.47137025468032, -0.00000353937994, -0.02145144861037, -0.00001234426596, 0.00010322952773, -0.00000323890364, 826088.5],
];

export function bd09mcToBd09(x, y) {
  const factors = MC2LL[MCBAND.findIndex((band) => Math.abs(Number(y)) >= band)] || MC2LL[MC2LL.length - 1];
  const cc = Math.abs(Number(y)) / factors[9];
  let lng = factors[0] + factors[1] * Math.abs(Number(x));
  let lat = factors[2] + factors[3] * cc + factors[4] * cc ** 2 + factors[5] * cc ** 3 + factors[6] * cc ** 4 + factors[7] * cc ** 5 + factors[8] * cc ** 6;
  lng *= Number(x) < 0 ? -1 : 1;
  lat *= Number(y) < 0 ? -1 : 1;
  return [lng, lat];
}

export function bd09ToGcj02(lng, lat) {
  const x = lng - 0.0065;
  const y = lat - 0.006;
  const z = Math.sqrt(x * x + y * y) - 0.00002 * Math.sin(y * PI * 3000.0 / 180.0);
  const theta = Math.atan2(y, x) - 0.000003 * Math.cos(x * PI * 3000.0 / 180.0);
  return [z * Math.cos(theta), z * Math.sin(theta)];
}

export function normalizeSystem(system, fallback = 'WGS84') {
  if (!system) return fallback;
  const value = String(system).toUpperCase().replace(/[\s_-]/g, '');
  if (['WGS84', 'WGS', 'EPSG4326'].includes(value)) return 'WGS84';
  if (['GCJ02', 'GCJ', 'AMAP', 'GAODE', '火星坐标'].includes(value)) return 'GCJ02';
  if (['BD09', 'BD09LL', 'BAIDU', '百度坐标'].includes(value)) return 'BD09';
  if (['BD09MC', 'BAIDUMC', '百度墨卡托'].includes(value)) return 'BD09MC';
  return fallback;
}

export function convertCoordinate(lng, lat, from = 'WGS84', to = 'WGS84') {
  if (!Number.isFinite(Number(lng)) || !Number.isFinite(Number(lat))) return null;
  let x = Number(lng);
  let y = Number(lat);
  const source = normalizeSystem(from);
  const target = normalizeSystem(to);
  if (source === target) return [round(x), round(y)];

  if (source === 'BD09MC') {
    [x, y] = bd09mcToBd09(x, y);
    [x, y] = bd09ToGcj02(x, y);
  } else if (source === 'BD09') {
    [x, y] = bd09ToGcj02(x, y);
  } else if (source === 'WGS84') {
    [x, y] = wgs84ToGcj02(x, y);
  }

  if (target === 'BD09') {
    [x, y] = gcj02ToBd09(x, y);
  } else if (target === 'WGS84') {
    [x, y] = gcj02ToWgs84(x, y);
  }
  return [round(x), round(y)];
}

function round(value) {
  return Math.round(value * 1e6) / 1e6;
}

export function haversineMeters(a, b) {
  if (!a || !b) return Infinity;
  const toRad = (v) => v * PI / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(h));
}

export const PLATFORM_COORDS = {
  amap: 'GCJ02',
  baidu: 'BD09',
  yuanzhou: 'GCJ02',
};
