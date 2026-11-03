import type { Account } from "./accounts";
import { dateInTz } from "./dates";
import { db } from "./db";
import { fetchCampaigns, fetchInsights } from "./meta";

const BACKFILL_DAYS = 90;
const REFRESH_DAYS = 7; // Meta revises recent numbers, so re-pull the last week

const COLS = [
  "date", "account_id", "campaign_id", "campaign_name", "adset_id", "adset_name", "spend", "impressions", "reach",
  "clicks", "leads", "purchases", "messages", "purchase_value",
] as const;

export async function syncAccount(acc: Account): Promise<string> {
  const existing = await db.execute({
    sql: "SELECT COUNT(*) AS n FROM daily_insights WHERE account_id = ?",
    args: [acc.ad_account_id],
  });
  const firstRun = Number(existing.rows[0].n) === 0;
  const since = dateInTz(acc.timezone, firstRun ? BACKFILL_DAYS : REFRESH_DAYS);
  const until = dateInTz(acc.timezone, 0);

  const [campaigns, insights] = await Promise.all([
    fetchCampaigns(acc.ad_account_id),
    fetchInsights(acc.ad_account_id, since, until),
  ]);

  const BATCH = 200;
  for (let i = 0; i < campaigns.length; i += BATCH) {
    await db.batch(
      campaigns.slice(i, i + BATCH).map((c) => ({
        sql: `INSERT INTO campaigns (id, account_id, name, status, objective) VALUES (?, ?, ?, ?, ?)
              ON CONFLICT(id) DO UPDATE SET name = excluded.name, status = excluded.status, objective = excluded.objective`,
        args: [c.id, acc.ad_account_id, c.name, c.status, c.objective],
      })),
    );
  }
  for (let i = 0; i < insights.length; i += BATCH) {
    await db.batch(
      insights.slice(i, i + BATCH).map((r) => {
        const row: Record<string, string | number> = { ...r, account_id: acc.ad_account_id };
        return {
          sql: `INSERT OR REPLACE INTO daily_insights (${COLS.join(",")}) VALUES (${COLS.map(() => "?").join(",")})`,
          args: COLS.map((c) => row[c]),
        };
      }),
    );
  }

  return `${acc.name}: ${since} -> ${until}${firstRun ? " (backfill)" : ""}, ${campaigns.length} campaigns, ${insights.length} daily rows`;
}
