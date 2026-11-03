import { NextRequest, NextResponse } from "next/server";

// Admin area only: HTTP basic auth, any username, password = DASHBOARD_PASSWORD.
// Client dashboards (/c/<slug>) have their own per-client password.
export function middleware(req: NextRequest) {
  const password = process.env.DASHBOARD_PASSWORD;
  if (!password) {
    return new NextResponse("DASHBOARD_PASSWORD is not set", { status: 500 });
  }
  const header = req.headers.get("authorization");
  if (header?.startsWith("Basic ")) {
    const decoded = atob(header.slice(6));
    if (decoded.slice(decoded.indexOf(":") + 1) === password) return NextResponse.next();
  }
  return new NextResponse("Authentication required", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="Meta Ads Admin"' },
  });
}

export const config = { matcher: ["/admin/:path*"] };
