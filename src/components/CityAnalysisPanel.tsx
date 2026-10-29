import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, Building2, CircleCheck, Layers3, MapPin, Sparkles } from 'lucide-react';
import type { CityAnalysis } from '../lib/types';
import { PLATFORM_UI } from '../lib/platforms';
import { categoryTone, cn } from '../lib/utils';
import { PlatformMark } from './PlatformMark';

const donutPalette = ['#b96a31', '#6f8f7a', '#5a7f98', '#b06a76', '#8a7447', '#7b6e9b'];

export function CityAnalysisPanel({ analysis, navigate }: { analysis: CityAnalysis; navigate: (path: string) => void }) {
  const [selectedCity, setSelectedCity] = useState(analysis.cities[0]?.name || '');
  const city = analysis.cities.find((item) => item.name === selectedCity) || analysis.cities[0] || null;
  const maxCount = Math.max(1, ...analysis.cities.map((item) => item.count));

  useEffect(() => {
    if (analysis.cities.length && !analysis.cities.some((item) => item.name === selectedCity)) {
      setSelectedCity(analysis.cities[0].name);
    }
  }, [analysis.cities, selectedCity]);

  const platformEntries = useMemo(() => {
    if (!city) return [];
    return analysis.sourcePlatforms
      .map((platform) => ({ ...platform, count: city.platforms[platform.id] || 0 }))
      .filter((platform) => platform.count > 0)
      .sort((a, b) => b.count - a.count);
  }, [analysis.sourcePlatforms, city]);

  const totalPlatformLinks = platformEntries.reduce((sum, item) => sum + item.count, 0);
  const donut = useMemo(() => {
    if (!city) return { gradient: '#eee8dc', total: 0 };
    const total = city.categories.reduce((sum, item) => sum + item.count, 0);
    let cursor = 0;
    const stops = city.categories.map((item, index) => {
      const start = cursor;
      cursor += total ? (item.count / total) * 100 : 0;
      return `${donutPalette[index % donutPalette.length]} ${start}% ${cursor}%`;
    });
    return { gradient: `conic-gradient(${stops.join(', ')})`, total };
  }, [city]);

  return (
    <section className="panel city-analysis-panel">
      <div className="city-analysis-head">
        <div>
          <p className="eyebrow">CITY INTELLIGENCE</p>
          <h2>城市分析</h2>
          <p className="city-analysis-sub">汇总高德与百度的收藏，不含圆周旅迹。</p>
        </div>
        <span className="exclusion-badge"><CircleCheck size={13} /> 已排除圆周旅迹</span>
      </div>

      <div className="city-metrics">
        <div><span className="city-metric-icon clay"><Building2 size={16} /></span><strong>{analysis.cityCount}</strong><small>覆盖城市</small></div>
        <div><span className="city-metric-icon moss"><MapPin size={16} /></span><strong>{analysis.total}</strong><small>纳入分析</small></div>
        <div><span className="city-metric-icon ochre"><Layers3 size={16} /></span><strong>{analysis.crossPlatformRate}%</strong><small>跨平台收藏</small></div>
        <div><span className="city-metric-icon sky"><Sparkles size={16} /></span><strong>{analysis.dominantPlatform?.name || '—'}</strong><small>贡献最多平台</small></div>
      </div>

      {analysis.cities.length ? (
        <div className="city-analysis-body">
          <div className="city-ranking">
            <div className="city-ranking-head"><span>城市排行</span><span>收藏数</span></div>
            {analysis.cities.slice(0, 8).map((item, index) => (
              <button key={item.name} className={cn('city-ranking-row', city?.name === item.name && 'is-active')} onClick={() => setSelectedCity(item.name)}>
                <span className="city-rank">{String(index + 1).padStart(2, '0')}</span>
                <span className="city-name">{item.name}</span>
                <span className="city-track"><i style={{ width: `${(item.count / maxCount) * 100}%` }} /></span>
                <span className="city-mini-platforms">
                  {analysis.sourcePlatforms.map((platform) => item.platforms[platform.id] ? <i key={platform.id} style={{ background: PLATFORM_UI[platform.id as keyof typeof PLATFORM_UI]?.color || '#999' }} /> : null)}
                </span>
                <strong>{item.count}</strong>
              </button>
            ))}
          </div>

          <div className="city-detail">
            <div className="city-detail-head">
              <div>
                <span className="detail-eyebrow">SELECTED CITY</span>
                <h3>{city?.name}</h3>
              </div>
              <button className="text-btn" onClick={() => city && navigate(`/places?city=${encodeURIComponent(city.name)}`)}>查看地点 <ArrowRight size={13} /></button>
            </div>
            <div className="selected-city-stats">
              <div><strong>{city?.count}</strong><small>收藏地点</small></div>
              <div><strong>{city?.located}</strong><small>已有坐标</small></div>
              <div><strong>{platformEntries.length}</strong><small>覆盖平台</small></div>
            </div>

            <div className="city-platform-block">
              <div className="block-label"><span>平台构成</span><em>{totalPlatformLinks} 次平台关联</em></div>
              <div className="platform-stack-bar">
                {platformEntries.map((platform) => (
                  <span key={platform.id} style={{ width: `${totalPlatformLinks ? (platform.count / totalPlatformLinks) * 100 : 0}%`, background: PLATFORM_UI[platform.id as keyof typeof PLATFORM_UI]?.color }} />
                ))}
              </div>
              <div className="platform-bar-legend">
                {platformEntries.map((platform) => (
                  <span key={platform.id}>
                    <PlatformMark platform={PLATFORM_UI[platform.id as keyof typeof PLATFORM_UI]} size={18} />
                    {platform.name}<em>{platform.count}</em>
                  </span>
                ))}
              </div>
            </div>

            {city?.categories.length ? (
              <div className="city-category-block">
                <div className="city-donut" style={{ background: donut.gradient }}>
                  <span><strong>{city.count}</strong><small>地点</small></span>
                </div>
                <div className="city-category-list">
                  <div className="block-label"><span>地点偏好</span><em>TOP {Math.min(4, city.categories.length)}</em></div>
                  {city.categories.slice(0, 4).map((item, index) => (
                    <div className="category-legend-row" key={item.name}>
                      <i className={`tone-${categoryTone(item.name)}`} style={{ background: donutPalette[index % donutPalette.length] }} />
                      <span>{item.name}</span>
                      <em>{Math.round((item.count / Math.max(1, city.count)) * 100)}%</em>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            <div className="city-top-places">
              {city?.topPlaces.slice(0, 4).map((place) => <span key={place.id}>{place.name}</span>)}
            </div>
          </div>
        </div>
      ) : (
        <div className="city-analysis-empty">
          <Building2 size={26} />
          <strong>还没有可分析的非圆周收藏</strong>
          <p>导入高德或百度的地点后，这里会自动生成城市画像。</p>
        </div>
      )}

      <div className="city-analysis-foot">
        <span><i className="status-dot good" /> {analysis.total} 个地点参与分析</span>
        <span>跨平台 {analysis.crossPlatformCount} 个 · 偏好「{analysis.topCategory?.name || '待补充'}」</span>
      </div>
    </section>
  );
}
