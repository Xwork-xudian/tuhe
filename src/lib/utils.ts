import type { ConnectionMode, PlatformId, Place, PlaceSync } from './types';

export const PLATFORM_ORDER: PlatformId[] = ['amap', 'baidu', 'yuanzhou'];

export function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(' ');
}

export function formatNumber(value: number) {
  return new Intl.NumberFormat('zh-CN').format(value);
}

export function formatDate(value?: string | null, withTime = false) {
  if (!value) return '暂无';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '暂无';
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'short', day: 'numeric',
    ...(withTime ? { hour: '2-digit', minute: '2-digit', hour12: false } : {}),
  }).format(date);
}

export function formatFullDate(value?: string | null) {
  if (!value) return '暂无';
  const date = new Date(value);
  return new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' }).format(date);
}

export function relativeTime(value?: string | null) {
  if (!value) return '从未';
  const date = new Date(value).getTime();
  const delta = Date.now() - date;
  if (Number.isNaN(delta)) return '未知';
  if (delta < 0) return '刚刚';
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (delta < minute) return '刚刚';
  if (delta < hour) return `${Math.floor(delta / minute)} 分钟前`;
  if (delta < day) return `${Math.floor(delta / hour)} 小时前`;
  if (delta < 7 * day) return `${Math.floor(delta / day)} 天前`;
  return formatDate(value);
}

export function formatDuration(ms?: number) {
  if (!ms) return '—';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)}s`;
}

export function modeLabel(_mode: ConnectionMode | string) {
  return 'Cookie 桥接';
}

export function syncStateLabel(sync?: PlaceSync) {
  if (!sync) return '未同步';
  if (sync.state === 'complete') return '全部同步';
  if (sync.pendingCount) return '待确认';
  if (sync.linkedCount === 0) return '未关联';
  return '部分同步';
}

export function syncStateTone(sync?: PlaceSync) {
  if (!sync) return 'neutral';
  if (sync.state === 'complete') return 'success';
  if (sync.pendingCount) return 'warning';
  if (sync.linkedCount === 0) return 'neutral';
  return 'info';
}

const categoryTones: Record<string, string> = {
  人文古迹: 'ochre', 公园: 'moss', 艺术街区: 'rose', 街区: 'sky', 咖啡馆: 'clay',
  城市地标: 'indigo', 城市漫步: 'sage', 美术馆: 'plum', 本帮菜: 'clay', 湖景: 'sky',
  校园: 'indigo', 茶村: 'moss', 商业街区: 'sand', 茶馆: 'ochre', 古镇: 'clay',
  观景地: 'sky', 海岛: 'sky', 山野: 'moss', 建筑: 'sand', 老街: 'ochre',
};

export function categoryTone(category: string) {
  return categoryTones[category] || 'sage';
}

export function placeInitial(place: Pick<Place, 'name' | 'category'>) {
  return place.name?.trim()?.slice(0, 1) || '·';
}

export function coordinateText(place: Pick<Place, 'location'>) {
  if (!place.location) return '未定位';
  return `${place.location.lng.toFixed(4)}, ${place.location.lat.toFixed(4)}`;
}

export function greeting() {
  const hour = new Date().getHours();
  if (hour < 6) return '夜深了';
  if (hour < 11) return '早上好';
  if (hour < 14) return '中午好';
  if (hour < 18) return '下午好';
  return '晚上好';
}

export function todayLabel() {
  return new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' }).format(new Date());
}

export function platformName(platform: string) {
  return ({ amap: '高德', baidu: '百度', yuanzhou: '圆周' } as Record<string, string>)[platform] || platform;
}

export function firstLine(value: string, max = 80) {
  const line = value || '';
  return line.length > max ? `${line.slice(0, max)}…` : line;
}
