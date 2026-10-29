import type {
  Activity, Connection, Dashboard, FootprintDetail, FootprintList, FootprintSummary,
  ImportPreview, ImportResult, Place, PlaceDraft, PlacesResponse, PlatformId, SyncJob,
} from './types';

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...options,
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {}),
    },
  });
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    if (!response.ok) throw new Error(`请求失败（${response.status}）`);
    return response as unknown as T;
  }
  const payload = await response.json();
  if (!response.ok || payload.ok === false) throw new Error(payload.error || `请求失败（${response.status}）`);
  return payload.data as T;
}

function queryString(params: Record<string, string | number | undefined | null>) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') search.set(key, String(value));
  }
  return search.toString();
}

export const api = {
  dashboard: () => request<Dashboard>('/api/dashboard'),
  places: (params: Record<string, string | number | undefined | null>) => request<PlacesResponse>(`/api/places?${queryString(params)}`),
  createPlace: (draft: PlaceDraft) => request<Place>('/api/places', { method: 'POST', body: JSON.stringify(draft) }),
  updatePlace: (id: string, draft: PlaceDraft) => request<Place>(`/api/places/${id}`, { method: 'PATCH', body: JSON.stringify(draft) }),
  deletePlaces: (ids: string[]) => request<{ count: number }>('/api/places', { method: 'DELETE', body: JSON.stringify({ ids }) }),
  bulkTag: (ids: string[], tag: string, mode: 'add' | 'remove' = 'add') => request<{ count: number }>('/api/places/bulk-tag', { method: 'POST', body: JSON.stringify({ ids, tag, mode }) }),
  previewImport: (body: { platform: PlatformId; fileName: string; content: string; format?: string }) => request<ImportPreview>('/api/import/preview', { method: 'POST', body: JSON.stringify(body) }),
  commitImport: (body: { platform: PlatformId; fileName: string; content: string; format?: string; defaultTags?: string[] }) => request<ImportResult>('/api/import/commit', { method: 'POST', body: JSON.stringify(body) }),
  connections: () => request<Connection[]>('/api/connections'),
  updateConnection: (id: PlatformId, body: Partial<Pick<Connection, 'enabled' | 'mode' | 'webhookUrl'> & { token: string }>) => request<Connection>(`/api/connections/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  testConnection: (id: PlatformId) => request<{ status: number; response: string }>(`/api/connections/${id}/test`, { method: 'POST', body: '{}' }),
  startSync: (body: { placeIds?: string[]; platforms: PlatformId[]; scope?: string; strategy?: string }) => request<SyncJob>('/api/sync', { method: 'POST', body: JSON.stringify(body) }),
  pullConnection: (id: PlatformId, commit: boolean) => request<import('./types').PullPreview | import('./types').PullResult>(`/api/connections/${id}/pull`, { method: 'POST', body: JSON.stringify({ commit }) }),
  pullAllConnections: (platforms?: PlatformId[]) => request<import('./types').PullAllResult>('/api/connections/pull-all', { method: 'POST', body: JSON.stringify({ platforms }) }),
  jobs: () => request<SyncJob[]>('/api/jobs'),
  job: (id: string) => request<SyncJob>(`/api/jobs/${id}`),
  jobBridgeLogs: (id: string) => request<{ logs: import('./types').BridgeLog[]; warning?: string }>(`/api/jobs/${id}/bridge-logs`),
  getFootprints: () => request<FootprintList>('/api/footprints'),
  getFootprint: (id: string) => request<FootprintDetail>(`/api/footprints/${id}`),
  importFootprint: (body: { name?: string; fileName: string; content?: string; contentBase64?: string; format?: string }) => request<FootprintSummary>('/api/footprints/import', { method: 'POST', body: JSON.stringify(body) }),
  oneDriveStatus: () => request<import('./types').OneDriveStatus>('/api/onedrive/status'),
  oneDriveAuthStart: () => request<{ url: string; state: string; redirectUri: string }>('/api/onedrive/auth/start', { method: 'POST', body: '{}' }),
  oneDriveAuthComplete: (body: { redirectUrl?: string; code?: string; state?: string }) => request<import('./types').OneDriveStatus>('/api/onedrive/auth/complete', { method: 'POST', body: JSON.stringify(body) }),
  oneDriveDisconnect: () => request<import('./types').OneDriveStatus>('/api/onedrive/disconnect', { method: 'POST', body: '{}' }),
  oneDriveItems: (path: string) => request<import('./types').OneDriveListing>(`/api/onedrive/items?${queryString({ path })}`),
  oneDriveSync: (path: string) => request<import('./types').OneDriveSyncResult>('/api/onedrive/sync', { method: 'POST', body: JSON.stringify({ path }) }),
  renameFootprint: (id: string, name: string) => request<FootprintSummary>(`/api/footprints/${id}`, { method: 'PATCH', body: JSON.stringify({ name }) }),
  deleteFootprint: (id: string) => request<{ count: number }>(`/api/footprints/${id}`, { method: 'DELETE' }),
  activities: () => request<Activity[]>('/api/activities'),
  createBackup: () => request<{ file: string; createdAt: string }>('/api/backup', { method: 'POST', body: '{}' }),
};

export async function downloadExport(options: { platform: PlatformId; format: string; scope: string; ids?: string[] }) {
  const response = await fetch(`/api/export?${queryString({ ...options, ids: options.ids?.join(',') })}`);
  if (!response.ok) {
    let message = '导出失败';
    try { const data = await response.json(); message = data.error || message; } catch { /* ignore */ }
    throw new Error(message);
  }
  const blob = await response.blob();
  const disposition = response.headers.get('content-disposition') || '';
  const encoded = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  const plain = disposition.match(/filename="([^"]+)"/i)?.[1];
  const filename = encoded ? decodeURIComponent(encoded) : plain || `tuhe-export.${options.format}`;
  triggerDownload(blob, filename);
  return filename;
}

export async function downloadBackup() {
  const response = await fetch('/api/backup/download');
  if (!response.ok) throw new Error('备份下载失败');
  const blob = await response.blob();
  triggerDownload(blob, `tuhe-backup-${new Date().toISOString().slice(0, 10)}.json`);
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
