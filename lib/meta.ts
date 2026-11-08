import { goalKind } from "./results";

const API = "https://graph.facebook.com/v21.0";

export type InsightRow = {
  date: string;
  campaign_id: string;
  campaign_name: string;
  adset_id: string;
  adset_name: string;
  spend: number;
  impressions: number;
  reach: number;
  clicks: number;
  leads: number;
  purchases: number;
  messages: number;
  profile_visits?: number; // Instagram profile visits (Profile visit campaigns)
  purchase_value: number;
  calls?: number; // Google Smart campaigns: call clicks
  local_actions?: number; // Google Smart campaigns: directions, visits and similar
};

export type CampaignInfo = { id: string; name: string; status: string; objective: string };
export type AdAccountInfo = { account_id: string; name: string; currency: string; timezone_name: string };

type Action = { action_type: string; value: string };

function token(): string {
  const v = process.env.META_ACCESS_TOKEN;
  if (!v) throw new Error("Missing env var META_ACCESS_TOKEN");
  return v;
}

async function getJson(url: string, attempt = 0): Promise<any> {
  const res = await fetch(url);
  if (res.ok) return res.json();
  const body = await res.text();
  // 4 = app rate limit, 17 = user rate limit, 613 = custom rate limit
  const rateLimited = /"code":\s*(4|17|613)\b/.test(body);
  if ((rateLimited || res.status >= 500) && attempt < 4) {
    await new Promise((r) => setTimeout(r, 2000 * 2 ** attempt));
    return getJson(url, attempt + 1);
  }
  throw new Error(`Meta API ${res.status}: ${body}`);
}

async function getAll<T>(firstUrl: string): Promise<T[]> {
  const out: T[] = [];
  let url: string | undefined = firstUrl;
  while (url) {
    const page: { data: T[]; paging?: { next?: string } } = await getJson(url);
    out.push(...page.data);
    url = page.paging?.next;
  }
  return out;
}

const sumAction = (list: Action[] | undefined, types: string[]) =>
  (list ?? []).filter((a) => types.includes(a.action_type)).reduce((s, a) => s + Number(a.value), 0);

export async function fetchInsights(adAccountId: string, since: string, until: string): Promise<InsightRow[]> {
  const params = new URLSearchParams({
    access_token: token(),
    level: "adset",
    time_increment: "1",
    time_range: JSON.stringify({ since, until }),
    fields: "campaign_id,campaign_name,adset_id,adset_name,spend,impressions,reach,clicks,actions,action_values,instagram_profile_visits,date_start",
    limit: "500",
  });
  const rows = await getAll<any>(`${API}/act_${adAccountId}/insights?${params}`);
  return rows.map((r) => ({
    date: r.date_start,
    campaign_id: r.campaign_id,
    campaign_name: r.campaign_name,
    adset_id: r.adset_id,
    adset_name: r.adset_name,
    spend: Number(r.spend ?? 0),
    impressions: Number(r.impressions ?? 0),
    reach: Number(r.reach ?? 0),
    clicks: Number(r.clicks ?? 0),
    leads: sumAction(r.actions, ["lead", "onsite_conversion.lead_grouped"]),
    purchases: sumAction(r.actions, ["purchase", "omni_purchase"]),
    messages: sumAction(r.actions, ["onsite_conversion.messaging_conversation_started_7d"]),
    profile_visits: Number(r.instagram_profile_visits ?? 0),
    purchase_value: sumAction(r.action_values, ["purchase", "omni_purchase"]),
  }));
}

// Unique reach and frequency for a whole period. They cannot be summed from daily rows (the same
// person is counted once per day), so they are asked from Meta directly and cached briefly.
const reachCache = new Map<string, { at: number; v: { reach: number; frequency: number } | null }>();
export async function fetchPeriodReach(adAccountId: string, since: string, until: string) {
  const key = `${adAccountId}|${since}|${until}`;
  const hit = reachCache.get(key);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.v;
  let v: { reach: number; frequency: number } | null = null;
  try {
    const params = new URLSearchParams({ access_token: token(), fields: "reach,frequency", time_range: JSON.stringify({ since, until }) });
    const res = await fetch(`${API}/act_${adAccountId}/insights?${params}`, { signal: AbortSignal.timeout(6000) });
    const row = (await res.json()).data?.[0];
    if (row) v = { reach: Number(row.reach ?? 0), frequency: Number(row.frequency ?? 0) };
  } catch {}
  reachCache.set(key, { at: Date.now(), v });
  return v;
}

// adset id -> result kind, from each ad set's optimization goal.
export async function fetchAdsetGoals(adAccountId: string): Promise<Map<string, string>> {
  const params = new URLSearchParams({ access_token: token(), fields: "id,optimization_goal", limit: "500" });
  const rows = await getAll<{ id: string; optimization_goal?: string }>(`${API}/act_${adAccountId}/adsets?${params}`);
  return new Map(rows.map((r) => [r.id, goalKind(r.optimization_goal)]));
}

export async function fetchCampaigns(adAccountId: string): Promise<CampaignInfo[]> {
  const params = new URLSearchParams({
    access_token: token(),
    fields: "id,name,status,objective",
    limit: "500",
  });
  return getAll<CampaignInfo>(`${API}/act_${adAccountId}/campaigns?${params}`);
}

export type AccountBillingRaw = {
  account_status: number;
  disable_reason: number;
  is_prepay_account: boolean;
  balance: string; // amount currently owed (minor units)
  amount_spent: string; // lifetime spend (minor units)
  spend_cap: string; // account spending limit, "0" = none (minor units)
  funding_source_details?: { display_string?: string };
};

export async function fetchAccountBilling(adAccountId: string): Promise<AccountBillingRaw> {
  const params = new URLSearchParams({
    access_token: token(),
    fields: "account_status,disable_reason,is_prepay_account,balance,amount_spent,spend_cap,funding_source_details",
  });
  return getJson(`${API}/act_${adAccountId}?${params}`);
}

export async function listAdAccounts(): Promise<AdAccountInfo[]> {
  const params = new URLSearchParams({
    access_token: token(),
    fields: "account_id,name,currency,timezone_name",
    limit: "200",
  });
  return getAll<AdAccountInfo>(`${API}/me/adaccounts?${params}`);
}
