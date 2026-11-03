import type { Account } from "./accounts";
import { dateInTz } from "./dates";
import { db } from "./db";

export type Alert = { scope: string; level: "bad" | "warn" | "good"; text: string };

const THRESHOLD = 0.4; // flag moves of 40% or more versus the baseline
const BASELINE_DAYS = 7;
const MIN_BASELINE_ACTIVE_DAYS = 3; // new/rarely-running campaigns have no "normal" yet

type Day = { spend: number; results: number };

const pct = (v: number) => `${Math.round(Math.abs(v) * 100)}%`;
const money = (v: number) => v.toLocaleString("en-US", { maximumFractionDigits: 0 });

// Compares yesterday with the average of the 7 days before it, for the whole account and for
// each campaign. Yesterday is the last complete day, same as the dashboard's presets.
export async function getAlerts(account: Account): Promise<Alert[]> {
  const tz = account.timezone;
  const yesterday = dateInTz(tz, 1);
  const baseFrom = dateInTz(tz, 1 + BASELINE_DAYS);
  const baseTo = dateInTz(tz, 2);

  const { rows } = await db.execute({
    sql: `SELECT date, campaign_id, campaign_name,
                 SUM(spend) AS spend, SUM(leads + purchases + messages) AS results
          FROM daily_insights
          WHERE account_id = ? AND date BETWEEN ? AND ?
          GROUP BY date, campaign_id, campaign_name`,
    args: [account.ad_account_id, baseFrom, yesterday],
  });

  type Entity = { name: string; yesterday: Day; base: Day; activeDays: number };
  const empty = (name: string): Entity => ({
    name,
    yesterday: { spend: 0, results: 0 },
    base: { spend: 0, results: 0 },
    activeDays: 0,
  });
  const entities = new Map<string, Entity>();
  const dayHasSpend = new Set<string>();

  for (const r of rows) {
    const spend = Number(r.spend ?? 0);
    const results = Number(r.results ?? 0);
    const date = String(r.date);
    for (const [key, name] of [
      ["__account__", "Whole account"],
      [String(r.campaign_id), String(r.campaign_name)],
    ]) {
      const e = entities.get(key) ?? empty(name);
      if (date === yesterday) {
        e.yesterday.spend += spend;
        e.yesterday.results += results;
      } else {
        e.base.spend += spend;
        e.base.results += results;
        if (spend > 0 && !dayHasSpend.has(`${key}|${date}`)) {
          dayHasSpend.add(`${key}|${date}`);
          e.activeDays++;
        }
      }
      entities.set(key, e);
    }
  }

  // With a single campaign the account line would just repeat the campaign's alerts.
  if (entities.size === 2) entities.delete("__account__");

  const alerts: Alert[] = [];
  for (const e of entities.values()) {
    if (e.activeDays < MIN_BASELINE_ACTIVE_DAYS) continue;
    const avgSpend = e.base.spend / e.activeDays;
    const { yesterday: y } = e;
    const cur = account.currency;

    if (y.spend === 0) {
      alerts.push({ scope: e.name, level: "bad", text: `No spend yesterday (usually ~${money(avgSpend)} ${cur}/day)` });
      continue;
    }

    const spendChange = (y.spend - avgSpend) / avgSpend;
    if (Math.abs(spendChange) >= THRESHOLD) {
      alerts.push({
        scope: e.name,
        level: "warn",
        text: `Spend ${spendChange > 0 ? "up" : "down"} ${pct(spendChange)}: ${money(y.spend)} ${cur} vs ~${money(avgSpend)} usual`,
      });
    }

    if (e.base.results > 0) {
      const baseCpr = e.base.spend / e.base.results;
      if (y.results === 0) {
        // Only worth flagging once it has spent about what one result normally costs.
        if (y.spend >= baseCpr) {
          alerts.push({ scope: e.name, level: "bad", text: `${money(y.spend)} ${cur} spent with no results (a result usually costs ~${money(baseCpr)})` });
        }
      } else {
        const cpr = y.spend / y.results;
        const cprChange = (cpr - baseCpr) / baseCpr;
        if (cprChange >= THRESHOLD) {
          alerts.push({ scope: e.name, level: "bad", text: `Cost per result up ${pct(cprChange)}: ${money(cpr)} ${cur} vs ~${money(baseCpr)} usual` });
        } else if (cprChange <= -THRESHOLD) {
          alerts.push({ scope: e.name, level: "good", text: `Cost per result down ${pct(cprChange)}: ${money(cpr)} ${cur} vs ~${money(baseCpr)} usual` });
        }
      }
    }
  }

  const order = { bad: 0, warn: 1, good: 2 };
  return alerts.sort((a, b) => order[a.level] - order[b.level]);
}
