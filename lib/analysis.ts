import type { Account } from "./accounts";
import { RES_SUM } from "./results";
import { dateInTz } from "./dates";
import { db } from "./db";

// Rule-based performance analysis for the agency (admin) side. Looks at the last 30 complete days
// against the 30 before, and turns the numbers into "what to change" recommendations.
// Everything here is a suggestion to look at, not an automatic action.

export type Level = "bad" | "warn" | "good" | "info";
export type Recommendation = {
  level: Level;
  area: "Waste" | "Cost" | "Scale" | "Creative" | "Trend" | "Budget" | "Timing";
  scope: string;
  title: string;
  detail: string;
  action: string;
};
export type Verdict = "Scale" | "Keep" | "Fix" | "Pause" | "New";
export type CampaignStat = {
  id: string;
  name: string;
  spend: number;
  results: number;
  impressions: number;
  clicks: number;
  cpr: number | null;
  ctr: number;
  cpm: number;
  share: number; // of account spend, 0..1
  verdict: Verdict;
  why: string;
};
export type Weekday = { day: string; spend: number; results: number; cpr: number | null };
export type Analysis = {
  since: string;
  until: string;
  days: number;
  spend: number;
  results: number;
  cpr: number | null;
  prevSpend: number;
  prevResults: number;
  prevCpr: number | null;
  campaigns: CampaignStat[];
  weekdays: Weekday[];
  recs: Recommendation[];
};

const DAYS = 30;
const money = (v: number) => v.toLocaleString("en-US", { maximumFractionDigits: 0 });
const money2 = (v: number) => v.toLocaleString("en-US", { maximumFractionDigits: 2 });
const pct = (v: number) => `${Math.round(Math.abs(v) * 100)}%`;
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const ORDER: Record<Level, number> = { bad: 0, warn: 1, good: 2, info: 3 };

type Agg = { spend: number; results: number; impressions: number; clicks: number };
const zero = (): Agg => ({ spend: 0, results: 0, impressions: 0, clicks: 0 });
const add = (a: Agg, r: Agg) => {
  a.spend += r.spend;
  a.results += r.results;
  a.impressions += r.impressions;
  a.clicks += r.clicks;
};
const cprOf = (a: Agg) => (a.results > 0 ? a.spend / a.results : null);

export async function getAnalysis(account: Account): Promise<Analysis> {
  const tz = account.timezone;
  const until = dateInTz(tz, 1);
  const since = dateInTz(tz, DAYS);
  const prevSince = dateInTz(tz, DAYS * 2);
  const prevUntil = dateInTz(tz, DAYS + 1);
  const last7From = dateInTz(tz, 7);
  const prev7From = dateInTz(tz, 14);
  const prev7To = dateInTz(tz, 8);
  const cur = account.currency;

  // One query for everything: ad-set level per day over the 60-day window.
  const { rows } = await db.execute({
    sql: `SELECT date, campaign_id, campaign_name, adset_id, adset_name,
                 SUM(spend) AS spend, ${RES_SUM} AS results,
                 SUM(impressions) AS impressions, SUM(clicks) AS clicks
          FROM daily_insights WHERE account_id = ? AND date BETWEEN ? AND ?
          GROUP BY date, campaign_id, campaign_name, adset_id, adset_name`,
    args: [account.ad_account_id, prevSince, until],
  });

  const total = zero();
  const prev = zero();
  const l7 = zero();
  const p7 = zero();
  const campaigns = new Map<string, { name: string; a: Agg; last7: Agg }>();
  const adsets = new Map<string, { name: string; campaign: string; a: Agg }>();
  const wd = WEEKDAYS.map(() => zero());

  for (const r of rows) {
    const date = String(r.date);
    const a: Agg = { spend: Number(r.spend ?? 0), results: Number(r.results ?? 0), impressions: Number(r.impressions ?? 0), clicks: Number(r.clicks ?? 0) };
    if (date < since) {
      add(prev, a);
      continue;
    }
    add(total, a);
    add(wd[new Date(`${date}T00:00:00Z`).getUTCDay()], a);
    if (date >= last7From) add(l7, a);
    else if (date >= prev7From && date <= prev7To) add(p7, a);

    const cid = String(r.campaign_id);
    const c = campaigns.get(cid) ?? { name: String(r.campaign_name), a: zero(), last7: zero() };
    add(c.a, a);
    if (date >= last7From) add(c.last7, a);
    campaigns.set(cid, c);

    const sid = `${cid}|${String(r.adset_id)}`;
    const s = adsets.get(sid) ?? { name: String(r.adset_name), campaign: String(r.campaign_name), a: zero() };
    add(s.a, a);
    adsets.set(sid, s);
  }
  // 7-day windows before "since" also matter when the 30-day window is short; they are inside it here.

  const avgCpr = cprOf(total);
  const recs: Recommendation[] = [];
  const out: CampaignStat[] = [];
  const enoughData = total.results >= 10 && avgCpr !== null;

  for (const [id, c] of campaigns) {
    if (c.a.spend <= 0 && c.a.impressions <= 0) continue;
    const cpr = cprOf(c.a);
    const share = total.spend ? c.a.spend / total.spend : 0;
    const ctr = c.a.impressions ? (c.a.clicks / c.a.impressions) * 100 : 0;
    const cpm = c.a.impressions ? (c.a.spend / c.a.impressions) * 1000 : 0;
    let verdict: Verdict = "Keep";
    let why = "Close to the account average.";

    if (!enoughData) {
      verdict = "New";
      why = "Not enough results yet to judge.";
    } else if (c.a.results === 0 && c.a.spend >= Math.max(total.spend * 0.05, avgCpr)) {
      verdict = "Pause";
      why = `${money(c.a.spend)} ${cur} spent, no results.`;
      recs.push({
        level: "bad",
        area: "Waste",
        scope: c.name,
        title: `${money(c.a.spend)} ${cur} spent with no results (${pct(share)} of spend)`,
        action: "Pause it, or change the audience, offer or creative before spending more.",
        detail: `The account averages ${money2(avgCpr)} ${cur} per result, so this should have produced about ${Math.floor(c.a.spend / avgCpr)} results.`,
      });
    } else if (cpr !== null && cpr >= avgCpr * 1.5 && share >= 0.04 && c.a.results >= 3) {
      verdict = "Fix";
      why = `Costs ${pct(cpr / avgCpr - 1)} more than the account average.`;
      const gain = Math.floor(c.a.spend / avgCpr - c.a.results);
      recs.push({
        level: "warn",
        area: "Cost",
        scope: c.name,
        title: `Cost per result is ${money2(cpr)} ${cur}, ${pct(cpr / avgCpr - 1)} above the account average`,
        action: "Check its worst ad set and creative first. If it does not improve in about a week, move budget to a cheaper campaign.",
        detail: `It takes ${pct(share)} of spend. At the average cost the same spend would bring about ${gain > 0 ? `${gain} more results` : "a few more results"}.`,
      });
    } else if (cpr !== null && cpr <= avgCpr * 0.75 && c.a.results >= 5) {
      verdict = "Scale";
      why = `Costs ${pct(1 - cpr / avgCpr)} less than the account average.`;
      recs.push({
        level: "good",
        area: "Scale",
        scope: c.name,
        title: `Cheapest results: ${money2(cpr)} ${cur} each, ${pct(1 - cpr / avgCpr)} below the account average`,
        action: "Raise its budget in steps of about 20% every few days and watch that cost per result holds.",
        detail: `${c.a.results} results from ${money(c.a.spend)} ${cur}. Only ${pct(share)} of spend goes here today.`,
      });
    }

    if (verdict === "Keep" && c.a.results === 0 && c.a.spend > 0) why = "No leads/messages/purchases/profile visits recorded. May be a traffic or awareness campaign.";
    if (c.a.impressions >= 5000 && ctr < 0.8 && c.a.results > 0) {
      recs.push({
        level: "warn",
        area: "Creative",
        scope: c.name,
        title: `Low click rate: ${ctr.toFixed(2)}% CTR over ${money(c.a.impressions)} impressions`,
        action: "Test a stronger hook or a new image/video. A weak first line is the usual cause.",
        detail: "Below about 0.8% usually means people scroll past the ad.",
      });
    }
    out.push({ id, name: c.name, spend: c.a.spend, results: c.a.results, impressions: c.a.impressions, clicks: c.a.clicks, cpr, ctr, cpm, share, verdict, why });
  }
  out.sort((a, b) => b.spend - a.spend);

  // Ad sets (audiences) that drag a campaign down. Only the clearest cases, to keep the list short.
  if (enoughData) {
    const campaignCpr = new Map<string, number | null>();
    for (const c of campaigns.values()) campaignCpr.set(c.name, cprOf(c.a));
    const asRecs: Recommendation[] = [];
    for (const s of adsets.values()) {
      const base = campaignCpr.get(s.campaign);
      const campaignSpend = campaigns.size ? [...campaigns.values()].find((c) => c.name === s.campaign)?.a.spend ?? 0 : 0;
      if (!base || campaignSpend <= 0) continue;
      const cpr = cprOf(s.a);
      if (cpr !== null && s.a.results >= 4 && cpr >= base * 1.5 && s.a.spend >= campaignSpend * 0.2) {
        asRecs.push({
          level: "warn",
          area: "Cost",
          scope: `${s.campaign} / ${s.name}`,
          title: `This audience costs ${money2(cpr)} ${cur} per result vs ${money2(base)} for its campaign`,
          action: "Lower its budget or pause it and let the better audiences in the campaign take the spend.",
          detail: `${s.a.results} results from ${money(s.a.spend)} ${cur}.`,
        });
      } else if (cpr === null && s.a.spend >= Math.max(campaignSpend * 0.2, base)) {
        asRecs.push({
          level: "bad",
          area: "Waste",
          scope: `${s.campaign} / ${s.name}`,
          title: `${money(s.a.spend)} ${cur} spent on this audience with no results`,
          action: "Pause this ad set, or replace its creative.",
          detail: `Its campaign gets a result for about ${money2(base)} ${cur}.`,
        });
      }
    }
    recs.push(...asRecs.slice(0, 4));
  }

  // Account trend: last 7 days against the 7 before.
  const l7Cpr = cprOf(l7);
  const p7Cpr = cprOf(p7);
  if (l7Cpr !== null && p7Cpr !== null && l7.results >= 5 && p7.results >= 5) {
    const ch = (l7Cpr - p7Cpr) / p7Cpr;
    if (ch >= 0.25) {
      recs.push({
        level: "bad",
        area: "Trend",
        scope: "Whole account",
        title: `Cost per result rose ${pct(ch)} in the last 7 days (${money2(p7Cpr)} to ${money2(l7Cpr)} ${cur})`,
        action: "Look at which campaign moved. Often it is a tired creative or a competitor spike. Refresh ads or tighten audiences.",
        detail: "Compared with the 7 days before.",
      });
    } else if (ch <= -0.25) {
      recs.push({
        level: "good",
        area: "Trend",
        scope: "Whole account",
        title: `Cost per result fell ${pct(ch)} in the last 7 days (${money2(p7Cpr)} to ${money2(l7Cpr)} ${cur})`,
        action: "Do not change what is working. This is a good moment to raise budget on the cheapest campaign.",
        detail: "Compared with the 7 days before.",
      });
    }
  }
  if (p7.spend > 0 && l7.spend > 0) {
    const ch = (l7.spend - p7.spend) / p7.spend;
    if (ch <= -0.3) {
      recs.push({
        level: "warn",
        area: "Trend",
        scope: "Whole account",
        title: `Spend fell ${pct(ch)} in the last 7 days`,
        action: "Check for paused ads, rejected ads, low balance or a narrowed audience.",
        detail: `${money(p7.spend)} to ${money(l7.spend)} ${cur} over 7 days.`,
      });
    }
  }
  // Creative fatigue: clicks getting scarcer while impressions get pricier.
  if (l7.impressions >= 3000 && p7.impressions >= 3000) {
    const ctrNow = l7.clicks / l7.impressions;
    const ctrBefore = p7.clicks / p7.impressions;
    const cpmNow = l7.spend / l7.impressions;
    const cpmBefore = p7.spend / p7.impressions;
    if (ctrBefore > 0 && ctrNow < ctrBefore * 0.85 && cpmNow > cpmBefore * 1.1) {
      recs.push({
        level: "warn",
        area: "Creative",
        scope: "Whole account",
        title: `Possible ad fatigue: CTR down ${pct(ctrNow / ctrBefore - 1)} while CPM is up ${pct(cpmNow / cpmBefore - 1)}`,
        action: "Add fresh creatives (new image/video or copy) to the main campaigns.",
        detail: "People are seeing the same ads and clicking less, so each impression costs more.",
      });
    }
  }

  // Weekday pattern (needs several weeks to mean anything).
  const weekdays: Weekday[] = wd.map((a, i) => ({ day: WEEKDAYS[i], spend: a.spend, results: a.results, cpr: cprOf(a) }));
  if (enoughData) {
    const ok = weekdays.filter((w) => w.cpr !== null && w.results >= 5);
    if (ok.length >= 5) {
      const best = ok.reduce((x, y) => (x.cpr! <= y.cpr! ? x : y));
      const worst = ok.reduce((x, y) => (x.cpr! >= y.cpr! ? x : y));
      if (best.cpr! <= avgCpr * 0.8 && worst.cpr! >= avgCpr * 1.25) {
        recs.push({
          level: "info",
          area: "Timing",
          scope: "Whole account",
          title: `${best.day} is the cheapest day (${money2(best.cpr!)} ${cur}), ${worst.day} the most expensive (${money2(worst.cpr!)} ${cur})`,
          action: `Consider shifting some daily budget towards ${best.day} and away from ${worst.day}.`,
          detail: "Based on the last 30 days, so treat it as a hint to test, not a rule.",
        });
      }
    }
  }

  // Budget pacing for the month, same logic as the client dashboard.
  if (account.monthly_budget) {
    const today = dateInTz(tz, 0);
    const [y, m, d] = today.split("-").map(Number);
    const elapsed = d - 1;
    if (elapsed >= 3) {
      const res = await db.execute({
        sql: "SELECT SUM(spend) AS spend FROM daily_insights WHERE account_id = ? AND date BETWEEN ? AND ?",
        args: [account.ad_account_id, `${today.slice(0, 7)}-01`, today],
      });
      const spent = Number(res.rows[0]?.spend ?? 0);
      const dim = new Date(Date.UTC(y, m, 0)).getUTCDate();
      const forecast = (spent / elapsed) * dim;
      const ratio = forecast / account.monthly_budget;
      if (ratio > 1.05) {
        recs.push({
          level: "warn",
          area: "Budget",
          scope: "Monthly budget",
          title: `On pace to spend ${money(forecast)} ${cur}, ${pct(ratio - 1)} over the ${money(account.monthly_budget)} budget`,
          action: "Lower daily budgets a little so the month ends on target, or confirm the extra spend with the client.",
          detail: `${money(spent)} ${cur} spent so far this month.`,
        });
      } else if (ratio < 0.85) {
        recs.push({
          level: "warn",
          area: "Budget",
          scope: "Monthly budget",
          title: `On pace to spend only ${money(forecast)} ${cur}, ${pct(1 - ratio)} under the ${money(account.monthly_budget)} budget`,
          action: "Raise daily budgets on the best campaigns, or check that nothing stopped delivering.",
          detail: `${money(spent)} ${cur} spent so far this month.`,
        });
      }
    }
  }

  // Too much in one basket.
  const top = out[0];
  if (top && out.length >= 3 && top.share >= 0.7) {
    recs.push({
      level: "info",
      area: "Cost",
      scope: top.name,
      title: `${pct(top.share)} of all spend goes to one campaign`,
      action: "Make sure a second campaign is tested so results do not depend on a single one.",
      detail: `There are ${out.length} active campaigns.`,
    });
  }

  recs.sort((a, b) => ORDER[a.level] - ORDER[b.level]);
  return {
    since,
    until,
    days: DAYS,
    spend: total.spend,
    results: total.results,
    cpr: avgCpr,
    prevSpend: prev.spend,
    prevResults: prev.results,
    prevCpr: cprOf(prev),
    campaigns: out,
    weekdays,
    recs,
  };
}
