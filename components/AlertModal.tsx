"use client";

import { useEffect, useState } from "react";

// Popup shown once per visit (per browser tab session), so changing the date range doesn't
// bring it back, but opening the dashboard again later does. A different alert shows again.
export function AlertModal({ items }: { items: string[] }) {
  const key = `alert-seen:${items.join("|")}`;
  const [open, setOpen] = useState(false);

  useEffect(() => {
    try {
      if (!sessionStorage.getItem(key)) setOpen(true);
    } catch {
      setOpen(true);
    }
  }, [key]);

  if (!open || items.length === 0) return null;

  const close = () => {
    try {
      sessionStorage.setItem(key, "1");
    } catch {
      // storage blocked: the popup just won't be remembered for this tab
    }
    setOpen(false);
  };

  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="alert-title"
      onClick={close}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(10, 30, 45, 0.55)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
        zIndex: 50,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ background: "#fff", borderRadius: 12, padding: 24, maxWidth: 440, width: "100%", boxShadow: "0 10px 40px rgba(0,0,0,0.25)" }}
      >
        <h2 id="alert-title" style={{ margin: "0 0 12px", fontSize: 18, color: "#b71c1c" }}>
          ⚠ Important notice
        </h2>
        {items.map((t, i) => (
          <p key={i} style={{ margin: "0 0 10px", fontSize: 15, lineHeight: 1.5 }}>
            {t}
          </p>
        ))}
        <p style={{ margin: "0 0 16px", fontSize: 13, color: "#65676b" }}>
          Please contact your account manager at TAT Agency to avoid any interruption to your ads.
        </p>
        <button
          autoFocus
          onClick={close}
          style={{ padding: "10px 18px", borderRadius: 8, border: 0, background: "#0f766e", color: "#fff", fontSize: 15, cursor: "pointer" }}
        >
          Got it
        </button>
      </div>
    </div>
  );
}
