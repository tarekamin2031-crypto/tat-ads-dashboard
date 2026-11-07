import { timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { BrandBar, BrandFooter } from "@/components/Brand";
import { Dashboard, type PlatformTab } from "@/components/Dashboard";
import { getAccount, isMetaAccount, primaryPlatform } from "@/lib/accounts";
import { sessionCookieName, sessionToken } from "@/lib/auth";
import { resolveRange } from "@/lib/dates";
import { db } from "@/lib/db";
import { insightsKey, platformById, platformReady } from "@/lib/platforms";
import { loadCredentials } from "@/lib/secrets";
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
  searchParams: Promise<{ p?: string; days?: string; range?: string; tax?: string; from?: string; to?: string; error?: string }>;
}) {
  const { slug } = await params;
  const query = await searchParams;
  const { error } = query;
  const account = await getAccount(slug);
  if (!account) notFound();

  const cookie = (await cookies()).get(sessionCookieName(slug))?.value ?? "";
  if (safeEqual(cookie, sessionToken(slug, account.password_hash))) {
    await loadCredentials();
    const range = resolveRange(query, account.timezone);
    // Tabs: Meta always, plus each linked platform that has data synced.
    const linked = await db.execute({ sql: "SELECT platform, external_id FROM account_platforms WHERE slug = ?", args: [slug] });
    const tabs: PlatformTab[] = isMetaAccount(account) ? [{ id: "meta", label: "Meta", key: account.ad_account_id }] : [];
    for (const r of linked.rows) {
      const def = platformById(String(r.platform));
      if (!def || def.id === "meta" || !platformReady(def.id)) continue;
      const key = insightsKey(def.id, String(r.external_id));
      const has = await db.execute({ sql: "SELECT 1 FROM daily_insights WHERE account_id = ? LIMIT 1", args: [key] });
      // The client's primary platform always has a tab, even before its first data arrives.
      if (has.rows.length > 0 || key === account.ad_account_id) tabs.push({ id: def.id, label: def.label.replace(" Ads", ""), key });
    }
    if (tabs.length === 0) {
      const pid = primaryPlatform(account);
      tabs.push({ id: pid, label: platformById(pid)?.label.replace(" Ads", "") ?? pid, key: account.ad_account_id });
    }
    const current = tabs.find((t) => t.id === query.p) ?? tabs[0];
    return <Dashboard account={account} range={range} basePath={`/c/${slug}`} platforms={tabs} tax={query.tax === "1"} current={{ ...current, label: current.id === "meta" ? "Meta Ads" : `${current.label} Ads` }} />;
  }

  return (
    <>
    <BrandBar clientName={account.name} clientLogo={account.logo} />
    <main className="login">
      <form action={login.bind(null, slug)} className="card login-card">
        <h1>Ads performance</h1>
        <p>Enter your password to view your ads performance.</p>
        <input className="field" name="password" type="password" placeholder="Password" autoFocus required aria-label="Password" />
        {error && <div className="form-error" role="alert">Wrong password. Please try again.</div>}
        <button className="btn" type="submit">View dashboard</button>
      </form>
    </main>
    <BrandFooter />
    </>
  );
}
