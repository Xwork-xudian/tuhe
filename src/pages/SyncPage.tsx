import { useEffect, useRef, useState } from 'react';
import {
  ArrowRight, Check, CircleAlert, CircleCheck, Clock3, Cloud, History, Info,
  LoaderCircle, RefreshCw, RotateCcw, ShieldCheck, Sparkles, TriangleAlert, Zap,
} from 'lucide-react';
import { api } from '../lib/api';
import { PLATFORM_LIST, PLATFORM_UI } from '../lib/platforms';
import type { BridgeLog, Dashboard, PlatformId, SyncJob } from '../lib/types';
import { PLATFORM_ORDER, cn, formatDuration, formatDate, modeLabel, relativeTime } from '../lib/utils';
import { PlatformMark } from '../components/PlatformMark';
import { Modal } from '../components/Modal';

export function SyncPage({
  dashboard, notify, onNavigate, refreshVersion,
}: {
  dashboard: Dashboard | null;
  notify: (message: string, tone?: 'success' | 'error') => void;
  onNavigate: (path: string) => void;
  refreshVersion: number;
}) {
  const [selected, setSelected] = useState<PlatformId[]>(['amap', 'baidu', 'yuanzhou']);
  const [scope, setScope] = useState<'unsynced' | 'all'>('unsynced');
  const [jobs, setJobs] = useState<SyncJob[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [logOpen, setLogOpen] = useState(false);
  const [logJob, setLogJob] = useState<SyncJob | null>(null);
  const [logLoading, setLogLoading] = useState(false);
  const [bridgeLogs, setBridgeLogs] = useState<BridgeLog[]>([]);
  const [bridgeWarning, setBridgeWarning] = useState('');
  const notified = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!dashboard) return;
    setSelected((current) => current.filter((id) => dashboard.platformStats[id]?.enabled && dashboard.platformStats[id]?.bridgeReady));
  }, [dashboard]);

  useEffect(() => {
    let cancelled = false;
    api.jobs().then((items) => {
      if (cancelled) return;
      setJobs(items);
      const running = items.find((job) => job.status === 'running' || job.status === 'queued');
      if (running) setActiveId(running.id);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [refreshVersion]);

  useEffect(() => {
    if (!activeId) return;
    let stopped = false;
    const timer = setInterval(async () => {
      try {
        const job = await api.job(activeId);
        if (stopped) return;
        setJobs((current) => [job, ...current.filter((item) => item.id !== job.id)]);
        if (job.status === 'completed' || job.status === 'failed') {
          setActiveId(null);
          if (!notified.current.has(job.id)) {
            notified.current.add(job.id);
            notify(job.status === 'completed' ? `同步完成：${job.succeeded} 个成功` : '同步任务失败', job.status === 'completed' ? 'success' : 'error');
            window.dispatchEvent(new CustomEvent('tuhe-refresh'));
          }
        }
      } catch {
        setActiveId(null);
      }
    }, 850);
    return () => { stopped = true; clearInterval(timer); };
  }, [activeId, notify]);

  const activeJob = jobs.find((job) => job.id === activeId) || null;
  const pendingCount = dashboard?.stats.incomplete ?? 0;
  const selectedConnections = dashboard ? (Object.keys(dashboard.platformStats) as PlatformId[]) : [];
  const online = dashboard ? selectedConnections.filter((id) => dashboard.platformStats[id].enabled && dashboard.platformStats[id].bridgeReady).length : 0;

  const toggle = (id: PlatformId) => {
    const stats = dashboard?.platformStats[id];
    if (!stats?.enabled) return;
    if (!stats.bridgeReady) { notify('该平台还没有配置桥接地址，请先到「平台连接」配置', 'error'); return; }
    setSelected((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  };

  const openLog = async (job: SyncJob) => {
    setLogOpen(true);
    setLogLoading(true);
    setLogJob(job);
    setBridgeLogs([]);
    setBridgeWarning('');
    try {
      const [detail, bridge] = await Promise.all([
        api.job(job.id),
        api.jobBridgeLogs(job.id).catch((error) => ({ logs: [], warning: error instanceof Error ? error.message : '桥接器日志读取失败' })),
      ]);
      setLogJob(detail);
      setBridgeLogs(bridge.logs || []);
      setBridgeWarning(bridge.warning || '');
    } catch (error) {
      notify(error instanceof Error ? error.message : '日志读取失败', 'error');
    } finally {
      setLogLoading(false);
    }
  };

  const start = async () => {
    if (!selected.length) { notify('请至少选择一个同步平台', 'error'); return; }
    setBusy(true);
    try {
      const job = await api.startSync({ platforms: selected, scope, strategy: 'merge' });
      setJobs((current) => [job, ...current.filter((item) => item.id !== job.id)]);
      setActiveId(job.id);
      notify('同步任务已启动');
    } catch (error) {
      notify(error instanceof Error ? error.message : '启动同步失败', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page sync-page">
      <header className="page-header">
        <div>
          <p className="eyebrow">SYNC CONTROL</p>
          <h1>同步中心</h1>
          <p>通过 Cookie 桥接器，把地点库按平台坐标批量送到三个收藏夹。</p>
        </div>
        <div className="header-badge"><ShieldCheck size={15} /> 本地优先 · 可回滚</div>
      </header>

      <section className="sync-overview-strip">
        <div><span className="strip-icon clay"><Clock3 size={18} /></span><p><strong>{pendingCount}</strong><small>待补齐地点</small></p></div>
        <div><span className="strip-icon moss"><CircleCheck size={18} /></span><p><strong>{dashboard?.stats.syncRate ?? 0}%</strong><small>整体同步率</small></p></div>
        <div><span className="strip-icon sky"><Cloud size={18} /></span><p><strong>{online}/3</strong><small>桥接已配置</small></p></div>
        <div><span className="strip-icon ochre"><History size={18} /></span><p><strong>{jobs.filter((job) => job.status === 'completed').length}</strong><small>已完成任务</small></p></div>
      </section>

      <section className="sync-console">
        <div className="sync-console-main">
          <div className="console-heading">
            <span className="console-icon"><Zap size={20} /></span>
            <div>
              <p className="eyebrow light">NEW SYNC RUN</p>
              <h2>新建同步任务</h2>
              <p>选择平台与范围，剩下的交给途合。</p>
            </div>
          </div>
          <div className="console-platforms">
            {PLATFORM_LIST.map((platform) => {
              const stats = dashboard?.platformStats[platform.id];
              const active = selected.includes(platform.id);
              const ready = Boolean(stats?.enabled && stats.bridgeReady);
              return (
                <button key={platform.id} className={cn('console-platform', active && 'is-active', !ready && 'is-disabled')} onClick={() => toggle(platform.id)}>
                  <PlatformMark platform={platform} size={36} muted={!ready} />
                  <span><strong>{platform.shortName}</strong><small>{!stats?.enabled ? '已停用' : !stats.bridgeReady ? '未配置桥接' : 'Cookie 桥接'}</small></span>
                  <i className="console-check">{active && <Check size={11} />}</i>
                </button>
              );
            })}
          </div>
          <div className="console-options">
            <div className="segmented">
              <button className={cn(scope === 'unsynced' && 'is-active')} onClick={() => setScope('unsynced')}>仅未完成</button>
              <button className={cn(scope === 'all' && 'is-active')} onClick={() => setScope('all')}>全部地点</button>
            </div>
            <span className="scope-note">{scope === 'unsynced' ? '只处理还没同步完整的收藏，速度更快。' : `将推送全部 ${dashboard?.stats.total ?? 0} 个地点。`}</span>
          </div>
          <div className="console-footer">
            <span><Info size={14} /> 同步会调用 Cookie 桥接器；未配置桥接地址的任务会失败。</span>
            <button className="btn btn-accent" onClick={start} disabled={busy || !selected.length}>
              {busy ? <LoaderCircle size={16} className="spin" /> : <RefreshCw size={16} />}
              {busy ? '正在创建…' : '开始批量同步'}
            </button>
          </div>
        </div>
        <aside className="sync-route-card">
          <p className="eyebrow light">SYNC ROUTE</p>
          <div className="route-node source"><span className="route-pin">途</span><div><strong>途合地点库</strong><small>{dashboard?.stats.total ?? 0} 个地点 · 统一坐标</small></div></div>
          <div className="route-line"><span /><i /><i /><i /></div>
          <div className="route-targets">
            {PLATFORM_ORDER.map((id) => {
              const platform = PLATFORM_UI[id];
              const active = selected.includes(id);
              return (
                <div className={cn('route-target', active && 'is-active')} key={id}>
                  <PlatformMark platform={platform} size={28} muted={!active} />
                  <span>{platform.shortName}</span>
                  {active && <Check size={11} />}
                </div>
              );
            })}
          </div>
          <div className="route-foot"><span><i className={`status-dot ${selected.length ? 'good' : 'warn'}`} /> {selected.length ? '已配置' : '等待配置'}</span><small>{selected.length} 个目标平台</small></div>
        </aside>
      </section>

      {activeJob && (
        <section className="active-job-card">
          <div className="active-job-top">
            <div className="job-pulse"><span /><RefreshCw size={18} /></div>
            <div className="active-job-copy">
              <p className="eyebrow">RUNNING NOW</p>
              <h3>正在同步 {activeJob.total} 个地点操作</h3>
              <p>{activeJob.status === 'queued' ? '任务排队中，马上开始…' : `已完成 ${activeJob.processed} / ${activeJob.total}，请稍候。`}</p>
            </div>
            <strong className="active-percent">{activeJob.progress}%</strong>
          </div>
          <div className="job-progress"><span style={{ width: `${activeJob.progress}%` }} /></div>
          <div className="active-job-stats">
            <span><CircleCheck size={14} /> 成功 {activeJob.succeeded}</span>
            <span><TriangleAlert size={14} /> 失败 {activeJob.failed}</span>
            <span><Clock3 size={14} /> 跳过 {activeJob.skipped}</span>
            <span className="job-platforms">{activeJob.platforms.map((id) => <PlatformMark key={id} platform={PLATFORM_UI[id]} size={20} />)}</span>
          </div>
        </section>
      )}

      <section className="panel jobs-panel">
        <div className="panel-head">
          <div>
            <p className="eyebrow">SYNC HISTORY</p>
            <h2>任务记录</h2>
          </div>
          <button className="text-btn" onClick={() => { setJobs([]); api.jobs().then(setJobs); }}><RotateCcw size={14} /> 刷新</button>
        </div>
        <div className="jobs-table">
          <div className="jobs-row jobs-header">
            <span>任务</span><span>平台</span><span>结果</span><span>耗时</span><span>时间</span><span />
          </div>
          {jobs.length === 0 && <div className="jobs-empty"><History size={22} /><p>还没有同步任务</p><small>创建一个任务后，记录会出现在这里。</small></div>}
          {jobs.slice(0, 8).map((job) => (
            <div className="jobs-row" key={job.id}>
              <span className="job-name"><i className={cn('job-dot', job.status)} /><div><strong>{job.status === 'running' || job.status === 'queued' ? '进行中的同步' : job.status === 'failed' ? '同步失败' : job.status === 'interrupted' ? '任务中断' : '批量同步'}</strong><small>{job.total} 个操作 · {job.strategy === 'merge' ? '合并更新' : '覆盖'}</small></div></span>
              <span className="job-platforms">{job.platforms.map((id) => <PlatformMark key={id} platform={PLATFORM_UI[id]} size={21} />)}</span>
              <span className="job-result"><em className="good">{job.succeeded} 成功</em>{job.failed > 0 && <em className="bad">{job.failed} 失败</em>}{job.skipped > 0 && <em>{job.skipped} 跳过</em>}</span>
              <span className="job-duration">{formatDuration(job.durationMs)}</span>
              <span className="job-time">{relativeTime(job.createdAt)}</span>
              <span className="job-end">{job.status === 'running' ? <LoaderCircle size={15} className="spin" /> : job.status === 'failed' || job.status === 'interrupted' ? <CircleAlert size={15} className="bad-icon" /> : <CircleCheck size={15} className="good-icon" />}<button className="job-log-btn" onClick={() => openLog(job)}>日志</button></span>
            </div>
          ))}
        </div>
      </section>

      <Modal open={logOpen} onClose={() => setLogOpen(false)} title="同步日志" eyebrow="SYNC LOG" subtitle="查看每个地点的写入结果和平台返回信息。" size="lg" footer={<button className="btn btn-ghost" onClick={() => setLogOpen(false)}>关闭</button>}>
        {!logJob ? <div className="job-log-empty">没有日志</div> : (
          <div className="job-log">
            <div className="job-log-summary">
              <div><small>状态</small><strong>{logJob.status === 'completed' ? '已完成' : logJob.status === 'failed' ? '失败' : logJob.status === 'interrupted' ? '已中断' : logJob.status === 'running' ? '进行中' : '排队中'}</strong></div>
              <div><small>处理</small><strong>{logJob.processed} / {logJob.total}</strong></div>
              <div><small>成功</small><strong className="good">{logJob.succeeded}</strong></div>
              <div><small>失败</small><strong className={logJob.failed ? 'bad' : ''}>{logJob.failed}</strong></div>
              <div><small>跳过</small><strong>{logJob.skipped}</strong></div>
              <div><small>耗时</small><strong>{formatDuration(logJob.durationMs)}</strong></div>
            </div>
            {logJob.error && <div className="job-log-error"><CircleAlert size={14} /> {logJob.error}</div>}
            {logLoading && <div className="job-log-empty"><LoaderCircle size={16} className="spin" /> 正在读取日志…</div>}
            <div className="job-log-list">
              {(logJob.results || []).slice().sort((a, b) => (a.status === b.status ? 0 : a.status === 'failed' ? -1 : 1)).map((item, index) => (
                <div className={cn('job-log-row', item.status)} key={`${item.platform}-${item.placeId}-${index}`}>
                  <PlatformMark platform={PLATFORM_UI[item.platform]} size={22} />
                  <span className="job-log-place"><strong>{item.placeName || item.placeId}</strong><small>{item.platform} · {item.status}</small></span>
                  <span className="job-log-reason">{item.reason || item.externalId || '—'}</span>
                </div>
              ))}
              {!logLoading && !(logJob.results || []).length && <div className="job-log-empty">这个任务没有保存逐条结果（旧任务只记录汇总）。</div>}
            </div>
            {(logJob.results?.length || 0) >= 200 && <p className="job-log-note">仅显示最近 200 条结果。</p>}
            <div className="job-log-section">
              <div className="job-log-section-head"><strong>桥接器日志</strong><span>{bridgeLogs.length} 条</span></div>
              {bridgeWarning && <div className="job-log-error">桥接器日志：{bridgeWarning}</div>}
              <div className="job-log-list bridge">
                {bridgeLogs.map((item, index) => (
                  <div className={cn('job-log-row', item.status)} key={`${item.at}-${index}`}>
                    <PlatformMark platform={PLATFORM_UI[item.platform]} size={20} />
                    <span className="job-log-place"><strong>{item.placeName || '—'}</strong><small>{formatDate(item.at)} · {item.status}{item.httpStatus ? ` · HTTP ${item.httpStatus}` : ''}</small></span>
                    <span className="job-log-reason">{item.error || item.response || '—'}</span>
                  </div>
                ))}
                {!bridgeLogs.length && !bridgeWarning && <div className="job-log-empty">这个时间段的桥接器没有记录。</div>}
              </div>
            </div>
          </div>
        )}
      </Modal>

      <section className="sync-note-panel">
        <Sparkles size={18} />
        <div>
          <strong>同步说明</strong>
          <p>途合只执行真实桥接同步。每个平台都需要在「平台连接」中配置 Cookie 桥接器地址，并在桥接器里保存 Cookie 与请求模板。未配置时同步任务会明确失败，不会伪造成功状态。</p>
        </div>
        <button className="text-btn" onClick={() => onNavigate('/connections')}>查看接入方式 <ArrowRight size={14} /></button>
      </section>
    </div>
  );
}
