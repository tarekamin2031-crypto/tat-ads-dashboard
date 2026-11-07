import { BrandBar } from "@/components/Brand";
import { requireAdmin } from "@/lib/admin";
import { changePassword, signOut } from "./actions";

export const dynamic = "force-dynamic";

export default async function AccountPage({ searchParams }: { searchParams: Promise<{ saved?: string; error?: string }> }) {
  const { email } = await requireAdmin();
  const { saved, error } = await searchParams;
  return (
    <>
      <BrandBar admin />
      <main className="wrap narrow">
        <a className="back" href="/admin">← All clients</a>
        <header className="settings-head">
          <div>
            <h1 className="page-title">My account</h1>
            <div className="page-sub">{email}</div>
          </div>
          <form action={signOut} className="push"><button className="btn ghost small" type="submit">Sign out</button></form>
        </header>

        {error && <div className="notice err" role="alert">{error}</div>}
        {saved && <div className="notice ok" role="status">✓ Password changed. Other devices were signed out.</div>}

        <section className="card set-card">
          <h2>Change password</h2>
          <form action={changePassword} className="set-form">
            <input type="email" name="username" defaultValue={email} autoComplete="username" hidden readOnly />
            <label className="f">
              <span>Current password</span>
              <input className="field" name="current" type="password" autoComplete="current-password" required />
            </label>
            <label className="f">
              <span>New password <em>at least 8 characters</em></span>
              <input className="field" name="next" type="password" autoComplete="new-password" minLength={8} required />
            </label>
            <label className="f">
              <span>Repeat new password</span>
              <input className="field" name="confirm" type="password" autoComplete="new-password" minLength={8} required />
            </label>
            <div className="set-actions"><button className="btn" type="submit">Change password</button></div>
          </form>
        </section>
      </main>
    </>
  );
}
