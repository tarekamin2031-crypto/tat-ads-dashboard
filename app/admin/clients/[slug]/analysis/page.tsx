import { notFound } from "next/navigation";
import { BrandBar } from "@/components/Brand";
import { requireAdmin } from "@/lib/admin";
import { getAccount } from "@/lib/accounts";
import { getAnalysis, type Level } from "@/lib/analysis";

export const dynamic = "force-dynamic";

const money = (v: number) => v.toLocaleString("en-US", { maximumFractionDigits: 0 });
const money2 = (v: number) => v.toLocaleString("en-US", { maximumFractionDigits: 2 });
const LABEL: Record<Level, string> = { bad: "Fix now", warn: "Review", good: "Opportunity", info: "Note" };
const PILL: Record<Level, string> = { bad: "bad", warn: "warn", good: "good", info: "info" };
const change = (c: number | null, p: number | null) => (c === null || p === null || p === 0 ? null : ((c - p) / p) * 100);

export default async function AnalysisPage({ params }: { params: Promise<{ slug: string }> }) {
  await requireAdmin();
  const { slug } = await params;
  const a = await getAccount(slug);
  if (!a) notFound();
  const an = await getAnalysis(a);
  const cur = a.currency;
  const sp = change(an.spend, an.prevSpend);
  const rs = change(an.results, an.prevResults);
  const cp = change(an.cpr, an.prevCpr);
  const maxWd = Math.max(1, ...an.weekdays.map((w) => w.spend));
  const Delta = ({ v, goodUp }: { v: number | null; goodUp: boolean | null }) =>
    v === null ? <small>no prior period</small> : (
      <small className={goodUp === null ? "" : (v > 0) === goodUp ? "up-good" : "up-bad"}>{v > 0 ? "▲" : "▼"} {Math.abs(v).toFixed(0)}% vs previous {an.days}d</small>
    );

  return (
    <>
      <BrandBar admin />
      <main className="wrap narrow">
        <a className="back" href={`/admin/clients/${slug}`}>← {a.name} settings</a>
        <header className="settings-head">
          <div>
            <h1 className="page-title">Analysis · {a.name}</h1>
            <div className="page-sub">Last {an.days} complete days ({an.since} to {an.until}) · suggestions to review, nothing changes automatically</div>
          </div>
        </header>

        <section className="sum-tiles" aria-label="Summary">
          <div className="card sum"><span>Spend ({cur})</span><b>{money(an.spend)}</b><Delta v={sp} goodUp={null} /></div>
          <div className="card sum"><span>Results</span><b>{money(an.results)}</b><Delta v={rs} goodUp={true} /></div>
          <div className="card sum"><span>Cost per result</span><b>{an.cpr === null ? "-" : money2(an.cpr)}</b><Delta v={cp} goodUp={false} /></div>
          <div className="card sum"><span>Suggestions</span><b>{an.recs.length}</b><small>{an.recs.filter((r) => r.level === "bad").length} to fix now</small></div>
        </section>

        <h2 className="section-title">What to change</h2>
        <section className="card" aria-label="Recommendations">
          {an.recs.length === 0 ? (
            <div className="all-clear">✓ Nothing stands out. Campaigns are close to the account average and trends are stable.</div>
          ) : (
            <div className="recs">
              {an.recs.map((r, i) => (
                <article key={i} className={`rec ${r.level}`}>
                  <div className="rec-top">
                    <span className={`pill ${PILL[r.level]}`}>{LABEL[r.level]}</span>
                    <span className="rec-area">{r.area}</span>
                    <span className="rec-scope">{r.scope}</span>
                  </div>
                  <h3>{r.title}</h3>
                  <p className="rec-detail">{r.detail}</p>
                  <p className="rec-action"><b>Suggested:</b> {r.action}</p>
                </article>
              ))}
            </div>
          )}
        </section>

        <h2 className="section-title">Campaign scorecard</h2>
        <div className="card table-card">
          <table className="rtable">
            <thead>
              <tr><th>Campaign</th><th>Verdict</th><th>Spend</th><th>Share</th><th>Results</th><th>Cost / result</th><th>CTR</th><th>CPM</th></tr>
            </thead>
            <tbody>
              {an.campaigns.map((c) => (
                <tr key={c.id} className="parent">
                  <td className="name">{c.name}<div className="why">{c.why}</div></td>
                  <td data-label="Verdict"><span className={`verdict v-${c.verdict.toLowerCase()}`}>{c.verdict}</span></td>
                  <td data-label="Spend">{money(c.spend)}</td>
                  <td data-label="Share">{Math.round(c.share * 100)}%</td>
                  <td data-label="Results">{money(c.results)}</td>
                  <td data-label="Cost / result">{c.cpr === null ? "-" : money2(c.cpr)}</td>
                  <td data-label="CTR">{c.ctr.toFixed(2)}%</td>
                  <td data-label="CPM">{money2(c.cpm)}</td>
                </tr>
              ))}
              {an.campaigns.length === 0 && <tr><td className="name" colSpan={8}>No spend in the last {an.days} days.</td></tr>}
            </tbody>
          </table>
        </div>

        <h2 className="section-title">By weekday</h2>
        <div className="card wd">
          {an.weekdays.map((w) => (
            <div key={w.day} className="wd-col" title={`${w.day}: ${money(w.spend)} ${cur}, ${w.results} results`}>
              <span className="wd-cpr">{w.cpr === null ? "-" : money(w.cpr)}</span>
              <div className="wd-bar"><i style={{ height: `${(w.spend / maxWd) * 100}%` }} /></div>
              <span className="wd-day">{w.day}</span>
            </div>
          ))}
          <div className="hint">Bar = spend, number on top = cost per result ({cur}). Based on {an.days} days.</div>
        </div>
      </main>
    </>
  );
}
