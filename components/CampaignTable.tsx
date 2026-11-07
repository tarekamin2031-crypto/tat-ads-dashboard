"use client";

import { Fragment, useMemo, useState } from "react";

export type Metrics = {
  spend: number;
  impressions: number;
  clicks: number;
  results: number;
  purchase_value: number;
};
export type Row = Metrics & { id: string; name: string; adsets: (Metrics & { id: string; name: string })[] };

type SortKey = "spend" | "results" | "cpr" | "impressions" | "clicks" | "ctr";

const money = (v: number) => v.toLocaleString("en-US", { maximumFractionDigits: 2 });
const int = (v: number) => v.toLocaleString("en-US", { maximumFractionDigits: 0 });
const cprOf = (m: Metrics) => (m.results ? m.spend / m.results : null);
const ctrOf = (m: Metrics) => (m.impressions ? (m.clicks / m.impressions) * 100 : null);

const value = (m: Metrics, k: SortKey): number => {
  switch (k) {
    case "spend": return m.spend;
    case "results": return m.results;
    case "cpr": return cprOf(m) ?? Infinity; // no results sorts as "worst" cost
    case "impressions": return m.impressions;
    case "clicks": return m.clicks;
    case "ctr": return ctrOf(m) ?? -1;
  }
};

export function CampaignTable({ rows, showRoas, resultLabel, costLabel }: { rows: Row[]; showRoas: boolean; resultLabel: string; costLabel: string }) {
  const [q, setQ] = useState("");
  const [key, setKey] = useState<SortKey>("spend");
  const [desc, setDesc] = useState(true);
  const [closed, setClosed] = useState<Set<string>>(new Set());

  const totalSpend = rows.reduce((n, r) => n + r.spend, 0) || 1;

  // Best / worst cost per result, only meaningful when at least 3 campaigns have results.
  const { best, worst } = useMemo(() => {
    const withCpr = rows.filter((r) => r.results > 0).map((r) => ({ id: r.id, c: r.spend / r.results }));
    if (withCpr.length < 3) return { best: null, worst: null };
    withCpr.sort((a, b) => a.c - b.c);
    return { best: withCpr[0].id, worst: withCpr[withCpr.length - 1].id };
  }, [rows]);

  const sorter = <T extends Metrics>(a: T, b: T) => {
    const x = value(a, key);
    const y = value(b, key);
    const d = x === y ? 0 : x < y ? -1 : 1;
    return desc ? -d : d;
  };

  const needle = q.trim().toLowerCase();
  const view = rows
    .filter((r) => !needle || r.name.toLowerCase().includes(needle) || r.adsets.some((a) => a.name.toLowerCase().includes(needle)))
    .sort(sorter);

  const toggle = (id: string) =>
    setClosed((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const cols = showRoas ? 8 : 7;

  return (
    <div className="card table-card">
      <div className="table-tools">
        <input className="field" type="search" placeholder="Search campaign or ad set" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search campaigns" />
        <label className="sortsel">
          <span>Sort by</span>
          <select className="field" value={key} onChange={(e) => setKey(e.target.value as SortKey)}>
            <option value="spend">Spend</option>
            <option value="results">{resultLabel}</option>
            <option value="cpr">{costLabel}</option>
            <option value="impressions">Impressions</option>
            <option value="clicks">Clicks</option>
            <option value="ctr">CTR</option>
          </select>
        </label>
        <button type="button" className="btn ghost small" onClick={() => setDesc((d) => !d)} aria-label={desc ? "Sorted high to low" : "Sorted low to high"}>
          {desc ? "High → low" : "Low → high"}
        </button>
      </div>
      <table className="rtable">
        <thead>
          <tr>
            <th>Campaign / Ad set</th>
            <th>Spend</th>
            <th>{resultLabel}</th>
            <th>{costLabel}</th>
            <th>Impressions</th>
            <th>Clicks</th>
            <th>CTR</th>
            {showRoas && <th>ROAS</th>}
          </tr>
        </thead>
        <tbody>
          {view.map((r) => {
            const open = !closed.has(r.id);
            const adsets = [...r.adsets].filter((a) => !needle || r.name.toLowerCase().includes(needle) || a.name.toLowerCase().includes(needle)).sort(sorter);
            return (
              <Fragment key={r.id}>
                <tr className="parent">
                  <td className="name">
                    <div className="cname">
                      {r.adsets.length > 0 ? (
                        <button type="button" className="twisty" onClick={() => toggle(r.id)} aria-expanded={open} aria-label={`${open ? "Collapse" : "Expand"} ad sets`}>
                          {open ? "▾" : "▸"}
                        </button>
                      ) : null}
                      <span>{r.name}</span>
                      {r.id === best && <span className="tag good">Lowest cost</span>}
                      {r.id === worst && <span className="tag bad">Highest cost</span>}
                    </div>
                    <div className="share" aria-hidden title={`${Math.round((r.spend / totalSpend) * 100)}% of spend`}>
                      <i style={{ width: `${Math.max(2, (r.spend / totalSpend) * 100)}%` }} />
                    </div>
                  </td>
                  <Cells m={r} showRoas={showRoas} resultLabel={resultLabel} costLabel={costLabel} />
                </tr>
                {open &&
                  adsets.map((a) => (
                    <tr key={a.id} className="sub">
                      <td className="name"><span className="arrow" aria-hidden>↳</span>{a.name}</td>
                      <Cells m={a} showRoas={showRoas} resultLabel={resultLabel} costLabel={costLabel} />
                    </tr>
                  ))}
              </Fragment>
            );
          })}
          {view.length === 0 && (
            <tr>
              <td className="empty-row" colSpan={cols}>{rows.length === 0 ? "No campaign activity in this period." : "No campaign matches your search."}</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function Cells({ m, showRoas, resultLabel, costLabel }: { m: Metrics; showRoas: boolean; resultLabel: string; costLabel: string }) {
  const cpr = cprOf(m);
  const ctr = ctrOf(m);
  return (
    <>
      <td data-label="Spend">{money(m.spend)}</td>
      <td data-label={resultLabel}>{int(m.results)}</td>
      <td data-label={costLabel}>{cpr === null ? "-" : money(cpr)}</td>
      <td data-label="Impressions">{int(m.impressions)}</td>
      <td data-label="Clicks">{int(m.clicks)}</td>
      <td data-label="CTR">{ctr === null ? "-" : `${ctr.toFixed(2)}%`}</td>
      {showRoas && <td data-label="ROAS">{m.spend ? (m.purchase_value / m.spend).toFixed(2) : "-"}</td>}
    </>
  );
}
