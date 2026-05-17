"use client";

// InsightsView — admin-only, full-page view that replaces the
// library canvas when the Insights side-rail item is active.
//
// Two top-level sections live on a single scrollable page:
//
//   Team Adoption     — counters for searches / links shared /
//                       feedback given, the recent-search feed,
//                       and the coverage-gap pivot matrix. Answers
//                       "is my team using this thing, and is the
//                       library serving them?"
//
//   Content Analytics — placeholder for v1. The future home of
//                       asset-level performance, dormant-asset
//                       reports, quote engagement, etc. — i.e.
//                       "how is the content itself doing?"
//
// The two sections compose: Team Adoption is about *people* (search
// signal, sharing behavior, qualitative feedback); Content
// Analytics will be about *the library* (which stories work, which
// are stale). Keeping them on the same page makes the relationship
// readable at a glance without forcing the admin to navigate.

import { useEffect, useMemo, useState } from "react";

type SearchSource = "library" | "storymatch";

interface SearchLogEntry {
  id: string;
  query: string;
  source: SearchSource;
  resultCount: number;
  topResultIds: string[];
  createdAt: string;
}

type FieldType = "text" | "select" | "multi_select" | "number" | "date";
type FieldPopulator = "manual" | "vimeo" | "ai";

interface FieldDef {
  id: string;
  key: string;
  label: string;
  type: FieldType;
  options?: string[];
  showInFilters: boolean;
  position: number;
  system: boolean;
  systemColumn?: string;
  populator: FieldPopulator;
  aiAutoFill: boolean;
}

// Minimal asset shape — just what gap analysis needs. System-field
// access goes through `as unknown as Record<string, unknown>` at
// the read site, so this stays compatible with the real Asset type
// without forcing an index signature.
interface AssetLike {
  id: string;
  status: string;
  customFieldValues?: Record<string, unknown>;
}

type DateRange = "7" | "30" | "90" | "all";

interface Summary {
  searches: number;
  linksShared: number;
  feedbackGiven: number;
}

interface Props {
  authHeaders: () => Promise<HeadersInit>;
  assets: AssetLike[];
  fieldDefs: FieldDef[];
  onRerunSearch?: (query: string, source: SearchSource) => void;
}

function timeAgo(iso: string | null): string {
  if (!iso) return "";
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.round(ms / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d}d ago`;
  const mo = Math.round(d / 30);
  if (mo < 12) return `${mo}mo ago`;
  return `${Math.round(mo / 12)}y ago`;
}

const RANGE_LABEL: Record<DateRange, string> = {
  "7": "Last 7 days",
  "30": "Last 30 days",
  "90": "Last 90 days",
  "all": "All time",
};

export default function InsightsView({ authHeaders, assets, fieldDefs, onRerunSearch }: Props) {
  // Date range applies to the counter cards. The recent-search
  // feed stays chronological regardless, and the gap matrix is a
  // measurement of the current library (no time concept).
  const [range, setRange] = useState<DateRange>("all");

  return (
    <div className="iv">
      <style>{css}</style>

      {/* Page header — sits above both sections. */}
      <header className="iv-page-head">
        <div>
          <h2>Insights</h2>
          <p className="iv-page-sub">See how your team is using StoryMatch and where the library has gaps.</p>
        </div>
      </header>

      {/* ── Team Adoption ──────────────────────────────────────────── */}
      <section className="iv-section">
        <div className="iv-section-head">
          <h3>Team adoption</h3>
          <RangePicker value={range} onChange={setRange}/>
        </div>

        <CounterRow authHeaders={authHeaders} range={range}/>

        <div className="iv-subsection">
          <div className="iv-subsection-head">
            <h4>Recent searches</h4>
            <p className="iv-subsection-sub">What your team is asking for. Click any row to re-run the search.</p>
          </div>
          <SearchFeed authHeaders={authHeaders} onRerunSearch={onRerunSearch}/>
        </div>

        <div className="iv-subsection">
          <div className="iv-subsection-head">
            <h4>Coverage gaps</h4>
            <p className="iv-subsection-sub">Where the library is thin. Red cells have no published assets — that&apos;s a gap your team can&apos;t close.</p>
          </div>
          <GapMatrix assets={assets} fieldDefs={fieldDefs}/>
        </div>
      </section>

      {/* ── Content Analytics ────────────────────────────────────── */}
      <section className="iv-section">
        <div className="iv-section-head">
          <h3>Content analytics</h3>
        </div>

        <div className="iv-coming-soon">
          <div className="iv-coming-soon-h">Coming soon</div>
          <p>
            Per-asset performance, dormant assets, top-performing quotes, and content freshness — all the
            ways to measure how the library itself is doing, separate from how the team uses it.
          </p>
        </div>
      </section>
    </div>
  );
}

// ─── Date range picker ───────────────────────────────────────────
function RangePicker({ value, onChange }: { value: DateRange; onChange: (v: DateRange) => void }) {
  return (
    <label className="iv-range">
      <span className="iv-range-label">Range</span>
      <select value={value} onChange={e => onChange(e.target.value as DateRange)}>
        {(["7", "30", "90", "all"] as DateRange[]).map(r => (
          <option key={r} value={r}>{RANGE_LABEL[r]}</option>
        ))}
      </select>
    </label>
  );
}

// ─── Counter cards ───────────────────────────────────────────────
// Three big numbers across the top of Team Adoption. Pulls from
// /api/insights/summary, which does count-only queries against
// search_logs, share_links, and asset_feedback.
function CounterRow({ authHeaders, range }: { authHeaders: () => Promise<HeadersInit>; range: DateRange }) {
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState<Summary | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const headers = await authHeaders();
        const qs = range === "all" ? "" : `?days=${range}`;
        const r = await fetch(`/api/insights/summary${qs}`, { headers });
        if (!r.ok) throw new Error("Failed");
        const data = await r.json() as Summary;
        if (cancelled) return;
        setSummary(data);
      } catch (e) {
        console.error("[CounterRow] load failed", e);
      }
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [range, authHeaders]);

  // Loading state renders the cards with a "—" so the layout
  // doesn't pop — feels less janky than a spinner replacing
  // numbers on every range change.
  const display = (n: number | undefined) => {
    if (loading || n == null) return "—";
    return n.toLocaleString();
  };

  return (
    <div className="iv-counters">
      <CounterCard label="Searches" value={display(summary?.searches)} hint="Library + StoryMatch queries"/>
      <CounterCard label="Links shared" value={display(summary?.linksShared)} hint="Asset links sent to prospects"/>
      <CounterCard label="Feedback given" value={display(summary?.feedbackGiven)} hint="Ratings + notes on assets"/>
    </div>
  );
}

function CounterCard({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="iv-counter">
      <div className="iv-counter-value">{value}</div>
      <div className="iv-counter-label">{label}</div>
      <div className="iv-counter-hint">{hint}</div>
    </div>
  );
}

// ─── Search feed ─────────────────────────────────────────────────
// Chronological list of every library + StoryMatch search. Clickable
// rows re-run the search exactly as the rep saw it. Anonymized —
// no user identity surfaces here.
function SearchFeed({ authHeaders, onRerunSearch }: {
  authHeaders: () => Promise<HeadersInit>;
  onRerunSearch?: (query: string, source: SearchSource) => void;
}) {
  const [loading, setLoading] = useState(true);
  const [recent, setRecent] = useState<SearchLogEntry[]>([]);
  const [sourceFilter, setSourceFilter] = useState<"all" | SearchSource>("all");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const headers = await authHeaders();
        const qs = sourceFilter === "all" ? "" : `?source=${sourceFilter}`;
        const r = await fetch(`/api/search-logs${qs}`, { headers });
        if (!r.ok) throw new Error("Failed");
        const data = await r.json() as { recent: SearchLogEntry[] };
        if (cancelled) return;
        setRecent(data.recent || []);
      } catch (e) {
        console.error("[SearchFeed] load failed", e);
      }
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [sourceFilter, authHeaders]);

  return (
    <div className="iv-feed">
      <div className="iv-filterbar">
        {([
          { v: "all", label: "All" },
          { v: "library", label: "Library" },
          { v: "storymatch", label: "StoryMatch" },
        ] as { v: "all" | SearchSource; label: string }[]).map(opt => (
          <button
            key={opt.v}
            type="button"
            className={`iv-chip${sourceFilter === opt.v ? " on" : ""}`}
            onClick={() => setSourceFilter(opt.v)}
          >{opt.label}</button>
        ))}
      </div>

      <div className="iv-list">
        {loading ? (
          <div className="iv-empty">Loading…</div>
        ) : recent.length === 0 ? (
          <div className="iv-empty">
            <div className="iv-empty-h">Nothing searched yet</div>
            <p className="iv-empty-sub">Once your team starts running searches, they&apos;ll show up here.</p>
          </div>
        ) : recent.map(entry => {
          const zero = entry.resultCount === 0;
          return (
            <button
              key={entry.id}
              type="button"
              className="iv-search-row"
              onClick={() => onRerunSearch?.(entry.query, entry.source)}
              title="Click to re-run this search"
            >
              <div className="iv-search-q">{entry.query}</div>
              <div className="iv-search-meta">
                <span className={`iv-source-pill ${entry.source}`}>
                  {entry.source === "storymatch" ? "StoryMatch" : "Library"}
                </span>
                <span className={`iv-search-count${zero ? " zero" : ""}`}>
                  {zero ? "0 results" : `${entry.resultCount} ${entry.resultCount === 1 ? "result" : "results"}`}
                </span>
                <span className="iv-search-when">{timeAgo(entry.createdAt)}</span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─── Coverage gap matrix ─────────────────────────────────────────
// Pivot of assets across two field dimensions. Color tiers:
// red 0 (gap), amber 1-2 (sparse), green 3+ (covered). Multi-select
// fields put an asset into every bucket they belong to.
function GapMatrix({ assets, fieldDefs }: { assets: AssetLike[]; fieldDefs: FieldDef[] }) {
  const axisCandidates = useMemo(() => {
    return fieldDefs
      .filter(f => (f.type === "select" || f.type === "multi_select") && Array.isArray(f.options) && f.options.length > 0)
      .slice()
      .sort((a, b) => a.position - b.position);
  }, [fieldDefs]);

  const [rowKey, setRowKey] = useState<string>("");
  const [colKey, setColKey] = useState<string>("");
  useEffect(() => {
    if (axisCandidates.length === 0) return;
    if (!rowKey || !axisCandidates.find(c => c.key === rowKey)) {
      setRowKey(axisCandidates[0]?.key || "");
    }
    if (!colKey || !axisCandidates.find(c => c.key === colKey)) {
      setColKey(axisCandidates[1]?.key || axisCandidates[0]?.key || "");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [axisCandidates]);

  const rowDef = axisCandidates.find(c => c.key === rowKey);
  const colDef = axisCandidates.find(c => c.key === colKey);

  const bucketsForAsset = (a: AssetLike, def: FieldDef): string[] => {
    const raw = def.system
      ? (a as unknown as Record<string, unknown>)[def.key]
      : (a.customFieldValues || {})[def.key];
    if (raw == null || raw === "") return [];
    if (Array.isArray(raw)) {
      return (raw as unknown[]).filter(v => typeof v === "string" && v.length > 0) as string[];
    }
    if (typeof raw === "string") return [raw];
    return [];
  };

  const matrix = useMemo(() => {
    if (!rowDef || !colDef) return null;
    const rowOpts = [...(rowDef.options || []), "Unspecified"];
    const colOpts = [...(colDef.options || []), "Unspecified"];
    const counts: Record<string, Record<string, number>> = {};
    for (const r of rowOpts) {
      counts[r] = {};
      for (const c of colOpts) counts[r][c] = 0;
    }
    for (const a of assets) {
      if (a.status === "deleted" || a.status === "archived") continue;
      const rs = bucketsForAsset(a, rowDef);
      const cs = bucketsForAsset(a, colDef);
      const rBuckets = rs.length > 0 ? rs : ["Unspecified"];
      const cBuckets = cs.length > 0 ? cs : ["Unspecified"];
      for (const r of rBuckets) {
        if (!(r in counts)) continue;
        for (const c of cBuckets) {
          if (!(c in counts[r])) continue;
          counts[r][c] += 1;
        }
      }
    }
    return { rowOpts, colOpts, counts };
  }, [rowDef, colDef, assets]);

  const tierForCount = (n: number): "zero" | "low" | "mid" | "high" => {
    if (n === 0) return "zero";
    if (n <= 2) return "low";
    if (n <= 5) return "mid";
    return "high";
  };

  if (axisCandidates.length < 2) {
    return (
      <div className="iv-empty">
        <div className="iv-empty-h">Not enough fields to map gaps</div>
        <p className="iv-empty-sub">
          Coverage analysis needs at least two single-choice or multi-choice fields. Add custom fields in <strong>Manage fields</strong> or wait for the default schema to seed.
        </p>
      </div>
    );
  }

  return (
    <div className="iv-gaps">
      <div className="iv-gaps-controls">
        <label className="iv-gaps-ctl">
          <span>Rows</span>
          <select value={rowKey} onChange={e => setRowKey(e.target.value)}>
            {axisCandidates.map(c => (
              <option key={c.id} value={c.key}>{c.label}</option>
            ))}
          </select>
        </label>
        <label className="iv-gaps-ctl">
          <span>Cols</span>
          <select value={colKey} onChange={e => setColKey(e.target.value)}>
            {axisCandidates.map(c => (
              <option key={c.id} value={c.key}>{c.label}</option>
            ))}
          </select>
        </label>
        <div className="iv-gaps-legend">
          <span className="iv-gaps-legend-h">Coverage</span>
          <span className="iv-gaps-swatch zero">0</span>
          <span className="iv-gaps-swatch low">1–2</span>
          <span className="iv-gaps-swatch mid">3–5</span>
          <span className="iv-gaps-swatch high">6+</span>
        </div>
      </div>

      {!matrix ? (
        <div className="iv-empty">Pick two dimensions to see coverage.</div>
      ) : (
        <div className="iv-gaps-table-wrap">
          <table className="iv-gaps-table">
            <thead>
              <tr>
                <th className="iv-gaps-corner"/>
                {matrix.colOpts.map(c => (
                  <th key={c} className="iv-gaps-col-h" title={c}>{c}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {matrix.rowOpts.map(r => (
                <tr key={r}>
                  <th className="iv-gaps-row-h" title={r}>{r}</th>
                  {matrix.colOpts.map(c => {
                    const n = matrix.counts[r][c];
                    const tier = tierForCount(n);
                    return (
                      <td
                        key={c}
                        className={`iv-gaps-cell ${tier}`}
                        title={`${r} × ${c}: ${n} ${n === 1 ? "asset" : "assets"}`}
                      >{n}</td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="iv-gaps-note">
        Red cells are gaps — no published assets cover that combination. Archived and draft assets are excluded.
      </div>
    </div>
  );
}

const css = `
.iv{flex:1;min-width:0;overflow-y:auto;font-family:var(--font);color:var(--t1);padding:32px 40px 64px;display:flex;flex-direction:column;gap:32px;}

/* Page header */
.iv-page-head{display:flex;align-items:flex-end;justify-content:space-between;gap:24px;}
.iv-page-head h2{font-family:var(--serif);font-size:30px;font-weight:600;letter-spacing:-.6px;color:var(--t1);margin:0;}
.iv-page-sub{font-size:13.5px;color:var(--t3);margin:6px 0 0;line-height:1.5;max-width:680px;}

/* Section */
.iv-section{display:flex;flex-direction:column;gap:20px;}
.iv-section-head{display:flex;align-items:center;justify-content:space-between;gap:16px;padding-bottom:10px;border-bottom:1px solid var(--border);}
.iv-section-head h3{font-family:var(--serif);font-size:20px;font-weight:600;letter-spacing:-.3px;color:var(--t1);margin:0;}

/* Range picker — sits to the right of the section header */
.iv-range{display:inline-flex;align-items:center;gap:8px;font-family:var(--font);}
.iv-range-label{font-size:10.5px;text-transform:uppercase;letter-spacing:.5px;color:var(--t3);font-weight:700;}
.iv-range select{padding:6px 10px;border:1px solid var(--border);border-radius:7px;background:#fff;font-family:var(--font);font-size:12.5px;color:var(--t1);cursor:pointer;font-weight:500;}
.iv-range select:focus{outline:none;border-color:var(--accent);}

/* Counter cards */
.iv-counters{display:grid;grid-template-columns:repeat(3, minmax(0, 1fr));gap:16px;}
.iv-counter{background:#fff;border:1px solid var(--border);border-radius:12px;padding:20px 22px;display:flex;flex-direction:column;gap:4px;}
.iv-counter-value{font-family:var(--serif);font-size:36px;font-weight:600;letter-spacing:-.6px;color:var(--t1);line-height:1.1;font-variant-numeric:tabular-nums;}
.iv-counter-label{font-size:13px;font-weight:600;color:var(--t1);margin-top:4px;}
.iv-counter-hint{font-size:11.5px;color:var(--t3);line-height:1.45;}

/* Subsection (Recent searches + Coverage gaps inside Team Adoption) */
.iv-subsection{display:flex;flex-direction:column;gap:12px;}
.iv-subsection-head h4{font-family:var(--serif);font-size:15px;font-weight:600;color:var(--t1);margin:0;letter-spacing:-.2px;}
.iv-subsection-sub{font-size:12px;color:var(--t3);margin:3px 0 0;line-height:1.5;}

/* Searches feed */
.iv-feed{background:#fff;border:1px solid var(--border);border-radius:12px;overflow:hidden;}
.iv-filterbar{display:flex;gap:6px;padding:12px 16px;border-bottom:1px solid var(--border);background:var(--bg);}
.iv-chip{padding:5px 11px;border:1px solid var(--border);border-radius:99px;background:#fff;color:var(--t2);font-family:var(--font);font-size:11.5px;font-weight:600;cursor:pointer;transition:all .12s;}
.iv-chip:hover{border-color:var(--border2);color:var(--t1);}
.iv-chip.on{background:var(--accent);border-color:var(--accent);color:#fff;}

.iv-list{padding:10px 12px;display:flex;flex-direction:column;gap:6px;max-height:520px;overflow-y:auto;}
.iv-empty{padding:36px 20px;text-align:center;color:var(--t3);font-size:12.5px;}
.iv-empty-h{font-family:var(--serif);font-size:15px;font-weight:600;color:var(--t1);margin-bottom:4px;}
.iv-empty-sub{font-size:12px;color:var(--t3);margin:0;line-height:1.5;}

.iv-search-row{display:block;width:100%;text-align:left;padding:10px 12px;border:1px solid var(--border);border-radius:8px;background:#fff;font:inherit;color:inherit;cursor:pointer;transition:background .12s,border-color .12s;}
.iv-search-row:hover{background:var(--bg);border-color:var(--border2);}
.iv-search-q{font-size:13px;font-weight:600;color:var(--t1);line-height:1.4;word-break:break-word;}
.iv-search-meta{display:flex;align-items:center;gap:8px;margin-top:6px;flex-wrap:wrap;}
.iv-source-pill{display:inline-block;font-size:9.5px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;padding:2px 6px;border-radius:4px;background:var(--bg2);color:var(--t3);flex-shrink:0;}
.iv-source-pill.storymatch{background:#F2EBF9;color:var(--accent);}
.iv-source-pill.library{background:var(--bg2);color:var(--t3);}
.iv-search-count{font-size:11px;color:var(--t3);font-weight:500;}
.iv-search-count.zero{color:#b91c1c;font-weight:700;}
.iv-search-when{font-size:11px;color:var(--t4);margin-left:auto;flex-shrink:0;}

/* Gaps matrix */
.iv-gaps{background:#fff;border:1px solid var(--border);border-radius:12px;padding:16px 20px 20px;display:flex;flex-direction:column;gap:12px;}
.iv-gaps-controls{display:flex;gap:14px;flex-wrap:wrap;align-items:flex-end;}
.iv-gaps-ctl{display:flex;flex-direction:column;gap:4px;font-size:10.5px;text-transform:uppercase;letter-spacing:.5px;color:var(--t3);font-weight:700;min-width:160px;}
.iv-gaps-ctl select{padding:6px 8px;border:1px solid var(--border);border-radius:6px;background:#fff;font-family:var(--font);font-size:12.5px;color:var(--t1);text-transform:none;letter-spacing:0;font-weight:500;cursor:pointer;}
.iv-gaps-ctl select:focus{outline:none;border-color:var(--accent);}

.iv-gaps-legend{display:flex;align-items:center;gap:6px;font-size:10.5px;color:var(--t3);font-weight:600;margin-left:auto;align-self:flex-end;}
.iv-gaps-legend-h{text-transform:uppercase;letter-spacing:.5px;font-weight:700;margin-right:4px;}
.iv-gaps-swatch{display:inline-flex;align-items:center;justify-content:center;min-width:38px;height:20px;border-radius:4px;padding:0 6px;font-size:11px;font-weight:700;font-variant-numeric:tabular-nums;}
.iv-gaps-swatch.zero{background:#fee2e2;color:#b91c1c;}
.iv-gaps-swatch.low{background:#fef3c7;color:#92400e;}
.iv-gaps-swatch.mid{background:#dcfce7;color:#15803d;}
.iv-gaps-swatch.high{background:#a7f3d0;color:#065f46;}

.iv-gaps-table-wrap{overflow-x:auto;border:1px solid var(--border);border-radius:9px;background:#fff;}
.iv-gaps-table{border-collapse:separate;border-spacing:0;width:100%;font-family:var(--font);font-size:12px;color:var(--t1);}
.iv-gaps-corner{background:var(--bg2);border-bottom:1px solid var(--border);border-right:1px solid var(--border);position:sticky;left:0;top:0;z-index:2;min-width:120px;}
.iv-gaps-col-h{background:var(--bg2);color:var(--t2);font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.4px;padding:8px 10px;text-align:center;border-bottom:1px solid var(--border);white-space:nowrap;}
.iv-gaps-row-h{background:var(--bg);color:var(--t1);font-size:12px;font-weight:600;padding:8px 12px;text-align:left;border-bottom:1px solid var(--border);border-right:1px solid var(--border);position:sticky;left:0;z-index:1;white-space:nowrap;max-width:180px;overflow:hidden;text-overflow:ellipsis;}
.iv-gaps-cell{padding:0;text-align:center;font-weight:700;font-variant-numeric:tabular-nums;border-bottom:1px solid var(--border);height:42px;min-width:60px;cursor:default;}
.iv-gaps-cell.zero{background:#fee2e2;color:#b91c1c;}
.iv-gaps-cell.low{background:#fef3c7;color:#92400e;}
.iv-gaps-cell.mid{background:#dcfce7;color:#15803d;}
.iv-gaps-cell.high{background:#a7f3d0;color:#065f46;}

.iv-gaps-note{font-size:11px;color:var(--t3);line-height:1.5;font-style:italic;}

/* Content Analytics placeholder */
.iv-coming-soon{background:#fff;border:1px dashed var(--border2);border-radius:12px;padding:32px 28px;text-align:center;}
.iv-coming-soon-h{font-family:var(--serif);font-size:16px;font-weight:600;color:var(--t1);margin-bottom:6px;}
.iv-coming-soon p{font-size:13px;color:var(--t3);margin:0;line-height:1.6;max-width:560px;margin-left:auto;margin-right:auto;}

@media (max-width: 900px) {
  .iv{padding:20px 18px 48px;}
  .iv-counters{grid-template-columns:1fr;}
  .iv-page-head{flex-direction:column;align-items:flex-start;}
}
`;
