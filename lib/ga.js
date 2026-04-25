// Google Analytics 4 — Data API client.
// ----------------------------------------------------------------
// Auth via service account. The service-account JSON is stored as a
// base64-encoded blob in env (GA_SERVICE_ACCOUNT_KEY_B64) so it
// survives Vercel's env-var single-line constraints.
//
// Property ID lives in env (GA_PROPERTY_ID) so we never hardcode it.
//
// All public functions return shapes that the admin UI can render
// without further parsing — counts, top-N lists, etc.

import { BetaAnalyticsDataClient } from '@google-analytics/data';

let _client = null;

function getClient() {
  if (_client) return _client;
  const b64 = process.env.GA_SERVICE_ACCOUNT_KEY_B64;
  if (!b64) throw new Error('GA_SERVICE_ACCOUNT_KEY_B64 not set');
  let creds;
  try {
    creds = JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
  } catch (e) {
    throw new Error('GA_SERVICE_ACCOUNT_KEY_B64 is not valid base64-encoded JSON');
  }
  _client = new BetaAnalyticsDataClient({ credentials: creds });
  return _client;
}

function getPropertyName() {
  const id = process.env.GA_PROPERTY_ID;
  if (!id) throw new Error('GA_PROPERTY_ID not set');
  // Strip any "properties/" prefix the user might paste accidentally
  return 'properties/' + String(id).replace(/^properties\//, '').trim();
}

// ----------------------------------------------------------------
// Single-call dashboard summary — what the admin widget renders.
//   - active users in last 30 minutes
//   - last 7 days: users, sessions, pageviews, avg engagement seconds
//   - same metrics for last 30 days
//   - top 5 pages (last 7 days)
//   - top 5 referrers (last 7 days)
//   - top 5 cities (last 7 days)
// All in parallel — single round-trip from GA's perspective.
// ----------------------------------------------------------------
export async function getDashboardSummary() {
  const client = getClient();
  const property = getPropertyName();

  const realtimeQ = client.runRealtimeReport({
    property,
    metrics: [{ name: 'activeUsers' }],
    minuteRanges: [{ name: 'last30min', startMinutesAgo: 29, endMinutesAgo: 0 }],
  });

  const totalsQ = (startDate) => client.runReport({
    property,
    dateRanges: [{ startDate, endDate: 'today' }],
    metrics: [
      { name: 'totalUsers' },
      { name: 'sessions' },
      { name: 'screenPageViews' },
      { name: 'averageSessionDuration' },
      { name: 'engagementRate' },
    ],
  });

  const topPagesQ = client.runReport({
    property,
    dateRanges: [{ startDate: '7daysAgo', endDate: 'today' }],
    dimensions: [{ name: 'pagePath' }],
    metrics:    [{ name: 'screenPageViews' }],
    orderBys:   [{ metric: { metricName: 'screenPageViews' }, desc: true }],
    limit: 6,
  });

  const topReferrersQ = client.runReport({
    property,
    dateRanges: [{ startDate: '7daysAgo', endDate: 'today' }],
    dimensions: [{ name: 'sessionSource' }, { name: 'sessionMedium' }],
    metrics:    [{ name: 'sessions' }],
    orderBys:   [{ metric: { metricName: 'sessions' }, desc: true }],
    limit: 6,
  });

  const topCitiesQ = client.runReport({
    property,
    dateRanges: [{ startDate: '7daysAgo', endDate: 'today' }],
    dimensions: [{ name: 'city' }, { name: 'region' }],
    metrics:    [{ name: 'totalUsers' }],
    orderBys:   [{ metric: { metricName: 'totalUsers' }, desc: true }],
    limit: 6,
  });

  const formSubmitsQ = client.runReport({
    property,
    dateRanges: [{ startDate: '7daysAgo', endDate: 'today' }],
    dimensions: [{ name: 'eventName' }],
    metrics:    [{ name: 'eventCount' }],
    dimensionFilter: { filter: { fieldName: 'eventName', stringFilter: { matchType: 'EXACT', value: 'estimate_request' } } },
  });

  const [realtime, last7, last30, topPages, topReferrers, topCities, formSubmits] = await Promise.all([
    realtimeQ,
    totalsQ('7daysAgo'),
    totalsQ('30daysAgo'),
    topPagesQ,
    topReferrersQ,
    topCitiesQ,
    formSubmitsQ,
  ]);

  return {
    realtime: {
      active_users_now: parseInt(realtime[0]?.rows?.[0]?.metricValues?.[0]?.value || '0', 10),
    },
    last_7_days:  parseTotalsRow(last7[0]),
    last_30_days: parseTotalsRow(last30[0]),
    top_pages:     parseRows(topPages[0],     ['pagePath'],                ['screenPageViews']),
    top_referrers: parseRows(topReferrers[0], ['sessionSource', 'sessionMedium'], ['sessions']),
    top_cities:    parseRows(topCities[0],    ['city', 'region'],          ['totalUsers']),
    form_submits_last_7_days: parseInt(formSubmits[0]?.rows?.[0]?.metricValues?.[0]?.value || '0', 10),
  };
}

function parseTotalsRow(report) {
  const row = report?.rows?.[0]?.metricValues || [];
  const num = (i) => parseFloat(row[i]?.value || '0');
  return {
    users:                num(0),
    sessions:             num(1),
    page_views:           num(2),
    avg_session_seconds:  Math.round(num(3)),
    engagement_rate:      num(4),
  };
}

function parseRows(report, dimNames, metNames) {
  return (report?.rows || []).map((r) => {
    const out = {};
    dimNames.forEach((n, i) => { out[n] = r.dimensionValues?.[i]?.value || ''; });
    metNames.forEach((n, i) => { out[n] = parseFloat(r.metricValues?.[i]?.value || '0'); });
    return out;
  });
}
