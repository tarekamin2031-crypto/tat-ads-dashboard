import type { InsightRow } from "./meta";
import { cred } from "./secrets";

// Google Ads API (REST), ad-group level, one row per ad group per day, via a GAQL query.
// Needs, from the agency's Google Ads manager (MCC) account and a Google Cloud OAuth client:
//   GOOGLE_ADS_DEVELOPER_TOKEN, GOOGLE_ADS_CLIENT_ID, GOOGLE_ADS_CLIENT_SECRET, GOOGLE_ADS_REFRESH_TOKEN
//   GOOGLE_ADS_LOGIN_CUSTOMER_ID  (the MCC id, when clients are linked under it)
// GOOGLE_ADS_API_VERSION overrides the API version when Google retires the default.
const VERSION = process.env.GOOGLE_ADS_API_VERSION || "v21";

export const googleConfigured = () =>
  Boolean(cred("GOOGLE_ADS_DEVELOPER_TOKEN") && cred("GOOGLE_ADS_CLIENT_ID") && cred("GOOGLE_ADS_CLIENT_SECRET") && cred("GOOGLE_ADS_REFRESH_TOKEN"));

const digits = (s: string) => s.replace(/\D/g, "");
const num = (v: unknown) => Number(v ?? 0) || 0;

async function accessToken(): Promise<string> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: cred("GOOGLE_ADS_CLIENT_ID"),
      client_secret: cred("GOOGLE_ADS_CLIENT_SECRET"),
      refresh_token: cred("GOOGLE_ADS_REFRESH_TOKEN"),
      grant_type: "refresh_token",
    }),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok || !body?.access_token) throw new Error(`Google sign-in failed: ${body?.error_description ?? body?.error ?? `HTTP ${res.status}`}`);
  return body.access_token;
}

export async function fetchGoogleInsights(customerId: string, since: string, until: string): Promise<InsightRow[]> {
  if (!googleConfigured()) throw new Error("Google Ads credentials are not set");
  const id = digits(customerId);
  const token = await accessToken();
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    "developer-token": cred("GOOGLE_ADS_DEVELOPER_TOKEN"),
    "Content-Type": "application/json",
  };
  const login = digits(cred("GOOGLE_ADS_LOGIN_CUSTOMER_ID"));
  if (login) headers["login-customer-id"] = login;

  const query = `SELECT segments.date, campaign.id, campaign.name, ad_group.id, ad_group.name,
      metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions, metrics.conversions_value
    FROM ad_group
    WHERE segments.date BETWEEN '${since}' AND '${until}'`;

  const rows: InsightRow[] = [];
  let pageToken: string | undefined;
  do {
    const res = await fetch(`https://googleads.googleapis.com/${VERSION}/customers/${id}/googleAds:search`, {
      method: "POST",
      headers,
      body: JSON.stringify({ query, pageSize: 10000, ...(pageToken ? { pageToken } : {}) }),
    });
    const body = await res.json().catch(() => null);
    if (!res.ok || !body) {
      const msg = body?.error?.details?.[0]?.errors?.[0]?.message ?? body?.error?.message ?? `HTTP ${res.status}`;
      throw new Error(`Google Ads report failed: ${msg}`);
    }
    for (const r of body.results ?? []) {
      const m = r.metrics ?? {};
      rows.push({
        date: String(r.segments?.date),
        campaign_id: `google:${r.campaign?.id}`,
        campaign_name: String(r.campaign?.name ?? "Campaign"),
        adset_id: `google:${r.adGroup?.id}`,
        adset_name: String(r.adGroup?.name ?? "Ad group"),
        spend: num(m.costMicros) / 1_000_000,
        impressions: num(m.impressions),
        reach: 0, // Google does not report reach per ad group
        clicks: num(m.clicks),
        leads: num(m.conversions),
        purchases: 0,
        messages: 0,
        purchase_value: num(m.conversionsValue),
      });
    }
    pageToken = body.nextPageToken || undefined;
  } while (pageToken);
  return rows;
}
