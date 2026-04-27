// POST /api/admin/parse-estimate
// ----------------------------------------------------------------
// Drag-drop an insurance estimate (PDF / image) → Claude Vision
// extracts structured data → uploaded to Drive → row inserted in
// `documents` → line items appended to Sheets ledger.
//
// Body: multipart/form-data with one or more files.
//   Optional fields: lead_id, drip_campaign_id, kind ('insurance_estimate'|'invoice'|'photo')
//
// For now, we accept JSON with base64 file content too (simpler from
// Hailey's chat panel). Production-ready would use formidable for
// real multipart streaming.

import Anthropic from '@anthropic-ai/sdk';
import { supabase } from '../../lib/supabase.js';
import { uploadFile as driveUpload } from '../../lib/google-drive.js';
import { appendRows, ensureTab } from '../../lib/google-sheets.js';

const anthropic = new Anthropic();

export const config = { api: { bodyParser: { sizeLimit: '12mb' } }, maxDuration: 60 };

const ESTIMATE_SCHEMA_PROMPT = `
Extract these fields from the attached insurance estimate / invoice.
Return ONLY a JSON object — no preamble, no markdown.

{
  "claim_number":     "string or null",
  "carrier_name":     "string or null (e.g. Allstate, State Farm)",
  "policy_number":    "string or null",
  "deductible":       number or null,
  "loss_date":        "YYYY-MM-DD or null (date of incident)",
  "estimate_date":    "YYYY-MM-DD or null (date estimate was prepared)",
  "vehicle": {
    "year":  number or null,
    "make":  "string or null",
    "model": "string or null",
    "vin":   "string or null"
  },
  "owner": {
    "name":    "string or null",
    "address": "string or null",
    "phone":   "string or null",
    "email":   "string or null"
  },
  "line_items": [
    { "description": "string", "operation": "R&I|REPAIR|REFINISH|REPLACE|DIAG|...", "labor_hours": number, "labor_rate": number, "parts_cost": number, "paint_cost": number, "total": number }
  ],
  "totals": {
    "labor":       number,
    "parts":       number,
    "paint":       number,
    "tax":         number,
    "subtotal":    number,
    "deductible":  number,
    "net_to_shop": number,
    "grand_total": number
  },
  "notes": "any free-text notes worth surfacing (special instructions, supplements, etc.)"
}

If a field isn't visible or you can't read it confidently, set it to null. Don't guess.
`;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false });
  }

  try {
    // We support JSON body with base64 OR a single binary upload via raw body.
    const body = req.body || {};
    const filename    = body.filename || `estimate-${Date.now()}.pdf`;
    const mimeType    = body.mimeType || body.mime_type || 'application/pdf';
    const fileBase64  = body.file_base64 || body.fileBase64 || null;
    const lead_id     = body.lead_id || null;
    const drip_campaign_id = body.drip_campaign_id || null;
    const kind        = body.kind || 'insurance_estimate';

    if (!fileBase64) {
      return res.status(400).json({ ok: false, error: 'file_base64 required (base64-encoded file content)' });
    }

    const fileBuffer = Buffer.from(fileBase64, 'base64');
    const sizeBytes = fileBuffer.length;

    // ---- 1. Upload to Drive ----
    let driveFile = null;
    try {
      driveFile = await driveUpload({
        filename,
        content: fileBuffer,
        mimeType,
        description: `Just Hail estimate parsed by Hailey on ${new Date().toISOString().slice(0, 10)}`,
      });
    } catch (err) {
      console.error('[parse-estimate] drive upload failed:', err);
      // Continue — we can still parse + save to DB even if Drive fails
    }

    // ---- 2. Parse with Claude vision ----
    const messages = [{
      role: 'user',
      content: [
        {
          type: 'document',
          source: { type: 'base64', media_type: mimeType, data: fileBase64 },
        },
        { type: 'text', text: ESTIMATE_SCHEMA_PROMPT },
      ],
    }];

    let parsed;
    let parsedRaw;
    try {
      const response = await anthropic.messages.create({
        model: 'claude-opus-4-7',
        max_tokens: 4000,
        messages,
      });
      parsedRaw = response.content.filter(b => b.type === 'text').map(b => b.text).join('');
      const match = parsedRaw.match(/\{[\s\S]*\}/);
      if (!match) throw new Error('no JSON found in response');
      parsed = JSON.parse(match[0]);
    } catch (err) {
      console.error('[parse-estimate] Claude parse failed:', err);
      // Save the file row anyway
      const { data: docRow } = await supabase.from('documents').insert({
        kind,
        source: 'admin_chat',
        lead_id,
        drip_campaign_id,
        filename,
        mime_type: mimeType,
        size_bytes: sizeBytes,
        drive_file_id:   driveFile?.id || null,
        drive_folder_id: driveFile?.parents?.[0] || null,
        drive_url:       driveFile?.webViewLink || null,
        parsed_text:     parsedRaw || null,
        metadata: { parse_error: err.message },
      }).select('id').single();
      return res.status(200).json({
        ok: false,
        error: 'parse_failed: ' + err.message,
        document_id: docRow?.id,
        drive_url: driveFile?.webViewLink,
      });
    }

    // ---- 3. Insert document row ----
    const { data: docRow, error: docErr } = await supabase.from('documents').insert({
      kind,
      source: 'admin_chat',
      lead_id,
      drip_campaign_id,
      filename,
      mime_type: mimeType,
      size_bytes: sizeBytes,
      drive_file_id:   driveFile?.id || null,
      drive_folder_id: driveFile?.parents?.[0] || null,
      drive_url:       driveFile?.webViewLink || null,
      parsed_data: parsed,
      parsed_text: parsedRaw,
      total_amount:  parsed?.totals?.grand_total || null,
      carrier_name:  parsed?.carrier_name || null,
      claim_number:  parsed?.claim_number || null,
      vehicle_year:  parsed?.vehicle?.year || null,
      vehicle_make:  parsed?.vehicle?.make || null,
      vehicle_model: parsed?.vehicle?.model || null,
    }).select('id').single();
    if (docErr) console.error('[parse-estimate] document insert failed:', docErr);

    // ---- 4. Append to Sheets ledger ----
    let sheetResult = null;
    try {
      await ensureTab('Estimates', { headers: [
        'Parsed At', 'Document ID', 'Filename', 'Carrier', 'Claim #',
        'Vehicle', 'Owner Name', 'Loss Date', 'Estimate Date',
        'Labor', 'Parts', 'Paint', 'Tax', 'Subtotal', 'Deductible', 'Net to Shop', 'Grand Total',
        'Drive Link', 'Lead ID', 'Drip Campaign ID',
      ]});
      const vehicle = `${parsed?.vehicle?.year || ''} ${parsed?.vehicle?.make || ''} ${parsed?.vehicle?.model || ''}`.trim();
      const row = [
        new Date().toISOString(),
        docRow?.id || '',
        filename,
        parsed?.carrier_name || '',
        parsed?.claim_number || '',
        vehicle,
        parsed?.owner?.name || '',
        parsed?.loss_date || '',
        parsed?.estimate_date || '',
        parsed?.totals?.labor || 0,
        parsed?.totals?.parts || 0,
        parsed?.totals?.paint || 0,
        parsed?.totals?.tax || 0,
        parsed?.totals?.subtotal || 0,
        parsed?.totals?.deductible || 0,
        parsed?.totals?.net_to_shop || 0,
        parsed?.totals?.grand_total || 0,
        driveFile?.webViewLink || '',
        lead_id || '',
        drip_campaign_id || '',
      ];
      sheetResult = await appendRows('Estimates!A1', [row]);
      if (docRow?.id) {
        await supabase.from('documents').update({
          sheet_synced_at: new Date().toISOString(),
          sheet_row_id: sheetResult?.appended_range || null,
        }).eq('id', docRow.id);
      }
    } catch (err) {
      console.error('[parse-estimate] sheets append failed:', err);
    }

    return res.status(200).json({
      ok: true,
      document_id: docRow?.id,
      drive_file_id: driveFile?.id,
      drive_url: driveFile?.webViewLink,
      sheet_appended: !!sheetResult?.ok,
      sheet_range: sheetResult?.appended_range,
      parsed,
    });
  } catch (err) {
    console.error('[parse-estimate]', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
}
