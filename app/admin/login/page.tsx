import { BrandBar, BrandFooter } from "@/components/Brand";
import { adminLogin } from "./actions";

export const dynamic = "force-dynamic";

export default async function AdminLogin({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return (
    <>
      <BrandBar />
      <main className="login">
        <form action={adminLogin} className="card login-card">
          <h1>Agency admin</h1>
          <p>Enter the admin password to manage clients.</p>
          <input className="field" name="password" type="password" placeholder="Password" autoFocus required aria-label="Password" />
          {error && <div className="form-error" role="alert">Wrong password. Please try again.</div>}
          <button className="btn" type="submit">Sign in</button>
        </form>
      </main>
      <BrandFooter />
    </>
  );
}
