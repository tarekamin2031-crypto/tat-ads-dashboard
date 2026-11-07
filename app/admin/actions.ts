"use server";

import { randomBytes } from "node:crypto";
import { redirect } from "next/navigation";
import { getAccount } from "@/lib/accounts";
import { hashPassword } from "@/lib/auth";
import { db, ensureSchema } from "@/lib/db";
import { listGoogleAccounts } from "@/lib/google";
import { listAdAccounts } from "@/lib/meta";
import { loadCredentials } from "@/lib/secrets";
import { syncAccount, syncOtherPlatforms } from "@/lib/sync";

const slugify = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

const MAX_LOGO_BYTES = 400 * 1024;

// Logos live in the database as data: URIs so they work on hosts with a read-only filesystem.
async function logoFromForm(formData: FormData): Promise<string | null> {
  const file = formData.get("logo");
  if (!(file instanceof File) || file.size === 0) return null;
  if (!file.type.startsWith("image/")) redirect("/admin?error=Logo+must+be+an+image");
  if (file.size > MAX_LOGO_BYTES) redirect("/admin?error=Logo+is+too+large+(max+400KB)");
  return `data:${file.type};base64,${Buffer.from(await file.arrayBuffer()).toString("base64")}`;
}

export async function setLogo(slug: string, formData: FormData) {
  const logo = await logoFromForm(formData);
  if (!logo) redirect("/admin?error=Choose+an+image+file");
  await db.execute({ sql: "UPDATE accounts SET logo = ? WHERE slug = ?", args: [logo, slug] });
  redirect(`/admin/clients/${slug}?saved=logo`);
}

export async function addClient(formData: FormData) {
  await ensureSchema();
  await loadCredentials();
  const metaId = String(formData.get("ad_account_id") ?? "");
  const googleId = String(formData.get("google_customer_id") ?? "").replace(/\D/g, "");
  const name = String(formData.get("name") ?? "").trim();
  const password = String(formData.get("password") ?? "").trim() || randomBytes(6).toString("hex");
  if (!metaId && !googleId) redirect("/admin?error=Choose+a+Meta+ad+account,+a+Google+Ads+account,+or+both");

  // A client can run Meta, Google Ads or both. The first platform picked is the client's primary one:
  // Meta clients keep their plain ad account id, Google-only clients use "google:<customer id>".
  const meta = metaId ? (await listAdAccounts()).find((a) => a.account_id === metaId) : null;
  if (metaId && !meta) redirect("/admin?error=Ad+account+not+found+for+this+token");
  const google = googleId ? (await listGoogleAccounts()).find((g) => g.id === googleId) : null;
  if (googleId && !google) redirect("/admin?error=Google+Ads+account+not+found+under+your+manager+account");

  const accountKey = meta ? metaId : `google:${googleId}`;
  const currency = meta?.currency ?? google!.currency ?? "USD";
  const timezone = meta?.timezone_name ?? google!.timezone ?? "UTC";
  const logo = await logoFromForm(formData);
  const displayName = name || (meta ? meta.name.replace(/^ea\s*-\s*/i, "") : google!.name);
  const suffix = (metaId || googleId).slice(-4);
  let slug = slugify(displayName) || `client-${suffix}`;
  if (await getAccount(slug)) slug = `${slug}-${suffix}`;

  await db.execute({
    sql: `INSERT INTO accounts (slug, name, ad_account_id, currency, timezone, password_hash, logo)
          VALUES (?, ?, ?, ?, ?, ?, ?)`,
    args: [slug, displayName, accountKey, currency, timezone, hashPassword(password), logo],
  });

  if (googleId) {
    await db.execute({
      sql: `INSERT INTO account_platforms (slug, platform, external_id) VALUES (?, 'google', ?)
            ON CONFLICT(slug, platform) DO UPDATE SET external_id = excluded.external_id`,
      args: [slug, googleId],
    });
  }

  // Pull the first 90 days now so the client's dashboard is not empty until tomorrow's run.
  // If it fails (rate limit, timeout) the client is still added and the daily sync fills it in.
  const added = await getAccount(slug);
  let syncNote = "";
  try {
    if (added) {
      await syncAccount(added);
      if (googleId) await syncOtherPlatforms(added);
    }
  } catch (e) {
    console.error(`Initial sync failed for ${slug}`, e);
    syncNote = "&error=Client+added,+but+the+first+data+pull+failed.+It+will+retry+in+the+daily+sync.";
  }

  // The password is only known right now (stored hashed), so show it once via the URL.
  redirect(`/admin?created=${slug}&pw=${encodeURIComponent(password)}${syncNote}`);
}

export async function resetPassword(slug: string, formData: FormData) {
  const password = String(formData.get("password") ?? "").trim() || randomBytes(6).toString("hex");
  await db.execute({
    sql: "UPDATE accounts SET password_hash = ? WHERE slug = ?",
    args: [hashPassword(password), slug],
  });
  redirect(`/admin/clients/${slug}?created=1&pw=${encodeURIComponent(password)}`);
}
