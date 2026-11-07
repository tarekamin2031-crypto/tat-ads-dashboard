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
          <p>Sign in to manage clients.</p>
          <input className="field" name="email" type="email" placeholder="Email" autoComplete="username" autoFocus required aria-label="Email" />
          <input className="field" name="password" type="password" placeholder="Password" autoComplete="current-password" required aria-label="Password" />
          {error && <div className="form-error" role="alert">Wrong email or password. Please try again.</div>}
          <button className="btn" type="submit">Sign in</button>
        </form>
      </main>
      <BrandFooter />
    </>
  );
}
