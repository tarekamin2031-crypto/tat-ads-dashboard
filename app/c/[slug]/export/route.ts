import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getAccount } from "@/lib/accounts";
import { sessionCookieName, sessionToken } from "@/lib/auth";
import { resolveRange } from "@/lib/dates";
import { db } from "@/lib/db";
import { insightsKey, platformById } from "@/lib/platforms";

export const dynamic = "force-dynamic";

const safeEqual = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

// Spreadsheet formulas in names (=, +, -, @) would run when the CSV is opened in Excel; neutralise them.
const cell = (v: string | number) => {
  const s = String(v);
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

export async function GET(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const account = await getAccount(slug);
  if (!account) return new NextResponse("Not found", { status: 404 });

  const cookie = req.cookies.get(sessionCookieName(slug))?.value ?? "";
  if (!safeEqual(cookie, sessionToken(slug, account.password_hash))) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const q = Object.fromEntries(req.nextUrl.searchParams);
  const range = resolveRange(q, account.timezone);

  let key = account.ad_account_id;
  const p = q.p && q.p !== "meta" ? platformById(q.p) : null;
  if (p) {
    const linked = await db.execute({ sql: "SELECT external_id FROM account_platforms WHERE slug = ? AND platform = ?", args: [slug, p.id] });
    if (!linked.rows[0]) return new NextResponse("Platform not linked", { status: 404 });
    key = insightsKey(p.id, String(linked.rows[0].external_id));
  }

  const res = await db.execute({
    sql: `SELECT date, campaign_name, adset_name, spend, impressions, clicks, reach, leads, messages, profile_visits, purchases, purchase_value
          FROM daily_insights WHERE account_id = ? AND date BETWEEN ? AND ? ORDER BY date, campaign_name, adset_name`,
    args: [key, range.since, range.until],
  });

  const head = ["Date", "Campaign", "Ad set", `Spend (${account.currency})`, "Impressions", "Clicks", "Reach", "Leads", "Messages", "Profile visits", "Purchases", "Purchase value"];
  const lines = [head.join(",")];
  for (const r of res.rows) {
    lines.push(
      [r.date, r.campaign_name, r.adset_name, r.spend, r.impressions, r.clicks, r.reach, r.leads, r.messages, r.profile_visits, r.purchases, r.purchase_value]
        .map((v) => cell(v as string | number))
        .join(","),
    );
  }

  return new NextResponse("﻿" + lines.join("\r\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${slug}-${p?.id ?? "meta"}-${range.since}_${range.until}.csv"`,
      "Cache-Control": "private, no-store",
    },
  });
}
