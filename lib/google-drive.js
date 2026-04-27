// Google Drive client — service account.
// ----------------------------------------------------------------
// Used by Hailey's parse_estimate pipeline:
//   1. Charlie drag-drops a PDF in chat → uploaded to /api/admin/parse-estimate
//   2. Claude vision parses it
//   3. Original file lands in this Drive folder via uploadFile()
//   4. Sheet line-items appended via lib/google-sheets.js
//   5. (Phase 3) QuickBooks invoice created
//
// All operations use the service account configured in
// GA_SERVICE_ACCOUNT_KEY_B64. The target folder must be SHARED with
// `ga-reader@just-hail-website.iam.gserviceaccount.com` as Editor.
// (The Perplexity Computer prompt walked through this — confirmed
// done for the CMBF 2026-2027 folder.)

import { getAccessToken } from './google-auth.js';

const SCOPES = ['https://www.googleapis.com/auth/drive'];
const ROOT = process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID || null;

// ----------------------------------------------------------------
// uploadFile — multipart upload with metadata
// ----------------------------------------------------------------
// content: Buffer | string
// mimeType: 'application/pdf', 'image/png', etc.
// folderId: defaults to GOOGLE_DRIVE_ROOT_FOLDER_ID
// Returns: { id, webViewLink, webContentLink, name, mimeType, size }
// ----------------------------------------------------------------
export async function uploadFile({ filename, content, mimeType, folderId = null, description = null }) {
  if (!filename) throw new Error('filename required');
  if (!content)  throw new Error('content (Buffer or string) required');
  if (!mimeType) throw new Error('mimeType required');

  const token = await getAccessToken(SCOPES);
  const targetFolder = folderId || ROOT;
  if (!targetFolder) throw new Error('No folderId provided and GOOGLE_DRIVE_ROOT_FOLDER_ID not set');

  const metadata = {
    name: filename,
    mimeType,
    parents: [targetFolder],
    ...(description ? { description } : {}),
  };

  const boundary = 'jh-drive-' + Math.random().toString(36).slice(2);
  const parts = [];
  parts.push(`--${boundary}\r\n`);
  parts.push(`Content-Type: application/json; charset=UTF-8\r\n\r\n`);
  parts.push(JSON.stringify(metadata));
  parts.push(`\r\n--${boundary}\r\n`);
  parts.push(`Content-Type: ${mimeType}\r\n\r\n`);

  // Build the multipart body as a Buffer (so binary content is preserved)
  const head = Buffer.from(parts.join(''), 'utf8');
  const body = Buffer.isBuffer(content) ? content : Buffer.from(content);
  const tail = Buffer.from(`\r\n--${boundary}--`, 'utf8');
  const full = Buffer.concat([head, body, tail]);

  const url = new URL('https://www.googleapis.com/upload/drive/v3/files');
  url.searchParams.set('uploadType', 'multipart');
  url.searchParams.set('fields', 'id,name,mimeType,size,webViewLink,webContentLink,parents');
  url.searchParams.set('supportsAllDrives', 'true');

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'authorization': `Bearer ${token}`,
      'content-type': `multipart/related; boundary=${boundary}`,
      'content-length': String(full.length),
    },
    body: full,
  });

  if (!res.ok) {
    const t = await res.text();
    throw new Error(`drive upload ${res.status}: ${t.slice(0, 300)}`);
  }
  return res.json();
}

// ----------------------------------------------------------------
// listFiles — list files in a folder
// ----------------------------------------------------------------
export async function listFiles({ folderId = null, query = null, pageSize = 50 } = {}) {
  const token = await getAccessToken(SCOPES);
  const folder = folderId || ROOT;
  const q = [
    folder ? `'${folder}' in parents` : null,
    'trashed=false',
    query || null,
  ].filter(Boolean).join(' and ');

  const url = new URL('https://www.googleapis.com/drive/v3/files');
  url.searchParams.set('q', q);
  url.searchParams.set('pageSize', String(pageSize));
  url.searchParams.set('fields', 'files(id,name,mimeType,size,webViewLink,createdTime,modifiedTime)');
  url.searchParams.set('supportsAllDrives', 'true');
  url.searchParams.set('includeItemsFromAllDrives', 'true');

  const res = await fetch(url, { headers: { 'authorization': `Bearer ${token}` } });
  if (!res.ok) throw new Error(`drive list ${res.status}: ${await res.text().then(t => t.slice(0, 200))}`);
  return (await res.json()).files || [];
}

// ----------------------------------------------------------------
// getFile — fetch a file's content (returns Buffer)
// ----------------------------------------------------------------
export async function getFile(fileId) {
  const token = await getAccessToken(SCOPES);
  const url = new URL(`https://www.googleapis.com/drive/v3/files/${fileId}`);
  url.searchParams.set('alt', 'media');
  url.searchParams.set('supportsAllDrives', 'true');
  const res = await fetch(url, { headers: { 'authorization': `Bearer ${token}` } });
  if (!res.ok) throw new Error(`drive get ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

// ----------------------------------------------------------------
// createFolder — make a subfolder
// ----------------------------------------------------------------
export async function createFolder({ name, parentId = null }) {
  const token = await getAccessToken(SCOPES);
  const body = {
    name,
    mimeType: 'application/vnd.google-apps.folder',
    parents: [parentId || ROOT].filter(Boolean),
  };
  const url = new URL('https://www.googleapis.com/drive/v3/files');
  url.searchParams.set('fields', 'id,name,webViewLink,parents');
  url.searchParams.set('supportsAllDrives', 'true');
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'authorization': `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`drive folder ${res.status}: ${await res.text().then(t => t.slice(0, 200))}`);
  return res.json();
}

// ----------------------------------------------------------------
// healthCheck
// ----------------------------------------------------------------
export async function healthCheck() {
  if (!process.env.GA_SERVICE_ACCOUNT_KEY_B64) {
    return { ok: false, configured: false, reason: 'no_service_account' };
  }
  if (!ROOT) {
    return { ok: false, configured: false, reason: 'no_root_folder_id' };
  }
  const start = Date.now();
  try {
    await listFiles({ pageSize: 1 });
    return { ok: true, configured: true, latency_ms: Date.now() - start };
  } catch (err) {
    return { ok: false, configured: true, latency_ms: Date.now() - start, error: err.message?.slice(0, 200) };
  }
}
