import { useEffect, useState } from 'react';
import {
  ArrowRight, Cable, Check, CloudDownload, Code2, Download, ExternalLink, Globe2, Info, Link2,
  LoaderCircle, LockKeyhole, Plug, RefreshCw, Settings, ShieldCheck, Upload,
} from 'lucide-react';
import { api } from '../lib/api';
import type { Connection, PlatformId, PullPreview } from '../lib/types';
import { cn, relativeTime } from '../lib/utils';
import { Modal } from '../components/Modal';
import { PlatformMark } from '../components/PlatformMark';

function bridgeAdminUrl(connection?: Connection) {
  try {
    if (connection?.webhookUrl) {
      const url = new URL(connection.webhookUrl);
      return `${url.protocol}//${url.hostname}:8790`;
    }
  } catch { /* fall through */ }
  return `http://${window.location.hostname}:8790`;
}

export function ConnectionsPage({
  navigate, notify, refreshVersion,
}: {
  navigate: (path: string) => void;
  notify: (message: string, tone?: 'success' | 'error') => void;
  refreshVersion: number;
}) {
  const [items, setItems] = useState<Connection[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Connection | null>(null);
  const [webhookUrl, setWebhookUrl] = useState('');
  const [token, setToken] = useState('');
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState('');
  const [pullTarget, setPullTarget] = useState<Connection | null>(null);
  const [pullPreview, setPullPreview] = useState<PullPreview | null>(null);
  const [pullLoading, setPullLoading] = useState(false);
  const [pullBusy, setPullBusy] = useState(false);
  const [pullError, setPullError] = useState('');
  const [pullAllBusy, setPullAllBusy] = useState(false);

  const load = () => {
    setLoading(true);
    api.connections().then(setItems).catch((err) => notify(err.message, 'error')).finally(() => setLoading(false));
  };

  useEffect(load, [refreshVersion]);

  const toggle = async (connection: Connection) => {
    try {
      const updated = await api.updateConnection(connection.id as PlatformId, { enabled: !connection.enabled });
      setItems((current) => current.map((item) => item.id === connection.id ? { ...item, enabled: updated.enabled } : item));
      notify(`${connection.name}已${updated.enabled ? '启用' : '停用'}`);
    } catch (err) {
      notify(err instanceof Error ? err.message : '更新连接失败', 'error');
    }
  };

  const openConfig = (connection: Connection) => {
    setEditing(connection);
    setWebhookUrl(connection.webhookUrl || '');
    setToken('');
    setError('');
  };

  const save = async () => {
    if (!editing) return;
    if (!webhookUrl.trim()) { setError('请填写 Cookie 桥接地址'); return; }
    setSaving(true);
    setError('');
    try {
      const patch: { webhookUrl: string; token?: string } = { webhookUrl: webhookUrl.trim() };
      if (token.trim()) patch.token = token.trim();
      await api.updateConnection(editing.id as PlatformId, patch);
      notify(`${editing.name}桥接配置已保存`);
      setEditing(null);
      load();
      window.dispatchEvent(new CustomEvent('tuhe-refresh'));
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const test = async () => {
    if (!editing) return;
    setTesting(true);
    setError('');
    try {
      const result = await api.testConnection(editing.id as PlatformId);
      notify(`桥接测试通过（HTTP ${result.status}）`);
    } catch (err) {
      setError(err instanceof Error ? err.message : '测试失败');
    } finally {
      setTesting(false);
    }
  };

  const openPull = async (connection: Connection) => {
    setPullTarget(connection);
    setPullPreview(null);
    setPullError('');
    setPullLoading(true);
    try {
      const data = await api.pullConnection(connection.id as PlatformId, false);
      setPullPreview(data as PullPreview);
    } catch (err) {
      setPullError(err instanceof Error ? err.message : '拉取失败');
    } finally {
      setPullLoading(false);
    }
  };

  const commitPull = async () => {
    if (!pullTarget) return;
    setPullBusy(true);
    setPullError('');
    try {
      const data = await api.pullConnection(pullTarget.id as PlatformId, true);
      notify(`拉取完成：新增 ${data.newCount} 个，合并 ${data.mergedCount} 个`);
      setPullTarget(null);
      setPullPreview(null);
      load();
      window.dispatchEvent(new CustomEvent('tuhe-refresh'));
    } catch (err) {
      setPullError(err instanceof Error ? err.message : '合并失败');
    } finally {
      setPullBusy(false);
    }
  };

  const pullAll = async () => {
    setPullAllBusy(true);
    try {
      const data = await api.pullAllConnections();
      const failed = data.items.filter((item) => !item.ok);
      const detail = failed.length
        ? `，失败：${failed.map((item) => `${item.name}（${item.error || '未知错误'}）`).join('、')}`
        : '';
      notify(`全部拉取完成：读取 ${data.total} 个，新增 ${data.newCount} 个，合并 ${data.mergedCount} 个${detail}`, failed.length ? 'error' : 'success');
      load();
      window.dispatchEvent(new CustomEvent('tuhe-refresh'));
    } catch (err) {
      notify(err instanceof Error ? err.message : '批量拉取失败', 'error');
    } finally {
      setPullAllBusy(false);
    }
  };

  const totalSynced = items.reduce((sum, item) => sum + item.synced, 0);
  const configured = items.filter((item) => item.webhookUrl).length;
  const adminUrl = bridgeAdminUrl(items[0]);

  return (
    <div className="page connections-page">
      <header className="page-header">
        <div>
          <p className="eyebrow">CONNECTIONS</p>
          <h1>平台连接</h1>
          <p>高德、百度、圆周统一通过自建 Cookie 桥接器同步。</p>
        </div>
        <div className="page-header-actions">
          <button className="btn btn-primary" onClick={pullAll} disabled={pullAllBusy || loading}>
            {pullAllBusy ? <LoaderCircle size={15} className="spin" /> : <CloudDownload size={15} />}
            {pullAllBusy ? '拉取中…' : '全部拉取'}
          </button>
          <div className="header-badge"><LockKeyhole size={15} /> Cookie 只保存在桥接器</div>
        </div>
      </header>

      <section className="connection-summary">
        <div className="connection-summary-copy">
          <p className="eyebrow light">COOKIE BRIDGE</p>
          <h2>三个平台，<br />一条真实同步链路。</h2>
          <p>途合发送 Webhook，桥接器用你自备的 Cookie 和平台请求模板读取收藏，再合并进途合。</p>
        </div>
        <div className="connection-summary-stats">
          <div><strong>{items.filter((item) => item.enabled).length}</strong><small>已启用连接</small></div>
          <div><strong>{totalSynced}</strong><small>平台地点关联</small></div>
          <div><strong>{items.length || 3}</strong><small>支持平台</small></div>
        </div>
        <span className="summary-orbit"><Cable size={45} /></span>
      </section>

      <div className="connections-grid">
        {loading && [1, 2, 3].map((item) => <div className="platform-card skeleton-card" key={item} />)}
        {!loading && items.map((connection) => (
          <article className={cn('platform-card', !connection.enabled && 'is-offline')} key={connection.id}>
            <span className="platform-card-accent" style={{ background: connection.color }} />
            <header>
              <div className="platform-card-title">
                <PlatformMark platform={connection} size={48} muted={!connection.enabled} />
                <div>
                  <h3>{connection.name}</h3>
                  <p>{connection.coordSystem} 坐标系</p>
                </div>
              </div>
              <button className={cn('switch', connection.enabled && 'is-on')} onClick={() => toggle(connection)} aria-label={`${connection.enabled ? '停用' : '启用'}${connection.name}`}><span /></button>
            </header>
            <p className="platform-description">{connection.description}</p>
            <div className={cn('bridge-status', connection.webhookUrl ? 'is-ready' : 'is-empty')}>
              <span><i /></span>
              <div>
                <strong>{connection.webhookUrl ? '桥接地址已配置' : '尚未接入桥接器'}</strong>
                <small>{connection.webhookUrl || '填写桥接器 Webhook 地址后才能同步'}</small>
              </div>
              {connection.hasToken && <em>Token 已保存</em>}
            </div>
            <div className="platform-metrics">
              <div><strong>{connection.synced}</strong><small>已同步</small></div>
              <div><strong>{connection.pending}</strong><small>待确认</small></div>
              <div><strong>{connection.linked}</strong><small>已关联</small></div>
            </div>
            <div className="platform-progress">
              <div><span style={{ width: `${Math.round((connection.synced / Math.max(1, connection.linked || 1)) * 100)}%`, background: connection.color }} /></div>
              <span>最近同步 {relativeTime(connection.lastSyncAt)}</span>
            </div>
            <div className="platform-mode-row">
              <span className={cn('connection-state', connection.enabled && connection.webhookUrl && 'is-online')}><i />{!connection.enabled ? '已停用' : connection.webhookUrl ? '桥接已配置' : '待配置'}</span>
              <span className="mode-badge"><RefreshCw size={12} />Cookie 桥接</span>
            </div>
            <footer className="platform-card-actions">
              <button className="pull-action" onClick={() => openPull(connection)}><CloudDownload size={14} /> 拉取</button>
              <button onClick={() => openConfig(connection)}><Settings size={14} /> 配置</button>
              <button onClick={() => navigate(`/transfer?tab=import&platform=${connection.id}`)}><Upload size={14} /> 导入</button>
              <button onClick={() => navigate(`/transfer?tab=export&platform=${connection.id}`)}><Download size={14} /> 导出</button>
            </footer>
          </article>
        ))}
      </div>

      <section className="panel integration-guide">
        <div className="integration-head">
          <div>
            <p className="eyebrow">PULL FIRST</p>
            <h2>先拉取现有收藏</h2>
          </div>
          <span className="guide-badge"><ShieldCheck size={15} /> 仅真实桥接</span>
        </div>
        <div className="guide-grid">
          <div className="guide-step">
            <span className="guide-number">01</span>
            <span className="guide-icon"><Globe2 size={19} /></span>
            <h3>配置拉取模板</h3>
            <p>在桥接器里粘贴平台「收藏列表」请求，设置 itemsPath 和字段映射；Cookie 已保存在桥接器本地。</p>
            <a className="text-btn" href={adminUrl} target="_blank" rel="noreferrer">去配置拉取 <ExternalLink size={13} /></a>
          </div>
          <div className="guide-step">
            <span className="guide-number">02</span>
            <span className="guide-icon"><Code2 size={19} /></span>
            <h3>途合拉取并预览</h3>
            <p>在平台卡片点「拉取」，查看平台收藏总数、将新增和将合并的数量，不会写入平台。</p>
            <button className="text-btn" onClick={() => items[0] && openPull(items[0])}>预览拉取 <ArrowRight size={13} /></button>
          </div>
          <div className="guide-step">
            <span className="guide-number">03</span>
            <span className="guide-icon"><Link2 size={19} /></span>
            <h3>合并到地点库</h3>
            <p>确认预览后合并；同名且 120 米内的地点会自动合并，并保留平台关联 ID。</p>
            <button className="text-btn" onClick={() => items[0] && openPull(items[0])}>开始拉取 <ArrowRight size={13} /></button>
          </div>
        </div>
        <div className="integration-note">
          <Info size={17} />
          <div>
            <strong>拉取是只读操作</strong>
            <p>「拉取」只读取平台收藏并合并到途合，不会修改平台。写入平台是另一套模板，按需再配置；没有配置时不会伪造同步成功。</p>
          </div>
        </div>
        <div className="webhook-example">
          <div className="code-head"><Code2 size={15} /><span>拉取收藏接口</span><span className="code-lang">JSON</span></div>
          <pre>{`POST ${adminUrl}/webhook/pull
Authorization: Bearer <BRIDGE_WEBHOOK_TOKEN>

{ "platform": "amap" }

→ {
  "ok": true,
  "total": 225,
  "items": [
    { "name": "君钰中心", "location": { "lng": 120.92, "lat": 32.02 } }
  ]
}`}</pre>
        </div>
      </section>

      <Modal
        open={Boolean(editing)}
        onClose={() => setEditing(null)}
        title={editing ? `配置${editing.name}桥接` : '配置桥接'}
        eyebrow="BRIDGE SETTINGS"
        subtitle="填写 Cookie 桥接器地址与令牌，途合会把地点推送到桥接器。"
        size="md"
        footer={
          <>
            <button className="btn btn-ghost" onClick={test} disabled={testing || !editing?.webhookUrl}>{testing ? <LoaderCircle size={15} className="spin" /> : <Plug size={15} />}{testing ? '测试中…' : '测试连接'}</button>
            <button className="btn btn-ghost" onClick={() => setEditing(null)}>取消</button>
            <button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? '保存中…' : '保存配置'}</button>
          </>
        }
      >
        {editing && (
          <>
            <label className="field field-full">
              <span>桥接器 Webhook 地址</span>
              <div className="input-with-icon"><Link2 size={15} /><input value={webhookUrl} onChange={(event) => setWebhookUrl(event.target.value)} placeholder="http://localhost:8790/webhook" /></div>
            </label>
            <label className="field field-full">
              <span>Bearer Token <em>与桥接器 BRIDGE_WEBHOOK_TOKEN 一致</em></span>
              <div className="input-with-icon"><LockKeyhole size={15} /><input type="password" value={token} onChange={(event) => setToken(event.target.value)} placeholder={editing.hasToken ? '已保存，留空则不修改' : '桥接器 Webhook 令牌'} /></div>
            </label>
            <p className="field-hint">桥接器地址：<a href={bridgeAdminUrl(editing)} target="_blank" rel="noreferrer">{bridgeAdminUrl(editing)}</a>。同步前请确认该平台已在桥接器中保存 Cookie 和请求模板。</p>
            <div className="connection-coords-note">
              <span>{editing.coordSystem}</span>
              <p>此平台使用 {editing.coordSystem} 坐标，途合会在推送时自动转换。</p>
            </div>
            {error && <p className="form-error">{error}</p>}
          </>
        )}
      </Modal>

      <Modal
        open={Boolean(pullTarget)}
        onClose={() => { setPullTarget(null); setPullPreview(null); setPullError(''); }}
        title={pullTarget ? `从${pullTarget.name}拉取收藏` : '拉取收藏'}
        eyebrow="IMPORT FROM PLATFORM"
        subtitle="只读取平台现有收藏并合并到地点库，不会向平台写入任何内容。"
        size="md"
        footer={
          <>
            <button className="btn btn-ghost" onClick={() => { setPullTarget(null); setPullPreview(null); }}>取消</button>
            <button className="btn btn-primary" onClick={commitPull} disabled={pullBusy || pullLoading || !pullPreview || pullPreview.total === 0}>
              {pullBusy ? <LoaderCircle size={15} className="spin" /> : <CloudDownload size={15} />}
              {pullBusy ? '合并中…' : `合并到地点库${pullPreview ? `（${pullPreview.newCount + pullPreview.mergedCount}）` : ''}`}
            </button>
          </>
        }
      >
        {pullTarget && (
          <>
            {pullLoading && <div className="pull-loading"><LoaderCircle size={18} className="spin" /> 正在读取平台收藏…</div>}
            {pullError && <p className="form-error">{pullError}</p>}
            {pullPreview && !pullLoading && (
              <>
                <div className="pull-stats">
                  <div><strong>{pullPreview.total}</strong><small>平台收藏</small></div>
                  <div><strong className="good">{pullPreview.newCount}</strong><small>将新增</small></div>
                  <div><strong className="warn">{pullPreview.mergedCount}</strong><small>将合并</small></div>
                  <div><strong>{pullPreview.located}</strong><small>含坐标</small></div>
                </div>
                {pullPreview.total === 0 ? (
                  <p className="pull-empty">平台没有返回收藏。请检查桥接器的拉取模板、Cookie 和 itemsPath。</p>
                ) : (
                  <div className="pull-preview-table">
                    <table>
                      <thead><tr><th>地点</th><th>城市</th><th>坐标</th><th>状态</th></tr></thead>
                      <tbody>
                        {pullPreview.preview.map((place) => (
                          <tr key={place.externalId + place.name}>
                            <td><strong>{place.name}</strong><small>{place.address}</small></td>
                            <td>{place.city || '—'}</td>
                            <td>{place.location ? `${place.location.lng.toFixed(3)}, ${place.location.lat.toFixed(3)}` : '—'}</td>
                            <td>{place.duplicate ? <span className="status-pill warning"><i />合并</span> : <span className="status-pill success"><i />新增</span>}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                <p className="field-hint">坐标会按平台坐标系自动转换为 WGS84；同名且 120 米内的地点会合并，并保留平台关联 ID。</p>
              </>
            )}
          </>
        )}
      </Modal>
    </div>
  );
}
