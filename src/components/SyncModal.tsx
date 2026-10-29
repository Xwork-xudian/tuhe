import { useEffect, useState } from 'react';
import { ArrowRight, Check, Cloud, ShieldCheck } from 'lucide-react';
import { api } from '../lib/api';
import type { PlatformId, PlatformStat, SyncJob } from '../lib/types';
import { cn, modeLabel } from '../lib/utils';
import { Modal } from './Modal';
import { PlatformMark } from './PlatformMark';

export function SyncModal({
  open, onClose, platforms, placeIds, onStarted, notify,
}: {
  open: boolean;
  onClose: () => void;
  platforms: Record<PlatformId, PlatformStat> | null;
  placeIds?: string[];
  onStarted: (job: SyncJob) => void;
  notify: (message: string, tone?: 'success' | 'error') => void;
}) {
  const [selected, setSelected] = useState<PlatformId[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open || !platforms) return;
    setError('');
    setSelected((Object.keys(platforms) as PlatformId[]).filter((id) => platforms[id]?.enabled && platforms[id]?.bridgeReady));
  }, [open, platforms]);

  const toggle = (id: PlatformId) => {
    setSelected((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  };

  const start = async () => {
    if (!selected.length) { setError('请至少选择一个平台'); return; }
    setBusy(true);
    setError('');
    try {
      const job = await api.startSync({
        placeIds: placeIds?.length ? placeIds : undefined,
        platforms: selected,
        scope: placeIds?.length ? undefined : 'unsynced',
        strategy: 'merge',
      });
      notify('同步任务已创建');
      onStarted(job);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : '创建同步任务失败');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="发起一次同步"
      eyebrow="SYNC NOW"
      subtitle={placeIds?.length ? `将选中的 ${placeIds.length} 个地点推送到目标平台。` : '扫描所有未完成同步的地点，按平台逐一补齐。'}
      size="md"
      footer={
        <>
          <span className="sync-foot-note"><ShieldCheck size={14} /> 冲突时保留最新信息，不覆盖备注</span>
          <button className="btn btn-ghost" onClick={onClose}>取消</button>
          <button className="btn btn-primary" onClick={start} disabled={busy || !selected.length}>{busy ? '创建中…' : '开始同步'}<ArrowRight size={16} /></button>
        </>
      }
    >
      <div className="sync-platform-list">
        {platforms && (Object.keys(platforms) as PlatformId[]).map((id) => {
          const platform = platforms[id];
          const active = selected.includes(id);
          const ready = Boolean(platform.enabled && platform.bridgeReady);
          return (
            <button
              key={id}
              className={cn('sync-platform-option', active && 'is-selected', !ready && 'is-disabled')}
              onClick={() => ready && toggle(id)}
              disabled={!ready}
            >
              <PlatformMark platform={platform} size={40} muted={!ready} />
              <span className="sync-option-copy">
                <strong>{platform.name}</strong>
                <small>{!platform.enabled ? '连接已停用' : !platform.bridgeReady ? '未配置桥接 · 请先配置' : `Cookie 桥接 · 已同步 ${platform.synced} 个`}</small>
              </span>
              <span className={cn('check-box', active && 'is-checked')}>{active && <Check size={13} />}</span>
            </button>
          );
        })}
      </div>
      <div className="sync-info-card">
        <Cloud size={18} />
        <div>
          <strong>即将同步 {placeIds?.length ? `${placeIds.length} 个选中地点` : '全部未完成的收藏'}</strong>
          <p>同步会通过 Cookie 桥接器推送到平台；未配置桥接地址的任务会失败。</p>
        </div>
      </div>
      {error && <p className="form-error">{error}</p>}
    </Modal>
  );
}
