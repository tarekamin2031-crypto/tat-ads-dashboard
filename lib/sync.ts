import { isMetaAccount, type Account } from "./accounts";
import { dateInTz } from "./dates";
import { db } from "./db";
import { fetchCampaigns, fetchInsights, type InsightRow } from "./meta";
import { insightsKey, platformReady } from "./platforms";
import { fetchGoogleInsights } from "./google";
import { loadCredentials } from "./secrets";
import { fetchTikTokInsights } from "./tiktok";

const BACKFILL_DAYS = 90;
const REFRESH_DAYS = 7; // Meta revises recent numbers, so re-pull the last week

const COLS = [
  "date", "account_id", "campaign_id", "campaign_name", "adset_id", "adset_name", "spend", "impressions", "reach",
  "clicks", "leads", "purchases", "messages", "purchase_value",
] as const;

export async function syncAccount(acc: Account): Promise<string> {
  if (!isMetaAccount(acc)) return `${acc.name}: no Meta account (data comes from other platforms)`;
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

  // Lets the dashboard tell "no spend yesterday" apart from "the sync hasn't run".
  await db.execute({
    sql: "INSERT OR REPLACE INTO sync_log (account_id, synced_at) VALUES (?, ?)",
    args: [acc.ad_account_id, new Date().toISOString()],
  });

  return `${acc.name}: ${since} -> ${until}${firstRun ? " (backfill)" : ""}, ${campaigns.length} campaigns, ${insights.length} daily rows`;
}

async function storeInsights(key: string, insights: InsightRow[]) {
  const BATCH = 200;
  for (let i = 0; i < insights.length; i += BATCH) {
    await db.batch(
      insights.slice(i, i + BATCH).map((r) => {
        const row: Record<string, string | number> = { ...r, account_id: key };
        return {
          sql: `INSERT OR REPLACE INTO daily_insights (${COLS.join(",")}) VALUES (${COLS.map(() => "?").join(",")})`,
          args: COLS.map((c) => row[c]),
        };
      }),
    );
  }
  await db.execute({ sql: "INSERT OR REPLACE INTO sync_log (account_id, synced_at) VALUES (?, ?)", args: [key, new Date().toISOString()] });
}

// Pulls every non-Meta platform linked to this client that the server has credentials for.
const FETCHERS: Record<string, { label: string; fetch: (id: string, since: string, until: string) => Promise<InsightRow[]> }> = {
  tiktok: { label: "TikTok", fetch: fetchTikTokInsights },
  google: { label: "Google Ads", fetch: fetchGoogleInsights },
};

export async function syncOtherPlatforms(acc: Account): Promise<string[]> {
  await loadCredentials();
  const linked = await db.execute({ sql: "SELECT platform, external_id FROM account_platforms WHERE slug = ?", args: [acc.slug] });
  const notes: string[] = [];
  for (const r of linked.rows) {
    const platform = String(r.platform);
    const f = FETCHERS[platform];
    if (!f || !platformReady(platform)) continue;
    const key = insightsKey(platform, String(r.external_id));
    const existing = await db.execute({ sql: "SELECT COUNT(*) AS n FROM daily_insights WHERE account_id = ?", args: [key] });
    const firstRun = Number(existing.rows[0].n) === 0;
    const since = dateInTz(acc.timezone, firstRun ? BACKFILL_DAYS : REFRESH_DAYS);
    const until = dateInTz(acc.timezone, 0);
    try {
      const rows = await f.fetch(String(r.external_id), since, until);
      await storeInsights(key, rows);
      await db.execute({ sql: "INSERT OR REPLACE INTO sync_log (account_id, synced_at) VALUES (?, ?)", args: [key, new Date().toISOString()] });
      notes.push(`${acc.name} [${f.label}]: ${since} -> ${until}${firstRun ? " (backfill)" : ""}, ${rows.length} daily rows`);
    } catch (e) {
      notes.push(`${acc.name} [${f.label}]: FAILED ${(e as Error).message}`);
    }
  }
  return notes;
}
