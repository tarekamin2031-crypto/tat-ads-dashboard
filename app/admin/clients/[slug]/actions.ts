"use server";

import { redirect } from "next/navigation";
import { db, ensureSchema } from "@/lib/db";
import { getAccount } from "@/lib/accounts";
import { platformById, platformReady } from "@/lib/platforms";
import { syncOtherPlatforms } from "@/lib/sync";

const back = (slug: string, q: string) => redirect(`/admin/clients/${slug}?${q}`);

export async function saveDetails(slug: string, formData: FormData) {
  await ensureSchema();
  const name = String(formData.get("name") ?? "").trim();
  if (!name) back(slug, "error=Name+can%27t+be+empty");
  await db.execute({ sql: "UPDATE accounts SET name = ? WHERE slug = ?", args: [name, slug] });
  back(slug, "saved=details");
}

export async function saveAlerts(slug: string, formData: FormData) {
  await ensureSchema();
  const low = Number(formData.get("low_balance"));
  const pct = Number(formData.get("change_pct"));
  if (!Number.isFinite(low) || low < 0) back(slug, "error=Low+balance+must+be+0+or+more");
  if (!Number.isFinite(pct) || pct < 5 || pct > 500) back(slug, "error=Change+limit+must+be+between+5+and+500");
  await db.execute({ sql: "UPDATE accounts SET low_balance = ?, change_pct = ? WHERE slug = ?", args: [low, pct / 100, slug] });
  back(slug, "saved=alerts");
}

export async function saveBudget(slug: string, formData: FormData) {
  await ensureSchema();
  const raw = String(formData.get("monthly_budget") ?? "").trim();
  const value = raw === "" ? null : Number(raw);
  if (value !== null && (!Number.isFinite(value) || value <= 0)) back(slug, "error=Monthly+budget+must+be+more+than+0+(or+leave+blank)");
  await db.execute({ sql: "UPDATE accounts SET monthly_budget = ? WHERE slug = ?", args: [value, slug] });
  back(slug, "saved=budget");
}

export async function saveNotifications(slug: string, formData: FormData) {
  await ensureSchema();
  const on = formData.get("notify_visits") === "on" ? 1 : 0;
  await db.execute({ sql: "UPDATE accounts SET notify_visits = ? WHERE slug = ?", args: [on, slug] });
  back(slug, "saved=notifications");
}

export async function savePlatform(slug: string, platform: string, formData: FormData) {
  await ensureSchema();
  const p = platformById(platform);
  if (!p || p.id === "meta") back(slug, "error=Unknown+platform");
  const id = String(formData.get("external_id") ?? "").trim();
  if (!id) {
    await db.execute({ sql: "DELETE FROM account_platforms WHERE slug = ? AND platform = ?", args: [slug, platform] });
  } else {
    await db.execute({
      sql: `INSERT INTO account_platforms (slug, platform, external_id) VALUES (?, ?, ?)
            ON CONFLICT(slug, platform) DO UPDATE SET external_id = excluded.external_id`,
      args: [slug, platform, id.slice(0, 80)],
    });
  }
  // Pull the data right away so the client's tab isn't empty until tomorrow's sync.
  if (id && platformReady(platform)) {
    const acc = await getAccount(slug);
    const notes = acc ? await syncOtherPlatforms(acc) : [];
    if (notes.some((n) => n.includes("FAILED"))) back(slug, `error=${encodeURIComponent("Saved, but the first data pull failed: " + notes.find((n) => n.includes("FAILED")))}`);
  }
  back(slug, "saved=platforms");
}
