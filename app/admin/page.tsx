import { headers } from "next/headers";
import { isMetaAccount, listAccounts, primaryPlatform } from "@/lib/accounts";
import { getAlerts } from "@/lib/alerts";
import { getAnalysis } from "@/lib/analysis";
import { billingAlerts, getBilling, getGoogleBilling, type Billing } from "@/lib/billing";
import { formatCustomerId, listGoogleAccounts } from "@/lib/google";
import { listAdAccounts } from "@/lib/meta";
import { loadCredentials } from "@/lib/secrets";
import { BrandBar } from "@/components/Brand";
import { requireAdmin } from "@/lib/admin";
import { CopyLink } from "@/components/CopyLink";
import { db } from "@/lib/db";
import { insightsKey, platformById, platformReady } from "@/lib/platforms";
import { addClient } from "./actions";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // adding a client pulls its first 90 days inside the server action

const fmt = (v: number) => v.toLocaleString("en-US", { maximumFractionDigits: 0 });
const PILL = { bad: "Action", warn: "Watch", good: "Good" } as const;

function BillingSummary({ b }: { b: Billing | null }) {
  if (!b) return <span className="chip muted">Billing unavailable</span>;
  const problem = b.low || b.statusCode !== 1;
  const main =
    b.available === null ? b.noLimitLabel ?? "No spending limit" : `${b.low ? "⚠ " : ""}${fmt(b.available)} ${b.currency} available`;
  const sub = [
    b.availableNet !== null ? `net ${fmt(b.availableNet)} after tax` : null,
    !b.isPrepay ? `due ${fmt(b.amountDue)}` : null,
    b.statusCode !== 1 ? b.status : null,
  ].filter(Boolean);
  return (
    <>
      <span className={`chip${problem ? " bad" : ""}`}>{main}</span>
      {sub.length > 0 && <span className="cc-sub">{sub.join(" · ")}</span>}
    </>
  );
}

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{ created?: string; pw?: string; error?: string }>;
}) {
  await requireAdmin();
  const { created, pw, error } = await searchParams;
  await loadCredentials();
  const [accounts, adAccounts, googleAccounts, h] = await Promise.all([listAccounts(), listAdAccounts(), listGoogleAccounts(), headers()]);
  // Google Ads customer id per client (only when Google credentials are set), for balance and alerts.
  const googleIds = new Map<string, string>();
  if (platformReady("google")) {
    const rows = await db.execute("SELECT slug, external_id FROM account_platforms WHERE platform = 'google'");
    for (const r of rows.rows) googleIds.set(String(r.slug), String(r.external_id));
  }
  const clients = await Promise.all(
    accounts.map(async (a) => {
      const gid = googleIds.get(a.slug);
      const googleKey = gid ? insightsKey("google", gid) : null;
      const googleIsPrimary = googleKey === a.ad_account_id;
      const [metaBilling, performance, analysis, googleBilling, googlePerf] = await Promise.all([
        getBilling(a),
        getAlerts(a),
        getAnalysis(a).catch(() => null),
        gid ? getGoogleBilling(a, gid.replace(/\D/g, "")) : Promise.resolve(null),
        googleKey && !googleIsPrimary ? getAlerts(a, googleKey, "Google") : Promise.resolve([]),
      ]);
      // A Google-only client shows Google's balance in place of Meta's.
      const billing = googleIsPrimary ? googleBilling : metaBilling;
      const alerts = [...billingAlerts(metaBilling), ...billingAlerts(googleBilling, "Google billing"), ...performance, ...googlePerf];
      return { account: a, billing, googleBilling: googleIsPrimary ? null : googleBilling, alerts, recs: analysis?.recs.filter((r) => r.level !== "info").length ?? 0, analysis };
    }),
  );
  const RANK = { bad: 0, warn: 1, good: 2 } as const;
  for (const c of clients) c.alerts.sort((x, y) => RANK[x.level] - RANK[y.level]);
  const withAlerts = clients
    .filter((c) => c.alerts.length > 0)
    .sort((a, b) => RANK[a.alerts[0].level] - RANK[b.alerts[0].level] || a.account.name.localeCompare(b.account.name));
  const count = (lvl: "bad" | "warn" | "good") => clients.reduce((n, c) => n + c.alerts.filter((a) => a.level === lvl).length, 0);
  const origin = `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host")}`;
  const taken = new Set(accounts.map((a) => a.ad_account_id));
  const available = adAccounts.filter((a) => !taken.has(a.account_id));
  const takenGoogle = new Set((await db.execute("SELECT external_id FROM account_platforms WHERE platform = 'google'")).rows.map((r) => String(r.external_id).replace(/\D/g, "")));
  const googleAvailable = googleAccounts.filter((g) => !takenGoogle.has(g.id));

  return (
    <>
      <BrandBar admin />
      <section className="hero">
        <div className="hero-in">
          <div>
            <div className="hero-eyebrow">TAT Agency · Admin</div>
            <h1 className="hero-name">Clients</h1>
          </div>
          <div className="hero-period">
            <b>{accounts.length} {accounts.length === 1 ? "client" : "clients"}</b>
            <span>{withAlerts.length > 0 ? `${withAlerts.length} with alerts` : "All normal"}</span>
          </div>
        </div>
      </section>
      <main className="wrap narrow">
        <section className="sum-tiles" aria-label="Summary">
          <div className="card sum"><span>Clients</span><b>{accounts.length}</b></div>
          <div className="card sum bad"><span>Action needed</span><b>{count("bad")}</b></div>
          <div className="card sum warn"><span>Watch</span><b>{count("warn")}</b></div>
          <div className="card sum good"><span>Good news</span><b>{count("good")}</b></div>
        </section>

        {error && <div className="notice err" role="alert">{error}</div>}
        {created && pw && (
          <div className="notice ok">
            <h3>Client ready. Send these to your client</h3>
            <dl>
              <dt>Link</dt>
              <dd>
                <span className="mono">{origin}/c/{created}</span>
                <CopyLink url={`${origin}/c/${created}`} />
              </dd>
              <dt>Password</dt>
              <dd>
                <span className="mono">{pw}</span>
              </dd>
            </dl>
            <small>Copy the password now. It is stored hashed and won&apos;t be shown again.</small>
          </div>
        )}

        <h2 className="section-title">Clients <span className="count">({clients.length})</span></h2>
        <div className="client-grid">
          {clients.length === 0 && <div className="card all-clear" style={{ color: "var(--muted)" }}>No clients yet. Add the first one below.</div>}
          {clients.map(({ account: a, billing, googleBilling, recs, analysis, alerts }) => {
            const worst = alerts[0]?.level;
            const status = worst === "bad" ? ["Action", "bad"] : worst === "warn" ? ["Watch", "warn"] : ["Healthy", "good"];
            const nBad = alerts.filter((x) => x.level === "bad").length;
            const cprCh = analysis && analysis.cpr !== null && analysis.prevCpr ? ((analysis.cpr - analysis.prevCpr) / analysis.prevCpr) * 100 : null;
            const pctLeft = billing && billing.cap ? Math.max(0, Math.min(100, ((billing.available ?? 0) / billing.cap) * 100)) : null;
            return (
              <article key={a.slug} className={`card cl lvl-${worst ?? "ok"}`}>
                <header className="cl-head">
                  {a.logo ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={a.logo} alt="" className="cc-logo" />
                  ) : (
                    <div className="cc-logo empty" aria-hidden>{a.name.slice(0, 1).toUpperCase()}</div>
                  )}
                  <div className="cl-title">
                    <a href={`/admin/clients/${a.slug}/analysis`} className="cc-name">{a.name}</a>
                    <div className="cc-meta">{a.currency} · {a.timezone}</div>
                  </div>
                  <span className={`pill ${status[1]}`}>{status[0]}</span>
                </header>

                {analysis && (
                  <dl className="cl-kpis" aria-label="Last 30 days">
                    <div><dt>Spend 30d</dt><dd>{fmt(analysis.spend)}</dd></div>
                    <div><dt>Results</dt><dd>{fmt(analysis.results)}</dd></div>
                    <div>
                      <dt>Cost / result</dt>
                      <dd>
                        {analysis.cpr === null ? "-" : analysis.cpr.toLocaleString("en-US", { maximumFractionDigits: 1 })}
                        {cprCh !== null && Math.abs(cprCh) >= 1 && <small className={cprCh > 0 ? "dn" : "up"}>{cprCh > 0 ? "▲" : "▼"} {Math.abs(cprCh).toFixed(0)}%</small>}
                      </dd>
                    </div>
                  </dl>
                )}

                <div className="cl-bal">
                  {billing && billing.available !== null && pctLeft !== null ? (
                    <>
                      <div className="cl-bal-top">
                        <span>Balance</span>
                        <b className={billing.low ? "low" : ""}>{billing.low ? "⚠ " : ""}{fmt(billing.available)} {billing.currency}</b>
                      </div>
                      <div className="cl-bar" role="img" aria-label={`${Math.round(pctLeft)}% of the spending limit left`}>
                        <i className={billing.low ? "low" : ""} style={{ width: `${pctLeft}%` }} />
                      </div>
                      <div className="cc-sub">of {fmt(billing.cap ?? 0)} limit{billing.availableNet !== null ? ` · net ${fmt(billing.availableNet)} after tax` : ""}{billing.availableGross != null ? ` · ${fmt(billing.availableGross)} incl. tax` : ""}{billing.statusCode !== 1 ? ` · ${billing.status}` : ""}</div>
                    </>
                  ) : billing ? (
                    <BillingSummary b={billing} />
                  ) : !isMetaAccount(a) ? (
                    <span className="chip">{platformById(primaryPlatform(a))?.label ?? primaryPlatform(a)} only</span>
                  ) : (
                    <BillingSummary b={billing} />
                  )}
                  {googleBilling && (
                    <div className="cl-google">
                      <span>Google Ads</span>
                      <b className={googleBilling.low || googleBilling.statusCode !== 1 ? "low" : ""}>
                        {googleBilling.statusCode !== 1 ? `⚠ ${googleBilling.status}` : googleBilling.available === null ? googleBilling.noLimitLabel ?? "No spending limit" : `${googleBilling.low ? "⚠ " : ""}${fmt(googleBilling.available)} ${googleBilling.currency} left`}
                      </b>
                    </div>
                  )}
                </div>

                <footer className="cl-foot">
                  <div className="cl-chips">
                    {nBad > 0 && <span className="chip bad">{nBad} to fix</span>}
                    {recs > 0 && <span className="chip">{recs} {recs === 1 ? "suggestion" : "suggestions"}</span>}
                    {nBad === 0 && recs === 0 && <span className="chip muted">Nothing to flag</span>}
                  </div>
                  <div className="cc-actions">
                    <a className="btn ghost small" href={`/c/${a.slug}`}>Open</a>
                    <a className="btn ghost small" href={`/admin/clients/${a.slug}/analysis`}>Analysis</a>
                    <a className="btn ghost small" href={`/admin/clients/${a.slug}`}>Settings</a>
                    <CopyLink url={`${origin}/c/${a.slug}`} />
                  </div>
                </footer>
              </article>
            );
          })}
        </div>

        <h2 className="section-title">
          Needs attention {withAlerts.length > 0 && <span className="count">({withAlerts.length})</span>}
        </h2>
        <section className="card" aria-label="Alerts">
          {accounts.length > 0 && withAlerts.length === 0 && (
            <div className="all-clear">✓ All normal. Balances are above the limit and no client moved past its change limit on spend or cost per result.</div>
          )}
          {accounts.length === 0 && <div className="all-clear" style={{ color: "var(--muted)" }}>No clients yet.</div>}
          {withAlerts.length > 0 && (
            <div className="attn">
              {withAlerts.map(({ account, alerts }) => {
                const worst = alerts[0].level;
                return (
                  <div key={account.slug} className={`attn-client lvl-${worst}`}>
                    <div className="attn-name">
                      {account.logo ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={account.logo} alt="" className="mini-logo" />
                      ) : (
                        <div className="mini-logo empty" aria-hidden>{account.name.slice(0, 1).toUpperCase()}</div>
                      )}
                      <a href={`/admin/clients/${account.slug}`}>{account.name}</a>
                      <span className="attn-count">{alerts.length} {alerts.length === 1 ? "alert" : "alerts"}</span>
                    </div>
                    <div className="attn-list">
                      {alerts.map((a, i) => {
                        const [head, ...rest] = a.text.split(": ");
                        return (
                          <div key={i} className={`attn-item ${a.level}`}>
                            <span className={`pill ${a.level}`}>{PILL[a.level]}</span>
                            <span className="attn-scope">{a.scope}</span>
                            <span className="attn-text">
                              {rest.length > 0 ? (
                                <>
                                  <b>{head}</b>
                                  <span>{rest.join(": ")}</span>
                                </>
                              ) : (
                                <b>{head}</b>
                              )}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          <div className="hint">Billing, plus yesterday compared with the previous 7-day average.</div>
        </section>

        <details className="add-client">
        <summary className="section-title">Add client</summary>
        <section className="card form-card">
          {available.length === 0 && googleAvailable.length === 0 ? (
            <div className="all-clear" style={{ color: "var(--muted)", padding: 0 }}>
              Every Meta and Google Ads account we can see is already added.
            </div>
          ) : (
            <form action={addClient} className="form-grid">
              <label className="f span2">
                <span>Meta ad account <em>optional if the client only runs Google Ads</em></span>
                <select className="field" name="ad_account_id" defaultValue="">
                  <option value="">None (no Meta)</option>
                  {available.map((a) => (
                    <option key={a.account_id} value={a.account_id}>
                      {a.name} ({a.currency})
                    </option>
                  ))}
                </select>
              </label>
              {googleAvailable.length > 0 && (
                <label className="f span2">
                  <span>Google Ads account <em>optional</em></span>
                  <select className="field" name="google_customer_id" defaultValue="">
                    <option value="">None</option>
                    {googleAvailable.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.name} · {formatCustomerId(g.id)}{g.currency ? ` (${g.currency})` : ""}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <label className="f">
                <span>Display name <em>optional</em></span>
                <input className="field" name="name" placeholder="Shown to the client" />
              </label>
              <label className="f">
                <span>Password <em>blank = generate</em></span>
                <input className="field" name="password" placeholder="Auto-generated" autoComplete="off" />
              </label>
              <label className="f span2">
                <span>Logo <em>optional, up to 400 KB</em></span>
                <input className="field file" name="logo" type="file" accept="image/*" />
              </label>
              <div className="form-actions span2">
                <button className="btn" type="submit">Add client</button>
                <small>Pulls the last 90 days right away, so it can take a few seconds.</small>
              </div>
            </form>
          )}
        </section>
        </details>
      </main>
    </>
  );
}
