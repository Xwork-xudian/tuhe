import { useEffect, useState } from 'react';
import { LocateFixed, Plus, Star, X } from 'lucide-react';
import { api } from '../lib/api';
import type { Place, PlaceDraft } from '../lib/types';
import { cn } from '../lib/utils';
import { Modal } from './Modal';

const categories = ['人文古迹', '公园', '艺术街区', '街区', '咖啡馆', '城市地标', '城市漫步', '美术馆', '本帮菜', '湖景', '校园', '茶村', '商业街区', '茶馆', '古镇', '观景地', '海岛', '山野', '建筑', '老街', '美食', '住宿'];

const emptyDraft: PlaceDraft = {
  name: '', address: '', city: '', district: '', category: '未分类', tags: [], note: '', rating: null, url: '', lng: '', lat: '',
};

export function PlaceModal({
  open, place, onClose, onSaved, notify,
}: {
  open: boolean;
  place: Place | null;
  onClose: () => void;
  onSaved: () => void;
  notify: (message: string, tone?: 'success' | 'error') => void;
}) {
  const [draft, setDraft] = useState<PlaceDraft>(emptyDraft);
  const [tagInput, setTagInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setError('');
    setTagInput('');
    setDraft(place ? {
      name: place.name,
      address: place.address || '',
      city: place.city || '',
      district: place.district || '',
      category: place.category || '未分类',
      tags: place.tags || [],
      note: place.note || '',
      rating: place.rating ?? null,
      url: place.url || '',
      lng: place.location ? String(place.location.lng) : '',
      lat: place.location ? String(place.location.lat) : '',
    } : emptyDraft);
  }, [open, place]);

  const update = (key: keyof PlaceDraft, value: string | number | null | string[]) => {
    setDraft((current) => ({ ...current, [key]: value }));
  };

  const addTag = () => {
    const value = tagInput.trim();
    if (!value) return;
    if (!draft.tags.includes(value)) update('tags', [...draft.tags, value].slice(0, 20));
    setTagInput('');
  };

  const save = async () => {
    if (!draft.name.trim()) {
      setError('请填写地点名称');
      return;
    }
    const hasLng = Boolean(draft.lng.trim());
    const hasLat = Boolean(draft.lat.trim());
    if (hasLng !== hasLat) {
      setError('经度和纬度需要同时填写');
      return;
    }
    if (hasLng) {
      const lng = Number(draft.lng);
      const lat = Number(draft.lat);
      if (!Number.isFinite(lng) || !Number.isFinite(lat) || lng < -180 || lng > 180 || lat < -90 || lat > 90) {
        setError('经纬度格式不正确');
        return;
      }
    }
    setSaving(true);
    setError('');
    try {
      if (place) await api.updatePlace(place.id, draft);
      else await api.createPlace(draft);
      notify(place ? '地点信息已更新' : '地点已加入你的地图');
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={place ? '编辑地点' : '添加一个地点'}
      eyebrow={place ? 'PLACE DETAIL' : 'NEW PLACE'}
      subtitle={place ? '补充信息后，可批量同步到各个平台。' : '先收进来，之后再决定它属于哪段旅程。'}
      size="drawer"
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>取消</button>
          <button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? '保存中…' : place ? '保存修改' : '添加地点'}</button>
        </>
      }
    >
      <div className="form-section">
        <label className="field field-full">
          <span>地点名称 <i>*</i></span>
          <input value={draft.name} onChange={(event) => update('name', event.target.value)} placeholder="例如：沙溪古镇" autoFocus />
        </label>
        <div className="field-grid two">
          <label className="field">
            <span>分类</span>
            <input list="category-list" value={draft.category} onChange={(event) => update('category', event.target.value)} placeholder="选择一个分类" />
            <datalist id="category-list">{categories.map((item) => <option key={item} value={item} />)}</datalist>
          </label>
          <label className="field">
            <span>评分</span>
            <div className="rating-input">
              <Star size={15} />
              <input type="number" min="0" max="5" step="0.1" value={draft.rating ?? ''} onChange={(event) => update('rating', event.target.value === '' ? null : Number(event.target.value))} placeholder="0 - 5" />
            </div>
          </label>
        </div>
      </div>

      <div className="form-section">
        <div className="field-grid two">
          <label className="field">
            <span>城市</span>
            <input value={draft.city} onChange={(event) => update('city', event.target.value)} placeholder="大理" />
          </label>
          <label className="field">
            <span>区县</span>
            <input value={draft.district} onChange={(event) => update('district', event.target.value)} placeholder="剑川县" />
          </label>
        </div>
        <label className="field field-full">
          <span>详细地址</span>
          <input value={draft.address} onChange={(event) => update('address', event.target.value)} placeholder="省 / 市 / 区 / 街道" />
        </label>
      </div>

      <div className="form-section">
        <div className="form-section-title">
          <span><LocateFixed size={15} /> 坐标</span>
          <small>统一保存为 WGS84</small>
        </div>
        <div className="field-grid two">
          <label className="field">
            <span>经度 Lng</span>
            <input inputMode="decimal" value={draft.lng} onChange={(event) => update('lng', event.target.value)} placeholder="100.1374" />
          </label>
          <label className="field">
            <span>纬度 Lat</span>
            <input inputMode="decimal" value={draft.lat} onChange={(event) => update('lat', event.target.value)} placeholder="25.8519" />
          </label>
        </div>
        <p className="field-hint">导入平台文件时会自动完成 GCJ-02 / BD-09 / WGS84 坐标转换，无需手动处理偏移。</p>
      </div>

      <div className="form-section">
        <label className="field field-full">
          <span>标签</span>
          <div className="tag-input-wrap">
            {draft.tags.map((tag) => (
              <span className="tag-chip" key={tag}>{tag}<button onClick={() => update('tags', draft.tags.filter((item) => item !== tag))} aria-label={`移除 ${tag}`}><X size={12} /></button></span>
            ))}
            <input
              value={tagInput}
              onChange={(event) => setTagInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ',') { event.preventDefault(); addTag(); }
              }}
              onBlur={addTag}
              placeholder={draft.tags.length ? '继续添加…' : '例如：周末、日落、咖啡'}
            />
            <button className="tag-add" onClick={addTag} aria-label="添加标签"><Plus size={13} /></button>
          </div>
        </label>
        <label className="field field-full">
          <span>备注</span>
          <textarea rows={4} value={draft.note} onChange={(event) => update('note', event.target.value)} placeholder="记下最好去的时段、点什么、怎么走…" />
        </label>
      </div>
      {error && <p className="form-error">{error}</p>}
      {!place && <p className="drawer-note">添加后可在「地点库」批量选择，并同步到你连接的地图平台。</p>}
    </Modal>
  );
}
