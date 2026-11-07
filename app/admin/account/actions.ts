"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { requireAdmin, setAdminCookie } from "@/lib/admin";
import { ADMIN_COOKIE, hashPassword, verifyPassword } from "@/lib/auth";
import { db } from "@/lib/db";

const back = (q: string) => redirect(`/admin/account?${q}`);

export async function changePassword(formData: FormData) {
  const { email } = await requireAdmin();
  const current = String(formData.get("current") ?? "");
  const next = String(formData.get("next") ?? "");
  const confirm = String(formData.get("confirm") ?? "");
  const res = await db.execute({ sql: "SELECT password_hash FROM admin_users WHERE email = ?", args: [email] });
  if (!res.rows[0] || !verifyPassword(current, String(res.rows[0].password_hash))) back("error=Current+password+is+wrong");
  if (next.length < 8) back("error=New+password+must+be+at+least+8+characters");
  if (next !== confirm) back("error=The+two+new+passwords+do+not+match");
  if (next === current) back("error=Choose+a+password+different+from+the+current+one");
  // Every session issued before this moment stops working; this browser gets a fresh one.
  const now = Date.now();
  await db.execute({ sql: "UPDATE admin_users SET password_hash = ?, valid_after = ? WHERE email = ?", args: [hashPassword(next), now, email] });
  await setAdminCookie(email, now);
  back("saved=1");
}

export async function signOut() {
  (await cookies()).delete({ name: ADMIN_COOKIE, path: "/admin" });
  redirect("/admin/login");
}
