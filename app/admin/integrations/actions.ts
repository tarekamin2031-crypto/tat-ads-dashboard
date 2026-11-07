"use server";

import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/admin";
import { listAccounts } from "@/lib/accounts";
import { db } from "@/lib/db";
import { INTEGRATIONS, saveCredentials } from "@/lib/secrets";
import { syncOtherPlatforms } from "@/lib/sync";

const back = (q: string) => redirect(`/admin/integrations?${q}`);

export async function saveIntegration(id: string, formData: FormData) {
  await requireAdmin();
  const integ = INTEGRATIONS.find((i) => i.id === id);
  if (!integ) back("error=Unknown+integration");
  const values: Record<string, string> = {};
  for (const f of integ!.fields) values[f.name] = String(formData.get(f.name) ?? "");
  if (Object.values(values).every((v) => !v.trim())) back("error=Nothing+to+save.+Paste+at+least+one+value");
  await saveCredentials(values);

  // Pull data right away for clients already linked to this platform, so their tab fills without waiting for tomorrow.
  const linked = await db.execute({ sql: "SELECT DISTINCT slug FROM account_platforms WHERE platform = ?", args: [id] });
  const slugs = new Set(linked.rows.map((r) => String(r.slug)));
  const notes: string[] = [];
  for (const acc of (await listAccounts()).filter((a) => slugs.has(a.slug))) notes.push(...(await syncOtherPlatforms(acc)));
  const failed = notes.find((n) => n.includes("FAILED"));
  if (failed) back(`error=${encodeURIComponent(`Saved, but the first data pull failed: ${failed}`)}`);
  back(`saved=${id}&pulled=${notes.length}&note=${encodeURIComponent(notes.join(" | ").slice(0, 600))}`);
}

export async function removeIntegration(id: string) {
  await requireAdmin();
  const integ = INTEGRATIONS.find((i) => i.id === id);
  if (!integ) back("error=Unknown+integration");
  await saveCredentials(Object.fromEntries(integ!.fields.map((f) => [f.name, null])));
  back(`removed=${id}`);
}
