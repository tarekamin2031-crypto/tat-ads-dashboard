import { NextRequest, NextResponse } from "next/server";

// Admin area only: a signed cookie set by /admin/login (password = DASHBOARD_PASSWORD).
// Client dashboards (/c/<slug>) have their own per-client password.
// Edge runtime, so the HMAC uses Web Crypto; lib/auth.ts adminToken() produces the same value.
async function expectedToken(): Promise<string | null> {
  const password = process.env.DASHBOARD_PASSWORD;
  const secret = process.env.SESSION_SECRET;
  if (!password || !secret) return null;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`admin:${password}`));
  return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function middleware(req: NextRequest) {
  if (req.nextUrl.pathname === "/admin/login") return NextResponse.next();
  const expected = await expectedToken();
  if (!expected) return new NextResponse("DASHBOARD_PASSWORD or SESSION_SECRET is not set", { status: 500 });
  if (req.cookies.get("admin_session")?.value === expected) return NextResponse.next();
  return NextResponse.redirect(new URL("/admin/login", req.url));
}

export const config = { matcher: ["/admin/:path*"] };
