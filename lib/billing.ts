import type { Account } from "./accounts";
import type { Alert } from "./alerts";
import { fetchAccountBilling } from "./meta";

// 14% VAT + 6% payment tax, added together.
export const TAX_RATE = 0.2;
// Warn when this much (in account currency) is left before the account stops delivering.
export const LOW_BALANCE_THRESHOLD = 1000;

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
};

// Meta returns money in minor units (cents/piasters) as strings.
const major = (v: string | undefined) => Number(v ?? 0) / 100;

const TTL_MS = 10 * 60 * 1000;
const cache = new Map<string, { at: number; value: Billing | null }>();

// Fetched live (balances move during the day) and cached briefly so page views don't hammer Meta.
// Any failure returns null so the rest of the page still renders.
export async function getBilling(account: Account): Promise<Billing | null> {
  const hit = cache.get(account.ad_account_id);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;

  let value: Billing | null = null;
  try {
    const raw = await fetchAccountBilling(account.ad_account_id);
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
      low: available !== null && available <= LOW_BALANCE_THRESHOLD,
    };
  } catch (e) {
    console.error(`Billing fetch failed for ${account.name}`, e);
  }
  cache.set(account.ad_account_id, { at: Date.now(), value });
  return value;
}

const money = (v: number) => v.toLocaleString("en-US", { maximumFractionDigits: 0 });

export function billingAlerts(b: Billing | null): Alert[] {
  if (!b) return [];
  const alerts: Alert[] = [];
  if (b.statusCode !== 1) {
    alerts.push({ scope: "Billing", level: "bad", text: `Account status: ${b.status}. Ads may not be delivering` });
  }
  if (b.low && b.available !== null) {
    alerts.push({
      scope: "Billing",
      level: "bad",
      text: `Only ${money(b.available)} ${b.currency} left before the account stops (alert at ${money(LOW_BALANCE_THRESHOLD)})`,
    });
  }
  return alerts;
}
