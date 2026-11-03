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
  purchase_value: number;
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
    fields: "campaign_id,campaign_name,adset_id,adset_name,spend,impressions,reach,clicks,actions,action_values,date_start",
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
    purchase_value: sumAction(r.action_values, ["purchase", "omni_purchase"]),
  }));
}

export async function fetchCampaigns(adAccountId: string): Promise<CampaignInfo[]> {
  const params = new URLSearchParams({
    access_token: token(),
    fields: "id,name,status,objective",
    limit: "500",
  });
  return getAll<CampaignInfo>(`${API}/act_${adAccountId}/campaigns?${params}`);
}

export async function listAdAccounts(): Promise<AdAccountInfo[]> {
  const params = new URLSearchParams({
    access_token: token(),
    fields: "account_id,name,currency,timezone_name",
    limit: "200",
  });
  return getAll<AdAccountInfo>(`${API}/me/adaccounts?${params}`);
}
