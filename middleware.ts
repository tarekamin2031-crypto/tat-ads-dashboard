import { NextRequest, NextResponse } from "next/server";

// Admin area only: a signed cookie set by /admin/login ("<issuedAtMs>:<hmac>:<email>").
// This edge check verifies the signature and age; lib/admin.ts requireAdmin() also checks the user in the
// database (so changing the password signs old sessions out). Client dashboards (/c/<slug>) have their own password.
// Edge runtime, so the HMAC uses Web Crypto; lib/auth.ts adminCookieValue() produces the same value.
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

async function valid(cookie: string | undefined): Promise<boolean | null> {
  const secret = process.env.SESSION_SECRET;
  if (!secret) return null;
  if (!cookie) return false;
  const [iat, sig, ...rest] = cookie.split(":");
  const email = rest.join(":");
  const issuedAt = Number(iat);
  if (!email || !sig || !Number.isFinite(issuedAt) || Date.now() - issuedAt > MAX_AGE_MS) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`admin:${email}:${issuedAt}`));
  const hex = Array.from(new Uint8Array(mac), (b) => b.toString(16).padStart(2, "0")).join("");
  return hex === sig;
}

export async function middleware(req: NextRequest) {
  if (req.nextUrl.pathname === "/admin/login") return NextResponse.next();
  const ok = await valid(req.cookies.get("admin_session")?.value);
  if (ok === null) return new NextResponse("SESSION_SECRET is not set", { status: 500 });
  if (ok) return NextResponse.next();
  return NextResponse.redirect(new URL("/admin/login", req.url));
}

export const config = { matcher: ["/admin/:path*"] };
