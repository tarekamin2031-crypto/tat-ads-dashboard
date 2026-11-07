import type { InsightRow } from "./meta";
import { cred } from "./secrets";

// Google Ads API (REST), ad-group level, one row per ad group per day, via a GAQL query.
// Needs, from the agency's Google Ads manager (MCC) account and a Google Cloud OAuth client:
//   GOOGLE_ADS_DEVELOPER_TOKEN, GOOGLE_ADS_CLIENT_ID, GOOGLE_ADS_CLIENT_SECRET, GOOGLE_ADS_REFRESH_TOKEN
//   GOOGLE_ADS_LOGIN_CUSTOMER_ID  (the MCC id, when clients are linked under it)
// GOOGLE_ADS_API_VERSION overrides the API version when Google retires the default.
// Google retires API versions about a year after release and answers 404 for a retired (or not yet
// released) one, so try newest first and remember the one that works. GOOGLE_ADS_API_VERSION pins one.
const VERSIONS = [process.env.GOOGLE_ADS_API_VERSION, "v23", "v22", "v21", "v20", "v19"].filter((v): v is string => Boolean(v));
let workingVersion: string | null = null;

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

// Signs in and returns a function that runs GAQL queries against one customer account.
async function makeSearch(customerId: string): Promise<{ id: string; search: (query: string) => Promise<any[]> }> {
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

  // Runs one GAQL query, following pages and trying API versions as needed.
  async function search(query: string): Promise<any[]> {
    const out: any[] = [];
    let pageToken: string | undefined;
    do {
      let res: Response | null = null;
      for (const v of workingVersion ? [workingVersion] : VERSIONS) {
        res = await fetch(`https://googleads.googleapis.com/${v}/customers/${id}/googleAds:search`, {
          method: "POST",
          headers,
          body: JSON.stringify({ query, ...(pageToken ? { pageToken } : {}) }),
        });
        if (res.status !== 404) {
          workingVersion = v;
          break;
        }
        workingVersion = null;
      }
      if (!res || res.status === 404) {
        throw new Error(`Google Ads report failed: HTTP 404 on every API version tried (${VERSIONS.join(", ")}). Check the customer ID ${id} and set GOOGLE_ADS_API_VERSION to a version listed at developers.google.com/google-ads/api/docs/release-notes`);
      }
      const text = await res.text();
      let body: any = null;
      try {
        body = JSON.parse(text);
      } catch {
        /* not JSON */
      }
      if (!res.ok || !body) {
        const msg = body?.error?.details?.[0]?.errors?.[0]?.message ?? body?.error?.message ?? `HTTP ${res.status} ${text.slice(0, 160)}`;
        let hint = "";
        if (res.status === 403) hint = await accessHint(workingVersion ?? VERSIONS[0], token, id, login);
        throw new Error(`Google Ads report failed: ${msg}${hint}`);
      }
      out.push(...(body.results ?? []));
      pageToken = body.nextPageToken || undefined;
    } while (pageToken);
    return out;
  }

  return { id, search };
}

export async function fetchGoogleInsights(customerId: string, since: string, until: string): Promise<InsightRow[]> {
  const { id, search } = await makeSearch(customerId);

  const metrics = "metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions, metrics.conversions_value";
  const toRow = (r: any, adsetId: string, adsetName: string): InsightRow => {
    const m = r.metrics ?? {};
    return {
      date: String(r.segments?.date),
      campaign_id: `google:${r.campaign?.id}`,
      campaign_name: String(r.campaign?.name ?? "Campaign"),
      adset_id: adsetId,
      adset_name: adsetName,
      spend: num(m.costMicros) / 1_000_000,
      impressions: num(m.impressions),
      reach: 0, // Google does not report reach per ad group
      clicks: num(m.clicks),
      leads: num(m.conversions),
      purchases: 0,
      messages: 0,
      // Google's conversion value is often a default amount per action (calls, directions), not revenue, so it is
      // not shown as ROAS. Meta purchases are the only revenue figure we trust.
      purchase_value: 0,
    };
  };

  // Search, Display, Video, Demand Gen and Shopping campaigns report at ad-group level.
  const groups = await search(`SELECT segments.date, campaign.id, campaign.name, ad_group.id, ad_group.name, ${metrics}
    FROM ad_group WHERE segments.date BETWEEN '${since}' AND '${until}'`);
  const rows = groups.map((r) => toRow(r, `google:${r.adGroup?.id}`, String(r.adGroup?.name ?? "Ad group")));

  // Performance Max, Smart and Local campaigns have no usable ad groups, so they are read at campaign level
  // (one row per campaign per day). Smart campaigns report phone calls rather than conversions, so calls
  // stand in for results when no conversions are recorded.
  const LABELS: Record<string, string> = { PERFORMANCE_MAX: "Performance Max", SMART: "Smart campaign", LOCAL: "Local campaign" };
  const flat = await search(`SELECT segments.date, campaign.id, campaign.name, campaign.advertising_channel_type, ${metrics}, metrics.phone_calls
    FROM campaign WHERE segments.date BETWEEN '${since}' AND '${until}'
    AND campaign.advertising_channel_type IN ('PERFORMANCE_MAX', 'SMART', 'LOCAL')`);
  // Smart campaigns headline "call clicks" and "local actions" (directions, visits…). The API exposes them as
  // all-conversions split by conversion action, so they are told apart by the action's name and category:
  // anything about calls is a call click; directions, map and engagement actions are local actions.
  const isCall = (name: string, cat: string) => /call/i.test(name) || cat === "PHONE_CALL_LEAD";
  const isLocal = (name: string, cat: string) => !isCall(name, cat) && (/direction|map|store|visit|engagement/i.test(name) || ["GET_DIRECTIONS", "ENGAGEMENT", "STORE_VISIT"].includes(cat));
  const perDay = new Map<string, { calls: number; local: number }>();
  const byCategory = new Map<string, number>();
  lastNote = "";
  if (flat.length > 0) {
    try {
      const cats = await search(`SELECT segments.date, campaign.id, segments.conversion_action_name, segments.conversion_action_category, metrics.all_conversions
        FROM campaign WHERE segments.date BETWEEN '${since}' AND '${until}'
        AND campaign.advertising_channel_type IN ('PERFORMANCE_MAX', 'SMART', 'LOCAL')`);
      for (const r of cats) {
        const cat = String(r.segments?.conversionActionCategory ?? "UNKNOWN");
        const name = String(r.segments?.conversionActionName ?? "");
        const n = num(r.metrics?.allConversions);
        const k = `${r.segments?.date}|${r.campaign?.id}`;
        const d = perDay.get(k) ?? { calls: 0, local: 0 };
        // Google's "Local actions" total includes click-to-call actions (1,796 + 25 = the 1.82k Google shows).
        if (isCall(name, cat)) {
          d.calls += n;
          d.local += n;
        } else if (isLocal(name, cat)) d.local += n;
        perDay.set(k, d);
        const label = `${name || "?"} [${cat}]${isCall(name, cat) ? " → calls" : isLocal(name, cat) ? " → local" : " → ignored"}`;
        byCategory.set(label, (byCategory.get(label) ?? 0) + n);
      }
      lastNote = `local actions = every action below except ignored; all conversions by action: ${[...byCategory].sort((a, b) => b[1] - a[1]).map(([c, n]) => `${c} ${Math.round(n)}`).join(", ")}`;
    } catch (e) {
      lastNote = `could not read conversion types: ${(e as Error).message}`;
    }
  }
  // "Call clicks" in Google's overview are clicks on the call button: the campaign's clicks split by click type
  // ("CALLS" in the API; older accounts report PHONE_CALL_CLICK). The phone_calls metric and the click-to-call conversion action are other, smaller counts.
  const callClicks = new Map<string, number>();
  const byClickType = new Map<string, number>();
  if (flat.length > 0) {
    try {
      const ct = await search(`SELECT segments.date, campaign.id, segments.click_type, metrics.clicks
        FROM campaign WHERE segments.date BETWEEN '${since}' AND '${until}'
        AND campaign.advertising_channel_type IN ('PERFORMANCE_MAX', 'SMART', 'LOCAL')`);
      for (const r of ct) {
        const type = String(r.segments?.clickType ?? "UNKNOWN");
        const n = num(r.metrics?.clicks);
        byClickType.set(type, (byClickType.get(type) ?? 0) + n);
        if (type === "CALLS" || type === "PHONE_CALL_CLICK") {
          const k = `${r.segments?.date}|${r.campaign?.id}`;
          callClicks.set(k, (callClicks.get(k) ?? 0) + n);
        }
      }
    } catch (e) {
      lastNote += `; could not read click types: ${(e as Error).message}`;
    }
  }
  const phoneTotal = flat.reduce((n, r) => n + num(r.metrics?.phoneCalls), 0);
  const clickTotal = [...callClicks.values()].reduce((n, v) => n + v, 0);
  // Put the short figures first: the message shown to the admin is length-limited.
  if (flat.length > 0) {
    const types = [...byClickType].sort((x, y) => y[1] - x[1]).map(([t, n]) => `${t} ${Math.round(n)}`).join(", ");
    lastNote = `call clicks (CALLS click type): ${Math.round(clickTotal)}; phone_calls metric: ${Math.round(phoneTotal)}; click types: ${types}${lastNote ? `; ${lastNote}` : ""}`;
  }
  for (const r of flat) {
    const row = toRow(r, `google:${r.campaign?.id}-campaign`, LABELS[String(r.campaign?.advertisingChannelType)] ?? "Campaign");
    const key = `${r.segments?.date}|${r.campaign?.id}`;
    const d = perDay.get(key);
    row.calls = clickTotal > 0 ? callClicks.get(key) ?? 0 : phoneTotal > 0 ? num(r.metrics?.phoneCalls) : d ? d.calls : 0;
    row.local_actions = d ? d.local : 0;
    if (row.leads === 0) row.leads = row.calls;
    rows.push(row);
  }

  // An empty result is ambiguous (no spend, wrong account, or paused campaigns), so say what the account looks like.
  if (rows.length === 0) {
    try {
      const info = (await search("SELECT customer.descriptive_name, customer.currency_code, customer.status FROM customer"))[0]?.customer;
      const camps = await search("SELECT campaign.name, campaign.status, campaign.advertising_channel_type FROM campaign");
      const by = (k: (c: any) => string) => {
        const m = new Map<string, number>();
        for (const c of camps) m.set(k(c.campaign ?? {}), (m.get(k(c.campaign ?? {})) ?? 0) + 1);
        return [...m].map(([n, v]) => `${v} ${n}`).join(", ");
      };
      lastNote = `account "${info?.descriptiveName ?? id}" (${info?.currencyCode ?? "?"}, ${info?.status ?? "?"}) has ${camps.length} campaigns${camps.length ? ` [status: ${by((c) => c.status)}; type: ${by((c) => c.advertisingChannelType)}]` : ""} but none had activity in this period`;
    } catch (e) {
      lastNote = `could not describe the account: ${(e as Error).message}`;
    }
  }
  return rows;
}

let lastNote = "";
// Extra detail about the latest empty pull, for the "Pulled data" message.
export const googleLastNote = () => lastNote;

// On a permission error, list the accounts the signed-in Google user can reach directly, so it is clear
// whether the manager (MCC) or the client account is missing from that user's access.
async function accessHint(version: string, token: string, customerId: string, loginId: string): Promise<string> {
  try {
    const res = await fetch(`https://googleads.googleapis.com/${version}/customers:listAccessibleCustomers`, {
      headers: { Authorization: `Bearer ${token}`, "developer-token": cred("GOOGLE_ADS_DEVELOPER_TOKEN") },
    });
    const body = await res.json().catch(() => null);
    const ids: string[] = (body?.resourceNames ?? []).map((n: string) => n.replace("customers/", ""));
    if (!res.ok || !body) return ` [Could not list accessible accounts: HTTP ${res.status}]`;
    const fmt = (v: string) => v.replace(/^(\d{3})(\d{3})(\d{4})$/, "$1-$2-$3");
    const has = (v: string) => ids.includes(v);
    return ` [Signed-in Google user can access: ${ids.length ? ids.map(fmt).join(", ") : "no accounts"}. Manager ${loginId ? fmt(loginId) : "(not set)"} ${loginId ? (has(loginId) ? "is" : "is NOT") : ""} in that list; client ${fmt(customerId)} ${has(customerId) ? "is" : "is not"} listed directly (clients under a manager normally are not).]`;
  } catch {
    return "";
  }
}

export type GoogleAccountInfo = { id: string; name: string; currency: string; timezone: string };
let accountsCache: { at: number; list: GoogleAccountInfo[] } | null = null;

// Client accounts under the agency's manager (MCC), for the "pick an account" lists. Returns [] when
// Google Ads is not set up or the call fails, so the pages simply hide the list.
export async function listGoogleAccounts(): Promise<GoogleAccountInfo[]> {
  const login = digits(cred("GOOGLE_ADS_LOGIN_CUSTOMER_ID"));
  if (!googleConfigured() || !login) return [];
  if (accountsCache && Date.now() - accountsCache.at < 5 * 60_000) return accountsCache.list;
  try {
    const token = await accessToken();
    const query = `SELECT customer_client.id, customer_client.descriptive_name, customer_client.currency_code, customer_client.time_zone, customer_client.manager, customer_client.status
      FROM customer_client WHERE customer_client.status = 'ENABLED'`;
    let res: Response | null = null;
    for (const v of workingVersion ? [workingVersion] : VERSIONS) {
      res = await fetch(`https://googleads.googleapis.com/${v}/customers/${login}/googleAds:search`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "developer-token": cred("GOOGLE_ADS_DEVELOPER_TOKEN"), "login-customer-id": login, "Content-Type": "application/json" },
        body: JSON.stringify({ query }),
      });
      if (res.status !== 404) {
        workingVersion = v;
        break;
      }
    }
    const body: any = res && (await res.json().catch(() => null));
    if (!res || !res.ok || !body) return [];
    const list: GoogleAccountInfo[] = (body.results ?? [])
      .map((r: any) => r.customerClient)
      .filter((c: any) => c && !c.manager)
      .map((c: any) => ({ id: String(c.id), name: String(c.descriptiveName ?? `Account ${c.id}`), currency: String(c.currencyCode ?? ""), timezone: String(c.timeZone ?? "UTC") }))
      .sort((a: GoogleAccountInfo, b: GoogleAccountInfo) => a.name.localeCompare(b.name));
    accountsCache = { at: Date.now(), list };
    return list;
  } catch {
    return [];
  }
}

export const formatCustomerId = (id: string) => id.replace(/^(\d{3})(\d{3})(\d{4})$/, "$1-$2-$3");

export type GoogleBillingInfo = {
  currency: string;
  customerStatus: string; // ENABLED, SUSPENDED, CANCELED...
  setupStatus: string | null; // billing setup: APPROVED, PENDING, APPROVED_HELD, CANCELLED
  paymentsAccount: string | null;
  // Present only for accounts on monthly invoicing / account budgets. Card (automatic payments) accounts have none.
  budget: { name: string; limit: number | null; served: number } | null;
};

// What Google Ads exposes about money: account status, billing setup and the account budget (if any).
// Accounts that pay by card have no prepaid balance to read, so budget stays null for them.
export async function fetchGoogleBilling(customerId: string): Promise<GoogleBillingInfo> {
  const { search } = await makeSearch(customerId);
  const c = (await search("SELECT customer.status, customer.currency_code FROM customer"))[0]?.customer ?? {};
  let setupStatus: string | null = null;
  let paymentsAccount: string | null = null;
  let budget: GoogleBillingInfo["budget"] = null;
  try {
    const setups = await search("SELECT billing_setup.status, billing_setup.payments_account_info.payments_account_name, billing_setup.payments_account_info.payments_profile_name FROM billing_setup");
    const pick = setups.find((r) => r.billingSetup?.status === "APPROVED") ?? setups[setups.length - 1];
    if (pick) {
      setupStatus = String(pick.billingSetup?.status ?? "") || null;
      paymentsAccount = pick.billingSetup?.paymentsAccountInfo?.paymentsAccountName ?? pick.billingSetup?.paymentsAccountInfo?.paymentsProfileName ?? null;
    }
  } catch {
    /* no billing access: leave unknown */
  }
  try {
    const budgets = await search(`SELECT account_budget.status, account_budget.name, account_budget.approved_spending_limit_micros, account_budget.approved_spending_limit_type,
      account_budget.adjusted_spending_limit_micros, account_budget.amount_served_micros FROM account_budget`);
    const live = budgets.filter((r) => r.accountBudget?.status === "APPROVED");
    const b = live[live.length - 1]?.accountBudget;
    if (b) {
      const infinite = b.approvedSpendingLimitType === "INFINITE";
      const micros = b.adjustedSpendingLimitMicros ?? b.approvedSpendingLimitMicros;
      budget = { name: String(b.name ?? ""), limit: infinite || micros === undefined ? null : num(micros) / 1_000_000, served: num(b.amountServedMicros) / 1_000_000 };
    }
  } catch {
    /* no account budgets on this account */
  }
  return { currency: String(c.currencyCode ?? ""), customerStatus: String(c.status ?? "UNKNOWN"), setupStatus, paymentsAccount, budget };
}
