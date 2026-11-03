// YYYY-MM-DD for "n days ago" in the given IANA timezone (the ad account's own timezone,
// so day boundaries match Ads Manager).
export function dateInTz(tz: string, daysAgo = 0): string {
  const d = new Date(Date.now() - daysAgo * 86_400_000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(d);
}

export const PRESET_DAYS = [7, 14, 30, 90];
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_CUSTOM_DAYS = 366;

export type Range = { kind: "daily" | "days" | "custom"; days?: number; since: string; until: string };

// Presets end yesterday, like Ads Manager. Custom dates may include today
// (partial, as of the last sync). Anything invalid falls back to the last 7 days.
export function resolveRange(
  p: { days?: string; range?: string; from?: string; to?: string },
  tz: string,
): Range {
  const yesterday = dateInTz(tz, 1);
  const today = dateInTz(tz, 0);

  if (p.from && p.to && ISO_DATE.test(p.from) && ISO_DATE.test(p.to)) {
    const span = (Date.parse(p.to) - Date.parse(p.from)) / 86_400_000;
    if (p.from <= p.to && p.to <= today && span < MAX_CUSTOM_DAYS) {
      return { kind: "custom", since: p.from, until: p.to };
    }
  }
  if (p.range === "daily") return { kind: "daily", since: yesterday, until: yesterday };

  const days = PRESET_DAYS.includes(Number(p.days)) ? Number(p.days) : 7;
  return { kind: "days", days, since: dateInTz(tz, days), until: yesterday };
}
