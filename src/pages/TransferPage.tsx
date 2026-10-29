import { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft, ArrowRight, Check, ChevronRight, CircleAlert, CircleCheck, Database,
  Download, FileJson, FileSpreadsheet, FileUp, FolderSync, Info, LoaderCircle,
  LockKeyhole, ScanSearch, ShieldCheck, Sparkles, Upload, X,
} from 'lucide-react';
import { api, downloadBackup, downloadExport } from '../lib/api';
import { PLATFORM_LIST, PLATFORM_UI } from '../lib/platforms';
import type { Dashboard, ImportPreview, ImportResult, PlatformId } from '../lib/types';
import { cn, formatDate } from '../lib/utils';
import { PlatformMark } from '../components/PlatformMark';

type Tab = 'import' | 'export';

export function TransferPage({
  route, dashboard, notify, refreshVersion,
}: {
  route: string;
  dashboard: Dashboard | null;
  notify: (message: string, tone?: 'success' | 'error') => void;
  refreshVersion: number;
}) {
  const params = new URLSearchParams(route.split('?')[1] || '');
  const [tab, setTab] = useState<Tab>(params.get('tab') === 'export' ? 'export' : 'import');
  const [importPlatform, setImportPlatform] = useState<PlatformId>((params.get('platform') as PlatformId) || 'amap');
  const [exportPlatform, setExportPlatform] = useState<PlatformId>((params.get('platform') as PlatformId) || 'amap');
  const [format, setFormat] = useState('auto');
  const [content, setContent] = useState('');
  const [fileName, setFileName] = useState('');
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [defaultTags, setDefaultTags] = useState('');
  const [error, setError] = useState('');
  const [exportFormat, setExportFormat] = useState('csv');
  const [scope, setScope] = useState('all');
  const [backupBusy, setBackupBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const query = new URLSearchParams(route.split('?')[1] || '');
    if (query.get('tab') === 'export') setTab('export');
    if (query.get('tab') === 'import') setTab('import');
    if (query.get('platform') && PLATFORM_UI[query.get('platform') as PlatformId]) {
      setImportPlatform(query.get('platform') as PlatformId);
      setExportPlatform(query.get('platform') as PlatformId);
    }
    setPreview(null);
    setResult(null);
    setError('');
  }, [route]);

  useEffect(() => {
    const allowed = PLATFORM_UI[exportPlatform].exportFormats;
    if (!allowed.includes(exportFormat)) setExportFormat(allowed[0]);
  }, [exportPlatform, exportFormat]);

  useEffect(() => {
    setPreview(null);
    setResult(null);
    setContent('');
    setFileName('');
    setError('');
  }, [importPlatform]);

  const readFile = async (file: File) => {
    if (file.size > 12 * 1024 * 1024) { notify('文件不能超过 12MB', 'error'); return; }
    const text = await file.text();
    setContent(text);
    setFileName(file.name);
    setResult(null);
    setError('');
    await runPreview(text, file.name);
  };

  const runPreview = async (raw = content, name = fileName) => {
    if (!raw.trim()) { setError('请先选择文件或粘贴内容'); return; }
    setBusy(true);
    setError('');
    try {
      const data = await api.previewImport({ platform: importPlatform, fileName: name || 'pasted.txt', content: raw, format });
      setPreview(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : '解析失败');
      setPreview(null);
    } finally {
      setBusy(false);
    }
  };

  const commit = async () => {
    if (!content.trim()) return;
    setBusy(true);
    setError('');
    try {
      const tags = defaultTags.split(/[,，;；|、]/).map((tag) => tag.trim()).filter(Boolean);
      const data = await api.commitImport({ platform: importPlatform, fileName: fileName || 'pasted.txt', content, format, defaultTags: tags });
      setResult(data);
      setPreview(null);
      notify(`导入完成：新增 ${data.imported} 个，合并 ${data.merged} 个`);
      window.dispatchEvent(new CustomEvent('tuhe-refresh'));
    } catch (err) {
      setError(err instanceof Error ? err.message : '导入失败');
    } finally {
      setBusy(false);
    }
  };

  const doExport = async () => {
    setExporting(true);
    try {
      const name = await downloadExport({ platform: exportPlatform, format: exportFormat, scope });
      notify(`已导出 ${name}`);
      window.dispatchEvent(new CustomEvent('tuhe-refresh'));
    } catch (err) {
      notify(err instanceof Error ? err.message : '导出失败', 'error');
    } finally {
      setExporting(false);
    }
  };

  const backup = async () => {
    setBackupBusy(true);
    try {
      await downloadBackup();
      notify('完整数据备份已下载');
    } catch (err) {
      notify(err instanceof Error ? err.message : '备份失败', 'error');
    } finally {
      setBackupBusy(false);
    }
  };

;

  return (
    <div className="page transfer-page">
      <header className="page-header">
        <div>
          <p className="eyebrow">IMPORT & EXPORT</p>
          <h1>导入导出</h1>
          <p>把平台的收藏带进来，也可以按目标平台的坐标与格式带出去。</p>
        </div>
        <div className="transfer-tabs">
          <button className={cn(tab === 'import' && 'is-active')} onClick={() => setTab('import')}><Upload size={15} /> 导入</button>
          <button className={cn(tab === 'export' && 'is-active')} onClick={() => setTab('export')}><Download size={15} /> 导出</button>
        </div>
      </header>

      {tab === 'import' ? (
        <>
          <section className="transfer-platform-strip">
            <div>
              <p className="eyebrow">STEP 1 · SOURCE</p>
              <h2>选择收藏来自哪里</h2>
            </div>
            <div className="platform-selector">
              {PLATFORM_LIST.map((platform) => (
                <button key={platform.id} className={cn('platform-select-card', importPlatform === platform.id && 'is-selected')} onClick={() => setImportPlatform(platform.id)}>
                  <PlatformMark platform={platform} size={38} />
                  <span><strong>{platform.shortName}</strong><small>{platform.coordSystem}</small></span>
                  <i>{importPlatform === platform.id && <Check size={11} />}</i>
                </button>
              ))}
            </div>
          </section>

          <div className="transfer-layout">
            <section className="panel import-panel">
              <div className="panel-head">
                <div>
                  <p className="eyebrow">STEP 2 · FILE</p>
                  <h2>{result ? '导入结果' : preview ? '确认识别结果' : '上传收藏文件'}</h2>
                </div>
                {!preview && !result && (
                  <div className="format-select">
                    <span>格式</span>
                    <select value={format} onChange={(event) => setFormat(event.target.value)}>
                      <option value="auto">自动识别</option>
                      <option value="csv">CSV</option>
                      <option value="json">JSON</option>
                      <option value="kml">KML</option>
                      <option value="gpx">GPX</option>
                      <option value="text">纯文本</option>
                    </select>
                  </div>
                )}
              </div>

              {result ? (
                <div className="import-success">
                  <span className="success-check"><Check size={28} /></span>
                  <p className="eyebrow">IMPORT COMPLETE</p>
                  <h3>收藏已经收进来了。</h3>
                  <p>{result.fileName || '文本内容'} · {result.format.toUpperCase()} · {formatDate(result.createdAt, true)}</p>
                  <div className="import-result-stats">
                    <div><strong>{result.total}</strong><small>识别地点</small></div>
                    <div><strong>{result.imported}</strong><small>新地点</small></div>
                    <div><strong>{result.merged}</strong><small>合并重复</small></div>
                  </div>
                  <div className="success-actions">
                    <button className="btn btn-primary" onClick={() => { setResult(null); setContent(''); setFileName(''); }}>继续导入</button>
                    <button className="btn btn-ghost" onClick={() => setTab('export')}>去导出</button>
                  </div>
                </div>
              ) : preview ? (
                <div className="import-preview">
                  <div className="preview-summary">
                    <div><strong>{preview.total}</strong><small>识别</small></div>
                    <div><strong className="good">{preview.newCount}</strong><small>将新增</small></div>
                    <div><strong className="warn">{preview.duplicates}</strong><small>将合并</small></div>
                    <div><strong>{preview.located}</strong><small>含坐标</small></div>
                  </div>
                  <div className="preview-meta">
                    <span><FileJson size={14} /> {preview.format.toUpperCase()}</span>
                    <span><ScanSearch size={14} /> {preview.sourceSystems.join(' / ') || 'WGS84'}</span>
                    <span><ShieldCheck size={14} /> 自动去重 120m</span>
                  </div>
                  {preview.warnings.length > 0 && (
                    <div className="preview-warnings">
                      {preview.warnings.map((warning) => <p key={warning}><CircleAlert size={14} /> {warning}</p>)}
                    </div>
                  )}
                  <div className="preview-table-wrap">
                    <table className="preview-table">
                      <thead><tr><th>地点</th><th>地址</th><th>坐标</th><th>标签</th><th>状态</th></tr></thead>
                      <tbody>
                        {preview.preview.map((place, index) => (
                          <tr key={`${place.name}-${index}`}>
                            <td><strong>{place.name}</strong><small>{place.category}</small></td>
                            <td>{place.address || '—'}</td>
                            <td>{place.location ? `${place.location.lng.toFixed(3)}, ${place.location.lat.toFixed(3)}` : '—'}</td>
                            <td>{place.tags?.slice(0, 2).join(' / ') || '—'}</td>
                            <td>{place.duplicate ? <span className="status-pill warning"><i />合并</span> : <span className="status-pill success"><i />新增</span>}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="import-options">
                    <label className="field">
                      <span>为本次导入追加标签 <em>可选</em></span>
                      <input value={defaultTags} onChange={(event) => setDefaultTags(event.target.value)} placeholder="例如：2026 秋日旅行" />
                    </label>
                  </div>
                  <div className="preview-actions">
                    <button className="btn btn-ghost" onClick={() => setPreview(null)}><ArrowLeft size={15} /> 重新选择</button>
                    <button className="btn btn-primary" onClick={commit} disabled={busy}>{busy ? <LoaderCircle size={16} className="spin" /> : <Check size={16} />}{busy ? '正在导入…' : `确认导入 ${preview.total} 个地点`}</button>
                  </div>
                </div>
              ) : (
                <>
                  <div
                    className={cn('dropzone', dragging && 'is-dragging')}
                    onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
                    onDragLeave={() => setDragging(false)}
                    onDrop={(event) => { event.preventDefault(); setDragging(false); const file = event.dataTransfer.files?.[0]; if (file) readFile(file); }}
                    onClick={() => fileRef.current?.click()}
                  >
                    <input ref={fileRef} type="file" accept=".csv,.json,.kml,.gpx,.txt,.tsv" hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) readFile(file); event.target.value = ''; }} />
                    <span className="dropzone-icon"><FileUp size={25} /></span>
                    <h3>拖入文件，或点击选择</h3>
                    <p>支持 CSV、JSON、KML、GPX、TXT，最大 12MB</p>
                    <span className="dropzone-formats"><em>CSV</em><em>JSON</em><em>KML</em><em>GPX</em><em>TXT</em></span>
                  </div>
                  <div className="import-alternatives">
                    <button className="text-btn" onClick={() => setPasteOpen((value) => !value)}>{pasteOpen ? '收起文本粘贴' : '没有文件？直接粘贴文本'}<ChevronRight size={14} className={pasteOpen ? 'rotate' : ''} /></button>
                  </div>
                  {pasteOpen && (
                    <div className="paste-box">
                      <textarea rows={8} value={pasteText} onChange={(event) => setPasteText(event.target.value)} placeholder={'每行一个地点，或用空行分组：\n名称：沙溪古镇\n地址：云南省大理州剑川县沙溪镇\n坐标：99.8503, 26.3167'} />
                      <button className="btn btn-ghost small" onClick={() => { setContent(pasteText); setFileName('pasted.txt'); runPreview(pasteText, 'pasted.txt'); }} disabled={!pasteText.trim() || busy}>{busy ? '解析中…' : '解析文本'}</button>
                    </div>
                  )}
                  {fileName && <p className="selected-file"><FileJson size={14} /> {fileName}</p>}
                  {error && <p className="form-error">{error}</p>}
                </>
              )}
            </section>

            <aside className="transfer-side">
              <section className="panel source-guide">
                <div className="panel-head compact">
                  <div><p className="eyebrow">SOURCE GUIDE</p><h3>{PLATFORM_UI[importPlatform].name}</h3></div>
                  <PlatformMark platform={PLATFORM_UI[importPlatform]} size={36} />
                </div>
                <p>{PLATFORM_UI[importPlatform].docs}</p>
                <div className="coord-card">
                  <span>坐标系</span>
                  <strong>{PLATFORM_UI[importPlatform].coordSystem}</strong>
                  <ArrowRight size={14} />
                  <span>统一为</span>
                  <strong>WGS84</strong>
                </div>
                <ul className="guide-list">
                  <li><CircleCheck size={14} /> 自动识别常见中英文字段名</li>
                  <li><CircleCheck size={14} /> 120 米范围内同名地点自动合并</li>
                  <li><CircleCheck size={14} /> 缺少坐标的地点仍会保留</li>
                </ul>
                <div className="format-chips">{PLATFORM_UI[importPlatform].importFormats.map((item) => <span key={item}>{item.toUpperCase()}</span>)}</div>
              </section>
              <section className="import-tip">
                <Sparkles size={18} />
                <div><strong>导入不会改动原平台</strong><p>途合只读取你上传的文件。合并与标签修改都发生在本地地点库。</p></div>
              </section>
            </aside>
          </div>
        </>
      ) : (
        <div className="transfer-layout export-layout">
          <section className="panel export-panel">
            <div className="panel-head">
              <div><p className="eyebrow">EXPORT PACKAGE</p><h2>生成平台同步包</h2></div>
              <span className="guide-badge"><LockKeyhole size={14} /> 本地生成</span>
            </div>
            <div className="export-section">
              <label className="section-label">目标平台</label>
              <div className="platform-selector export">
                {PLATFORM_LIST.map((platform) => (
                  <button key={platform.id} className={cn('platform-select-card', exportPlatform === platform.id && 'is-selected')} onClick={() => setExportPlatform(platform.id)}>
                    <PlatformMark platform={platform} size={36} />
                    <span><strong>{platform.shortName}</strong><small>{platform.coordSystem}</small></span>
                    <i>{exportPlatform === platform.id && <Check size={11} />}</i>
                  </button>
                ))}
              </div>
            </div>
            <div className="export-section two-col">
              <div>
                <label className="section-label">文件格式</label>
                <div className="format-options">
                  {PLATFORM_UI[exportPlatform].exportFormats.map((item) => (
                    <button key={item} className={cn(exportFormat === item && 'is-active')} onClick={() => setExportFormat(item)}>
                      {item === 'csv' ? <FileSpreadsheet size={16} /> : item === 'kml' ? <Database size={16} /> : <FileJson size={16} />}
                      {item.toUpperCase()}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="section-label">导出范围</label>
                <select className="full-select" value={scope} onChange={(event) => setScope(event.target.value)}>
                  <option value="all">全部地点</option>
                  <option value="synced">已同步到该平台</option>
                  <option value="located">仅含坐标地点</option>
                </select>
              </div>
            </div>
            <div className="export-summary">
              <div><strong>{dashboard?.stats.total ?? 0}</strong><small>地点库总数</small></div>
              <div><strong>{dashboard?.stats.located ?? 0}</strong><small>可导出坐标</small></div>
              <div><strong>{PLATFORM_UI[exportPlatform].coordSystem}</strong><small>目标坐标</small></div>
            </div>
            <div className="export-note">
              <Info size={16} />
              <p>导出会按 {PLATFORM_UI[exportPlatform].name} 的坐标体系重新计算经纬度，并生成带 BOM 的文件，避免中文乱码。</p>
            </div>
            <button className="btn btn-primary export-button" onClick={doExport} disabled={exporting}>
              {exporting ? <LoaderCircle size={16} className="spin" /> : <Download size={16} />}{exporting ? '正在生成…' : `导出 ${exportFormat.toUpperCase()} 文件`}
            </button>
          </section>

          <aside className="transfer-side">
            <section className="panel coordinate-card">
              <p className="eyebrow">COORDINATE MAPPING</p>
              <h3>坐标转换已经做好</h3>
              <div className="coord-map">
                <span>WGS84</span><ArrowRight size={14} /><strong style={{ color: PLATFORM_UI[exportPlatform].color }}>{PLATFORM_UI[exportPlatform].coordSystem}</strong>
              </div>
              <p>统一地点库以 WGS84 保存。导出到高德时转 GCJ-02，百度转 BD-09，圆周旅迹转 GCJ-02。</p>
            </section>
            <section className="panel backup-card">
              <span className="backup-icon"><FolderSync size={21} /></span>
              <div><strong>完整数据备份</strong><p>下载包含地点、连接与任务记录的 JSON 数据库。</p></div>
              <button className="btn btn-ghost small" onClick={backup} disabled={backupBusy}>{backupBusy ? '准备中…' : '下载备份'}</button>
            </section>
            <section className="import-tip">
              <ShieldCheck size={18} />
              <div><strong>导出不会触碰平台账号</strong><p>生成的文件可手动上传，或交给你的自动化脚本继续处理。</p></div>
            </section>
          </aside>
        </div>
      )}
    </div>
  );
}
