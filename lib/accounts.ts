import { db, ensureSchema } from "./db";

export type Account = {
  slug: string;
  name: string;
  ad_account_id: string;
  currency: string;
  timezone: string;
  password_hash: string;
  logo: string | null; // data: URI of the client's logo
};

const toAccount = (r: Record<string, unknown>): Account => ({
  slug: String(r.slug),
  name: String(r.name),
  ad_account_id: String(r.ad_account_id),
  currency: String(r.currency),
  timezone: String(r.timezone),
  password_hash: String(r.password_hash),
  logo: r.logo ? String(r.logo) : null,
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
