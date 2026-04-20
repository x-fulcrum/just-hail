/**
 * Just Hail — Online Web Form handler + Admin data feed
 * Deploy as: Web app, Execute as Me, Access: Anyone
 * Paste the deployment URL into form.jsx → SHEET_ENDPOINT
 *                                and admin.html → ENDPOINT
 */

// ==============================================================
// SHARED SECRET — change this to anything you like.
// Same value must be in admin.html → ADMIN_KEY
// ==============================================================
const ADMIN_KEY = 'jh-leander-2026';

// Column order — rearrange here to reorder the sheet.
const COLUMNS = [
  'Submitted At',
  'Reference #',
  'Name',
  'Email',
  'Phone',
  'ZIP',
  'Vehicle',
  'Year',
  'Damage',
  'Insurer',
  'Severity',
  'Severity Label',
  'Estimated Range',
  'Timeline',
  'Notes',
  'Source',
  'User Agent',
  'Status',
];

// Optional: set an email to receive alerts on every submission.
const ALERT_EMAIL = '';

function doPost(e) {
  try {
    const payload = JSON.parse(e.postData.contents);
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();

    if (sheet.getLastRow() === 0) {
      sheet.appendRow(COLUMNS);
      sheet.getRange(1, 1, 1, COLUMNS.length)
        .setFontWeight('bold')
        .setBackground('#0a0b10')
        .setFontColor('#f5f3ee');
      sheet.setFrozenRows(1);
    }

    const row = [
      new Date(payload.submittedAt || Date.now()),
      payload.referenceNumber || '',
      payload.name || '',
      payload.email || '',
      payload.phone || '',
      payload.zip || '',
      payload.vehicle || '',
      payload.year || '',
      payload.damage || '',
      payload.insurer || '',
      payload.severity || '',
      payload.severityLabel || '',
      payload.estimatedRange || '',
      payload.timeline || '',
      payload.notes || '',
      payload.source || '',
      payload.userAgent || '',
      'New',
    ];
    sheet.appendRow(row);

    if (ALERT_EMAIL) {
      const subject = `New estimate request — ${payload.name} (${payload.referenceNumber})`;
      const body = [
        `New estimate request.`, ``,
        `Reference: ${payload.referenceNumber}`,
        `Name: ${payload.name}`,
        `Phone: ${payload.phone}`,
        `Email: ${payload.email}`,
        `ZIP: ${payload.zip}`, ``,
        `Vehicle: ${payload.year} ${payload.vehicle}`,
        `Insurer: ${payload.insurer || '—'}`,
        `Damage: ${payload.damage || '—'}`,
        `Severity: ${payload.severityLabel} (${payload.estimatedRange})`,
        `Timeline: ${payload.timeline}`, ``,
        `Notes: ${payload.notes || '(none)'}`, ``,
        `Sheet: ${SpreadsheetApp.getActiveSpreadsheet().getUrl()}`,
      ].join('\n');
      MailApp.sendEmail(ALERT_EMAIL, subject, body);
    }

    return ContentService
      .createTextOutput(JSON.stringify({ ok: true, ref: payload.referenceNumber }))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let errSheet = ss.getSheetByName('_errors');
    if (!errSheet) errSheet = ss.insertSheet('_errors');
    errSheet.appendRow([new Date(), err.toString(), e.postData ? e.postData.contents : '(no body)']);
    return ContentService
      .createTextOutput(JSON.stringify({ ok: false, error: err.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

/**
 * doGet — used by admin.html to fetch all leads as JSON.
 * Requires ?key=ADMIN_KEY. Supports JSONP via ?callback= for CORS-free fetch.
 */
function doGet(e) {
  const params = e && e.parameter ? e.parameter : {};
  const callback = params.callback;

  // Auth check
  if (params.key !== ADMIN_KEY) {
    const body = JSON.stringify({ ok: false, error: 'unauthorized' });
    return respond_(body, callback);
  }

  try {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
    const lastRow = sheet.getLastRow();
    const lastCol = sheet.getLastColumn();
    if (lastRow < 2) {
      return respond_(JSON.stringify({ ok: true, leads: [] }), callback);
    }

    const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
    const rows = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();

    const leads = rows.map((r, idx) => {
      const obj = { _row: idx + 2 };
      headers.forEach((h, i) => {
        const key = String(h).replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_|_$/g, '').toLowerCase();
        let v = r[i];
        if (v instanceof Date) v = v.toISOString();
        obj[key] = v;
      });
      return obj;
    });

    return respond_(JSON.stringify({ ok: true, leads: leads, fetchedAt: new Date().toISOString() }), callback);
  } catch (err) {
    return respond_(JSON.stringify({ ok: false, error: err.toString() }), callback);
  }
}

function respond_(body, callback) {
  if (callback) {
    return ContentService
      .createTextOutput(callback + '(' + body + ');')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService
    .createTextOutput(body)
    .setMimeType(ContentService.MimeType.JSON);
}
