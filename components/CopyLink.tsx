"use client";

import { useState } from "react";

export function CopyLink({ url, label = "Copy link" }: { url: string; label?: string }) {
  const [done, setDone] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setDone(true);
      setTimeout(() => setDone(false), 1500);
    } catch {
      window.prompt("Copy this link", url);
    }
  }

  return (
    <button type="button" className="btn ghost small" onClick={copy}>
      {done ? "Copied ✓" : label}
    </button>
  );
}
