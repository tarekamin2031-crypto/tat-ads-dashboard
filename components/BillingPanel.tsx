import { billingAlerts, TAX_RATE, type Billing } from "@/lib/billing";

const money = (v: number) => v.toLocaleString("en-US", { maximumFractionDigits: 0 });

// Red banners shown at the very top of the page, before anything else.
export function BillingAlerts({ billing }: { billing: Billing | null }) {
  return (
    <>
      {billingAlerts(billing).map((a, i) => (
        <div key={i} className="banner" role="alert">
          <span aria-hidden>⚠</span>
          <span>
            <strong>{a.scope}:</strong> {a.text}
          </span>
        </div>
      ))}
    </>
  );
}

export function BillingPanel({ billing }: { billing: Billing | null }) {
  if (!billing) {
    return (
      <section className="card billing">
        <div className="billing-note">Billing details are temporarily unavailable.</div>
      </section>
    );
  }
  const cur = billing.currency;
  const remainingPct = billing.cap && billing.available !== null ? Math.min(100, (billing.available / billing.cap) * 100) : null;

  return (
    <>
      <section className="card billing" aria-label="Billing and spending limit">
        <div className="billing-top">
          <div>
            <div className="tile-label">Available balance</div>
            <div className={`billing-big${billing.low ? " low" : ""}`}>
              {billing.available === null ? "No spending limit" : `${money(billing.available)} ${cur}`}
            </div>
          </div>
          {billing.cap !== null && (
            <div className="billing-note">
              of {money(billing.cap)} {cur} limit · {money(billing.spent)} spent
            </div>
          )}
        </div>

        {remainingPct !== null && (
          <div
            className={`meter${billing.low ? " low" : ""}`}
            role="meter"
            aria-label="Remaining balance"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(remainingPct)}
          >
            <i style={{ width: `${remainingPct}%` }} />
          </div>
        )}

        <div className="billing-grid">
          {billing.availableNet !== null && (
            <div className="kv">
              <span>Net for ads after tax</span>
              <b>{money(billing.availableNet)} {cur}</b>
            </div>
          )}
          {!billing.isPrepay && (
            <div className="kv">
              <span>Amount due now</span>
              <b>{money(billing.amountDue)} {cur}</b>
            </div>
          )}
          <div className="kv">
            <span>Payment</span>
            <b>{billing.funding}</b>
          </div>
          <div className="kv">
            <span>Account status</span>
            <b className={billing.statusCode !== 1 ? "warn" : undefined}>{billing.status}</b>
          </div>
        </div>

        <div className="fine">
          Net for ads = available balance ÷ {(1 + TAX_RATE).toFixed(2)} (14% VAT + 6% payment tax). Warning at {money(billing.threshold)} {cur} or less.
        </div>
      </section>
    </>
  );
}
