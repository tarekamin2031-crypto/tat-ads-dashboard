import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${scryptSync(password, salt, 32).toString("hex")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  const expected = Buffer.from(hash, "hex");
  const actual = scryptSync(password, salt, expected.length);
  return timingSafeEqual(actual, expected);
}

// Cookie value proving the visitor entered this client's password. Changing the
// client's password changes the hash, which invalidates existing sessions.
export function sessionToken(slug: string, passwordHash: string): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("Missing env var SESSION_SECRET");
  return createHmac("sha256", secret).update(`${slug}:${passwordHash}`).digest("hex");
}

export const sessionCookieName = (slug: string) => `s_${slug}`;

// Admin session cookie value (must match middleware.ts). Changing DASHBOARD_PASSWORD signs everyone out.
export function adminToken(): string {
  const secret = process.env.SESSION_SECRET;
  const password = process.env.DASHBOARD_PASSWORD;
  if (!secret || !password) throw new Error("Missing env var SESSION_SECRET or DASHBOARD_PASSWORD");
  return createHmac("sha256", secret).update(`admin:${password}`).digest("hex");
}
