import { haversineMeters } from './coordinates.js';

const NOW = '2026-10-29T09:00:00.000Z';

const PLACES = [
  ['故宫角楼咖啡', '北京市东城区景山前街4号', '北京', '东城', '咖啡', ['故宫', '咖啡', '拍照'], '角楼边的小店，傍晚光线最好。', 4.7, 116.397, 39.916],
  ['景山万春亭', '北京市西城区景山西街44号', '北京', '西城', '公园', ['登高', '日落', '中轴线'], '看故宫全景的首选位置。', 4.8, 116.396, 39.925],
  ['798 艺术区', '北京市朝阳区酒仙桥路2号', '北京', '朝阳', '艺术街区', ['展览', '散步', '工业风'], '周末展览很多，适合慢慢逛。', 4.5, 116.495, 39.984],
  ['亮马河畔', '北京市朝阳区亮马桥路', '北京', '朝阳', '滨水步道', ['夜跑', '夜景'], '晚上沿河走一圈很舒服。', 4.6, 116.469, 39.949],
  ['国家大剧院', '北京市西城区西长安街2号', '北京', '西城', '剧院', ['演出', '建筑'], '水下通道入口很有仪式感。', 4.8, 116.383, 39.903],
  ['胡同书店', '北京市东城区五道营胡同', '北京', '东城', '书店', ['独立书店', '胡同'], '小院子里有咖啡和旧书。', 4.4, 116.417, 39.947],
  ['武康大楼', '上海市徐汇区淮海中路1850号', '上海', '徐汇', '历史建筑', ['街拍', '梧桐区'], '清晨人少，转角机位最好。', 4.7, 121.438, 31.205],
  ['西岸美术馆', '上海市徐汇区龙腾大道2600号', '上海', '徐汇', '美术馆', ['展览', '滨江'], '看完展可以沿江骑行。', 4.6, 121.466, 31.181],
  ['苏州河步道', '上海市静安区苏州河北岸', '上海', '静安', '滨水步道', ['散步', '夜景'], '傍晚从外白渡桥往西走。', 4.5, 121.472, 31.245],
  ['愚园路咖啡馆', '上海市长宁区愚园路', '上海', '长宁', '咖啡', ['咖啡', '老洋房'], '梧桐树下的街角小店。', 4.4, 121.433, 31.220],
  ['外滩源', '上海市黄浦区中山东一路', '上海', '黄浦', '历史街区', ['建筑', '夜景'], '比外滩主街安静很多。', 4.6, 121.490, 31.242],
  ['浦东美术馆', '上海市浦东新区滨江大道2777号', '上海', '浦东', '美术馆', ['展览', '日落'], '顶层露台看外滩很震撼。', 4.8, 121.499, 31.239],
  ['鸡鸣寺', '南京市玄武区鸡鸣寺路1号', '南京', '玄武', '寺庙', ['樱花', '古建'], '春天樱花大道人多，早点去。', 4.7, 118.795, 32.061],
  ['颐和路', '南京市鼓楼区颐和路', '南京', '鼓楼', '历史街区', ['梧桐', '民国建筑'], '适合无目的散步。', 4.5, 118.771, 32.067],
  ['先锋书店', '南京市鼓楼区广州路173号', '南京', '鼓楼', '书店', ['独立书店', '文创'], '地下车库改造的空间。', 4.6, 118.774, 32.057],
  ['玄武湖', '南京市玄武区玄武巷1号', '南京', '玄武', '湖泊', ['环湖', '跑步'], '环湖一圈大约十公里。', 4.6, 118.796, 32.073],
  ['老门东', '南京市秦淮区剪子巷', '南京', '秦淮', '历史街区', ['小吃', '夜景'], '晚上灯亮起来更好看。', 4.4, 118.789, 32.012],
  ['人民公园鹤鸣茶社', '成都市青羊区少城路12号', '成都', '青羊', '茶馆', ['盖碗茶', '慢生活'], '下午坐一下午，采耳要排队。', 4.7, 104.057, 30.657],
  ['玉林路小酒馆', '成都市武侯区玉林西路', '成都', '武侯', '酒吧', ['音乐', '夜生活'], '小而热闹，适合听现场。', 4.3, 104.049, 30.630],
  ['东郊记忆', '成都市成华区建设南支路4号', '成都', '成华', '艺术街区', ['展览', '工业风'], '旧厂房改造，演出很多。', 4.5, 104.121, 30.671],
  ['望江楼公园', '成都市武侯区望江路30号', '成都', '武侯', '公园', ['竹子', '江边'], '竹林里很凉快。', 4.5, 104.092, 30.628],
  ['翠湖', '昆明市五华区翠湖南路67号', '昆明', '五华', '公园', ['海鸥', '慢跑'], '冬天有海鸥，环湖很舒服。', 4.6, 102.704, 25.049],
  ['云南大学', '昆明市五华区一二一大街182号', '昆明', '五华', '校园', ['银杏', '老建筑'], '秋天银杏道很美。', 4.6, 102.704, 25.061],
  ['斗南花市', '昆明市呈贡区斗南街道', '昆明', '呈贡', '市场', ['鲜花', '夜市'], '晚上去花最便宜。', 4.7, 102.805, 24.889],
  ['滇池海埂大坝', '昆明市西山区滇池路', '昆明', '西山', '湖泊', ['海鸥', '日落'], '风大，记得带外套。', 4.6, 102.659, 24.985],
  ['鼓浪屿', '厦门市思明区鼓浪屿', '厦门', '思明', '海岛', ['建筑', '步行'], '避开中午的旅行团。', 4.6, 118.067, 24.447],
  ['沙坡尾', '厦门市思明区沙坡尾', '厦门', '思明', '艺术街区', ['咖啡', '老港口'], '傍晚在避风坞看船。', 4.4, 118.080, 24.442],
  ['环岛路', '厦门市思明区环岛南路', '厦门', '思明', '海岸线', ['骑行', '日出'], '清晨骑行最舒服。', 4.7, 118.137, 24.430],
  ['集美学村', '厦门市集美区嘉庚路', '厦门', '集美', '校园', ['建筑', '人文'], '嘉庚建筑很有特色。', 4.5, 118.101, 24.575],
  ['八大关', '青岛市市南区八大关', '青岛', '市南', '历史街区', ['建筑', '梧桐'], '秋天落叶很好看。', 4.7, 120.348, 36.052],
  ['栈桥', '青岛市市南区太平路12号', '青岛', '市南', '海岸', ['海鸥', '地标'], '冬天海鸥很多。', 4.4, 120.320, 36.061],
  ['小麦岛', '青岛市崂山区小麦岛', '青岛', '崂山', '海岛', ['草地', '日落'], '山坡上看海很开阔。', 4.6, 120.424, 36.057],
  ['大学路', '青岛市市南区大学路', '青岛', '市南', '街区', ['咖啡', '红墙'], '红墙转角是经典机位。', 4.5, 120.335, 36.061],
  ['西湖断桥', '杭州市西湖区北山街', '杭州', '西湖', '湖泊', ['西湖', '步行'], '清晨薄雾时最好看。', 4.8, 120.150, 30.259],
  ['中国美院象山校区', '杭州市西湖区转塘街道', '杭州', '西湖', '校园', ['建筑', '展览'], '建筑本身值得看半天。', 4.5, 120.100, 30.157],
  ['小河直街', '杭州市拱墅区小河直街', '杭州', '拱墅', '历史街区', ['运河', '咖啡'], '沿河小店很适合发呆。', 4.5, 120.145, 30.319],
  ['良渚博物院', '杭州市余杭区美丽洲路1号', '杭州', '余杭', '博物馆', ['考古', '建筑'], '展陈和建筑都值得看。', 4.7, 120.017, 30.396],
  ['西安城墙永宁门', '西安市碑林区南大街', '西安', '碑林', '古城墙', ['骑行', '夜景'], '傍晚登城墙骑车。', 4.7, 108.947, 34.253],
  ['大雁塔', '西安市雁塔区雁塔路', '西安', '雁塔', '古建', ['历史', '夜景'], '北广场喷泉时间要查。', 4.6, 108.964, 34.218],
  ['回民街', '西安市莲湖区北院门', '西安', '莲湖', '美食街', ['小吃', '夜市'], '往小巷子里走更好吃。', 4.3, 108.940, 34.262],
].map((row, index) => {
  const [name, address, city, district, category, tags, note, rating, lng, lat] = row;
  return {
    name, address, city, district, category, tags, note, rating, lng, lat,
    index,
  };
});

function haversinePath(points) {
  let distance = 0;
  for (let i = 1; i < points.length; i += 1) distance += haversineMeters(points[i - 1], points[i]);
  return Math.round(distance);
}

function footprintStats(points) {
  const grids = new Set(points.map((p) => `${Math.floor(p.lng / 0.05)}:${Math.floor(p.lat / 0.05)}`));
  return {
    points: points.length,
    tracks: 1,
    distanceMeters: haversinePath(points),
    gridCells: grids.size,
    startAt: null,
    endAt: null,
    bounds: points.reduce((acc, p) => ({
      minLng: Math.min(acc.minLng, p.lng), maxLng: Math.max(acc.maxLng, p.lng),
      minLat: Math.min(acc.minLat, p.lat), maxLat: Math.max(acc.maxLat, p.lat),
    }), { minLng: Infinity, maxLng: -Infinity, minLat: Infinity, maxLat: -Infinity }),
  };
}

function makePoints(startLng, startLat, count, stepLng, stepLat, wave = 0) {
  return Array.from({ length: count }, (_, i) => ({
    lng: Math.round((startLng + stepLng * i + Math.sin(i / 3) * wave) * 1e6) / 1e6,
    lat: Math.round((startLat + stepLat * i + Math.cos(i / 4) * wave) * 1e6) / 1e6,
  }));
}

export function createDemoData() {
  const connections = Object.fromEntries(['amap', 'baidu', 'yuanzhou'].map((id) => [id, {
    enabled: true,
    mode: 'webhook',
    webhookUrl: '',
    token: '',
    hasToken: false,
    lastSyncAt: null,
    createdAt: NOW,
  }]));

  const places = PLACES.map((item, index) => {
    const links = {
      amap: { externalId: `demo_amap_${String(index + 1).padStart(3, '0')}`, status: 'synced', lastSyncedAt: NOW },
    };
    if (index % 2 === 0) links.baidu = { externalId: `demo_baidu_${String(index + 1).padStart(3, '0')}`, status: 'synced', lastSyncedAt: NOW };
    if (index % 5 === 0) links.yuanzhou = { externalId: `demo_yuanzhou_${String(index + 1).padStart(3, '0')}`, status: 'synced', lastSyncedAt: NOW };
    return {
      id: `pl_demo_${String(index + 1).padStart(3, '0')}`,
      name: item.name,
      address: item.address,
      city: item.city,
      district: item.district,
      category: item.category,
      tags: item.tags,
      note: item.note,
      rating: item.rating,
      url: '',
      location: { lng: item.lng, lat: item.lat },
      coordSystem: 'WGS84',
      source: { platform: 'amap', externalId: links.amap.externalId, importedAt: NOW },
      links,
      createdAt: NOW,
      updatedAt: NOW,
    };
  });

  const shanghai = makePoints(121.438, 31.205, 24, 0.0042, 0.0018, 0.0016);
  const yunnan = makePoints(100.150, 26.870, 20, 0.0048, 0.0022, 0.0012);
  const fogPoints = makePoints(121.430, 31.200, 140, 0.00055, 0.00035, 0.0011);

  const footprints = [
    {
      id: 'fp_demo_shanghai',
      name: '示例足迹 · 上海梧桐区',
      source: 'world-fog',
      fileName: 'shanghai-demo.gpx',
      format: 'gpx',
      stats: footprintStats(shanghai),
      tracks: [{ name: '示范轨迹', points: shanghai }],
      warnings: [],
      createdAt: NOW,
    },
    {
      id: 'fp_demo_yunnan',
      name: '示例足迹 · 大理洱海',
      source: 'world-fog',
      fileName: 'dali-demo.gpx',
      format: 'gpx',
      stats: footprintStats(yunnan),
      tracks: [{ name: '示范轨迹', points: yunnan }],
      warnings: [],
      createdAt: NOW,
    },
    {
      id: 'fp_demo_fog',
      name: '示例迷雾 · 上海',
      source: 'onedrive',
      fileName: 'demo.fwss',
      format: 'fwss',
      stats: {
        points: fogPoints.length,
        tracks: 140,
        distanceMeters: 0,
        gridCells: 82,
        startAt: null,
        endAt: null,
        bounds: footprintStats(fogPoints).bounds,
        blocks: 280,
      },
      tracks: fogPoints.map((point) => ({ name: '世界迷雾探索块', points: [point] })),
      warnings: ['世界迷雾快照按 600 米探索块展示。'],
      createdAt: NOW,
    },
  ];

  const activities = [
    { id: 'act_demo_1', createdAt: '2026-10-29T08:52:00.000Z', type: 'sync', title: '同步完成，部分失败', detail: '38 个成功 · 2 个失败 · 0 个跳过', platform: 'all' },
    { id: 'act_demo_2', createdAt: '2026-10-29T08:40:00.000Z', type: 'import', title: '导入示例地点', detail: '新增 40 个，合并 0 个地点', platform: 'amap' },
    { id: 'act_demo_3', createdAt: '2026-10-29T08:31:00.000Z', type: 'footprint', title: '导入足迹数据', detail: '示例足迹 · 上海梧桐区 · 24 个点 · 11.2 km', platform: 'world-fog' },
  ];

  const jobs = [
    {
      id: 'job_demo_1', status: 'completed', platforms: ['amap', 'baidu', 'yuanzhou'],
      total: 120, processed: 120, succeeded: 118, failed: 2, skipped: 0, progress: 100,
      strategy: 'merge', trigger: 'manual', createdAt: '2026-10-29T08:50:00.000Z',
      updatedAt: '2026-10-29T08:52:00.000Z', finishedAt: '2026-10-29T08:52:00.000Z', durationMs: 120000,
      results: [
        { placeId: 'pl_demo_001', placeName: '故宫角楼咖啡', platform: 'amap', status: 'synced', externalId: 'demo_amap_001' },
        { placeId: 'pl_demo_002', placeName: '景山万春亭', platform: 'baidu', status: 'synced', externalId: 'demo_baidu_002' },
        { placeId: 'pl_demo_003', placeName: '798 艺术区', platform: 'amap', status: 'failed', reason: '坐标缺失，未写入平台' },
      ],
    },
  ];

  return {
    meta: { version: 1, product: '途合', createdAt: NOW, updatedAt: NOW, demo: true },
    places,
    connections,
    jobs,
    activities,
    settings: { dedupeDistance: 120, defaultPlatformView: 'all', autoBackup: true },
    importBatches: [
      { id: 'batch_demo_1', platform: 'amap', fileName: 'demo-places.csv', format: 'csv', total: 40, imported: 40, merged: 0, createdAt: NOW },
    ],
    footprints,
  };
}
