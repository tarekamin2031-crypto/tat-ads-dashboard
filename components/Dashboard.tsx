import { Fragment, type CSSProperties } from "react";
import type { Account } from "@/lib/accounts";
import { after } from "next/server";
import { AlertModal } from "@/components/AlertModal";
import { BillingPanel } from "@/components/BillingPanel";
import { BrandBar, BrandFooter } from "@/components/Brand";
import { billingAlerts, getBilling, TAX_RATE } from "@/lib/billing";
import { notifyVisit } from "@/lib/notify";
import { dateInTz, PRESET_DAYS, type Range } from "@/lib/dates";
import { db } from "@/lib/db";

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
const int = (v: number) => v.toLocaleString("en-US", { maximumFractionDigits: 0 });
const results = (t: Totals) => t.leads + t.purchases + t.messages;

function toTotals(r: Record<string, unknown>): Totals {
  return {
    spend: num(r.spend),
    impressions: num(r.impressions),
    clicks: num(r.clicks),
    leads: num(r.leads),
    purchases: num(r.purchases),
    messages: num(r.messages),
    purchase_value: num(r.purchase_value),
  };
}

function MetricsRow({
  t,
  name,
  td,
  bold,
  sub,
}: {
  t: Totals;
  name: string;
  td: CSSProperties;
  bold?: boolean;
  sub?: boolean;
}) {
  const cell: CSSProperties = {
    ...td,
    ...(bold ? { fontWeight: 600 } : {}),
    ...(sub ? { color: "#4b4f56", fontSize: 13, background: "#fafbfc" } : {}),
  };
  return (
    <tr>
      <td style={{ ...cell, textAlign: "left", paddingLeft: sub ? 28 : 10 }}>
        {sub ? <span style={{ color: "#9aa0a6" }}>↳ </span> : null}
        {name}
      </td>
      <td style={cell}>{money(t.spend)}</td>
      <td style={cell}>{int(results(t))}</td>
      <td style={cell}>{results(t) ? money(t.spend / results(t)) : "-"}</td>
      <td style={cell}>{int(t.impressions)}</td>
      <td style={cell}>{int(t.clicks)}</td>
      <td style={cell}>{t.impressions ? `${((t.clicks / t.impressions) * 100).toFixed(2)}%` : "-"}</td>
      <td style={cell}>{t.spend ? (t.purchase_value / t.spend).toFixed(2) : "-"}</td>
    </tr>
  );
}

const pill = (active: boolean) => ({
  padding: "6px 12px",
  borderRadius: 6,
  textDecoration: "none",
  fontSize: 14,
  background: active ? "#0f766e" : "#fff",
  color: active ? "#fff" : "#1c1e21",
  border: "1px solid #dadde1",
});
const dateInput = { padding: 4, borderRadius: 4, border: "1px solid #dadde1", fontSize: 13 };

const SUMS = `SUM(spend) AS spend, SUM(impressions) AS impressions, SUM(clicks) AS clicks,
  SUM(leads) AS leads, SUM(purchases) AS purchases, SUM(messages) AS messages,
  SUM(purchase_value) AS purchase_value`;

export async function Dashboard({ account, range, basePath }: { account: Account; range: Range; basePath: string }) {
  const { since, until } = range;
  const includesToday = until === dateInTz(account.timezone, 0);
  const today = dateInTz(account.timezone, 0);
  const id = account.ad_account_id;

  const [billing, totalRes, dailyRes, campaignRes, adsetRes, lastRes] = await Promise.all([
    getBilling(account),
    db.execute({
      sql: `SELECT ${SUMS} FROM daily_insights WHERE account_id = ? AND date BETWEEN ? AND ?`,
      args: [id, since, until],
    }),
    db.execute({
      sql: `SELECT date, ${SUMS} FROM daily_insights WHERE account_id = ? AND date BETWEEN ? AND ?
            GROUP BY date ORDER BY date DESC`,
      args: [id, since, until],
    }),
    db.execute({
      sql: `SELECT campaign_id, campaign_name, ${SUMS} FROM daily_insights
            WHERE account_id = ? AND date BETWEEN ? AND ?
            GROUP BY campaign_id, campaign_name ORDER BY spend DESC`,
      args: [id, since, until],
    }),
    db.execute({
      sql: `SELECT campaign_id, adset_id, adset_name, ${SUMS} FROM daily_insights
            WHERE account_id = ? AND date BETWEEN ? AND ?
            GROUP BY campaign_id, adset_id, adset_name ORDER BY spend DESC`,
      args: [id, since, until],
    }),
    db.execute({ sql: "SELECT MAX(date) AS d FROM daily_insights WHERE account_id = ?", args: [id] }),
  ]);

  const adsetsByCampaign = new Map<string, (Totals & { id: string; name: string })[]>();
  for (const r of adsetRes.rows) {
    const list = adsetsByCampaign.get(String(r.campaign_id)) ?? [];
    list.push({ id: String(r.adset_id), name: String(r.adset_name), ...toTotals(r) });
    adsetsByCampaign.set(String(r.campaign_id), list);
  }

  // Runs after the response is sent, so the Telegram call never slows the client's page.
  after(() => notifyVisit(account, billing));

  const total = toTotals(totalRes.rows[0] ?? {});
  const daily = dailyRes.rows.map((r) => ({ date: String(r.date), ...toTotals(r) }));
  const campaigns = campaignRes.rows.map((r) => ({
    id: String(r.campaign_id),
    name: String(r.campaign_name),
    ...toTotals(r),
  }));
  const maxSpend = Math.max(1, ...daily.map((d) => d.spend));

  const cpr = results(total) ? total.spend / results(total) : 0;
  const roas = total.spend ? total.purchase_value / total.spend : 0;
  const ctr = total.impressions ? (total.clicks / total.impressions) * 100 : 0;

  const cards: [string, string][] = [
    [`Spend (${account.currency})`, money(total.spend)],
    [`Spend incl. tax (+${Math.round(TAX_RATE * 100)}%)`, money(total.spend * (1 + TAX_RATE))],
    ["Results", int(results(total))],
    ["Cost / Result", money(cpr)],
    ["ROAS", roas.toFixed(2)],
    ["Impressions", int(total.impressions)],
    ["CTR", `${ctr.toFixed(2)}%`],
  ];

  const th = { textAlign: "right" as const, padding: "8px 10px", borderBottom: "1px solid #e4e6eb" };
  const td = { textAlign: "right" as const, padding: "8px 10px", borderBottom: "1px solid #f0f2f5" };

  return (
    <>
    <BrandBar clientName={account.name} clientLogo={account.logo} />
    <AlertModal items={billingAlerts(billing).map((a) => a.text)} />
    <main style={{ maxWidth: 1100, margin: "0 auto", padding: 24 }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 22 }}>Ads Performance</h1>
          <small style={{ color: "#65676b" }}>
            {since === until ? since : `${since} → ${until}`}
            {includesToday ? " (includes today, partial)" : ""} · last synced data day:{" "}
            {String(lastRes.rows[0]?.d ?? "no data yet")}
          </small>
        </div>
      </header>

      <BillingPanel billing={billing} />

      <nav style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", margin: "16px 0 0" }}>
        <form
          method="GET"
          action={basePath}
          style={{
            display: "flex",
            gap: 6,
            alignItems: "center",
            padding: "4px 8px",
            borderRadius: 6,
            background: range.kind === "custom" ? "#e3f2f0" : "#fff",
            border: `1px solid ${range.kind === "custom" ? "#0f766e" : "#dadde1"}`,
          }}
        >
          <strong style={{ fontSize: 13 }}>Custom dates</strong>
          <input type="date" name="from" defaultValue={since} max={today} required style={dateInput} />
          <span>→</span>
          <input type="date" name="to" defaultValue={until} max={today} required style={dateInput} />
          <button type="submit" style={{ ...pill(false), cursor: "pointer" }}>Apply</button>
        </form>
        <a href={`${basePath}?range=daily`} style={pill(range.kind === "daily")}>Daily (yesterday)</a>
        {PRESET_DAYS.map((d) => (
          <a key={d} href={`${basePath}?days=${d}`} style={pill(range.kind === "days" && range.days === d)}>
            {d}d
          </a>
        ))}
      </nav>

      <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12, margin: "20px 0" }}>
        {cards.map(([label, value]) => (
          <div key={label} style={{ background: "#fff", borderRadius: 8, padding: 14, border: "1px solid #e4e6eb" }}>
            <div style={{ color: "#65676b", fontSize: 13 }}>{label}</div>
            <div style={{ fontSize: 24, fontWeight: 600 }}>{value}</div>
          </div>
        ))}
      </section>

      <h2 style={{ fontSize: 16 }}>Daily performance</h2>
      <div style={{ background: "#fff", borderRadius: 8, border: "1px solid #e4e6eb", overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
          <thead>
            <tr>
              <th style={{ ...th, textAlign: "left" }}>Date</th>
              <th style={{ ...th, width: "30%" }}>Spend</th>
              <th style={th}>Results</th>
              <th style={th}>Cost / Result</th>
              <th style={th}>Clicks</th>
              <th style={th}>ROAS</th>
            </tr>
          </thead>
          <tbody>
            {daily.map((d) => (
              <tr key={d.date}>
                <td style={{ ...td, textAlign: "left" }}>{d.date}</td>
                <td style={td}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, justifyContent: "flex-end" }}>
                    <div style={{ height: 8, width: `${(d.spend / maxSpend) * 100}%`, background: "#0f766e", borderRadius: 4 }} />
                    <span>{money(d.spend)}</span>
                  </div>
                </td>
                <td style={td}>{int(results(d))}</td>
                <td style={td}>{results(d) ? money(d.spend / results(d)) : "-"}</td>
                <td style={td}>{int(d.clicks)}</td>
                <td style={td}>{d.spend ? (d.purchase_value / d.spend).toFixed(2) : "-"}</td>
              </tr>
            ))}
            {daily.length === 0 && (
              <tr>
                <td style={td} colSpan={6}>No data in this period yet.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <h2 style={{ fontSize: 16, marginTop: 24 }}>Campaigns</h2>
      <div style={{ background: "#fff", borderRadius: 8, border: "1px solid #e4e6eb", overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
          <thead>
            <tr>
              <th style={{ ...th, textAlign: "left" }}>Campaign / Ad set</th>
              <th style={th}>Spend</th>
              <th style={th}>Results</th>
              <th style={th}>Cost / Result</th>
              <th style={th}>Impressions</th>
              <th style={th}>Clicks</th>
              <th style={th}>CTR</th>
              <th style={th}>ROAS</th>
            </tr>
          </thead>
          <tbody>
            {campaigns.map((c) => (
              <Fragment key={c.id}>
                <MetricsRow t={c} name={c.name} td={td} bold />
                {(adsetsByCampaign.get(c.id) ?? []).map((a) => (
                  <MetricsRow key={a.id} t={a} name={a.name} td={td} sub />
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </main>
    <BrandFooter />
    </>
  );
}
