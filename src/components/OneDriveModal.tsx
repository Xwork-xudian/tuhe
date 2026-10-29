import { useEffect, useState } from 'react';
import {
  AlertTriangle, Check, ChevronRight, Cloud, FileText, Folder, LoaderCircle,
  LogIn, RefreshCw, Unplug,
} from 'lucide-react';
import { api } from '../lib/api';
import type { OneDriveListing, OneDriveStatus, OneDriveSyncResult } from '../lib/types';
import { relativeTime } from '../lib/utils';
import { Modal } from './Modal';

function joinPath(base: string, name: string) {
  return [base.replace(/^\/+|\/+$/g, ''), name].filter(Boolean).join('/');
}

function formatSize(bytes: number) {
  if (!bytes) return '0 B';
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function OneDriveModal({
  open, onClose, notify, onImported,
}: {
  open: boolean;
  onClose: () => void;
  notify: (message: string, tone?: 'success' | 'error') => void;
  onImported: () => void | Promise<void>;
}) {
  const [status, setStatus] = useState<OneDriveStatus | null>(null);
  const [listing, setListing] = useState<OneDriveListing | null>(null);
  const [path, setPath] = useState('');
  const [loading, setLoading] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState('');
  const [authUrl, setAuthUrl] = useState('');
  const [redirectInput, setRedirectInput] = useState('');
  const [result, setResult] = useState<OneDriveSyncResult | null>(null);

  const loadStatus = async (nextPath?: string) => {
    setLoading(true);
    setError('');
    try {
      const next = await api.oneDriveStatus();
      setStatus(next);
      if (next.connected) {
        const target = nextPath ?? next.lastPath ?? '';
        setPath(target);
        await scan(target);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'OneDrive 状态读取失败');
    } finally {
      setLoading(false);
    }
  };

  const scan = async (target: string) => {
    setScanning(true);
    setError('');
    try {
      const response = await api.oneDriveItems(target);
      setListing(response);
      setPath(response.path);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'OneDrive 文件夹读取失败');
    } finally {
      setScanning(false);
    }
  };

  useEffect(() => {
    if (!open) return;
    setAuthUrl('');
    setRedirectInput('');
    setResult(null);
    loadStatus();
  }, [open]);

  const startAuth = async () => {
    setError('');
    try {
      const response = await api.oneDriveAuthStart();
      setAuthUrl(response.url);
      window.open(response.url, '_blank');
    } catch (err) {
      setError(err instanceof Error ? err.message : '无法发起 OneDrive 登录');
    }
  };

  const completeAuth = async () => {
    if (!redirectInput.trim()) { setError('请粘贴登录后地址栏里的完整链接'); return; }
    setLoading(true);
    setError('');
    try {
      const next = await api.oneDriveAuthComplete({ redirectUrl: redirectInput.trim() });
      setStatus(next);
      setAuthUrl('');
      setRedirectInput('');
      notify('OneDrive 已连接');
      await scan(next.lastPath || '');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'OneDrive 登录完成失败');
    } finally {
      setLoading(false);
    }
  };

  const disconnect = async () => {
    if (!window.confirm('断开 OneDrive 后不会删除已导入的足迹，确定继续吗？')) return;
    setLoading(true);
    try {
      const next = await api.oneDriveDisconnect();
      setStatus(next);
      setListing(null);
      setPath('');
      setResult(null);
      notify('OneDrive 已断开');
    } catch (err) {
      notify(err instanceof Error ? err.message : '断开失败', 'error');
    } finally {
      setLoading(false);
    }
  };

  const sync = async () => {
    setSyncing(true);
    setError('');
    setResult(null);
    try {
      const response = await api.oneDriveSync(path);
      setResult(response);
      const summary = `扫描 ${response.scanned} 个足迹文件，新增 ${response.imported} 个，更新 ${response.updated} 个，跳过 ${response.skipped} 个${response.failed ? `，失败 ${response.failed} 个` : ''}`;
      notify(summary, response.failed ? 'error' : 'success');
      await onImported();
      const next = await api.oneDriveStatus();
      setStatus(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'OneDrive 同步失败');
    } finally {
      setSyncing(false);
    }
  };

  const crumbs = path.split('/').filter(Boolean);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="OneDrive 同步"
      eyebrow="MICROSOFT ONEDRIVE"
      subtitle="登录 Microsoft 账号，读取 OneDrive 里的世界迷雾导出文件。"
      size="lg"
      footer={<button className="btn btn-ghost" onClick={onClose}>关闭</button>}
    >
      {loading && !status ? (
        <div className="od-loading"><LoaderCircle size={20} className="spin" /><span>正在读取 OneDrive 状态…</span></div>
      ) : !status?.connected ? (
        <div className="od-auth">
          <div className="od-note">
            <Cloud size={18} />
            <div>
              <strong>用 Microsoft 账号登录</strong>
              <p>途合只会读取你授权的 OneDrive 文件，不会修改或删除任何内容。登录令牌保存在本机数据目录。</p>
            </div>
          </div>
          {!authUrl ? (
            <button className="btn btn-primary od-wide" onClick={startAuth}><LogIn size={16} /> 登录 OneDrive</button>
          ) : (
            <div className="od-auth-steps">
              <p><b>1.</b> 在新窗口完成 Microsoft 登录并同意读取文件。</p>
              <p><b>2.</b> 登录后浏览器会跳到 <code>localhost:53682</code>，页面打不开是正常的。</p>
              <p><b>3.</b> 复制地址栏里的完整链接，粘贴到下面。</p>
              <textarea
                value={redirectInput}
                onChange={(event) => setRedirectInput(event.target.value)}
                placeholder="http://localhost:53682/?code=..."
                spellCheck={false}
                rows={4}
              />
              <div className="od-auth-actions">
                <a className="text-btn" href={authUrl} target="_blank" rel="noreferrer">重新打开登录页 <ChevronRight size={13} /></a>
                <button className="btn btn-primary" onClick={completeAuth} disabled={loading || !redirectInput.trim()}>
                  {loading ? <LoaderCircle size={15} className="spin" /> : <Check size={15} />} 完成登录
                </button>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="od-connected">
          {status.profileWarning && <div className="od-warning"><AlertTriangle size={13} /> 账号资料读取失败，但文件权限可能仍然可用：{status.profileWarning.slice(0, 180)}</div>}
          <div className="od-account">
            <div>
              <span className="od-account-mark"><Cloud size={18} /></span>
              <div><strong>{status.accountName}</strong><small>{status.accountEmail || status.driveType || 'OneDrive'}</small></div>
            </div>
            <div className="od-account-actions">
              <span>最近同步 {relativeTime(status.lastSyncAt)}</span>
              <button className="text-btn" onClick={disconnect}><Unplug size={13} /> 断开</button>
            </div>
          </div>

          <div className="od-pathbar">
            <button className="od-crumb" onClick={() => scan('')}>OneDrive</button>
            {crumbs.map((crumb, index) => (
              <span className="od-crumb-group" key={`${crumb}-${index}`}>
                <ChevronRight size={12} />
                <button className="od-crumb" onClick={() => scan(crumbs.slice(0, index + 1).join('/'))}>{crumb}</button>
              </span>
            ))}
            <span style={{ flex: 1 }} />
            <button className="text-btn" onClick={() => scan(path)} disabled={scanning}><RefreshCw size={13} className={scanning ? 'spin' : ''} /> 刷新</button>
          </div>

          <div className="od-browser">
            {scanning ? (
              <div className="od-loading"><LoaderCircle size={18} className="spin" /><span>正在读取文件夹…</span></div>
            ) : (
              <>
                {listing?.folders.map((folder) => (
                  <button className="od-row od-folder" key={folder.id} onClick={() => scan(joinPath(path, folder.name))}>
                    <Folder size={16} />
                    <span className="od-name">{folder.name}</span>
                    <em>{folder.childCount} 项</em>
                    <ChevronRight size={14} />
                  </button>
                ))}
                {listing?.files.map((file) => (
                  <div className={`od-row ${file.supported ? 'is-supported' : 'is-unsupported'}`} key={file.id}>
                    <FileText size={16} />
                    <span className="od-name">{file.name}</span>
                    <em>{formatSize(file.size)}</em>
                    <span className="od-file-tag">{file.supported ? file.extension.toUpperCase() : '不支持'}</span>
                  </div>
                ))}
                {!listing?.folders.length && !listing?.files.length && <p className="od-empty">这个文件夹是空的。</p>}
              </>
            )}
          </div>

          <div className="od-syncbar">
            <div>
              <strong>同步当前文件夹</strong>
              <small>会递归读取子文件夹，自动跳过未变化文件；支持 GPX、KML、GeoJSON、JSON、CSV、TXT。</small>
            </div>
            <button className="btn btn-primary" onClick={sync} disabled={syncing || scanning}>
              {syncing ? <LoaderCircle size={15} className="spin" /> : <Cloud size={15} />}
              {syncing ? '同步中…' : '同步当前文件夹'}
            </button>
          </div>

          {result && (
            <div className={`od-result ${result.failed ? 'has-error' : ''}`}>
              <strong><Check size={14} /> 同步完成</strong>
              <p>扫描 {result.scanned} 个 · 新增 {result.imported} 个 · 更新 {result.updated} 个 · 跳过 {result.skipped} 个{result.failed ? ` · 失败 ${result.failed} 个` : ''}{result.truncated ? ' · 文件较多，已分批处理' : ''}</p>
              {result.results.filter((item) => item.status === 'failed').slice(0, 4).map((item) => (
                <small key={`${item.path}-${item.name}`}><AlertTriangle size={12} /> {item.name}：{item.error}</small>
              ))}
            </div>
          )}
        </div>
      )}
      {error && <div className="od-error"><AlertTriangle size={14} /> {error}</div>}
    </Modal>
  );
}
