import type { InsightRow } from "./meta";
import { cred } from "./secrets";

// TikTok Marketing API, reporting at ad group level, one row per ad group per day.
// Needs TIKTOK_ACCESS_TOKEN (a long-lived token from a TikTok for Business developer app that
// the client's advertiser account has authorized).
const API = "https://business-api.tiktok.com/open_api/v1.3/report/integrated/get/";
const MAX_DAYS = 30; // TikTok limits daily-breakdown reports to 30 days per request

export const tiktokConfigured = () => Boolean(cred("TIKTOK_ACCESS_TOKEN"));

const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const num = (v: unknown) => Number(v ?? 0) || 0;

export async function fetchTikTokInsights(advertiserId: string, since: string, until: string): Promise<InsightRow[]> {
  const token = cred("TIKTOK_ACCESS_TOKEN");
  if (!token) throw new Error("Missing env var TIKTOK_ACCESS_TOKEN");
  const rows: InsightRow[] = [];

  for (let from = since; from <= until; from = addDays(from, MAX_DAYS)) {
    const to = addDays(from, MAX_DAYS - 1) < until ? addDays(from, MAX_DAYS - 1) : until;
    for (let page = 1; ; page++) {
      const qs = new URLSearchParams({
        advertiser_id: advertiserId,
        report_type: "BASIC",
        data_level: "AUCTION_ADGROUP",
        dimensions: JSON.stringify(["adgroup_id", "stat_time_day"]),
        metrics: JSON.stringify(["campaign_id", "campaign_name", "adgroup_name", "spend", "impressions", "clicks", "reach", "conversion"]),
        start_date: from,
        end_date: to,
        page: String(page),
        page_size: "1000",
      });
      const res = await fetch(`${API}?${qs}`, { headers: { "Access-Token": token } });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body || body.code !== 0) {
        throw new Error(`TikTok report failed: ${body?.message ?? `HTTP ${res.status}`}`);
      }
      for (const r of body.data?.list ?? []) {
        const m = r.metrics ?? {};
        const d = r.dimensions ?? {};
        rows.push({
          date: String(d.stat_time_day).slice(0, 10),
          // Prefixed so ids can never collide with another platform's in the shared table.
          campaign_id: `tiktok:${m.campaign_id}`,
          campaign_name: String(m.campaign_name ?? "Campaign"),
          adset_id: `tiktok:${d.adgroup_id}`,
          adset_name: String(m.adgroup_name ?? "Ad group"),
          spend: num(m.spend),
          impressions: num(m.impressions),
          reach: num(m.reach),
          clicks: num(m.clicks),
          leads: num(m.conversion),
          purchases: 0,
          messages: 0,
          purchase_value: 0,
        });
      }
      if (page >= num(body.data?.page_info?.total_page)) break;
    }
  }
  return rows;
}
