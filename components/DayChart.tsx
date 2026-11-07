"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";

export type Point = { date: string; value: number | null };

type Props = {
  title: string;
  subtitle?: string;
  data: Point[];
  kind: "bar" | "line";
  /** Shown after the value in the tooltip and the end label, e.g. "EGP". */
  unit?: string;
  /** Decimals for tooltip / end label. Axis ticks are always rounded. */
  decimals?: number;
  /** Previous period, same length as data (index i = same day-of-period). Drawn as a dashed line. */
  prev?: (number | null)[];
};

const H = 168;
const PAD = { l: 38, r: 10, t: 14, b: 22 };
const ACCENT = "#0f766e";
const ACCENT_STRONG = "#0a5a54";
const SURFACE = "#ffffff";

const fmtDate = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

const compact = (v: number) =>
  v >= 1_000_000 ? `${+(v / 1_000_000).toFixed(1)}M` : v >= 10_000 ? `${Math.round(v / 1000)}K` : v >= 1000 ? `${+(v / 1000).toFixed(1)}K` : `${+v.toFixed(v < 10 ? 1 : 0)}`;

// Smallest "round" number (1, 2, 5 x 10^n) at or above v, so the top gridline is a clean value.
function niceCeil(v: number) {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
}

export function DayChart({ title, subtitle, data, kind, unit = "", decimals = 0, prev }: Props) {
  const id = useId();
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(320);
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.max(220, Math.floor(entry.contentRect.width))));
    ro.observe(el);
    setWidth(Math.max(220, el.clientWidth));
    return () => ro.disconnect();
  }, []);

  const prevVals = prev && prev.length === data.length ? prev : null;
  const values = [...data.map((d) => d.value), ...(prevVals ?? [])].filter((v): v is number => v !== null);
  const ownValues = data.map((d) => d.value).filter((v): v is number => v !== null);
  const hasData = ownValues.some((v) => v > 0);
  const top = niceCeil(Math.max(...values, 0) * 1.05);
  const n = data.length;
  const plotW = width - PAD.l - PAD.r;
  const plotH = H - PAD.t - PAD.b;
  const band = plotW / Math.max(n, 1);
  const cx = (i: number) => PAD.l + band * (i + 0.5);
  const y = (v: number) => PAD.t + plotH * (1 - v / top);
  const base = PAD.t + plotH;
  const ticks = [0, top / 2, top];

  const fmtVal = (v: number) => `${v.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: decimals })}${unit ? ` ${unit}` : ""}`;

  const indexFromX = (clientX: number) => {
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect) return null;
    return Math.min(n - 1, Math.max(0, Math.floor((clientX - rect.left - PAD.l) / band)));
  };
  const onMove = (e: PointerEvent) => setHover(indexFromX(e.clientX));
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "ArrowRight") setHover((h) => Math.min(n - 1, (h ?? -1) + 1));
    else if (e.key === "ArrowLeft") setHover((h) => Math.max(0, (h ?? n) - 1));
    else if (e.key === "Escape") setHover(null);
    else return;
    e.preventDefault();
  };

  // x labels: first, middle, last (skip the middle on tiny ranges so labels never collide)
  const labelIdx = n <= 1 ? [0] : n < 5 ? [0, n - 1] : [0, Math.floor((n - 1) / 2), n - 1];

  // Line kind: consecutive non-null runs, so a day without a value leaves a gap instead of a false zero.
  const runs: number[][] = [];
  if (kind === "line") {
    let cur: number[] = [];
    data.forEach((d, i) => {
      if (d.value === null) {
        if (cur.length) runs.push(cur);
        cur = [];
      } else cur.push(i);
    });
    if (cur.length) runs.push(cur);
  }
  const prevRuns: number[][] = [];
  if (prevVals) {
    let cur: number[] = [];
    prevVals.forEach((v, i) => {
      if (v === null) {
        if (cur.length) prevRuns.push(cur);
        cur = [];
      } else cur.push(i);
    });
    if (cur.length) prevRuns.push(cur);
  }
  const lastIdx = (() => {
    for (let i = n - 1; i >= 0; i--) if (data[i].value !== null) return i;
    return -1;
  })();

  const barW = Math.min(24, band * 0.68);
  const hovered = hover !== null ? data[hover] : null;
  const tipLeft = hover !== null ? Math.min(Math.max(cx(hover) - 60, 0), width - 130) : 0;

  return (
    <section className="card chart" aria-labelledby={`${id}-t`}>
      <div className="chart-head">
        <h3 id={`${id}-t`} className="chart-title">{title}</h3>
        <span className="chart-sub">
          {prevVals && hasData && (
            <span className="legend-prev" aria-hidden>
              <svg width="18" height="6" viewBox="0 0 18 6"><line x1="0" y1="3" x2="18" y2="3" stroke="#7a8892" strokeWidth="1.5" strokeDasharray="4 3" /></svg>
              previous period
            </span>
          )}
          {subtitle}
        </span>
      </div>
      <div className="chart-body" ref={wrapRef}>
        {!hasData ? (
          <div className="chart-empty">No data in this period</div>
        ) : (
          <>
            <svg
              viewBox={`0 0 ${width} ${H}`}
              height={H}
              role="img"
              aria-label={`${title} by day. Use left and right arrow keys to read each day.`}
              tabIndex={0}
              onPointerMove={onMove}
              onPointerDown={onMove}
              onPointerLeave={() => setHover(null)}
              onFocus={() => setHover((h) => h ?? n - 1)}
              onBlur={() => setHover(null)}
              onKeyDown={onKey}
              style={{ touchAction: "pan-y" }}
            >
              {ticks.map((t) => (
                <g key={t}>
                  <line x1={PAD.l} x2={width - PAD.r} y1={y(t)} y2={y(t)} stroke={t === 0 ? "#c5ced3" : "#e9eef0"} strokeWidth={1} />
                  <text x={PAD.l - 6} y={y(t) + 4} textAnchor="end" fontSize={11} fill="#7a8892">
                    {compact(t)}
                  </text>
                </g>
              ))}

              {kind === "bar" &&
                data.map((d, i) => {
                  const v = d.value ?? 0;
                  const h = Math.max(v > 0 ? 2 : 0, base - y(v));
                  if (h <= 0) return null;
                  const r = Math.min(4, h, barW / 2);
                  const x0 = cx(i) - barW / 2;
                  const path = `M${x0},${base} V${base - h + r} a${r},${r} 0 0 1 ${r},${-r} h${barW - 2 * r} a${r},${r} 0 0 1 ${r},${r} V${base} Z`;
                  const active = hover === i;
                  return <path key={d.date} d={path} fill={active ? ACCENT_STRONG : ACCENT} opacity={hover !== null && !active ? 0.55 : 1} />;
                })}

              {kind === "line" &&
                runs.map((run, k) => (
                  <polyline
                    key={k}
                    points={run.map((i) => `${cx(i)},${y(data[i].value as number)}`).join(" ")}
                    fill="none"
                    stroke={ACCENT}
                    strokeWidth={2}
                    strokeLinejoin="round"
                    strokeLinecap="round"
                  />
                ))}

              {prevRuns.map((run, k) => (
                <polyline
                  key={`p${k}`}
                  points={run.map((i) => `${cx(i)},${y(prevVals![i] as number)}`).join(" ")}
                  fill="none"
                  stroke="#7a8892"
                  strokeWidth={1.5}
                  strokeDasharray="4 3"
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />
              ))}

              {kind === "line" && hover === null && lastIdx >= 0 && (
                <g>
                  <circle cx={cx(lastIdx)} cy={y(data[lastIdx].value as number)} r={4} fill={ACCENT} stroke={SURFACE} strokeWidth={2} />
                  <text
                    x={cx(lastIdx)}
                    y={y(data[lastIdx].value as number) - 10}
                    textAnchor="end"
                    fontSize={11}
                    fontWeight={600}
                    fill="#0b1f2a"
                    stroke={SURFACE}
                    strokeWidth={4}
                    paintOrder="stroke"
                    strokeLinejoin="round"
                  >
                    {fmtVal(data[lastIdx].value as number)}
                  </text>
                </g>
              )}

              {hover !== null && (
                <g>
                  <line x1={cx(hover)} x2={cx(hover)} y1={PAD.t} y2={base} stroke="#c5ced3" strokeWidth={1} />
                  {kind === "line" && hovered?.value != null && (
                    <circle cx={cx(hover)} cy={y(hovered.value)} r={4} fill={ACCENT} stroke={SURFACE} strokeWidth={2} />
                  )}
                </g>
              )}

              {labelIdx.map((i, k) => (
                <text
                  key={i}
                  x={cx(i)}
                  y={H - 6}
                  fontSize={11}
                  fill="#7a8892"
                  textAnchor={k === 0 && labelIdx.length > 1 ? "start" : k === labelIdx.length - 1 && labelIdx.length > 1 ? "end" : "middle"}
                >
                  {fmtDate(data[i].date)}
                </text>
              ))}
            </svg>

            {hovered && (
              <div className="tip" style={{ left: tipLeft, top: 0 }} aria-live="polite">
                <b>{hovered.value === null ? "No result" : fmtVal(hovered.value)}</b>
                <span>{fmtDate(hovered.date)}</span>
                {prevVals && hover !== null && (
                  <span className="tip-prev">
                    Previous: {prevVals[hover] === null ? "no result" : fmtVal(prevVals[hover] as number)}
                  </span>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}
