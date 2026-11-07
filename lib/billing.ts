import { isMetaAccount, type Account } from "./accounts";
import { fetchGoogleBilling } from "./google";
import type { Alert } from "./alerts";
import { fetchAccountBilling } from "./meta";

// 14% VAT + 6% payment tax, added together.
export const TAX_RATE = 0.2;

const STATUS: Record<number, string> = {
  1: "Active",
  2: "Disabled",
  3: "Payment unsettled",
  7: "Pending risk review",
  8: "Pending settlement",
  9: "In grace period",
  100: "Pending closure",
  101: "Closed",
};

export type Billing = {
  currency: string;
  statusCode: number;
  status: string;
  isPrepay: boolean;
  spent: number;
  cap: number | null; // null = no spending limit set
  available: number | null; // what is left before the cap, same as Meta's "Available balance" for prepaid
  availableNet: number | null; // available ÷ (1 + tax): what can actually go to ads
  amountDue: number; // owed now (card accounts only)
  funding: string;
  low: boolean;
  threshold: number; // per-client "low balance" limit
  availableGross?: number | null; // available × (1 + tax): the same balance including tax (Google)
  noLimitLabel?: string; // shown instead of "No spending limit" (e.g. Google card accounts have no balance)
};

// Meta returns money in minor units (cents/piasters) as strings.
const major = (v: string | undefined) => Number(v ?? 0) / 100;

const TTL_MS = 10 * 60 * 1000;
const cache = new Map<string, { at: number; value: Billing | null }>();

// Fetched live (balances move during the day) and cached briefly so page views don't hammer Meta.
// Any failure returns null so the rest of the page still renders.
export async function getBilling(account: Account): Promise<Billing | null> {
  if (!isMetaAccount(account)) return null; // billing comes from Meta only
  const hit = cache.get(account.ad_account_id);
  // The threshold is a per-client setting, so it is applied after the cache, not stored in it.
  const withLimit = (b: Billing | null): Billing | null =>
    b && { ...b, threshold: account.low_balance, low: b.available !== null && b.available <= account.low_balance };
  if (hit && Date.now() - hit.at < TTL_MS) return withLimit(hit.value);

  let value: Billing | null = null;
  try {
    // Never let a slow Meta call hold the whole page: give up after 6s (the panel then shows "unavailable").
    const raw = await Promise.race([
      fetchAccountBilling(account.ad_account_id),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error("Billing fetch timed out")), 6000)),
    ]);
    const spent = major(raw.amount_spent);
    const cap = major(raw.spend_cap) || null;
    const available = cap === null ? null : Math.max(cap - spent, 0);
    value = {
      currency: account.currency,
      statusCode: raw.account_status,
      status: STATUS[raw.account_status] ?? `Status ${raw.account_status}`,
      isPrepay: raw.is_prepay_account,
      spent,
      cap,
      available,
      availableNet: available === null ? null : available / (1 + TAX_RATE),
      amountDue: major(raw.balance),
      funding: raw.is_prepay_account ? "Prepaid balance" : (raw.funding_source_details?.display_string ?? "Card"),
      low: false,
      threshold: account.low_balance,
    };
  } catch (e) {
    console.error(`Billing fetch failed for ${account.name}`, e);
  }
  cache.set(account.ad_account_id, { at: Date.now(), value });
  return withLimit(value);
}

const googleCache = new Map<string, { at: number; value: Billing | null }>();
const titleCase = (s: string) => s.toLowerCase().replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());

// Google Ads money situation in the same shape as Meta's, so the panel and alerts are shared.
export async function getGoogleBilling(account: Account, customerId: string): Promise<Billing | null> {
  const withLimit = (b: Billing | null): Billing | null =>
    b && { ...b, threshold: account.low_balance, low: b.available !== null && b.available <= account.low_balance };
  const hit = googleCache.get(customerId);
  if (hit && Date.now() - hit.at < TTL_MS) return withLimit(hit.value);

  let value: Billing | null = null;
  try {
    const g = await Promise.race([
      fetchGoogleBilling(customerId),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error("Google billing fetch timed out")), 6000)),
    ]);
    const enabled = g.customerStatus === "ENABLED";
    const setupOk = g.setupStatus === null || g.setupStatus === "APPROVED";
    const statusText = !enabled ? titleCase(g.customerStatus) : !setupOk ? `Payment setup ${titleCase(g.setupStatus ?? "")}` : "Active";
    const cap = g.budget?.limit ?? null;
    const spent = g.budget?.served ?? 0;
    const available = g.budget && cap !== null ? Math.max(cap - spent, 0) : null;
    value = {
      currency: g.currency || account.currency,
      statusCode: enabled && setupOk ? 1 : 2,
      status: statusText,
      isPrepay: true, // hides "amount due", which Google does not give us
      spent,
      cap,
      available,
      // Google reports the balance as is; show it both net of the 20% tax and including it.
      availableNet: available === null ? null : available / (1 + TAX_RATE),
      availableGross: available === null ? null : available * (1 + TAX_RATE),
      amountDue: 0,
      funding: g.budget ? `Account budget${g.budget.name ? ` (${g.budget.name})` : ""}` : g.paymentsAccount ? `${g.paymentsAccount} (automatic payments)` : "Automatic payments",
      low: false,
      threshold: account.low_balance,
      noLimitLabel: g.budget ? "No spending limit" : "Automatic payments, no balance to track",
    };
  } catch (e) {
    console.error(`Google billing fetch failed for ${account.name}`, e);
  }
  googleCache.set(customerId, { at: Date.now(), value });
  return withLimit(value);
}

const money = (v: number) => v.toLocaleString("en-US", { maximumFractionDigits: 0 });

export function billingAlerts(b: Billing | null, scope = "Billing"): Alert[] {
  if (!b) return [];
  const alerts: Alert[] = [];
  if (b.statusCode !== 1) {
    alerts.push({ scope, level: "bad", text: `Account status: ${b.status}. Ads may not be delivering` });
  }
  if (b.low && b.available !== null) {
    alerts.push({
      scope,
      level: "bad",
      text: `Only ${money(b.available)} ${b.currency} left before the account stops (alert at ${money(b.threshold)})`,
    });
  }
  return alerts;
}
