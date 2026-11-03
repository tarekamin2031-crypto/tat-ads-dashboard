"use server";

import { randomBytes } from "node:crypto";
import { redirect } from "next/navigation";
import { getAccount } from "@/lib/accounts";
import { hashPassword } from "@/lib/auth";
import { db, ensureSchema } from "@/lib/db";
import { listAdAccounts } from "@/lib/meta";
import { syncAccount } from "@/lib/sync";

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
  redirect("/admin");
}

export async function addClient(formData: FormData) {
  await ensureSchema();
  const adAccountId = String(formData.get("ad_account_id") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const password = String(formData.get("password") ?? "").trim() || randomBytes(6).toString("hex");

  const meta = (await listAdAccounts()).find((a) => a.account_id === adAccountId);
  if (!meta) redirect("/admin?error=Ad+account+not+found+for+this+token");

  const logo = await logoFromForm(formData);
  const displayName = name || meta.name.replace(/^ea\s*-\s*/i, "");
  let slug = slugify(displayName) || `client-${adAccountId.slice(-6)}`;
  if (await getAccount(slug)) slug = `${slug}-${adAccountId.slice(-4)}`;

  await db.execute({
    sql: `INSERT INTO accounts (slug, name, ad_account_id, currency, timezone, password_hash, logo)
          VALUES (?, ?, ?, ?, ?, ?, ?)`,
    args: [slug, displayName, adAccountId, meta.currency, meta.timezone_name, hashPassword(password), logo],
  });

  // Pull the first 90 days now so the client's dashboard is not empty until tomorrow's run.
  // If it fails (rate limit, timeout) the client is still added and the daily sync fills it in.
  const added = await getAccount(slug);
  let syncNote = "";
  try {
    if (added) await syncAccount(added);
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
  redirect(`/admin?created=${slug}&pw=${encodeURIComponent(password)}`);
}
