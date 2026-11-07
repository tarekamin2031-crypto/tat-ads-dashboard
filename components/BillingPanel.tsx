import { billingAlerts, LOW_BALANCE_THRESHOLD, TAX_RATE, type Billing } from "@/lib/billing";

const money = (v: number) => v.toLocaleString("en-US", { maximumFractionDigits: 0 });

export function BillingPanel({ billing }: { billing: Billing | null }) {
  if (!billing) {
    return (
      <section style={{ margin: "20px 0", color: "#65676b", fontSize: 14 }}>
        Billing details are temporarily unavailable.
      </section>
    );
  }
  const cur = billing.currency;
  const alerts = billingAlerts(billing);

  const stats: [string, string, boolean?][] = [
    [
      "Available balance",
      billing.available === null ? "No spending limit" : `${money(billing.available)} ${cur}`,
      billing.low,
    ],
    [
      "Net for ads after tax",
      billing.availableNet === null ? "-" : `${money(billing.availableNet)} ${cur}`,
    ],
    ["Spending limit", billing.cap === null ? "None" : `${money(billing.cap)} ${cur}`],
    ...(billing.isPrepay ? [] : ([["Amount due now", `${money(billing.amountDue)} ${cur}`]] as [string, string][])),
    ["Payment", billing.funding],
    ["Account status", billing.status, billing.statusCode !== 1],
  ];

  return (
    <section style={{ margin: "20px 0" }}>
      {alerts.map((a, i) => (
        <div
          key={i}
          style={{ background: "#fdecea", color: "#b71c1c", border: "1px solid #f5c6cb", borderRadius: 8, padding: "10px 14px", marginBottom: 10, fontSize: 14 }}
        >
          <strong>⚠ {a.scope}:</strong> {a.text}
        </div>
      ))}
      <h2 style={{ fontSize: 16, margin: "0 0 8px" }}>Billing &amp; limit</h2>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 12 }}>
        {stats.map(([label, value, warn]) => (
          <div
            key={label}
            style={{
              background: warn ? "#fdecea" : "#fff",
              borderRadius: 8,
              padding: 14,
              border: `1px solid ${warn ? "#f5c6cb" : "#e4e6eb"}`,
            }}
          >
            <div style={{ color: "#65676b", fontSize: 13 }}>{label}</div>
            <div style={{ fontSize: 20, fontWeight: 600, color: warn ? "#b71c1c" : undefined }}>{value}</div>
          </div>
        ))}
      </div>
      <small style={{ color: "#8a8d91", display: "block", marginTop: 8 }}>
        Net for ads = available balance ÷ {(1 + TAX_RATE).toFixed(2)} (14% VAT + 6% payment tax). Warning appears at{" "}
        {money(LOW_BALANCE_THRESHOLD)} {cur} or less.
      </small>
    </section>
  );
}
