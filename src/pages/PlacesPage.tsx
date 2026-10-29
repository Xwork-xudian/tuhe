import { useEffect, useMemo, useState } from 'react';
import {
  Check, ChevronLeft, ChevronRight, Filter, Grid2X2, List, LocateFixed, Map as MapIcon, MapPin, MoreHorizontal,
  Pencil, Plus, RefreshCw, Search, SlidersHorizontal, Tag, Trash2, X,
} from 'lucide-react';
import { api } from '../lib/api';
import { PLATFORM_LIST, PLATFORM_UI } from '../lib/platforms';
import type { Place, PlacesResponse, PlatformId } from '../lib/types';
import {
  PLATFORM_ORDER, categoryTone, cn, coordinateText, formatDate, placeInitial,
  syncStateLabel, syncStateTone,
} from '../lib/utils';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { Modal } from '../components/Modal';
import { PlatformMark } from '../components/PlatformMark';
import { PlaceMap } from '../components/PlaceMap';

const PAGE_SIZE = 12;

export function PlacesPage({
  route, onAdd, onEdit, onSync, notify, refreshVersion,
}: {
  route: string;
  onAdd: () => void;
  onEdit: (place: Place) => void;
  onSync: (ids: string[]) => void;
  notify: (message: string, tone?: 'success' | 'error') => void;
  refreshVersion: number;
}) {
  const [data, setData] = useState<PlacesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const [status, setStatus] = useState('');
  const [platform, setPlatform] = useState('');
  const [city, setCity] = useState('');
  const [category, setCategory] = useState('');
  const [sort, setSort] = useState('updated');
  const [page, setPage] = useState(1);
  const [view, setView] = useState<'table' | 'grid' | 'map'>(() => {
    const saved = localStorage.getItem('tuhe-place-view');
    if (saved === 'grid' || saved === 'table' || saved === 'map') return saved;
    return window.innerWidth <= 650 ? 'grid' : 'table';
  });
  const [mapPlaces, setMapPlaces] = useState<Place[]>([]);
  const [mapLoading, setMapLoading] = useState(false);
  const [mapSelected, setMapSelected] = useState<Place | null>(null);
  const [mapKey, setMapKey] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [tagOpen, setTagOpen] = useState(false);
  const [tagValue, setTagValue] = useState('');
  const [tagBusy, setTagBusy] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<string[]>([]);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(route.split('?')[1] || '');
    setQ(params.get('q') || '');
    setCity(params.get('city') || '');
    setStatus(params.get('status') || '');
    setPage(1);
  }, [route]);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQ(q), 240);
    return () => clearTimeout(timer);
  }, [q]);

  useEffect(() => {
    setPage(1);
  }, [debouncedQ, status, platform, city, category, sort]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api.places({ q: debouncedQ, status, platform, city, category, sort, page, limit: PAGE_SIZE })
      .then((response) => { if (!cancelled) setData(response); })
      .catch((error) => notify(error.message, 'error'))
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [debouncedQ, status, platform, city, category, sort, page, refreshVersion, notify]);

  useEffect(() => {
    if (data && page > data.pages) setPage(data.pages);
  }, [data, page]);

  useEffect(() => {
    if (view !== 'map') return;
    let cancelled = false;
    setMapLoading(true);
    api.places({ q: debouncedQ, status, platform, city, category, sort, page: 1, limit: 500 })
      .then((response) => { if (!cancelled) setMapPlaces(response.items); })
      .catch((error) => notify(error.message, 'error'))
      .finally(() => { if (!cancelled) setMapLoading(false); });
    return () => { cancelled = true; };
  }, [view, debouncedQ, status, platform, city, category, sort, refreshVersion, notify]);

  useEffect(() => {
    localStorage.setItem('tuhe-place-view', view);
  }, [view]);

  useEffect(() => {
    if (mapSelected && !mapPlaces.some((place) => place.id === mapSelected.id)) setMapSelected(null);
  }, [mapPlaces, mapSelected]);

  const items = data?.items || [];
  const allOnPageSelected = items.length > 0 && items.every((item) => selected.has(item.id));
  const selectedIds = useMemo(() => [...selected], [selected]);
  const hasFilters = Boolean(q || status || platform || city || category);

  const toggleSelect = (id: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    setSelected((current) => {
      const next = new Set(current);
      if (allOnPageSelected) items.forEach((item) => next.delete(item.id));
      else items.forEach((item) => next.add(item.id));
      return next;
    });
  };

  const clearFilters = () => {
    setQ(''); setStatus(''); setPlatform(''); setCity(''); setCategory(''); setSort('updated');
  };

  const applyTag = async () => {
    const tag = tagValue.trim();
    if (!tag || !selected.size) return;
    setTagBusy(true);
    try {
      const result = await api.bulkTag(selectedIds, tag, 'add');
      notify(`已为 ${result.count} 个地点添加「${tag}」`);
      setTagOpen(false);
      setTagValue('');
      setSelected(new Set());
      window.dispatchEvent(new CustomEvent('tuhe-refresh'));
    } catch (error) {
      notify(error instanceof Error ? error.message : '标签更新失败', 'error');
    } finally {
      setTagBusy(false);
    }
  };

  const doDelete = async () => {
    setDeleteBusy(true);
    try {
      const result = await api.deletePlaces(deleteTarget);
      notify(`已删除 ${result.count} 个地点`);
      setDeleteTarget([]);
      setSelected(new Set());
      window.dispatchEvent(new CustomEvent('tuhe-refresh'));
    } catch (error) {
      notify(error instanceof Error ? error.message : '删除失败', 'error');
    } finally {
      setDeleteBusy(false);
    }
  };

  return (
    <div className="page places-page">
      <header className="page-header">
        <div>
          <p className="eyebrow">YOUR PLACE LIBRARY</p>
          <h1>地点库 <span>{data ? data.total : '—'}</span></h1>
          <p>所有平台的收藏在这里合并成一份可检索、可同步的地点资产。</p>
        </div>
        <div className="page-header-actions">
          <button className="btn btn-ghost" onClick={() => { setFilterOpen((value) => !value); }}><SlidersHorizontal size={16} /> 筛选</button>
          <button className="btn btn-primary" onClick={onAdd}><Plus size={17} /> 添加地点</button>
        </div>
      </header>

      <section className="places-toolbar">
        <div className="library-search">
          <Search size={18} />
          <input value={q} onChange={(event) => setQ(event.target.value)} placeholder="搜索名称、地址、标签或备注…" />
          {q && <button onClick={() => setQ('')} aria-label="清除搜索"><X size={15} /></button>}
        </div>
        <div className="status-tabs">
          {[
            { value: '', label: '全部' },
            { value: 'complete', label: '完整同步' },
            { value: 'incomplete', label: '待处理' },
            { value: 'pending', label: '待确认' },
            { value: 'unlinked', label: '未关联' },
          ].map((item) => (
            <button key={item.value} className={cn(status === item.value && 'is-active')} onClick={() => setStatus(item.value)}>{item.label}</button>
          ))}
        </div>
        <div className="view-toggle">
          <button className={cn(view === 'table' && 'is-active')} onClick={() => setView('table')} aria-label="表格视图"><List size={17} /></button>
          <button className={cn(view === 'grid' && 'is-active')} onClick={() => setView('grid')} aria-label="卡片视图"><Grid2X2 size={16} /></button>
          <button className={cn(view === 'map' && 'is-active')} onClick={() => setView('map')} aria-label="地图视图"><MapIcon size={16} /></button>
        </div>
      </section>

      {filterOpen && (
        <section className="filter-drawer">
          <label className="mini-field">
            <span>平台</span>
            <select value={platform} onChange={(event) => setPlatform(event.target.value)}>
              <option value="">全部平台</option>
              {PLATFORM_LIST.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </label>
          <label className="mini-field">
            <span>城市</span>
            <select value={city} onChange={(event) => setCity(event.target.value)}>
              <option value="">全部城市</option>
              {data?.facets.cities.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </label>
          <label className="mini-field">
            <span>分类</span>
            <select value={category} onChange={(event) => setCategory(event.target.value)}>
              <option value="">全部分类</option>
              {data?.facets.categories.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </label>
          <label className="mini-field">
            <span>排序</span>
            <select value={sort} onChange={(event) => setSort(event.target.value)}>
              <option value="updated">最近更新</option>
              <option value="created">最近添加</option>
              <option value="name">名称 A-Z</option>
              <option value="city">按城市</option>
            </select>
          </label>
          <button className="btn btn-ghost small" onClick={clearFilters} disabled={!hasFilters}>重置筛选</button>
        </section>
      )}

      {hasFilters && (
        <div className="active-filters">
          <span><Filter size={13} /> 已筛选 {data?.total ?? 0} 个地点</span>
          {city && <button onClick={() => setCity('')}>{city} <X size={12} /></button>}
          {category && <button onClick={() => setCategory('')}>{category} <X size={12} /></button>}
          {platform && <button onClick={() => setPlatform('')}>{PLATFORM_UI[platform as PlatformId]?.shortName} <X size={12} /></button>}
          {q && <button onClick={() => setQ('')}>“{q}” <X size={12} /></button>}
          <button className="clear-all" onClick={clearFilters}>清除全部</button>
        </div>
      )}

      {loading ? (
        <PlacesSkeleton view={view} />
      ) : view === 'table' ? (
        <section className="places-table-card">
          <div className="table-scroll">
            <table className="places-table">
              <thead>
                <tr>
                  <th className="check-col">
                    <button className={cn('table-check', allOnPageSelected && 'is-checked')} onClick={toggleAll} aria-label="全选当前页">
                      {allOnPageSelected && <Check size={12} />}
                    </button>
                  </th>
                  <th>地点</th>
                  <th>分类 / 标签</th>
                  <th>城市</th>
                  <th>平台覆盖</th>
                  <th>同步状态</th>
                  <th>最近更新</th>
                  <th className="action-col" />
                </tr>
              </thead>
              <tbody>
                {items.map((place) => (
                  <tr key={place.id} className={cn(selected.has(place.id) && 'is-selected')} onClick={() => onEdit(place)}>
                    <td className="check-col" onClick={(event) => event.stopPropagation()}>
                      <button className={cn('table-check', selected.has(place.id) && 'is-checked')} onClick={() => toggleSelect(place.id)} aria-label={`选择 ${place.name}`}>
                        {selected.has(place.id) && <Check size={12} />}
                      </button>
                    </td>
                    <td>
                      <div className="place-cell">
                        <span className={`place-tile small tone-${categoryTone(place.category)}`}><span className="tile-contour" /><b>{placeInitial(place)}</b></span>
                        <span className="place-cell-copy">
                          <strong>{place.name}</strong>
                          <small>{place.address || coordinateText(place)}</small>
                        </span>
                      </div>
                    </td>
                    <td>
                      <div className="category-cell">
                        <span>{place.category}</span>
                        <div className="tag-row">{place.tags.slice(0, 2).map((tag) => <em key={tag}>{tag}</em>)}{place.tags.length > 2 && <em>+{place.tags.length - 2}</em>}</div>
                      </div>
                    </td>
                    <td><span className="city-cell"><MapPin size={13} />{place.city || '—'}</span></td>
                    <td><PlatformCoverage place={place} /></td>
                    <td><span className={`status-pill ${syncStateTone(place.sync)}`}><i />{syncStateLabel(place.sync)}</span></td>
                    <td><span className="date-cell">{formatDate(place.updatedAt)}</span></td>
                    <td className="action-col" onClick={(event) => event.stopPropagation()}>
                      <div className="row-actions">
                        <button onClick={() => onEdit(place)} aria-label="编辑"><Pencil size={15} /></button>
                        <button onClick={() => setDeleteTarget([place.id])} aria-label="删除"><Trash2 size={15} /></button>
                        <button aria-label="更多"><MoreHorizontal size={16} /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!items.length && <EmptyPlaces hasFilters={hasFilters} onClear={clearFilters} onAdd={onAdd} />}
        </section>
      ) : view === 'grid' ? (
        <div className="places-grid">
          {items.map((place) => (
            <article key={place.id} className={cn('place-card', selected.has(place.id) && 'is-selected')} onClick={() => onEdit(place)}>
              <div className={`place-card-cover tone-${categoryTone(place.category)}`}>
                <span className="cover-grid" />
                <span className="cover-pin"><MapPin size={18} /></span>
                <span className="cover-initial">{placeInitial(place)}</span>
                <button className={cn('card-check', selected.has(place.id) && 'is-checked')} onClick={(event) => { event.stopPropagation(); toggleSelect(place.id); }} aria-label="选择">
                  {selected.has(place.id) && <Check size={12} />}
                </button>
                <span className={`status-pill floating ${syncStateTone(place.sync)}`}><i />{syncStateLabel(place.sync)}</span>
              </div>
              <div className="place-card-body">
                <div className="place-card-title">
                  <div><h3>{place.name}</h3><p>{place.city || '未填写城市'} · {place.category}</p></div>
                  <span className="rating">{place.rating ? `★ ${place.rating}` : '—'}</span>
                </div>
                <p className="place-card-address">{place.address || coordinateText(place)}</p>
                <div className="place-card-footer">
                  <PlatformCoverage place={place} />
                  <time>{formatDate(place.updatedAt)}</time>
                </div>
              </div>
            </article>
          ))}
          {!items.length && <div className="grid-empty"><EmptyPlaces hasFilters={hasFilters} onClear={clearFilters} onAdd={onAdd} /></div>}
        </div>
      ) : (
        <MapView
          places={mapPlaces}
          loading={mapLoading}
          selected={mapSelected}
          onSelect={setMapSelected}
          onEdit={onEdit}
          onSync={(place) => onSync([place.id])}
          onReset={() => { setMapSelected(null); setMapKey((value) => value + 1); }}
          key={mapKey}
        />
      )}

      {view !== 'map' && data && data.pages > 1 && (
        <div className="pagination">
          <span>第 {data.page} / {data.pages} 页 · 共 {data.total} 个地点</span>
          <div>
            <button onClick={() => setPage((value) => Math.max(1, value - 1))} disabled={page <= 1} aria-label="上一页"><ChevronLeft size={16} /></button>
            {Array.from({ length: Math.min(5, data.pages) }, (_, index) => {
              let value = index + 1;
              if (data.pages > 5 && page > 3) value = Math.min(data.pages - 4 + index, page - 2 + index);
              return <button key={value} className={cn(page === value && 'is-active')} onClick={() => setPage(value)}>{value}</button>;
            })}
            <button onClick={() => setPage((value) => Math.min(data.pages, value + 1))} disabled={page >= data.pages} aria-label="下一页"><ChevronRight size={16} /></button>
          </div>
        </div>
      )}

      {selected.size > 0 && (
        <div className="bulk-bar">
          <span className="bulk-count"><i>{selected.size}</i> 个地点已选择</span>
          <div className="bulk-actions">
            <button onClick={() => onSync(selectedIds)}><RefreshCw size={15} /> 同步</button>
            <button onClick={() => setTagOpen(true)}><Tag size={15} /> 加标签</button>
            <button className="danger" onClick={() => setDeleteTarget(selectedIds)}><Trash2 size={15} /> 删除</button>
          </div>
          <button className="bulk-clear" onClick={() => setSelected(new Set())}><X size={16} /> 取消选择</button>
        </div>
      )}

      <Modal
        open={tagOpen}
        onClose={() => setTagOpen(false)}
        title="批量添加标签"
        subtitle={`为选中的 ${selected.size} 个地点添加同一个标签。`}
        size="sm"
        footer={<><button className="btn btn-ghost" onClick={() => setTagOpen(false)}>取消</button><button className="btn btn-primary" onClick={applyTag} disabled={tagBusy || !tagValue.trim()}>{tagBusy ? '添加中…' : '添加标签'}</button></>}
      >
        <label className="field field-full">
          <span>标签名称</span>
          <input value={tagValue} onChange={(event) => setTagValue(event.target.value)} placeholder="例如：下次再去、雨天备选" autoFocus onKeyDown={(event) => { if (event.key === 'Enter') applyTag(); }} />
        </label>
      </Modal>

      <ConfirmDialog
        open={deleteTarget.length > 0}
        onClose={() => setDeleteTarget([])}
        onConfirm={doDelete}
        title="删除地点"
        description={`确定要删除这 ${deleteTarget.length} 个地点吗？删除只影响途合本地地点库，不会修改平台上的收藏。`}
        confirmText="确认删除"
        danger
        busy={deleteBusy}
      />
    </div>
  );
}


function MapView({
  places, loading, selected, onSelect, onEdit, onSync, onReset,
}: {
  places: Place[];
  loading: boolean;
  selected: Place | null;
  onSelect: (place: Place | null) => void;
  onEdit: (place: Place) => void;
  onSync: (place: Place) => void;
  onReset: () => void;
}) {
  const categories = useMemo(() => {
    const counts = new Map<string, number>();
    places.forEach((place) => counts.set(place.category, (counts.get(place.category) || 0) + 1));
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
  }, [places]);
  const located = places.filter((place) => place.location).length;

  return (
    <section className="places-map-panel">
      <div className="places-map-head">
        <div>
          <p className="eyebrow">MERGED PLACES · MAP</p>
          <h2>{places.length} 个合并地点 <span>/ {located} 个已定位</span></h2>
        </div>
        <div className="map-head-right">
          <div className="map-legend">
            {categories.map(([name, count]) => <span key={name}><i className={`tone-${categoryTone(name)}`} />{name}<em>{count}</em></span>)}
          </div>
          <button className="btn btn-ghost small" onClick={onReset}><LocateFixed size={14} /> 重置视野</button>
        </div>
      </div>
      <div className="places-map-stage">
        {loading ? <div className="map-loading"><span className="map-loader" /><p>正在展开你的地点地图…</p></div> : places.length ? (
          <PlaceMap places={places} selectedId={selected?.id} onSelect={onSelect} />
        ) : (
          <div className="map-empty"><MapIcon size={30} /><strong>当前筛选下没有可显示的地点</strong><p>清除筛选，或先导入带坐标的收藏。</p></div>
        )}
        {selected && (
          <div className="map-place-card">
            <button className="map-card-close" onClick={() => onSelect(null)}><X size={15} /></button>
            <div className="map-card-top">
              <span className={`place-tile tone-${categoryTone(selected.category)}`}><span className="tile-contour" /><b>{placeInitial(selected)}</b></span>
              <div><p>{selected.city || '未填写城市'} · {selected.category}</p><h3>{selected.name}</h3></div>
            </div>
            <p className="map-card-address">{selected.address || coordinateText(selected)}</p>
            <div className="map-card-tags">{selected.tags.slice(0, 3).map((tag) => <span key={tag}>{tag}</span>)}</div>
            <div className="map-card-footer">
              <PlatformCoverage place={selected} />
              <span className={`status-pill ${syncStateTone(selected.sync)}`}><i />{syncStateLabel(selected.sync)}</span>
            </div>
            <div className="map-card-actions">
              <button className="btn btn-ghost small" onClick={() => onEdit(selected)}><Pencil size={14} /> 编辑</button>
              <button className="btn btn-primary small" onClick={() => onSync(selected)}><RefreshCw size={14} /> 同步</button>
            </div>
          </div>
        )}
        <span className="map-watermark">MERGE · VISUALIZE</span>
      </div>
    </section>
  );
}

function PlatformCoverage({ place }: { place: Place }) {
  return (
    <span className="coverage-marks">
      {PLATFORM_ORDER.map((id) => {
        const link = place.links[id];
        return (
          <span className={cn('coverage-mark-wrap', link?.status === 'pending' && 'is-pending')} key={id} title={`${PLATFORM_UI[id].name} · ${link ? (link.status === 'pending' ? '待确认' : '已同步') : '未关联'}`}>
            <PlatformMark platform={PLATFORM_UI[id]} size={20} muted={!link} />
          </span>
        );
      })}
    </span>
  );
}

function EmptyPlaces({ hasFilters, onClear, onAdd }: { hasFilters: boolean; onClear: () => void; onAdd: () => void }) {
  return (
    <div className="empty-state">
      <span className="empty-icon"><MapPin size={24} /></span>
      <h3>{hasFilters ? '没有符合条件的地点' : '地点库还是空的'}</h3>
      <p>{hasFilters ? '换个关键词，或清除筛选条件再试一次。' : '导入平台收藏，或手动添加第一个想去的地方。'}</p>
      <button className="btn btn-ghost" onClick={hasFilters ? onClear : onAdd}>{hasFilters ? '清除筛选' : '添加地点'}</button>
    </div>
  );
}

function PlacesSkeleton({ view }: { view: 'table' | 'grid' | 'map' }) {
  if (view === 'map') {
    return <div className="places-map-panel map-skeleton"><div className="map-loading"><span className="map-loader" /><p>正在展开你的地点地图…</p></div></div>;
  }
  if (view === 'grid') {
    return <div className="places-grid">{[1, 2, 3, 4, 5, 6].map((item) => <div className="place-card skeleton-card" key={item}><div className="skeleton-cover" /><div className="skeleton-lines" /></div>)}</div>;
  }
  return (
    <section className="places-table-card">
      <div className="table-skeleton">
        {Array.from({ length: 8 }, (_, index) => <div className="skeleton-row" key={index}><span /><span /><span /><span /><span /></div>)}
      </div>
    </section>
  );
}
