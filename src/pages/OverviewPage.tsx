import {
  ArrowRight, ArrowUpRight, CircleCheck, Clock3, Cloud, Compass, FileUp, MapPinned,
  RefreshCw, Sparkles, Tag, Trash2, Upload,
} from 'lucide-react';
import type { Dashboard, PlatformId, Place } from '../lib/types';
import { categoryTone, formatDate, formatNumber, greeting, placeInitial, relativeTime, todayLabel } from '../lib/utils';
import { PlatformMark } from '../components/PlatformMark';
import { SyncOrbit } from '../components/SyncOrbit';
import { CityAnalysisPanel } from '../components/CityAnalysisPanel';

const activityIcons: Record<string, typeof RefreshCw> = {
  sync: RefreshCw, import: Upload, export: FileUp, add: MapPinned, edit: Tag, delete: Trash2, config: Cloud, dedupe: Sparkles,
};

export function OverviewPage({
  dashboard, loading, navigate, onAdd, onSync, onEdit,
}: {
  dashboard: Dashboard | null;
  loading: boolean;
  navigate: (path: string) => void;
  onAdd: () => void;
  onSync: () => void;
  onEdit: (place: Place) => void;
}) {
  if (loading || !dashboard) return <OverviewSkeleton />;
  const { stats, platformStats, topCities, recentPlaces, activities, recentJobs } = dashboard;
  const lastJob = recentJobs[0];

  return (
    <div className="page overview-page">
      <section className="hero-panel">
        <div className="hero-copy">
          <p className="hero-eyebrow"><Sparkles size={14} /> {greeting()}，旅人 · {todayLabel()}</p>
          <h1>把散落的收藏，<br /><em>收进一张地图。</em></h1>
          <p className="hero-desc">高德、百度和圆周旅迹的收藏，终于可以在同一个地方整理、去重与同步。</p>
          <div className="hero-actions">
            <button className="btn btn-light" onClick={onSync}><RefreshCw size={16} /> 立即同步</button>
            <button className="btn btn-outline-light" onClick={() => navigate('/transfer')}><Upload size={16} /> 导入收藏</button>
          </div>
          <div className="hero-meta">
            <span><i className="pulse-dot" /> 最近更新 {relativeTime(dashboard.syncedAt)}</span>
            <span>{stats.located} / {stats.total} 个地点已定位</span>
          </div>
        </div>
        <div className="hero-art">
          <SyncOrbit platforms={platformStats} syncRate={stats.syncRate} />
        </div>
        <span className="hero-stamp">FIELD<br />NOTES<br /><i>2026</i></span>
      </section>

      <section className="stats-grid">
        <StatCard icon={<MapPinned size={19} />} tone="clay" label="收藏地点" value={formatNumber(stats.total)} hint={`${stats.cities} 座城市 · ${stats.located} 个已定位`} />
        <StatCard icon={<CircleCheck size={19} />} tone="moss" label="完整同步" value={formatNumber(stats.complete)} hint={`${stats.syncRate}% 平台覆盖率`} />
        <StatCard icon={<Clock3 size={19} />} tone="ochre" label="待处理" value={formatNumber(stats.incomplete)} hint={`${stats.pending} 个待确认同步`} />
        <StatCard icon={<Compass size={19} />} tone="sky" label="城市足迹" value={formatNumber(stats.cities)} hint={topCities.slice(0, 3).map((city) => city.name).join(' · ') || '等待第一座城市'} />
      </section>

      <div className="overview-columns">
        <section className="panel platform-coverage-panel">
          <div className="panel-head">
            <div>
              <p className="eyebrow">PLATFORM COVERAGE</p>
              <h2>平台同步概览</h2>
            </div>
            <button className="text-btn" onClick={() => navigate('/connections')}>管理连接 <ArrowRight size={15} /></button>
          </div>
          <div className="coverage-list">
            {(Object.keys(platformStats) as PlatformId[]).map((id) => {
              const platform = platformStats[id];
              return (
                <button className="coverage-row" key={id} onClick={() => navigate('/connections')}>
                  <PlatformMark platform={platform} size={40} muted={!platform.enabled} />
                  <div className="coverage-copy">
                    <div className="coverage-title">
                      <strong>{platform.name}</strong>
                      <span className="mode-chip webhook">Cookie 桥接</span>
                    </div>
                    <div className="coverage-bar"><span style={{ width: `${platform.coverage}%`, background: platform.color }} /></div>
                    <small>{platform.synced} / {stats.total} 个地点已同步 · {platform.lastSyncAt ? relativeTime(platform.lastSyncAt) : '尚未同步'}</small>
                  </div>
                  <span className="coverage-percent">{platform.coverage}%</span>
                  <ArrowUpRight size={16} className="row-arrow" />
                </button>
              );
            })}
          </div>
          <div className="coverage-footer">
            <span><i className={`status-dot ${stats.bridgeReady ? 'good' : 'warn'}`} /> {stats.bridgeReady} / {stats.platformCount} 个桥接已配置</span>
            <span>{lastJob ? `上次任务 ${relativeTime(lastJob.createdAt)}` : '还没有同步记录'}</span>
          </div>
        </section>

        <section className="panel activity-panel">
          <div className="panel-head">
            <div>
              <p className="eyebrow">ACTIVITY</p>
              <h2>最近动态</h2>
            </div>
            <span className="panel-count">{activities.length}</span>
          </div>
          <div className="activity-list">
            {activities.length === 0 && (
              <div className="activity-empty">
                <Clock3 size={18} />
                <p>还没有动态</p>
                <small>导入收藏或同步后，记录会出现在这里。</small>
              </div>
            )}
            {activities.slice(0, 5).map((activity) => {
              const Icon = activityIcons[activity.type] || CircleCheck;
              return (
                <div className="activity-item" key={activity.id}>
                  <span className={`activity-icon ${activity.type}`}><Icon size={15} /></span>
                  <div className="activity-copy">
                    <strong>{activity.title}</strong>
                    <p>{activity.detail}</p>
                  </div>
                  <time>{relativeTime(activity.createdAt)}</time>
                </div>
              );
            })}
          </div>
          <button className="panel-link" onClick={() => navigate('/sync')}>查看同步记录 <ArrowRight size={14} /></button>
        </section>
      </div>

      <div className="overview-columns lower">
        <CityAnalysisPanel analysis={dashboard.cityAnalysis} navigate={navigate} />

        <section className="panel recent-panel">
          <div className="panel-head">
            <div>
              <p className="eyebrow">RECENTLY SAVED</p>
              <h2>最近收藏</h2>
            </div>
            <button className="text-btn" onClick={() => navigate('/places')}>全部地点 <ArrowRight size={15} /></button>
          </div>
          <div className="recent-grid">
            {recentPlaces.slice(0, 4).map((place) => (
              <button className="recent-card" key={place.id} onClick={() => onEdit(place)}>
                <span className={`place-tile tone-${categoryTone(place.category)}`}>
                  <span className="tile-contour" />
                  <b>{placeInitial(place)}</b>
                </span>
                <span className="recent-copy">
                  <strong>{place.name}</strong>
                  <small>{place.city || '未填写城市'} · {place.category}</small>
                  <em>{formatDate(place.updatedAt)}</em>
                </span>
              </button>
            ))}
          </div>
          <button className="add-inline" onClick={onAdd}>+ 添加一个新的地点</button>
        </section>
      </div>
    </div>
  );
}

function StatCard({ icon, tone, label, value, hint }: { icon: React.ReactNode; tone: string; label: string; value: string; hint: string }) {
  return (
    <article className="stat-card">
      <div className={`stat-icon tone-${tone}`}>{icon}</div>
      <div className="stat-copy">
        <span>{label}</span>
        <strong>{value}</strong>
        <small>{hint}</small>
      </div>
      <span className="stat-spark" aria-hidden="true"><i /><i /><i /><i /><i /><i /></span>
    </article>
  );
}

function OverviewSkeleton() {
  return (
    <div className="page overview-page skeleton-page">
      <div className="hero-panel skeleton-hero" />
      <section className="stats-grid">
        {[1, 2, 3, 4].map((item) => <div className="stat-card skeleton-card" key={item} />)}
      </section>
      <div className="overview-columns">
        <div className="panel skeleton-block" />
        <div className="panel skeleton-block" />
      </div>
    </div>
  );
}
