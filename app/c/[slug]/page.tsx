import { timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { BrandBar, BrandFooter } from "@/components/Brand";
import { Dashboard } from "@/components/Dashboard";
import { getAccount } from "@/lib/accounts";
import { sessionCookieName, sessionToken } from "@/lib/auth";
import { resolveRange } from "@/lib/dates";
import { login } from "./actions";

export const dynamic = "force-dynamic";

function safeEqual(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export default async function ClientPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ days?: string; range?: string; from?: string; to?: string; error?: string }>;
}) {
  const { slug } = await params;
  const query = await searchParams;
  const { error } = query;
  const account = await getAccount(slug);
  if (!account) notFound();

  const cookie = (await cookies()).get(sessionCookieName(slug))?.value ?? "";
  if (safeEqual(cookie, sessionToken(slug, account.password_hash))) {
    const range = resolveRange(query, account.timezone);
    return <Dashboard account={account} range={range} basePath={`/c/${slug}`} />;
  }

  return (
    <>
    <BrandBar clientName={account.name} clientLogo={account.logo} />
    <main style={{ maxWidth: 360, margin: "10vh auto 0", padding: 24 }}>
      <h1 style={{ fontSize: 20, marginTop: 0 }}>Ads performance</h1>
      <p style={{ color: "#65676b" }}>Enter the password to view your ads performance.</p>
      <form action={login.bind(null, slug)} style={{ display: "grid", gap: 10 }}>
        <input
          name="password"
          type="password"
          placeholder="Password"
          autoFocus
          required
          style={{ padding: 10, borderRadius: 6, border: "1px solid #dadde1", fontSize: 15 }}
        />
        {error && <small style={{ color: "#c62828" }}>Wrong password</small>}
        <button
          type="submit"
          style={{ padding: 10, borderRadius: 6, border: 0, background: "#0f766e", color: "#fff", fontSize: 15, cursor: "pointer" }}
        >
          View dashboard
        </button>
      </form>
    </main>
    <BrandFooter />
    </>
  );
}
