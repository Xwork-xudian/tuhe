import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { paths } from './store.js';

const KEY_FILE = path.join(paths.DATA_DIR, '.tuhe-key');
let cachedKey = null;

function key() {
  if (cachedKey) return cachedKey;
  try {
    if (fs.existsSync(KEY_FILE)) {
      cachedKey = Buffer.from(fs.readFileSync(KEY_FILE, 'utf8').trim(), 'base64');
    }
  } catch { /* regenerate below */ }
  if (!cachedKey || cachedKey.length !== 32) {
    cachedKey = crypto.randomBytes(32);
    fs.mkdirSync(path.dirname(KEY_FILE), { recursive: true });
    fs.writeFileSync(KEY_FILE, cachedKey.toString('base64'), { mode: 0o600 });
  }
  return cachedKey;
}

export function seal(value) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const data = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
  return {
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    data: data.toString('base64'),
  };
}

export function unseal(payload) {
  if (!payload?.data) return '';
  const decipher = crypto.createDecipheriv('aes-256-gcm', key(), Buffer.from(payload.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(payload.tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(payload.data, 'base64')), decipher.final()]).toString('utf8');
}
