import { after } from "next/server";
import type { Account } from "@/lib/accounts";
import { AlertModal } from "@/components/AlertModal";
import { BillingAlerts, BillingPanel } from "@/components/BillingPanel";
import { BrandBar, BrandFooter, ClientHero } from "@/components/Brand";
import { CampaignTable, type Row } from "@/components/CampaignTable";
import { DayChart, type Point } from "@/components/DayChart";
import { PrintButton } from "@/components/PrintButton";
import { billingAlerts, getBilling, TAX_RATE } from "@/lib/billing";
import { dateInTz, PRESET_DAYS, type Range } from "@/lib/dates";
import { db } from "@/lib/db";
import { notifyVisit } from "@/lib/notify";

type Totals = {
  spend: number;
  impressions: number;
  clicks: number;
  leads: number;
  purchases: number;
  messages: number;
  purchase_value: number;
};

const num = (v: unknown) => Number(v ?? 0);
const money = (v: number) => v.toLocaleString("en-US", { maximumFractionDigits: 2 });
const money0 = (v: number) => v.toLocaleString("en-US", { maximumFractionDigits: 0 });
const int = (v: number) => v.toLocaleString("en-US", { maximumFractionDigits: 0 });
const results = (t: Totals) => t.leads + t.purchases + t.messages;
const cprOf = (t: Totals) => (results(t) ? t.spend / results(t) : null);

// Name the headline after what the account actually gets (messages, leads, purchases).
const KINDS = [
  { k: "leads", one: "lead", label: "Leads" },
  { k: "messages", one: "message", label: "Messages" },
  { k: "purchases", one: "purchase", label: "Purchases" },
] as const;
function resultNames(t: Totals) {
  const present = KINDS.filter((x) => t[x.k] > 0);
  return present.length === 1 ? { label: present[0].label, one: present[0].one, present } : { label: "Results", one: "result", present };
}

function toTotals(r: Record<string, unknown>, k = 1): Totals {
  return {
    spend: num(r.spend) * k,
    impressions: num(r.impressions),
    clicks: num(r.clicks),
    leads: num(r.leads),
    purchases: num(r.purchases),
    messages: num(r.messages),
    purchase_value: num(r.purchase_value),
  };
}

const SUMS = `SUM(spend) AS spend, SUM(impressions) AS impressions, SUM(clicks) AS clicks,
  SUM(leads) AS leads, SUM(purchases) AS purchases, SUM(messages) AS messages,
  SUM(purchase_value) AS purchase_value`;

const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const eachDate = (from: string, to: string) => {
  const out: string[] = [];
  for (let d = from; d <= to && out.length < 400; d = addDays(d, 1)) out.push(d);
  return out;
};
const niceDate = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

function Spark({ values }: { values: (number | null)[] }) {
  const pts = values.map((v, i) => ({ v, i })).filter((p): p is { v: number; i: number } => p.v !== null);
  if (pts.length < 2) return <span className="spark" />;
  const W = 84;
  const H = 28;
  const max = Math.max(...pts.map((p) => p.v));
  const min = Math.min(...pts.map((p) => p.v));
  const span = max - min || 1;
  const x = (i: number) => 3 + ((W - 6) * i) / Math.max(values.length - 1, 1);
  const y = (v: number) => H - 4 - ((H - 8) * (v - min)) / span;
  const last = pts[pts.length - 1];
  return (
    <svg className="spark" viewBox={`0 0 ${W} ${H}`} aria-hidden>
      <polyline points={pts.map((p) => `${x(p.i)},${y(p.v)}`).join(" ")} fill="none" stroke="#0f766e" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(last.i)} cy={y(last.v)} r={3} fill="#0f766e" stroke="#fff" strokeWidth={1.5} />
    </svg>
  );
}

// goodWhenUp: true = rising is good (results), false = rising is bad (cost per result), null = neutral (spend).
function Delta({ cur, prev, goodWhenUp, days }: { cur: number | null; prev: number | null; goodWhenUp: boolean | null; days: number }) {
  if (cur === null || prev === null || prev === 0) return <span className="delta"><small>no prior period</small></span>;
  const pct = ((cur - prev) / prev) * 100;
  if (Math.abs(pct) < 0.5) return <span className="delta">– <small>vs prev. {days}d</small></span>;
  const tone = goodWhenUp === null ? "" : pct > 0 === goodWhenUp ? " good" : " bad";
  return (
    <span className={`delta${tone}`}>
      {pct > 0 ? "▲" : "▼"} {Math.abs(pct).toFixed(1)}% <small>vs prev. {days}d</small>
    </span>
  );
}

function Tile(props: { label: string; value: string; cur: number | null; prev: number | null; goodWhenUp: boolean | null; days: number; spark: (number | null)[] }) {
  return (
    <div className="card tile">
      <div className="tile-label">{props.label}</div>
      <div className="tile-value">{props.value}</div>
      <div className="tile-foot">
        <Delta cur={props.cur} prev={props.prev} goodWhenUp={props.goodWhenUp} days={props.days} />
        <Spark values={props.spark} />
      </div>
    </div>
  );
}

export type PlatformTab = { id: string; label: string; key: string };

// platforms: tabs to show (only when the client has more than one with data); current: the active one.
export async function Dashboard({
  account,
  range,
  basePath,
  platforms,
  current,
  tax = false,
}: {
  account: Account;
  range: Range;
  basePath: string;
  platforms: PlatformTab[];
  current: PlatformTab;
  tax?: boolean;
}) {
  const isMeta = current.id === "meta";
  const taxOn = isMeta && tax;
  const k = taxOn ? 1 + TAX_RATE : 1;
  const tt = (r: Record<string, unknown>) => toTotals(r, k);
  const pq = `${isMeta ? "" : `&p=${current.id}`}${taxOn ? "&tax=1" : ""}`;
  const { since, until } = range;
  const today = dateInTz(account.timezone, 0);
  const includesToday = until === today;
  const id = current.key;
  const cur = account.currency;

  const dates = eachDate(since, until);
  const len = dates.length;
  const prevUntil = addDays(since, -1);
  const prevSince = addDays(since, -len);

  // Three data queries (was eight): one daily series covering the previous + current period, one
  // ad-set breakdown (campaign totals are summed from it), and the last-synced date. Fewer round
  // trips matters most on a remote database.
  const [billing, dailyRes, adsetRes, lastRes, monthRes] = await Promise.all([
    getBilling(account),
    db.execute({
      sql: `SELECT date, ${SUMS} FROM daily_insights WHERE account_id = ? AND date BETWEEN ? AND ? GROUP BY date`,
      args: [id, prevSince, until],
    }),
    db.execute({
      sql: `SELECT campaign_id, campaign_name, adset_id, adset_name, ${SUMS} FROM daily_insights
            WHERE account_id = ? AND date BETWEEN ? AND ?
            GROUP BY campaign_id, campaign_name, adset_id, adset_name ORDER BY spend DESC`,
      args: [id, since, until],
    }),
    db.execute({ sql: "SELECT MAX(date) AS d FROM daily_insights WHERE account_id = ?", args: [id] }),
    isMeta && account.monthly_budget
      ? db.execute({ sql: "SELECT SUM(spend) AS spend FROM daily_insights WHERE account_id = ? AND date BETWEEN ? AND ?", args: [id, `${today.slice(0, 7)}-01`, today] })
      : Promise.resolve(null),
  ]);

  // Runs after the response is sent, so the Telegram call never slows the client's page.
  after(() => notifyVisit(account, billing));

  const sumRows = (rows: Record<string, unknown>[]) => {
    const t = tt({});
    for (const r of rows) {
      const x = tt(r);
      t.spend += x.spend; t.impressions += x.impressions; t.clicks += x.clicks; t.leads += x.leads;
      t.purchases += x.purchases; t.messages += x.messages; t.purchase_value += x.purchase_value;
    }
    return t;
  };
  const dailyAll = dailyRes.rows as Record<string, unknown>[];
  const total = sumRows(dailyAll.filter((r) => String(r.date) >= since));
  const prev = sumRows(dailyAll.filter((r) => String(r.date) < since));
  const showRoas = total.purchase_value > 0;

  const byDate = new Map(dailyAll.filter((r) => String(r.date) >= since).map((r) => [String(r.date), tt(r)]));
  const series = dates.map((d) => byDate.get(d) ?? tt({}));
  const spendPts: Point[] = dates.map((d, i) => ({ date: d, value: series[i].spend }));
  const resultPts: Point[] = dates.map((d, i) => ({ date: d, value: results(series[i]) }));
  const cprPts: Point[] = dates.map((d, i) => ({ date: d, value: cprOf(series[i]) }));
  const maxSpend = Math.max(1, ...series.map((s) => s.spend));
  const prevByDate = new Map(dailyAll.filter((r) => String(r.date) < since).map((r) => [String(r.date), tt(r)]));
  const prevSeries = eachDate(prevSince, prevUntil).map((d) => prevByDate.get(d) ?? tt({}));
  const hasPrev = prevSeries.some((s) => s.spend > 0);
  const prevSpend = hasPrev ? prevSeries.map((s) => s.spend) : undefined;
  const prevResults = hasPrev ? prevSeries.map((s) => results(s)) : undefined;
  const prevCprs = hasPrev ? prevSeries.map((s) => cprOf(s)) : undefined;

  const adsetsByCampaign = new Map<string, (Totals & { id: string; name: string })[]>();
  for (const r of adsetRes.rows) {
    const t = tt(r);
    if (t.spend <= 0 && t.impressions <= 0) continue;
    const list = adsetsByCampaign.get(String(r.campaign_id)) ?? [];
    list.push({ id: String(r.adset_id), name: String(r.adset_name), ...t });
    adsetsByCampaign.set(String(r.campaign_id), list);
  }
  // Campaigns and ad sets that did nothing in the period are noise; hide them.
  const active = (t: Totals) => t.spend > 0 || t.impressions > 0;
  const campMap = new Map<string, Totals & { id: string; name: string }>();
  for (const r of adsetRes.rows) {
    const t = tt(r);
    const cid = String(r.campaign_id);
    const c = campMap.get(cid) ?? { id: cid, name: String(r.campaign_name), ...tt({}) };
    c.spend += t.spend; c.impressions += t.impressions; c.clicks += t.clicks; c.leads += t.leads;
    c.purchases += t.purchases; c.messages += t.messages; c.purchase_value += t.purchase_value;
    campMap.set(cid, c);
  }
  const campaigns = [...campMap.values()].filter(active).sort((x, y) => y.spend - x.spend);

  const rn = resultNames(results(total) > 0 ? total : prev);
  const rowsForTable: Row[] = campaigns.map((c) => ({
    id: c.id,
    name: c.name,
    spend: c.spend,
    impressions: c.impressions,
    clicks: c.clicks,
    results: results(c),
    purchase_value: c.purchase_value,
    adsets: (adsetsByCampaign.get(c.id) ?? []).map((a) => ({
      id: a.id,
      name: a.name,
      spend: a.spend,
      impressions: a.impressions,
      clicks: a.clicks,
      results: results(a),
      purchase_value: a.purchase_value,
    })),
  }));

  const cpr = cprOf(total);
  const prevCpr = cprOf(prev);
  const ctr = total.impressions ? (total.clicks / total.impressions) * 100 : 0;
  const roas = total.spend ? total.purchase_value / total.spend : 0;
  const prevRoas = prev.spend ? prev.purchase_value / prev.spend : null;

  const change = (c: number | null, p: number | null) => (c === null || p === null || p === 0 ? null : ((c - p) / p) * 100);
  const dir = (v: number) => `${v > 0 ? "up" : "down"} ${Math.abs(v).toFixed(0)}%`;
  const spendCh = change(total.spend, prev.spend);
  const cprCh = change(cpr, prevCpr);
  const ranked = rowsForTable.filter((r) => r.results >= 3).map((r) => ({ name: r.name, c: r.spend / r.results })).sort((a, b) => a.c - b.c);
  const summary: string[] = [];
  if (total.spend <= 0) summary.push("No spend in this period.");
  else {
    summary.push(`You spent ${money0(total.spend)} ${cur}${spendCh !== null && Math.abs(spendCh) >= 1 ? `, ${dir(spendCh)} on the previous ${len} days` : ""}.`);
    if (results(total) > 0 && cpr !== null) {
      summary.push(`That brought ${int(results(total))} ${rn.label.toLowerCase()} at ${money(cpr)} ${cur} each${cprCh !== null && Math.abs(cprCh) >= 1 ? ` (cost ${dir(cprCh)})` : ""}.`);
    }
    if (ranked.length >= 2) summary.push(`Lowest cost per ${rn.one}: ${ranked[0].name} (${money(ranked[0].c)} ${cur}).`);
  }
  let pace: { budget: number; spent: number; forecast: number | null; timePct: number; status: string; tone: "good" | "warn" | "bad" } | null = null;
  if (monthRes && account.monthly_budget) {
    const budget = account.monthly_budget;
    const spent = num(monthRes.rows[0]?.spend);
    const [y, m, d] = today.split("-").map(Number);
    const dim = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const elapsed = d - 1; // full days with synced data (yesterday and before)
    const forecast = elapsed >= 1 ? (spent / elapsed) * dim : null;
    const ratio = forecast === null ? 1 : forecast / budget;
    const [status, tone] = forecast === null ? ["Month just started", "good"] : ratio > 1.05 ? ["Over pace", "bad"] : ratio < 0.85 ? ["Under pace", "warn"] : ["On track", "good"];
    pace = { budget, spent, forecast, timePct: (d / dim) * 100, status, tone: tone as "good" | "warn" | "bad" };
  }
  const monthName = new Date(`${today.slice(0, 7)}-01T00:00:00Z`).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
  // Highlights: positive, factual call-outs for the client (what worked best in this period).
  const hl: { label: string; value: string; note: string }[] = [];
  const activeDays = dates.map((d, i) => ({ d, s: series[i] })).filter((x) => results(x.s) > 0);
  if (activeDays.length >= 3) {
    const mostRes = activeDays.reduce((a, b) => (results(b.s) > results(a.s) ? b : a));
    hl.push({ label: `Best day for ${rn.label.toLowerCase()}`, value: niceDate(mostRes.d), note: `${int(results(mostRes.s))} ${rn.label.toLowerCase()} from ${money0(mostRes.s.spend)} ${cur}` });
    const cheap = activeDays.filter((x) => results(x.s) >= 2 && x.s.spend > 0).reduce<(typeof activeDays)[number] | null>((a, b) => (a === null || b.s.spend / results(b.s) < a.s.spend / results(a.s) ? b : a), null);
    if (cheap) hl.push({ label: `Lowest cost per ${rn.one} (a day)`, value: `${money(cheap.s.spend / results(cheap.s))} ${cur}`, note: `${niceDate(cheap.d)} · ${int(results(cheap.s))} ${rn.label.toLowerCase()}` });
  }
  const topCampaign = [...rowsForTable].filter((r) => r.results > 0).sort((a, b) => b.results - a.results)[0];
  if (topCampaign && rowsForTable.length > 1) hl.push({ label: `Campaign with most ${rn.label.toLowerCase()}`, value: topCampaign.name, note: `${int(topCampaign.results)} ${rn.label.toLowerCase()} at ${money(topCampaign.spend / topCampaign.results)} ${cur} each` });
  const bestSet = rowsForTable.flatMap((c) => c.adsets.map((a) => ({ ...a, campaign: c.name }))).filter((a) => a.results >= 3).sort((a, b) => a.spend / a.results - b.spend / b.results)[0];
  if (bestSet) hl.push({ label: "Best-performing audience", value: bestSet.name, note: `${money(bestSet.spend / bestSet.results)} ${cur} per ${rn.one} · ${bestSet.campaign}` });
  if (len >= 14) {
    const wd = Array.from({ length: 7 }, () => ({ n: 0, r: 0 }));
    dates.forEach((d, i) => { const w = wd[new Date(`${d}T00:00:00Z`).getUTCDay()]; w.n++; w.r += results(series[i]); });
    const names = ["Sundays", "Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays"];
    const avg = wd.map((w, i) => ({ i, a: w.n ? w.r / w.n : 0 }));
    const best = avg.reduce((a, b) => (b.a > a.a ? b : a));
    if (best.a > 0) hl.push({ label: "Strongest weekday", value: names[best.i], note: `${best.a.toFixed(1)} ${rn.label.toLowerCase()} per day on average` });
  }
  const resultRate = total.clicks ? (results(total) / total.clicks) * 100 : 0;
  const exportQs = range.kind === "daily" ? "range=daily" : range.kind === "days" ? `days=${range.days}` : `from=${since}&to=${until}`;

  const title = range.kind === "daily" ? "Yesterday" : range.kind === "days" ? `Last ${range.days} days` : "Custom range";
  const period = since === until ? niceDate(since) : `${niceDate(since)} – ${niceDate(until)}`;

  return (
    <>
      <BrandBar />
      <ClientHero name={account.name} logo={account.logo} platform={current.label}>
        <div className="hero-period">
          <b>{title}</b>
          <span>{period}{includesToday ? " · includes today (partial)" : ""}</span>
          <span className="hero-upd">Updated through {String(lastRes.rows[0]?.d ?? "n/a")}</span>
        </div>
      </ClientHero>
      {isMeta && <AlertModal items={billingAlerts(billing).map((a) => a.text)} />}
      <main className="wrap">
        {isMeta && <BillingAlerts billing={billing} />}

        {platforms.length > 1 && (
          <nav className="platform-tabs" aria-label="Platform">
            {platforms.map((p) => (
              <a key={p.id} href={`${basePath}?p=${p.id}${taxOn && p.id === "meta" ? "&tax=1" : ""}`} className={p.id === current.id ? "active" : ""} aria-current={p.id === current.id ? "page" : undefined}>
                {p.label}
              </a>
            ))}
          </nav>
        )}

        <nav className="toolbar" aria-label="Date range">
          <div className="seg">
            <a href={`${basePath}?range=daily${pq}`} className={range.kind === "daily" ? "active" : ""}>Yesterday</a>
            {PRESET_DAYS.map((d) => (
              <a key={d} href={`${basePath}?days=${d}${pq}`} className={range.kind === "days" && range.days === d ? "active" : ""}>
                {d}d
              </a>
            ))}
          </div>
          <details className={`custom${range.kind === "custom" ? " active" : ""}`}>
            <summary>Custom dates</summary>
            <form method="GET" action={basePath}>
              {!isMeta && <input type="hidden" name="p" value={current.id} />}
              {taxOn && <input type="hidden" name="tax" value="1" />}
              <input className="field" type="date" name="from" defaultValue={since} max={today} required aria-label="From" />
              <span aria-hidden>→</span>
              <input className="field" type="date" name="to" defaultValue={until} max={today} required aria-label="To" />
              <button className="btn" type="submit">Apply</button>
            </form>
          </details>
          <div className="toolbar-actions">
            {isMeta && (
              <a
                className={`btn ghost small${taxOn ? " on" : ""}`}
                href={`${basePath}?${exportQs}${taxOn ? "" : "&tax=1"}`}
                aria-pressed={taxOn}
                title={`Show spend ${taxOn ? "without" : "with"} the ${Math.round(TAX_RATE * 100)}% tax`}
              >
                {taxOn ? `Incl. tax ✓` : "Incl. tax"}
              </a>
            )}
            <a className="btn ghost small" href={`${basePath}/export?${exportQs}${pq}`}>Export CSV</a>
            <PrintButton />
          </div>
        </nav>

        {!isMeta && !lastRes.rows[0]?.d && (
          <p className="summary">No {current.label} data has been pulled for this account yet. It appears here after the next daily sync.</p>
        )}
        <p className="summary">{summary.join(" ")}</p>

        <section className={`tiles${showRoas ? " four" : ""}`} aria-label="Key numbers">
          <Tile label={`Spend${taxOn ? " incl. tax" : ""} (${cur})`} value={money0(total.spend)} cur={total.spend} prev={prev.spend} goodWhenUp={null} days={len} spark={spendPts.map((p) => p.value)} />
          <Tile label={rn.label} value={int(results(total))} cur={results(total)} prev={results(prev)} goodWhenUp={true} days={len} spark={resultPts.map((p) => p.value)} />
          <Tile label={`Cost per ${rn.one} (${cur})`} value={cpr === null ? "-" : money(cpr)} cur={cpr} prev={prevCpr} goodWhenUp={false} days={len} spark={cprPts.map((p) => p.value)} />
          {showRoas && <Tile label="ROAS" value={roas.toFixed(2)} cur={roas} prev={prevRoas} goodWhenUp={true} days={len} spark={series.map((s) => (s.spend ? s.purchase_value / s.spend : null))} />}
        </section>

        {pace && (
          <section className="card pace" aria-label="Monthly budget pacing">
            <div className="pace-head">
              <div>
                <div className="tile-label">Monthly budget · {monthName}</div>
                <div className="pace-main"><b>{money0(pace.spent)}</b> of {money0(pace.budget)} {cur} <span className="pace-pct">({Math.round((pace.spent / pace.budget) * 100)}%)</span></div>
              </div>
              <span className={`pill ${pace.tone}`}>{pace.status}</span>
            </div>
            <div className="pace-bar" role="img" aria-label={`${Math.round((pace.spent / pace.budget) * 100)}% of budget spent, ${Math.round(pace.timePct)}% of the month passed`}>
              <i style={{ width: `${Math.min(100, (pace.spent / pace.budget) * 100)}%` }} />
              <u style={{ left: `${pace.timePct}%` }} />
            </div>
            <div className="pace-foot">
              {pace.forecast === null ? "The forecast starts after the first full day of the month." : <>On this pace the month ends near <b>{money0(pace.forecast)} {cur}</b>{pace.forecast > pace.budget ? `, ${money0(pace.forecast - pace.budget)} over budget` : `, ${money0(pace.budget - pace.forecast)} under budget`}.</>}
              {" "}Before tax · marker shows how much of the month has passed.
            </div>
          </section>
        )}

        <section className="mini-tiles" aria-label="More numbers">
          {isMeta && !taxOn && <div className="mini"><span>Spend incl. tax (+{Math.round(TAX_RATE * 100)}%)</span><b>{money0(total.spend * (1 + TAX_RATE))} {cur}</b></div>}
          <div className="mini"><span>Impressions</span><b>{int(total.impressions)}</b></div>
          <div className="mini"><span>Clicks</span><b>{int(total.clicks)}</b></div>
          <div className="mini"><span>CTR</span><b>{ctr.toFixed(2)}%</b></div>
          <div className="mini"><span>CPM</span><b>{total.impressions ? money((total.spend / total.impressions) * 1000) : "-"}</b></div>
          <div className="mini"><span>CPC</span><b>{total.clicks ? money(total.spend / total.clicks) : "-"}</b></div>
          {rn.present.length > 1 && rn.present.map((x) => (
            <div key={x.k} className="mini"><span>{x.label}</span><b>{int(total[x.k])}</b></div>
          ))}
        </section>

        {hl.length > 0 && (
          <>
            <h2 className="section-title">Highlights</h2>
            <section className="highlights" aria-label="Highlights">
              {hl.map((h) => (
                <div key={h.label} className="card hl">
                  <span>{h.label}</span>
                  <b title={h.value}>{h.value}</b>
                  <small>{h.note}</small>
                </div>
              ))}
            </section>
          </>
        )}

        {total.impressions > 0 && (
          <section className="card funnel" aria-label="How people moved from seeing to acting">
            <div className="funnel-step"><span>Saw your ads</span><b>{int(total.impressions)}</b><small>impressions</small></div>
            <i aria-hidden>→ {ctr.toFixed(2)}%</i>
            <div className="funnel-step"><span>Clicked</span><b>{int(total.clicks)}</b><small>clicks</small></div>
            <i aria-hidden>→ {resultRate.toFixed(1)}%</i>
            <div className="funnel-step"><span>Got in touch</span><b>{int(results(total))}</b><small>{rn.label.toLowerCase()}</small></div>
          </section>
        )}

        <h2 className="section-title">Daily trend</h2>
        <section className="charts" aria-label="Daily charts">
          <DayChart title="Spend" subtitle={cur} data={spendPts} prev={prevSpend} kind="bar" unit={cur} decimals={2} />
          <DayChart title={rn.label} subtitle="per day" data={resultPts} prev={prevResults} kind="bar" />
          <DayChart title={`Cost per ${rn.one}`} subtitle={cur} data={cprPts} prev={prevCprs} kind="line" unit={cur} decimals={2} />
        </section>

        {isMeta && (
          <>
            <h2 className="section-title">Billing &amp; limit</h2>
            <BillingPanel billing={billing} />
          </>
        )}

        <h2 className="section-title">Campaigns &amp; ad sets</h2>
        <CampaignTable rows={rowsForTable} showRoas={showRoas} resultLabel={rn.label} costLabel={`Cost / ${rn.one[0].toUpperCase()}${rn.one.slice(1)}`} />

        <h2 className="section-title">Day by day</h2>
        <div className="card table-card">
          <table className="rtable">
            <thead>
              <tr>
                <th>Date</th>
                <th>Spend</th>
                <th>{rn.label}</th>
                <th>Cost / {rn.one[0].toUpperCase() + rn.one.slice(1)}</th>
                <th>Clicks</th>
                {showRoas && <th>ROAS</th>}
              </tr>
            </thead>
            <tbody>
              {[...dates].reverse().map((d) => {
                const s = byDate.get(d) ?? tt({});
                const c = cprOf(s);
                return (
                  <tr key={d} className="parent">
                    <td className="name">{d}</td>
                    <td data-label="Spend">
                      <div className="bar-cell">
                        <i style={{ width: `${(s.spend / maxSpend) * 90}px` }} />
                        <span>{money(s.spend)}</span>
                      </div>
                    </td>
                    <td data-label={rn.label}>{int(results(s))}</td>
                    <td data-label="Cost">{c === null ? "-" : money(c)}</td>
                    <td data-label="Clicks">{int(s.clicks)}</td>
                    {showRoas && <td data-label="ROAS">{s.spend ? (s.purchase_value / s.spend).toFixed(2) : "-"}</td>}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </main>
      <BrandFooter />
    </>
  );
}
