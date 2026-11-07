import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { BrandBar } from "@/components/Brand";
import { requireAdmin } from "@/lib/admin";
import { CopyLink } from "@/components/CopyLink";
import { getAccount } from "@/lib/accounts";
import { db } from "@/lib/db";
import { PLATFORMS, platformReady } from "@/lib/platforms";
import { loadCredentials } from "@/lib/secrets";
import { resetPassword, setLogo } from "../../actions";
import { saveAlerts, saveBudget, saveDetails, saveNotifications, savePlatform } from "./actions";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // saving a platform pulls its first 90 days

const SAVED: Record<string, string> = {
  details: "Details saved.",
  alerts: "Alert limits saved.",
  budget: "Monthly budget saved.",
  notifications: "Notification setting saved.",
  platforms: "Platform saved.",
  logo: "Logo updated.",
};

export default async function ClientSettings({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ saved?: string; error?: string; created?: string; pw?: string }>;
}) {
  await requireAdmin();
  await loadCredentials();
  const { slug } = await params;
  const { saved, error, created, pw } = await searchParams;
  const a = await getAccount(slug);
  if (!a) notFound();

  const h = await headers();
  const origin = `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host")}`;
  const link = `${origin}/c/${a.slug}`;
  const linked = await db.execute({ sql: "SELECT platform, external_id FROM account_platforms WHERE slug = ?", args: [slug] });
  const ids = new Map(linked.rows.map((r) => [String(r.platform), String(r.external_id)]));
  const log = await db.execute({ sql: "SELECT synced_at FROM sync_log WHERE account_id = ?", args: [a.ad_account_id] });
  const syncedAt = log.rows[0] ? String(log.rows[0].synced_at) : null;

  return (
    <>
      <BrandBar admin />
      <main className="wrap narrow">
        <a className="back" href="/admin">← All clients</a>
        <header className="settings-head">
          {a.logo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={a.logo} alt="" className="cc-logo" />
          ) : (
            <div className="cc-logo empty" aria-hidden>{a.name.slice(0, 1).toUpperCase()}</div>
          )}
          <div>
            <h1 className="page-title">{a.name}</h1>
            <div className="page-sub">Settings · {a.currency} · {a.timezone}</div>
            <div className="set-chips">
              <span className="chip">Synced {syncedAt ? `${syncedAt.slice(0, 16).replace("T", " ")} UTC` : "never"}</span>
              <span className="chip">Low balance {a.low_balance.toLocaleString("en-US")} {a.currency}</span>
              <span className="chip">Alerts at {Math.round(a.change_pct * 100)}%</span>
              <span className="chip">{a.monthly_budget ? `Budget ${a.monthly_budget.toLocaleString("en-US")} ${a.currency}` : "No budget set"}</span>
            </div>
          </div>
          <div className="push set-head-actions">
            <a className="btn ghost small" href={`/admin/clients/${a.slug}/analysis`}>Analysis</a>
            <a className="btn small" href={`/c/${a.slug}`}>Open dashboard</a>
          </div>
        </header>

        {error && <div className="notice err" role="alert">{error}</div>}
        {saved && SAVED[saved] && <div className="notice ok" role="status">✓ {SAVED[saved]}</div>}
        {created && pw && (
          <div className="notice ok">
            <h3>New password set. Send these to your client</h3>
            <dl>
              <dt>Link</dt>
              <dd><span className="mono">{link}</span><CopyLink url={link} /></dd>
              <dt>Password</dt>
              <dd><span className="mono">{pw}</span></dd>
            </dl>
            <small>Copy the password now. It is stored hashed and won&apos;t be shown again.</small>
          </div>
        )}

        <nav className="set-nav" aria-label="Settings sections">
          <a href="#details">Details</a>
          <a href="#alerts">Alerts</a>
          <a href="#budget">Budget</a>
          <a href="#notifications">Notifications</a>
          <a href="#platforms">Platforms</a>
        </nav>
        <div className="set-stack">
        <section className="card set-card" id="details">
          <h2>Client details</h2>
          <form action={saveDetails.bind(null, slug)} className="set-form">
            <label className="f">
              <span>Display name <em>shown to the client</em></span>
              <input className="field" name="name" defaultValue={a.name} required />
            </label>
            <div className="f">
              <span>Dashboard link</span>
              <div className="row"><span className="mono grow">{link}</span><CopyLink url={link} /></div>
            </div>
            <div className="set-actions"><button className="btn" type="submit">Save details</button></div>
          </form>

          <div className="set-split">
            <form action={resetPassword.bind(null, slug)} className="set-form">
              <label className="f" htmlFor="pw">
                <span>Reset password <em>blank = generate one</em></span>
              </label>
              <div className="row">
                <input id="pw" className="field" name="password" placeholder="Auto-generated" autoComplete="off" />
                <button className="btn ghost small" type="submit">Reset</button>
              </div>
            </form>
            <form action={setLogo.bind(null, slug)} className="set-form">
              <label className="f" htmlFor="logo">
                <span>Replace logo <em>image, up to 400 KB</em></span>
              </label>
              <div className="row">
                <input id="logo" className="field file" name="logo" type="file" accept="image/*" required />
                <button className="btn ghost small" type="submit">Save</button>
              </div>
            </form>
          </div>
        </section>

        <section className="card set-card" id="alerts">
          <h2>Alert limits</h2>
          <p className="set-help">Alerts show on this client&apos;s dashboard and in the agency &ldquo;Needs attention&rdquo; list.</p>
          <form action={saveAlerts.bind(null, slug)} className="set-form two">
            <label className="f">
              <span>Low balance <em>{a.currency}</em></span>
              <input className="field" name="low_balance" type="number" min="0" step="1" defaultValue={a.low_balance} required />
              <small>Warn when the remaining balance falls to this amount or less.</small>
            </label>
            <label className="f">
              <span>Change limit <em>%</em></span>
              <input className="field" name="change_pct" type="number" min="5" max="500" step="1" defaultValue={Math.round(a.change_pct * 100)} required />
              <small>Flag spend or cost per result when yesterday moves this much versus the previous 7-day average.</small>
            </label>
            <div className="set-actions span2"><button className="btn" type="submit">Save limits</button></div>
          </form>
        </section>

        <section className="card set-card" id="budget">
          <h2>Monthly budget</h2>
          <p className="set-help">Shows a pacing card on the client&apos;s dashboard: month-to-date spend against this budget, with a forecast for month end.</p>
          <form action={saveBudget.bind(null, slug)} className="set-form">
            <label className="f">
              <span>Budget per month <em>{a.currency}, before tax</em></span>
              <input className="field" name="monthly_budget" type="number" min="0" step="1" defaultValue={a.monthly_budget ?? ""} placeholder="Blank = no budget card" />
            </label>
            <div className="set-actions"><button className="btn" type="submit">Save budget</button></div>
          </form>
        </section>

        <section className="card set-card" id="notifications">
          <h2>Notifications</h2>
          <form action={saveNotifications.bind(null, slug)} className="set-form">
            <label className="check">
              <input type="checkbox" name="notify_visits" defaultChecked={a.notify_visits} />
              <span>
                Telegram message when this client opens their dashboard
                <small>At most one per hour. Needs the Telegram bot set up on the server.</small>
              </span>
            </label>
            <div className="set-actions"><button className="btn" type="submit">Save</button></div>
          </form>
        </section>

        <section className="card set-card" id="platforms">
          <h2>Platforms</h2>
          <p className="set-help">Meta, TikTok and Google Ads pull data automatically once their credentials are saved under <a href="/admin/integrations">Integrations</a>. Snapchat stores the ID until its integration is switched on.</p>
          <ul className="plat-list">
            {PLATFORMS.map((p) =>
              p.id === "meta" ? (
                <li key={p.id} className="plat">
                  <div className="plat-name">{p.label}</div>
                  <span className="mono grow">{a.ad_account_id}</span>
                  <span className="pill good">Live</span>
                </li>
              ) : (
                <li key={p.id} className="plat">
                  <div className="plat-name">{p.label}</div>
                  <form action={savePlatform.bind(null, slug, p.id)} className="row grow">
                    <input className="field" name="external_id" defaultValue={ids.get(p.id) ?? ""} placeholder={`${p.idLabel} (${p.placeholder})`} aria-label={`${p.label} ${p.idLabel}`} autoComplete="off" />
                    <button className="btn ghost small" type="submit">Save</button>
                  </form>
                  <span className={`pill ${!ids.has(p.id) ? "muted" : p.hasAdapter && platformReady(p.id) ? "good" : "warn"}`}>
                    {!ids.has(p.id) ? "Not linked" : p.hasAdapter && platformReady(p.id) ? "Live" : p.hasAdapter ? "Needs token" : "Pending"}
                  </span>
                </li>
              ),
            )}
          </ul>
        </section>
        </div>
      </main>
    </>
  );
}
