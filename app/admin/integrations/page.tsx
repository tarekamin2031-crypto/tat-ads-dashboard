import { BrandBar } from "@/components/Brand";
import { requireAdmin } from "@/lib/admin";
import { cred, credSource, INTEGRATIONS, loadCredentials, maskValue } from "@/lib/secrets";
import { removeIntegration, saveIntegration } from "./actions";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // saving pulls data for clients already linked

export default async function IntegrationsPage({ searchParams }: { searchParams: Promise<{ saved?: string; pulled?: string; note?: string; removed?: string; error?: string }> }) {
  await requireAdmin();
  await loadCredentials(true);
  const { saved, pulled, note, removed, error } = await searchParams;
  const sessionSecretOk = Boolean(process.env.SESSION_SECRET);

  return (
    <>
      <BrandBar admin />
      <main className="wrap narrow">
        <a className="back" href="/admin">← All clients</a>
        <header className="settings-head">
          <div>
            <h1 className="page-title">Integrations</h1>
            <div className="page-sub">Ad platform credentials for the whole agency</div>
          </div>
        </header>

        {error && <div className="notice err" role="alert">{error}</div>}
        {saved && <div className="notice ok" role="status">✓ Saved. {Number(pulled) > 0 ? `Pulled data for ${pulled} linked ${Number(pulled) === 1 ? "client" : "clients"}. ` : ""}The daily sync uses these automatically.{note && <><br /><small>{note}</small></>}</div>}
        {removed && <div className="notice ok" role="status">✓ Removed the saved credentials.</div>}
        {!sessionSecretOk && <div className="notice err">SESSION_SECRET is not set, so credentials cannot be stored.</div>}

        <p className="set-help" style={{ margin: "0 0 14px" }}>
          Values are stored encrypted in the database. The daily GitHub sync reads them from there, so nothing needs to be added to GitHub or Vercel except
          <b> SESSION_SECRET</b> (same value in both) to decrypt them. Saved values are never shown again, only the last 4 characters.
        </p>

        <div className="set-stack">
          {INTEGRATIONS.map((i) => {
            const have = i.fields.filter((f) => cred(f.name)).length;
            const need = i.fields.filter((f) => f.name !== "GOOGLE_ADS_LOGIN_CUSTOMER_ID").length;
            const required = i.fields.filter((f) => f.name !== "GOOGLE_ADS_LOGIN_CUSTOMER_ID" && cred(f.name)).length;
            const ready = required === need;
            return (
              <section key={i.id} className="card set-card" id={i.id}>
                <h2>{i.label} <span className={`pill ${ready ? "good" : have > 0 ? "warn" : "muted"}`} style={{ marginLeft: "auto" }}>{ready ? "Connected" : have > 0 ? `${required}/${need} set` : "Not set"}</span></h2>
                <p className="set-help">{i.intro}</p>
                <form action={saveIntegration.bind(null, i.id)} className="set-form" autoComplete="off">
                  {i.fields.map((f) => {
                    const current = cred(f.name);
                    const src = credSource(f.name);
                    return (
                      <label key={f.name} className="f">
                        <span>{f.label} {src && <em>{src === "saved" ? "saved" : "from server environment"}{f.secret && current ? ` · ${maskValue(current)}` : ""}</em>}</span>
                        <input
                          className="field"
                          name={f.name}
                          type={f.secret ? "password" : "text"}
                          defaultValue={!f.secret && src === "saved" ? current : ""}
                          placeholder={f.secret && current ? "Leave blank to keep the saved value" : f.secret ? "Paste value" : ""}
                          autoComplete="off"
                          spellCheck={false}
                        />
                        {f.help && <small>{f.help}</small>}
                      </label>
                    );
                  })}
                  <div className="set-actions"><button className="btn" type="submit">Save &amp; pull data</button></div>
                </form>
                {have > 0 && (
                  <form action={removeIntegration.bind(null, i.id)} style={{ marginTop: 10 }}>
                    <button className="btn ghost small" type="submit">Remove saved credentials</button>
                  </form>
                )}
              </section>
            );
          })}
        </div>
      </main>
    </>
  );
}
