"use server";

import { timingSafeEqual } from "node:crypto";
import { redirect } from "next/navigation";
import { OWNER_EMAIL, setAdminCookie } from "@/lib/admin";
import { hashPassword, verifyPassword } from "@/lib/auth";
import { db, ensureSchema } from "@/lib/db";

const same = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

export async function adminLogin(formData: FormData) {
  await ensureSchema();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const fail = () => redirect("/admin/login?error=1");
  if (!email || !password) fail();

  const res = await db.execute({ sql: "SELECT password_hash FROM admin_users WHERE email = ?", args: [email] });
  if (res.rows[0]) {
    if (!verifyPassword(password, String(res.rows[0].password_hash))) fail();
  } else {
    // First sign-in of the owner: DASHBOARD_PASSWORD is the starting password; it is stored hashed.
    const initial = process.env.DASHBOARD_PASSWORD ?? "";
    if (email !== OWNER_EMAIL || !initial || !same(password, initial)) fail();
    await db.execute({ sql: "INSERT OR IGNORE INTO admin_users (email, password_hash, valid_after) VALUES (?, ?, 0)", args: [email, hashPassword(password)] });
  }
  await setAdminCookie(email);
  redirect("/admin");
}
