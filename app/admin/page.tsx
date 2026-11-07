import { headers } from "next/headers";
import { listAccounts } from "@/lib/accounts";
import { getAlerts } from "@/lib/alerts";
import { billingAlerts, getBilling, type Billing } from "@/lib/billing";
import { listAdAccounts } from "@/lib/meta";
import { BrandBar } from "@/components/Brand";
import { addClient, resetPassword, setLogo } from "./actions";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // adding a client pulls its first 90 days inside the server action

const box = { background: "#fff", borderRadius: 8, border: "1px solid #e4e6eb", padding: 16, marginBottom: 20 };
const LEVEL_COLOR = { bad: "#c62828", warn: "#ef6c00", good: "#2e7d32" };
const input = { padding: 8, borderRadius: 6, border: "1px solid #dadde1", fontSize: 14 };
const button = { padding: "8px 14px", borderRadius: 6, border: 0, background: "#0f766e", color: "#fff", cursor: "pointer" };

const fmt = (v: number) => v.toLocaleString("en-US", { maximumFractionDigits: 0 });

function BillingLine({ b }: { b: Billing | null }) {
  if (!b) return <div style={{ fontSize: 12, color: "#8a8d91" }}>Billing unavailable</div>;
  const parts =
    b.available === null
      ? ["No spending limit"]
      : [`Available ${fmt(b.available)} ${b.currency}`, `net ${fmt(b.availableNet ?? 0)} after tax`];
  if (!b.isPrepay) parts.push(`due ${fmt(b.amountDue)}`);
  return (
    <div style={{ fontSize: 12, color: b.low || b.statusCode !== 1 ? "#b71c1c" : "#65676b", fontWeight: b.low ? 600 : 400 }}>
      {b.low ? "⚠ " : ""}
      {parts.join(" · ")}
      {b.statusCode !== 1 ? ` · ${b.status}` : ""}
    </div>
  );
}

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{ created?: string; pw?: string; error?: string }>;
}) {
  const { created, pw, error } = await searchParams;
  const [accounts, adAccounts, h] = await Promise.all([listAccounts(), listAdAccounts(), headers()]);
  const clients = await Promise.all(
    accounts.map(async (a) => {
      const [billing, performance] = await Promise.all([getBilling(a), getAlerts(a)]);
      return { account: a, billing, alerts: [...billingAlerts(billing), ...performance] };
    }),
  );
  const withAlerts = clients.filter((c) => c.alerts.length > 0);
  const billingBySlug = new Map(clients.map((c) => [c.account.slug, c.billing]));
  const origin = `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host")}`;
  const taken = new Set(accounts.map((a) => a.ad_account_id));
  const available = adAccounts.filter((a) => !taken.has(a.account_id));

  return (
    <>
    <BrandBar />
    <main style={{ maxWidth: 900, margin: "0 auto", padding: 24 }}>
      <section style={box}>
        <h2 style={{ fontSize: 16, marginTop: 0 }}>Alerts — billing, and yesterday vs the previous 7-day average</h2>
        {accounts.length === 0 && <p style={{ color: "#65676b", margin: 0 }}>No clients yet.</p>}
        {accounts.length > 0 && withAlerts.length === 0 && (
          <p style={{ color: "#2e7d32", margin: 0 }}>All normal: balances are above the limit and no client moved 40% or more on spend or cost per result.</p>
        )}
        {withAlerts.map(({ account, alerts }) => (
          <div key={account.slug} style={{ padding: "10px 0", borderTop: "1px solid #f0f2f5" }}>
            <a href={`/c/${account.slug}`} style={{ fontWeight: 600 }}>{account.name}</a>
            {alerts.map((a, i) => (
              <div key={i} style={{ display: "flex", gap: 8, alignItems: "baseline", marginTop: 4, fontSize: 14 }}>
                <span style={{ color: LEVEL_COLOR[a.level] }}>●</span>
                <span>
                  <strong>{a.scope}:</strong> {a.text}
                </span>
              </div>
            ))}
          </div>
        ))}
      </section>

      <h1 style={{ fontSize: 22, marginTop: 0 }}>Clients</h1>

      {error &&<div style={{ ...box, color: "#c62828" }}>{error}</div>}
      {created && pw && (
        <div style={{ ...box, background: "#e8f5e9" }}>
          <strong>Link:</strong> {origin}/c/{created}
          <br />
          <strong>Password:</strong> {pw}
          <br />
          <small>Copy it now — it is stored hashed and won&apos;t be shown again.</small>
        </div>
      )}

      <section style={box}>
        <h2 style={{ fontSize: 16, marginTop: 0 }}>Add client</h2>
        <form action={addClient} style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <select name="ad_account_id" required style={{ ...input, minWidth: 260 }}>
            {available.map((a) => (
              <option key={a.account_id} value={a.account_id}>
                {a.name} ({a.currency})
              </option>
            ))}
          </select>
          <input name="name" placeholder="Display name (optional)" style={input} />
          <input name="password" placeholder="Password (blank = generate)" style={input} />
          <label style={{ ...input, background: "#fff" }}>
            Logo: <input name="logo" type="file" accept="image/*" />
          </label>
          <button type="submit" style={button}>Add</button>
        </form>
      </section>

      <section style={box}>
        <h2 style={{ fontSize: 16, marginTop: 0 }}>Existing clients</h2>
        {accounts.length === 0 && <p style={{ color: "#65676b" }}>No clients yet.</p>}
        {accounts.map((a) => (
          <div
            key={a.slug}
            style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap", padding: "8px 0", borderBottom: "1px solid #f0f2f5" }}
          >
            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              {a.logo && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={a.logo} alt="" style={{ width: 40, height: 40, borderRadius: 8, objectFit: "cover" }} />
              )}
              <div>
                <strong>{a.name}</strong>
                <br />
                <a href={`/c/${a.slug}`}>/c/{a.slug}</a>
                <small style={{ color: "#65676b" }}> · {a.currency} · {a.timezone}</small>
                <BillingLine b={billingBySlug.get(a.slug) ?? null} />
              </div>
            </div>
            <div style={{ display: "grid", gap: 6 }}>
              <form action={resetPassword.bind(null, a.slug)} style={{ display: "flex", gap: 6 }}>
                <input name="password" placeholder="New password (blank = generate)" style={input} />
                <button type="submit" style={button}>Reset</button>
              </form>
              <form action={setLogo.bind(null, a.slug)} style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <input name="logo" type="file" accept="image/*" required style={{ fontSize: 12 }} />
                <button type="submit" style={button}>Set logo</button>
              </form>
            </div>
          </div>
        ))}
      </section>
    </main>
    </>
  );
}
