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

// Admin session cookie: "<issuedAtMs>:<hmac>:<email>". The HMAC covers email + issue time, so it cannot be
// forged without SESSION_SECRET. middleware.ts verifies the same thing with Web Crypto; lib/admin.ts also
// checks the user still exists and the password was not changed after the cookie was issued.
export const ADMIN_COOKIE = "admin_session";
export const ADMIN_SESSION_MS = 30 * 24 * 60 * 60 * 1000;

export function adminCookieValue(email: string, issuedAt: number): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("Missing env var SESSION_SECRET");
  const sig = createHmac("sha256", secret).update(`admin:${email}:${issuedAt}`).digest("hex");
  return `${issuedAt}:${sig}:${email}`;
}

export function parseAdminCookie(value: string | undefined): { email: string; issuedAt: number } | null {
  if (!value || !process.env.SESSION_SECRET) return null;
  const [iat, sig, ...rest] = value.split(":");
  const email = rest.join(":");
  const issuedAt = Number(iat);
  if (!email || !sig || !Number.isFinite(issuedAt)) return null;
  const expected = Buffer.from(adminCookieValue(email, issuedAt));
  const given = Buffer.from(value);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  if (Date.now() - issuedAt > ADMIN_SESSION_MS || issuedAt > Date.now() + 60_000) return null;
  return { email, issuedAt };
}
