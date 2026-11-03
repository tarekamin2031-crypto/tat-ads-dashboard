import { createClient } from "@libsql/client";

export const db = createClient({
  url: process.env.DATABASE_URL ?? "file:local.db",
  authToken: process.env.DATABASE_AUTH_TOKEN || undefined,
});

export async function migrate() {
  // Insights used to be stored per campaign; they are now per ad set. The table is only a
  // cache of Meta data, so drop the old shape and let the next sync backfill it.
  const cols = await db.execute("PRAGMA table_info(daily_insights)");
  if (cols.rows.length > 0 && !cols.rows.some((c) => c.name === "adset_id")) {
    await db.execute("DROP TABLE daily_insights");
  }

  const accountCols = await db.execute("PRAGMA table_info(accounts)");
  if (accountCols.rows.length > 0 && !accountCols.rows.some((c) => c.name === "logo")) {
    await db.execute("ALTER TABLE accounts ADD COLUMN logo TEXT");
  }

  await db.batch([
    `CREATE TABLE IF NOT EXISTS accounts (
      slug TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      ad_account_id TEXT NOT NULL UNIQUE,
      currency TEXT NOT NULL DEFAULT 'USD',
      timezone TEXT NOT NULL DEFAULT 'UTC',
      password_hash TEXT NOT NULL,
      logo TEXT
    )`,
    `CREATE TABLE IF NOT EXISTS campaigns (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      name TEXT NOT NULL,
      status TEXT,
      objective TEXT
    )`,
    `CREATE TABLE IF NOT EXISTS daily_insights (
      date TEXT NOT NULL,
      account_id TEXT NOT NULL,
      campaign_id TEXT NOT NULL,
      campaign_name TEXT NOT NULL,
      adset_id TEXT NOT NULL,
      adset_name TEXT NOT NULL,
      spend REAL NOT NULL DEFAULT 0,
      impressions INTEGER NOT NULL DEFAULT 0,
      reach INTEGER NOT NULL DEFAULT 0,
      clicks INTEGER NOT NULL DEFAULT 0,
      leads INTEGER NOT NULL DEFAULT 0,
      purchases INTEGER NOT NULL DEFAULT 0,
      messages INTEGER NOT NULL DEFAULT 0,
      purchase_value REAL NOT NULL DEFAULT 0,
      PRIMARY KEY (date, adset_id)
    )`,
    `CREATE INDEX IF NOT EXISTS idx_insights_account_date ON daily_insights (account_id, date)`,
  ]);
}

let ready: Promise<void> | undefined;
export const ensureSchema = () => (ready ??= migrate());
