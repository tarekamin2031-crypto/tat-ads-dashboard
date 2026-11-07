import { db, ensureSchema } from "./db";

export type Account = {
  slug: string;
  name: string;
  ad_account_id: string;
  currency: string;
  timezone: string;
  password_hash: string;
  logo: string | null; // data: URI of the client's logo
  low_balance: number; // warn when this much (account currency) is left
  change_pct: number; // flag day-over-baseline moves of this fraction or more (0.4 = 40%)
  notify_visits: boolean; // Telegram message when the client opens the dashboard
  monthly_budget: number | null; // planned monthly spend (account currency, before tax); null = not set
};

export const DEFAULT_LOW_BALANCE = 1000;
export const DEFAULT_CHANGE_PCT = 0.4;

const toAccount = (r: Record<string, unknown>): Account => ({
  slug: String(r.slug),
  name: String(r.name),
  ad_account_id: String(r.ad_account_id),
  currency: String(r.currency),
  timezone: String(r.timezone),
  password_hash: String(r.password_hash),
  logo: r.logo ? String(r.logo) : null,
  low_balance: r.low_balance === null || r.low_balance === undefined ? DEFAULT_LOW_BALANCE : Number(r.low_balance),
  change_pct: r.change_pct === null || r.change_pct === undefined ? DEFAULT_CHANGE_PCT : Number(r.change_pct),
  notify_visits: r.notify_visits === null || r.notify_visits === undefined ? true : Number(r.notify_visits) !== 0,
  monthly_budget: r.monthly_budget === null || r.monthly_budget === undefined ? null : Number(r.monthly_budget),
});

export async function listAccounts(): Promise<Account[]> {
  await ensureSchema();
  const res = await db.execute("SELECT * FROM accounts ORDER BY name");
  return res.rows.map(toAccount);
}

export async function getAccount(slug: string): Promise<Account | null> {
  await ensureSchema();
  const res = await db.execute({ sql: "SELECT * FROM accounts WHERE slug = ?", args: [slug] });
  return res.rows[0] ? toAccount(res.rows[0]) : null;
}
