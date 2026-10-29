import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowRight, CalendarDays, Check, CircleCheck, Cloud, Compass, FileUp, Footprints,
  LoaderCircle, Map as MapIcon, MapPin, Plus, Route, Sparkles, Trash2, Upload,
} from 'lucide-react';
import { api } from '../lib/api';
import type { FootprintDetail, FootprintList, FootprintSummary, Place, PlatformId } from '../lib/types';
import { PLATFORM_LIST } from '../lib/platforms';
import { cn, formatDate, formatNumber, relativeTime } from '../lib/utils';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { FootprintMap, isPlaceVisible, placePlatforms } from '../components/FootprintMap';
import type { MapLayers } from '../components/FootprintMap';
import { Modal } from '../components/Modal';
import { OneDriveModal } from '../components/OneDriveModal';


function distanceText(meters: number) {
  const value = meters / 1000;
  return `${value >= 1000 ? formatNumber(Math.round(value)) : value.toFixed(value >= 100 ? 0 : 1)} km`;
}

function dateRange(startAt: string | null, endAt: string | null) {
  if (!startAt && !endAt) return '未包含时间';
  if (!endAt || !startAt) return formatDate(startAt || endAt);
  return `${formatDate(startAt)} — ${formatDate(endAt)}`;
}

async function fetchAllPlaces() {
  const items: Place[] = [];
  let page = 1;
  let pages = 1;
  do {
    const response = await api.places({ page, limit: 500, sort: 'updated' });
    items.push(...response.items);
    pages = response.pages;
    page += 1;
  } while (page <= pages);
  return items.filter((place) => Boolean(place.location));
}

const ALL_PLATFORMS: Record<PlatformId, boolean> = { amap: true, baidu: true, yuanzhou: true };

export function FootprintPage({ notify, refreshVersion }: { notify: (message: string, tone?: 'success' | 'error') => void; refreshVersion: number }) {
  const [list, setList] = useState<FootprintList | null>(null);
  const [details, setDetails] = useState<FootprintDetail[]>([]);
  const [places, setPlaces] = useState<Place[]>([]);
  const [layers, setLayers] = useState<MapLayers>({ footprints: true, fog: true, tracks: true, platforms: { ...ALL_PLATFORMS }, other: true });
  const [loading, setLoading] = useState(true);
  const [impOpen, setImpOpen] = useState(false);
  const [fileName, setFileName] = useState('');
  const [content, setContent] = useState('');
  const [contentBase64, setContentBase64] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [drag, setDrag] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<FootprintSummary | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [odOpen, setOdOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = async () => {
    setLoading(true);
    try {
      const [response, allPlaces] = await Promise.all([api.getFootprints(), fetchAllPlaces()]);
      setList(response);
      setPlaces(allPlaces);
      const all = await Promise.all(response.items.map((item) => api.getFootprint(item.id)));
      setDetails(all);
      if (activeId && !response.items.some((item) => item.id === activeId)) setActiveId(null);
    } catch (err) {
      notify(err instanceof Error ? err.message : '足迹数据加载失败', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [refreshVersion]);

  const readFile = async (file: File) => {
    const binary = /\.(fwss|fwdb|zip)$/i.test(file.name);
    const limit = binary ? 40 : 12;
    if (file.size > limit * 1024 * 1024) { notify(`足迹文件不能超过 ${limit}MB`, 'error'); return; }
    setFileName(file.name);
    setName(file.name.replace(/\.[^.]+$/, ''));
    setError('');
    if (binary) {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(reader.error || new Error('文件读取失败'));
        reader.readAsDataURL(file);
      });
      setContentBase64(dataUrl.split(',')[1] || '');
      setContent('');
    } else {
      const text = await file.text();
      setContent(text);
      setContentBase64('');
    }
  };

  const submit = async () => {
    const payload = { name, fileName, content, contentBase64 };
    if (!payload.content.trim() && !payload.contentBase64) { setError('请选择一个足迹文件'); return; }
    setBusy(true);
    setError('');
    try {
      const result = await api.importFootprint(payload);
      notify(`已导入 ${result.stats.points} 个足迹点`);
      setImpOpen(false);
      setFileName('');
      setContent('');
      setContentBase64('');
      setName('');
      await load();
      setActiveId(result.id);
      window.dispatchEvent(new CustomEvent('tuhe-refresh'));
    } catch (err) {
      setError(err instanceof Error ? err.message : '足迹导入失败');
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!deleteTarget) return;
    setDeleteBusy(true);
    try {
      await api.deleteFootprint(deleteTarget.id);
      notify('足迹档案已删除');
      setDeleteTarget(null);
      await load();
      window.dispatchEvent(new CustomEvent('tuhe-refresh'));
    } catch (err) {
      notify(err instanceof Error ? err.message : '删除失败', 'error');
    } finally {
      setDeleteBusy(false);
    }
  };

  const totals = list?.totals;
  const hasData = Boolean(list?.items.length);

  const platformCounts = useMemo(() => {
    const counts: Record<PlatformId, number> = { amap: 0, baidu: 0, yuanzhou: 0 };
    for (const place of places) {
      for (const id of placePlatforms(place)) counts[id] += 1;
    }
    return counts;
  }, [places]);
  const otherCount = useMemo(() => places.filter((place) => !placePlatforms(place).length).length, [places]);
  const visiblePlaces = useMemo(() => places.filter((place) => isPlaceVisible(place, layers)), [places, layers]);
  const fogPointCount = useMemo(() => details.filter((item) => item.format === 'fwss')
    .reduce((sum, item) => sum + item.tracks.reduce((n, track) => n + track.points.length, 0), 0), [details]);
  const trackPointCount = useMemo(() => details.filter((item) => item.format !== 'fwss')
    .reduce((sum, item) => sum + item.tracks.reduce((n, track) => n + track.points.length, 0), 0), [details]);
  const visiblePoints = useMemo(() => {
    if (!layers.footprints) return 0;
    return details.filter((item) => !activeId || item.id === activeId)
      .filter((item) => item.format === 'fwss' ? layers.fog : layers.tracks)
      .reduce((sum, item) => sum + item.tracks.reduce((n, track) => n + track.points.length, 0), 0);
  }, [details, activeId, layers.footprints, layers.fog, layers.tracks]);
  const allLayersOn = layers.footprints && layers.fog && layers.tracks && layers.other && PLATFORM_LIST.every((platform) => layers.platforms[platform.id]);
  const togglePlatform = (id: PlatformId) => setLayers((prev) => ({ ...prev, platforms: { ...prev.platforms, [id]: !prev.platforms[id] } }));
  const toggleAllLayers = () => {
    const next = !allLayersOn;
    setLayers({ footprints: next, fog: next, tracks: next, platforms: { amap: next, baidu: next, yuanzhou: next }, other: next });
  };
  const onlyFog = () => setLayers({ footprints: true, fog: true, tracks: false, platforms: { amap: false, baidu: false, yuanzhou: false }, other: false });

  return (
    <div className="page footprint-page">
      <header className="page-header">
        <div>
          <p className="eyebrow">WORLD FOG · FOOTPRINT</p>
          <h1>足迹</h1>
          <p>把世界迷雾里的探索轨迹带进来，和收藏地点一起回看走过的路。</p>
        </div>
        <div className="page-header-actions">
          <button className="btn btn-ghost" onClick={() => setOdOpen(true)}><Cloud size={16} /> OneDrive 同步</button>
          <button className="btn btn-ghost" onClick={() => setImpOpen(true)}><Upload size={16} /> 导入世界迷雾</button>
          <button className="btn btn-primary" onClick={() => setImpOpen(true)}><Plus size={17} /> 新增足迹</button>
        </div>
      </header>

      <section className="footprint-hero">
        <div className="footprint-hero-copy">
          <p className="eyebrow light">YOUR MOVEMENT, MAPPED</p>
          <h2>走过的地方，<br /><em>会留下形状。</em></h2>
          <p>支持世界迷雾导出的 GPX、KML、GeoJSON、CSV 与坐标文本。导入后自动计算里程、点位和探索网格。</p>
          <div className="footprint-hero-actions">
            <button className="btn btn-light" onClick={() => setImpOpen(true)}><FileUp size={16} /> 导入足迹数据</button>
          </div>
        </div>
        <div className="footprint-hero-stats">
          <div><strong>{distanceText(totals?.distanceMeters || 0)}</strong><small>轨迹总里程</small></div>
          <div><strong>{formatNumber(totals?.points || 0)}</strong><small>足迹点</small></div>
          <div><strong>{formatNumber(totals?.gridCells || 0)}</strong><small>探索网格</small></div>
          <div><strong>{totals?.sets || 0}</strong><small>足迹档案</small></div>
        </div>
        <span className="footprint-hero-mark"><Footprints size={90} /></span>
      </section>

      <div className="footprint-layout">
        <section className="panel footprint-map-panel">
          <div className="panel-head">
            <div><p className="eyebrow">FOOTPRINT MAP</p><h2>足迹与收藏地图</h2></div>
            <div className="footprint-map-meta">
              {totals?.startAt && <span><CalendarDays size={13} /> {dateRange(totals.startAt, totals.endAt)}</span>}
              {activeId && <button className="text-btn" onClick={() => setActiveId(null)}>显示全部 <ArrowRight size={13} /></button>}
            </div>
          </div>
          {loading ? (
            <div className="map-loading footprint-loading"><span className="map-loader" /><p>正在加载足迹轨迹…</p></div>
          ) : hasData || places.length ? (
            <div className="footprint-map-stage">
              <FootprintMap footprints={details} places={places} activeId={activeId} layers={layers} />
              <div className="map-layer-panel">
                <div className="map-layer-head">
                  <strong>图层筛选</strong>
                  <div className="map-layer-actions">
                    <button type="button" onClick={onlyFog}>只看迷雾</button>
                    <button type="button" onClick={toggleAllLayers}>{allLayersOn ? '全部隐藏' : '全部显示'}</button>
                  </div>
                </div>
                <label className="map-layer-row">
                  <input type="checkbox" checked={layers.fog} onChange={() => setLayers((prev) => ({ ...prev, fog: !prev.fog }))} />
                  <span className="layer-swatch fog" />
                  <span className="layer-name">迷雾快照</span>
                  <em>{formatNumber(fogPointCount)}</em>
                </label>
                <label className="map-layer-row">
                  <input type="checkbox" checked={layers.tracks} onChange={() => setLayers((prev) => ({ ...prev, tracks: !prev.tracks }))} />
                  <span className="layer-swatch track" />
                  <span className="layer-name">轨迹档案</span>
                  <em>{formatNumber(trackPointCount)}</em>
                </label>
                {PLATFORM_LIST.map((platform) => (
                  <label className="map-layer-row" key={platform.id}>
                    <input type="checkbox" checked={layers.platforms[platform.id]} onChange={() => togglePlatform(platform.id)} />
                    <span className="layer-swatch" style={{ background: platform.color }} />
                    <span className="layer-name">{platform.shortName}</span>
                    <em>{platformCounts[platform.id]}</em>
                  </label>
                ))}
                {otherCount > 0 && (
                  <label className="map-layer-row">
                    <input type="checkbox" checked={layers.other} onChange={() => setLayers((prev) => ({ ...prev, other: !prev.other }))} />
                    <span className="layer-swatch" style={{ background: '#8b8578' }} />
                    <span className="layer-name">未关联</span>
                    <em>{otherCount}</em>
                  </label>
                )}
              </div>
              <div className="footprint-map-overlay">
                <span><i /> MAP LAYERS</span>
                <strong>{visiblePlaces.length} 个收藏 · {formatNumber(visiblePoints)} 个足迹点</strong>
              </div>
            </div>
          ) : (
            <div className="footprint-empty">
              <span className="empty-orbit"><Footprints size={30} /></span>
              <h3>还没有足迹数据</h3>
              <p>从世界迷雾导出 GPX / KML / JSON 后导入。</p>
              <div>
                <button className="btn btn-primary" onClick={() => setImpOpen(true)}><Upload size={15} /> 导入数据</button>
              </div>
            </div>
          )}
        </section>

        <aside className="footprint-side">
          <section className="panel footprint-archive">
            <div className="panel-head compact"><div><p className="eyebrow">ARCHIVE</p><h3>足迹档案</h3></div><span className="panel-count">{list?.items.length || 0}</span></div>
            {hasData ? (
              <div className="footprint-list">
                {list?.items.map((item) => (
                  <div key={item.id} className={cn('footprint-list-item', activeId === item.id && 'is-active')} role="button" tabIndex={0} onClick={() => { setActiveId(activeId === item.id ? null : item.id); if (activeId !== item.id) setLayers((prev) => ({ ...prev, [item.format === 'fwss' ? 'fog' : 'tracks']: true })); }} onKeyDown={(event) => { if (event.key === 'Enter') { setActiveId(activeId === item.id ? null : item.id); if (activeId !== item.id) setLayers((prev) => ({ ...prev, [item.format === 'fwss' ? 'fog' : 'tracks']: true })); } }}>
                    <span className="footprint-item-icon">{item.format === 'fwss' ? <Cloud size={16} /> : <Route size={16} />}</span>
                    <span className="footprint-item-copy">
                      <strong>{item.name}</strong>
                      <small>{distanceText(item.stats.distanceMeters)} · {formatNumber(item.stats.points)} 点</small>
                      <em>{relativeTime(item.createdAt)} · {item.format.toUpperCase()}</em>
                    </span>
                    <button className="footprint-delete" onClick={(event) => { event.stopPropagation(); setDeleteTarget(item); }} aria-label="删除足迹"><Trash2 size={13} /></button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="archive-empty"><MapPin size={20} /><p>导入后，每一次旅行会成为一个独立档案。</p></div>
            )}
          </section>

          <section className="footprint-guide">
            <span><Compass size={19} /></span>
            <div>
              <strong>世界迷雾数据怎么导？</strong>
              <p>可以直接上传世界迷雾快照（.fwss）或 Sync 压缩包；也支持 GPX、KML、JSON。快照会按 600 米探索块展示。</p>
            </div>
          </section>

          <section className="footprint-numbers">
            <div><span><CircleCheck size={15} /></span><strong>{formatNumber(totals?.tracks || 0)}</strong><small>轨迹段</small></div>
            <div><span><MapIcon size={15} /></span><strong>{formatNumber(totals?.gridCells || 0)}</strong><small>5km 探索格</small></div>
          </section>
        </aside>
      </div>

      <Modal
        open={impOpen}
        onClose={() => setImpOpen(false)}
        title="导入世界迷雾数据"
        eyebrow="WORLD FOG IMPORT"
        subtitle="文件只在本机解析和保存，不会上传到云服务。"
        size="md"
        footer={
          <>
            <button className="btn btn-ghost" onClick={() => setImpOpen(false)}>取消</button>
            <button className="btn btn-primary" onClick={() => submit()} disabled={busy || (!content && !contentBase64)}>{busy ? <LoaderCircle size={15} className="spin" /> : <Upload size={15} />}{busy ? '正在解析…' : '导入足迹'}</button>
          </>
        }
      >
        <div className={cn('dropzone footprint-dropzone', drag && 'is-dragging')} onDragOver={(event) => { event.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={(event) => { event.preventDefault(); setDrag(false); const file = event.dataTransfer.files?.[0]; if (file) readFile(file); }} onClick={() => fileRef.current?.click()}>
          <input ref={fileRef} type="file" accept=".gpx,.kml,.json,.geojson,.csv,.txt,.fwss,.fwdb,.zip" hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) readFile(file); event.target.value = ''; }} />
          <span className="dropzone-icon"><Footprints size={24} /></span>
          <h3>{fileName || '拖入世界迷雾导出文件'}</h3>
          <p>{fileName ? '已读取文件，可继续补充名称后导入' : 'GPX / KML / GeoJSON / CSV / TXT / FWSS 快照，最大 40MB'}</p>
          <span className="dropzone-formats"><em>GPX</em><em>KML</em><em>JSON</em><em>CSV</em><em>FWSS</em></span>
        </div>
        <div className="footprint-import-fields">
          <label className="field"><span>足迹名称</span><input value={name} onChange={(event) => setName(event.target.value)} placeholder="例如：2026 春日江南" /></label>
          <p>导入后会根据轨迹点自动计算里程和探索网格。点位很多时会自动抽稀，保证地图仍可流畅浏览。</p>
        </div>
        {error && <p className="form-error">{error}</p>}
      </Modal>

      <OneDriveModal open={odOpen} onClose={() => setOdOpen(false)} notify={notify} onImported={load} />

      <ConfirmDialog open={Boolean(deleteTarget)} onClose={() => setDeleteTarget(null)} onConfirm={remove} title="删除足迹档案" description={`确定删除「${deleteTarget?.name || ''}」吗？足迹轨迹会从本地移除，收藏地点不受影响。`} confirmText="确认删除" danger busy={deleteBusy} />
    </div>
  );
}
