// Google Sheets client — service account.
// ----------------------------------------------------------------
// Used by Hailey for the financial ledger sync:
//   - parse_estimate appends line items to "Estimates" sheet
//   - When QuickBooks invoices land, totals get appended to "Invoices"
//   - Hailey can read any range to answer "what's our gross this month?"
//
// All operations target the spreadsheet at GOOGLE_SHEETS_LEDGER_ID.
// The sheet must be SHARED with the service account as Editor.
// (Done — confirmed by Perplexity Computer for "CMBF 2026-2027" sheet.)

import { getAccessToken } from './google-auth.js';

const SCOPES = ['https://www.googleapis.com/auth/spreadsheets'];
const SHEET_ID = process.env.GOOGLE_SHEETS_LEDGER_ID || null;

// ----------------------------------------------------------------
// readRange — get values from a sheet range
//   range: 'Sheet1!A1:Z100' or 'Estimates' (whole sheet)
// Returns: 2D array of cell values
// ----------------------------------------------------------------
export async function readRange(range, { sheetId = null } = {}) {
  const token = await getAccessToken(SCOPES);
  const sid = sheetId || SHEET_ID;
  if (!sid) throw new Error('No sheetId provided and GOOGLE_SHEETS_LEDGER_ID not set');

  const url = new URL(`https://sheets.googleapis.com/v4/spreadsheets/${sid}/values/${encodeURIComponent(range)}`);
  url.searchParams.set('valueRenderOption', 'UNFORMATTED_VALUE');
  const res = await fetch(url, { headers: { 'authorization': `Bearer ${token}` } });
  if (!res.ok) throw new Error(`sheets read ${res.status}: ${await res.text().then(t => t.slice(0, 200))}`);
  const data = await res.json();
  return data.values || [];
}

// ----------------------------------------------------------------
// appendRows — append rows to a sheet (auto-detects last row)
//   range: 'Sheet1!A1' (or just 'Sheet1' to append to the whole tab)
//   values: 2D array of cell values
// ----------------------------------------------------------------
export async function appendRows(range, values, { sheetId = null, valueInputOption = 'USER_ENTERED' } = {}) {
  if (!Array.isArray(values) || !values.length) {
    return { ok: false, reason: 'no_values' };
  }
  const token = await getAccessToken(SCOPES);
  const sid = sheetId || SHEET_ID;
  if (!sid) throw new Error('No sheetId provided and GOOGLE_SHEETS_LEDGER_ID not set');

  const url = new URL(`https://sheets.googleapis.com/v4/spreadsheets/${sid}/values/${encodeURIComponent(range)}:append`);
  url.searchParams.set('valueInputOption', valueInputOption);
  url.searchParams.set('insertDataOption', 'INSERT_ROWS');
  url.searchParams.set('includeValuesInResponse', 'true');

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'authorization': `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ values }),
  });
  if (!res.ok) throw new Error(`sheets append ${res.status}: ${await res.text().then(t => t.slice(0, 200))}`);
  const data = await res.json();
  return {
    ok: true,
    updates: data.updates,
    appended_range: data.updates?.updatedRange,
    appended_rows: data.updates?.updatedRows,
  };
}

// ----------------------------------------------------------------
// updateRange — overwrite a specific range
// ----------------------------------------------------------------
export async function updateRange(range, values, { sheetId = null, valueInputOption = 'USER_ENTERED' } = {}) {
  const token = await getAccessToken(SCOPES);
  const sid = sheetId || SHEET_ID;
  if (!sid) throw new Error('No sheetId provided and GOOGLE_SHEETS_LEDGER_ID not set');

  const url = new URL(`https://sheets.googleapis.com/v4/spreadsheets/${sid}/values/${encodeURIComponent(range)}`);
  url.searchParams.set('valueInputOption', valueInputOption);
  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      'authorization': `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ values }),
  });
  if (!res.ok) throw new Error(`sheets update ${res.status}: ${await res.text().then(t => t.slice(0, 200))}`);
  return res.json();
}

// ----------------------------------------------------------------
// listTabs — list all worksheet tabs in the spreadsheet
// ----------------------------------------------------------------
export async function listTabs({ sheetId = null } = {}) {
  const token = await getAccessToken(SCOPES);
  const sid = sheetId || SHEET_ID;
  const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sid}?fields=sheets(properties(sheetId,title,index))`, {
    headers: { 'authorization': `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`sheets meta ${res.status}`);
  const data = await res.json();
  return (data.sheets || []).map((s) => s.properties);
}

// ----------------------------------------------------------------
// ensureTab — create a tab if it doesn't exist (idempotent)
// ----------------------------------------------------------------
export async function ensureTab(title, { sheetId = null, headers = null } = {}) {
  const token = await getAccessToken(SCOPES);
  const sid = sheetId || SHEET_ID;
  const tabs = await listTabs({ sheetId: sid });
  const existing = tabs.find((t) => t.title === title);
  if (existing) return existing;

  // Add the tab
  const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sid}:batchUpdate`, {
    method: 'POST',
    headers: {
      'authorization': `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      requests: [{ addSheet: { properties: { title } } }],
    }),
  });
  if (!res.ok) throw new Error(`sheets addSheet ${res.status}`);
  const result = await res.json();
  const newTab = result.replies?.[0]?.addSheet?.properties;

  // Optionally seed headers
  if (headers && newTab) {
    await appendRows(`${title}!A1`, [headers], { sheetId: sid });
  }
  return newTab;
}

// ----------------------------------------------------------------
// healthCheck
// ----------------------------------------------------------------
export async function healthCheck() {
  if (!process.env.GA_SERVICE_ACCOUNT_KEY_B64) {
    return { ok: false, configured: false, reason: 'no_service_account' };
  }
  if (!SHEET_ID) {
    return { ok: false, configured: false, reason: 'no_sheet_id' };
  }
  const start = Date.now();
  try {
    await listTabs();
    return { ok: true, configured: true, latency_ms: Date.now() - start };
  } catch (err) {
    return { ok: false, configured: true, latency_ms: Date.now() - start, error: err.message?.slice(0, 200) };
  }
}
