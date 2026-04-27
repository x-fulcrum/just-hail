// Shared Google service-account auth.
// ----------------------------------------------------------------
// We reuse the same GA_SERVICE_ACCOUNT_KEY_B64 service account
// (`ga-reader@just-hail-website.iam.gserviceaccount.com`) for Drive
// + Sheets + (when GA4 unblocks) Analytics.
//
// `google-auth-library` handles JWT minting + token refresh. It's
// already in package-lock via @google-analytics/data dependency.

import { GoogleAuth } from 'google-auth-library';

let _auth = null;

export function getAuth(scopes = []) {
  if (_auth && scopesMatch(_auth.__scopes, scopes)) return _auth;
  const b64 = process.env.GA_SERVICE_ACCOUNT_KEY_B64;
  if (!b64) throw new Error('GA_SERVICE_ACCOUNT_KEY_B64 not set');
  let creds;
  try {
    creds = JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
  } catch (e) {
    throw new Error('GA_SERVICE_ACCOUNT_KEY_B64 invalid base64 JSON');
  }
  _auth = new GoogleAuth({
    credentials: creds,
    scopes: [...new Set(scopes)],
  });
  _auth.__scopes = scopes;
  return _auth;
}

function scopesMatch(a, b) {
  if (!a || !b) return false;
  if (a.length !== b.length) return false;
  const sa = new Set(a), sb = new Set(b);
  for (const x of sa) if (!sb.has(x)) return false;
  return true;
}

// Returns the email address of the service account (useful for sharing)
export function serviceAccountEmail() {
  const b64 = process.env.GA_SERVICE_ACCOUNT_KEY_B64;
  if (!b64) return null;
  try {
    const creds = JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
    return creds.client_email || null;
  } catch {
    return null;
  }
}

// Get a fresh access token for use in raw fetch() calls
export async function getAccessToken(scopes) {
  const auth = getAuth(scopes);
  const client = await auth.getClient();
  const { token } = await client.getAccessToken();
  if (!token) throw new Error('Failed to mint Google access token');
  return token;
}
