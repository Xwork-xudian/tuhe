const TENANT = process.env.ONEDRIVE_TENANT || 'common';
const CLIENT_ID = process.env.ONEDRIVE_CLIENT_ID || '';
const CLIENT_SECRET = process.env.ONEDRIVE_CLIENT_SECRET || '';
const SCOPES = process.env.ONEDRIVE_SCOPES || 'Files.Read offline_access';
export const ONEDRIVE_REDIRECT_URI = process.env.ONEDRIVE_REDIRECT_URI || 'http://localhost:53682/';
const TOKEN_URL = `https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/token`;
const AUTH_URL = `https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/authorize`;
const GRAPH = 'https://graph.microsoft.com/v1.0';
const SUPPORTED = new Set(['gpx', 'kml', 'geojson', 'json', 'csv', 'txt', 'fwss', 'fwdb']);

function fail(message, status = 502) {
  return Object.assign(new Error(message), { status });
}

export function oneDriveClientId() { return CLIENT_ID; }

export function buildOneDriveAuthUrl(state) {
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    response_type: 'code',
    redirect_uri: ONEDRIVE_REDIRECT_URI,
    response_mode: 'query',
    scope: SCOPES,
    state,
    prompt: 'select_account',
  });
  return `${AUTH_URL}?${params.toString()}`;
}

async function tokenRequest(params) {
  const body = new URLSearchParams({ client_id: CLIENT_ID, ...params });
  if (CLIENT_SECRET) body.set('client_secret', CLIENT_SECRET);
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    signal: AbortSignal.timeout(30000),
  });
  const text = await response.text();
  let payload = null;
  try { payload = JSON.parse(text); } catch { /* ignore */ }
  if (!response.ok || !payload?.access_token) {
    const message = payload?.error_description || payload?.error || text.slice(0, 200) || `令牌接口返回 ${response.status}`;
    throw fail(`Microsoft 登录失败：${message}`, response.status === 400 ? 400 : 502);
  }
  return {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token || '',
    expiresAt: Date.now() + Math.max(60, Number(payload.expires_in) || 3600) * 1000,
    scope: payload.scope || SCOPES,
    tokenType: payload.token_type || 'Bearer',
  };
}

export function exchangeOneDriveCode(code) {
  return tokenRequest({
    grant_type: 'authorization_code',
    code,
    redirect_uri: ONEDRIVE_REDIRECT_URI,
    scope: SCOPES,
  });
}

export function refreshOneDriveToken(refreshToken) {
  return tokenRequest({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    redirect_uri: ONEDRIVE_REDIRECT_URI,
    scope: SCOPES,
  });
}

export async function graphRequest(accessToken, pathOrUrl, options = {}) {
  const url = pathOrUrl.startsWith('http') ? pathOrUrl : `${GRAPH}${pathOrUrl}`;
  const response = await fetch(url, {
    ...options,
    headers: { Authorization: `Bearer ${accessToken}`, ...(options.headers || {}) },
    signal: AbortSignal.timeout(45000),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw fail(`Microsoft Graph 返回 ${response.status}：${text.slice(0, 180)}`, response.status === 401 ? 401 : 502);
  }
  return response;
}

export async function graphJson(accessToken, pathOrUrl) {
  const response = await graphRequest(accessToken, pathOrUrl);
  return response.json();
}

export async function getOneDriveProfile(accessToken) {
  const drive = await graphJson(accessToken, '/me/drive?$select=id,driveType,owner,quota');
  const owner = drive.owner?.user || {};
  return {
    accountId: owner.id || '',
    accountName: owner.displayName || owner.email || 'OneDrive',
    accountEmail: owner.email || '',
    driveId: drive.id || '',
    driveType: drive.driveType || '',
  };
}

function normalizeFolderPath(value) {
  return String(value || '')
    .replace(/\\/g, '/')
    .split('/')
    .map((part) => part.trim())
    .filter(Boolean)
    .join('/');
}

function childrenUrl(folderPath) {
  const cleanPath = normalizeFolderPath(folderPath);
  const encoded = cleanPath.split('/').filter(Boolean).map(encodeURIComponent).join('/');
  const base = encoded ? `/me/drive/root:/${encoded}:/children` : '/me/drive/root/children';
  return `${base}?$top=200&$select=id,name,size,file,folder,lastModifiedDateTime,eTag,parentReference`;
}

export function extensionOf(name) {
  const match = String(name || '').match(/\.([A-Za-z0-9]+)$/);
  return match ? match[1].toLowerCase() : '';
}

export function isSupportedOneDriveFile(name) {
  return SUPPORTED.has(extensionOf(name));
}

export async function listOneDriveFolder(accessToken, folderPath = '') {
  let url = childrenUrl(folderPath);
  const items = [];
  while (url && items.length < 2000) {
    const payload = await graphJson(accessToken, url);
    items.push(...(payload.value || []));
    url = payload['@odata.nextLink'] || '';
  }
  const folders = [];
  const files = [];
  for (const item of items) {
    if (item.folder) {
      folders.push({
        id: item.id,
        name: item.name,
        childCount: item.folder.childCount || 0,
        modifiedAt: item.lastModifiedDateTime || null,
      });
    } else if (item.file) {
      files.push({
        id: item.id,
        name: item.name,
        size: Number(item.size) || 0,
        modifiedAt: item.lastModifiedDateTime || null,
        eTag: item.eTag || '',
        extension: extensionOf(item.name),
        supported: isSupportedOneDriveFile(item.name),
      });
    }
  }
  folders.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
  files.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
  return { path: normalizeFolderPath(folderPath), folders, files };
}

export async function downloadOneDriveFile(accessToken, itemId) {
  const response = await graphRequest(accessToken, `/me/drive/items/${encodeURIComponent(itemId)}/content`, { redirect: 'follow' });
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > 25 * 1024 * 1024) throw fail('文件超过 25MB，已跳过', 400);
  return buffer;
}
