"use client";

export function PrintButton() {
  return (
    <button type="button" className="btn ghost small" onClick={() => window.print()}>
      Print / PDF
    </button>
  );
}
