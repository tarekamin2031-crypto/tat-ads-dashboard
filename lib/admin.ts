import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ADMIN_COOKIE, ADMIN_SESSION_MS, adminCookieValue, parseAdminCookie } from "./auth";
import { db, ensureSchema } from "./db";

// The first admin. Their initial password is DASHBOARD_PASSWORD; once they change it in Account
// settings the stored hash is used and the env var no longer matters.
export const OWNER_EMAIL = (process.env.ADMIN_EMAIL || "tarekamin2031@gmail.com").trim().toLowerCase();

export async function getAdmin(): Promise<{ email: string } | null> {
  const parsed = parseAdminCookie((await cookies()).get(ADMIN_COOKIE)?.value);
  if (!parsed) return null;
  await ensureSchema();
  const res = await db.execute({ sql: "SELECT valid_after FROM admin_users WHERE email = ?", args: [parsed.email] });
  if (!res.rows[0] || parsed.issuedAt < Number(res.rows[0].valid_after)) return null;
  return { email: parsed.email };
}

export async function requireAdmin(): Promise<{ email: string }> {
  const a = await getAdmin();
  if (!a) redirect("/admin/login");
  return a;
}

export async function setAdminCookie(email: string, issuedAt = Date.now()) {
  (await cookies()).set(ADMIN_COOKIE, adminCookieValue(email, issuedAt), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/admin",
    maxAge: Math.floor(ADMIN_SESSION_MS / 1000),
  });
}
