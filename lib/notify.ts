import type { Account } from "./accounts";
import { billingAlerts, type Billing } from "./billing";
import { db, ensureSchema } from "./db";

const MIN_GAP_MS = 60 * 60 * 1000; // at most one "client opened the dashboard" message per client per hour

const money = (v: number) => v.toLocaleString("en-US", { maximumFractionDigits: 0 });

// Tells the agency on Telegram that a client opened their dashboard. Does nothing unless
// TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID are set, and never throws: a notification problem
// must not break the client's page.
export async function notifyVisit(account: Account, billing: Billing | null): Promise<void> {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!botToken || !chatId || !account.notify_visits) return;

  try {
    await ensureSchema();
    const now = new Date();
    // The upsert only writes when the last message is older than the gap, so concurrent
    // visits can't both send: exactly one of them sees rowsAffected = 1.
    const claimed = await db.execute({
      sql: `INSERT INTO visit_notify (slug, last_notified_at) VALUES (?, ?)
            ON CONFLICT(slug) DO UPDATE SET last_notified_at = excluded.last_notified_at
            WHERE visit_notify.last_notified_at < ?`,
      args: [account.slug, now.toISOString(), new Date(now.getTime() - MIN_GAP_MS).toISOString()],
    });
    if (claimed.rowsAffected === 0) return;

    const time = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Africa/Cairo",
      hour: "2-digit",
      minute: "2-digit",
      day: "2-digit",
      month: "short",
    }).format(now);

    const lines = [`👀 العميل ${account.name} فتح الداشبورد`, `🕐 ${time} (القاهرة)`];
    if (billing?.available != null) {
      lines.push(`💰 المتاح: ${money(billing.available)} ${billing.currency}`);
    }
    for (const a of billingAlerts(billing)) lines.push(`⚠️ ${a.text}`);

    const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: lines.join("\n") }),
    });
    if (!res.ok) console.error(`Telegram sendMessage failed: HTTP ${res.status}`);
  } catch (e) {
    console.error("Visit notification failed", e);
  }
}
