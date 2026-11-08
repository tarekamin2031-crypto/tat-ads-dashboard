// What counts as a "result" depends on what the campaign was optimised for. Each ad set's Meta
// optimization goal is mapped to a kind at sync time and stored on its daily rows (column `goal`).
// Rows with no known goal (other platforms, old data) fall back to leads + purchases + messages + profile visits.
export const KINDS: Record<string, { label: string; one: string }> = {
  messages: { label: "Messages", one: "message" },
  leads: { label: "Leads", one: "lead" },
  conversions: { label: "Conversions", one: "conversion" },
  profile_visits: { label: "Profile visits", one: "profile visit" },
  traffic: { label: "Clicks", one: "click" },
  reach: { label: "People reached", one: "person reached" },
  "": { label: "Results", one: "result" },
};

export function goalKind(goal: string | null | undefined): string {
  switch ((goal ?? "").toUpperCase()) {
    case "CONVERSATIONS": return "messages";
    case "LEAD_GENERATION": case "QUALITY_LEAD": case "QUALITY_CALL": return "leads";
    case "OFFSITE_CONVERSIONS": case "VALUE": case "ONSITE_CONVERSIONS": return "conversions";
    case "PROFILE_VISIT": case "INSTAGRAM_PROFILE_VISIT": return "profile_visits";
    case "LINK_CLICKS": case "LANDING_PAGE_VIEWS": return "traffic";
    case "REACH": case "IMPRESSIONS": case "AD_RECALL_LIFT": return "reach";
    default: return "";
  }
}

// SQL for one row's result count, by its goal kind.
export const RES_ROW = `(CASE goal
  WHEN 'messages' THEN messages
  WHEN 'leads' THEN leads
  WHEN 'conversions' THEN (CASE WHEN purchases > 0 THEN purchases ELSE leads END)
  WHEN 'profile_visits' THEN profile_visits
  WHEN 'traffic' THEN clicks
  WHEN 'reach' THEN reach
  ELSE leads + purchases + messages + profile_visits END)`;
export const RES_SUM = `SUM${RES_ROW}`;
