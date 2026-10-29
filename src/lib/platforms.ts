import type { Platform, PlatformId } from './types';

export const PLATFORM_UI: Record<PlatformId, Platform> = {
  amap: {
    id: 'amap', name: '高德地图', shortName: '高德', mark: '高', color: '#1b74e4', softColor: '#e9f2ff',
    coordSystem: 'GCJ02', description: '国内地点最全，适合导航与路线规划。',
    importFormats: ['csv', 'json', 'text'], exportFormats: ['csv', 'json'],
    docs: '登录高德网页版并抓取收藏列表请求，在 Cookie 桥接器中配置拉取模板，即可读取全部收藏并合并到途合。',
  },
  baidu: {
    id: 'baidu', name: '百度地图', shortName: '百度', mark: '百', color: '#3448d2', softColor: '#eceefe',
    coordSystem: 'BD09', description: 'POI 与街景信息丰富，使用百度经纬度。',
    importFormats: ['csv', 'json', 'kml', 'gpx'], exportFormats: ['csv', 'json'],
    docs: '登录百度地图网页版并抓取收藏列表请求，在 Cookie 桥接器中配置拉取模板；百度墨卡托坐标会自动转换。',
  },
  yuanzhou: {
    id: 'yuanzhou', name: '圆周旅迹', shortName: '圆周', mark: '圆', color: '#b96a31', softColor: '#fbf1e7',
    coordSystem: 'GCJ02', description: '网页版支持收藏夹，可先读取收藏夹列表再逐个拉取地点。',
    importFormats: ['json', 'csv', 'text'], exportFormats: ['json', 'csv'],
    docs: '圆周旅迹网页版 pitravel.cn 的收藏按收藏夹组织；在桥接器开启收藏夹模式，即可读取全部收藏夹内的地点。',
  },
};

export const PLATFORM_LIST = Object.values(PLATFORM_UI);
