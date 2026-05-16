"use client";

// Search Insights — admin-only view that surfaces every library +
// StoryMatch search the org has run. Two sections:
//
//   1. Top searches — aggregate by lower-cased query. Sorted by
//      frequency. A zero-result column highlights gaps where reps
//      asked for something the library couldn't answer.
//
//   2. Recent activity — chronological feed of individual searches.
//      Anonymized — admins see WHAT was searched, never WHO.
//
// Source filter chips at the top let admins narrow to library-bar
// searches vs StoryMatch queries. Each surface tells you a slightly
// different thing: library searches reveal what reps look up by
// name; StoryMatch reveals what they pitch to.

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

interface TopQueryRow {
  queryNormalized: string;
  exampleQuery: string;
  count: number;
  avgResultCount: number;
  zeroResultRuns: number;
  lastSeen: string;
  sources: SearchSource[];
}

interface Props {
  authHeaders: () => Promise<HeadersInit>;
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

export default function SearchLogsView({ authHeaders }: Props) {
  const [loading, setLoading] = useState(true);
  const [recent, setRecent] = useState<SearchLogEntry[]>([]);
  const [top, setTop] = useState<TopQueryRow[]>([]);
  const [sourceFilter, setSourceFilter] = useState<"all" | SearchSource>("all");

  // Load on mount and whenever the source filter changes. Two-fetch
  // pattern matches the API's two response keys; the loader UI
  // shows until both come back.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const headers = await authHeaders();
        const qs = sourceFilter === "all" ? "" : `?source=${sourceFilter}`;
        const r = await fetch(`/api/search-logs${qs}`, { headers });
        if (!r.ok) throw new Error("Failed");
        const data = await r.json() as { recent: SearchLogEntry[]; top: TopQueryRow[] };
        if (cancelled) return;
        setRecent(data.recent || []);
        setTop(data.top || []);
      } catch (e) {
        console.error("[SearchLogsView] load failed", e);
      }
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [sourceFilter, authHeaders]);

  // Total searches, used for the headline metric in the header.
  const totalSearches = useMemo(() => top.reduce((a, r) => a + r.count, 0), [top]);
  // Gap signal: total zero-result runs across all top queries. The
  // headline number "X searches returned nothing" is the metric
  // admins act on most.
  const totalZeroResult = useMemo(() => top.reduce((a, r) => a + r.zeroResultRuns, 0), [top]);

  return (
    <div className="slv">
      <style>{css}</style>
      <div className="slv-head">
        <h1 className="slv-title">Search Insights</h1>
        <p className="slv-sub">
          What your team is searching for — and where the library has gaps. All queries are anonymized; you see the search, never the searcher.
        </p>
        <div className="slv-metrics">
          <div className="slv-metric">
            <div className="slv-metric-label">Distinct queries</div>
            <div className="slv-metric-num">{top.length}</div>
          </div>
          <div className="slv-metric">
            <div className="slv-metric-label">Total searches</div>
            <div className="slv-metric-num">{totalSearches}</div>
          </div>
          <div className={`slv-metric${totalZeroResult > 0 ? " warn" : ""}`}>
            <div className="slv-metric-label">Zero-result searches</div>
            <div className="slv-metric-num">{totalZeroResult}</div>
          </div>
        </div>
      </div>

      <div className="slv-filterbar">
        {([
          { v: "all", label: "All sources" },
          { v: "library", label: "Library search" },
          { v: "storymatch", label: "StoryMatch" },
        ] as { v: "all" | SearchSource; label: string }[]).map(opt => (
          <button
            key={opt.v}
            type="button"
            className={`slv-chip${sourceFilter === opt.v ? " on" : ""}`}
            onClick={() => setSourceFilter(opt.v)}
          >{opt.label}</button>
        ))}
      </div>

      {loading ? (
        <div className="slv-empty">Loading insights…</div>
      ) : top.length === 0 && recent.length === 0 ? (
        <div className="slv-empty">
          <div className="slv-empty-h">Nothing searched yet</div>
          <p className="slv-empty-sub">Once your team starts running searches, you&apos;ll see what they&apos;re looking for here.</p>
        </div>
      ) : (
        <>
          {/* ── Top searches ──────────────────────────────────────── */}
          <section className="slv-section">
            <div className="slv-section-h">
              <h2>Top searches</h2>
              <span className="slv-section-sub">Sorted by frequency. Zero-result queries are gap signals — the team asked but the library couldn&apos;t answer.</span>
            </div>
            {top.length === 0 ? (
              <div className="slv-empty-small">No searches in this slice.</div>
            ) : (
              <div className="slv-top-table">
                <div className="slv-top-row slv-top-row-head">
                  <span className="slv-q">Query</span>
                  <span className="slv-num">Times searched</span>
                  <span className="slv-num">Avg results</span>
                  <span className="slv-num">Zero-result runs</span>
                  <span className="slv-when">Last seen</span>
                </div>
                {top.map(row => (
                  <div key={row.queryNormalized} className={`slv-top-row${row.zeroResultRuns > 0 ? " has-gap" : ""}`}>
                    <span className="slv-q">
                      <span className="slv-q-text">{row.exampleQuery}</span>
                      <span className="slv-q-sources">
                        {row.sources.map(s => (
                          <span key={s} className={`slv-source-pill ${s}`}>{s === "storymatch" ? "StoryMatch" : "Library"}</span>
                        ))}
                      </span>
                    </span>
                    <span className="slv-num">{row.count}</span>
                    <span className="slv-num">{row.avgResultCount}</span>
                    <span className={`slv-num${row.zeroResultRuns > 0 ? " warn" : ""}`}>{row.zeroResultRuns}</span>
                    <span className="slv-when">{timeAgo(row.lastSeen)}</span>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* ── Recent activity ───────────────────────────────────── */}
          <section className="slv-section">
            <div className="slv-section-h">
              <h2>Recent activity</h2>
              <span className="slv-section-sub">Last 200 searches across your org. Newest first.</span>
            </div>
            {recent.length === 0 ? (
              <div className="slv-empty-small">No recent searches.</div>
            ) : (
              <div className="slv-feed">
                {recent.map(entry => (
                  <div key={entry.id} className="slv-feed-row">
                    <span className={`slv-source-pill ${entry.source}`}>{entry.source === "storymatch" ? "StoryMatch" : "Library"}</span>
                    <span className="slv-feed-q">{entry.query}</span>
                    <span className={`slv-feed-count${entry.resultCount === 0 ? " zero" : ""}`}>
                      {entry.resultCount === 0 ? "no results" : `${entry.resultCount} ${entry.resultCount === 1 ? "result" : "results"}`}
                    </span>
                    <span className="slv-feed-when">{timeAgo(entry.createdAt)}</span>
                  </div>
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}

const css = `
.slv{padding:18px 20px 32px;display:flex;flex-direction:column;height:100%;overflow-y:auto;font-family:var(--font);color:var(--t1);}
.slv-head{padding:0 4px 14px;border-bottom:1px solid var(--border);margin-bottom:16px;}
.slv-title{font-family:var(--serif);font-size:22px;font-weight:600;letter-spacing:-.3px;color:var(--t1);margin:0 0 4px;}
.slv-sub{font-size:12.5px;color:var(--t3);margin:0 0 12px;line-height:1.5;}
.slv-metrics{display:flex;gap:10px;flex-wrap:wrap;}
.slv-metric{flex:1;min-width:120px;padding:12px 14px;border:1px solid var(--border);border-radius:9px;background:#fff;}
.slv-metric.warn{border-color:#fecaca;background:#fef7f7;}
.slv-metric-label{font-size:10.5px;text-transform:uppercase;letter-spacing:.5px;color:var(--t3);font-weight:700;}
.slv-metric-num{font-size:22px;font-weight:600;color:var(--t1);font-variant-numeric:tabular-nums;letter-spacing:-.5px;margin-top:2px;}
.slv-metric.warn .slv-metric-num{color:#b91c1c;}

.slv-filterbar{display:flex;gap:6px;margin-bottom:16px;padding:0 4px;}
.slv-chip{padding:6px 12px;border:1px solid var(--border);border-radius:99px;background:#fff;color:var(--t2);font-family:var(--font);font-size:12px;font-weight:600;cursor:pointer;transition:all .12s;}
.slv-chip:hover{border-color:var(--border2);color:var(--t1);}
.slv-chip.on{background:var(--accent);border-color:var(--accent);color:#fff;}

.slv-empty{padding:48px 24px;text-align:center;background:var(--bg);border-radius:12px;border:1px solid var(--border);}
.slv-empty-h{font-family:var(--serif);font-size:17px;font-weight:600;color:var(--t1);margin-bottom:4px;}
.slv-empty-sub{font-size:13px;color:var(--t3);margin:0;line-height:1.55;}
.slv-empty-small{padding:18px;text-align:center;color:var(--t3);font-size:12.5px;}

.slv-section{margin-bottom:24px;}
.slv-section-h{margin-bottom:10px;padding:0 4px;}
.slv-section-h h2{font-family:var(--serif);font-size:16px;font-weight:600;color:var(--t1);margin:0 0 2px;letter-spacing:-.2px;}
.slv-section-sub{font-size:11.5px;color:var(--t3);line-height:1.5;}

/* Top searches — 5-column table-like grid. Rows with non-zero
   gap counts pick up a warm wash so they pop visually. */
.slv-top-table{border:1px solid var(--border);border-radius:10px;overflow:hidden;background:#fff;}
.slv-top-row{display:grid;grid-template-columns:minmax(220px,2fr) 110px 100px 130px 110px;gap:10px;padding:10px 14px;font-size:13px;color:var(--t1);align-items:center;border-bottom:1px solid var(--border);}
.slv-top-row:last-child{border-bottom:none;}
.slv-top-row-head{background:var(--bg2);color:var(--t3);font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;padding:9px 14px;}
.slv-top-row.has-gap{background:#fef7f7;}
.slv-q{display:flex;flex-direction:column;gap:3px;min-width:0;}
.slv-q-text{font-weight:600;color:var(--t1);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.slv-q-sources{display:flex;gap:4px;}
.slv-num{font-variant-numeric:tabular-nums;text-align:right;color:var(--t2);font-weight:500;}
.slv-num.warn{color:#b91c1c;font-weight:700;}
.slv-when{font-size:11.5px;color:var(--t3);}

/* Source pills. StoryMatch = accent purple; Library = neutral grey.
   Used in both the top table and the recent activity feed. */
.slv-source-pill{display:inline-block;font-size:9.5px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;padding:2px 7px;border-radius:4px;background:var(--bg2);color:var(--t3);}
.slv-source-pill.storymatch{background:#F2EBF9;color:var(--accent);}
.slv-source-pill.library{background:var(--bg2);color:var(--t3);}

/* Recent activity feed — single-row pills + query + result count + ago.
   Compact for scanning, not for deep analysis (the top table covers that). */
.slv-feed{display:flex;flex-direction:column;gap:0;border:1px solid var(--border);border-radius:10px;overflow:hidden;background:#fff;}
.slv-feed-row{display:grid;grid-template-columns:90px 1fr 110px 80px;gap:12px;padding:8px 14px;border-bottom:1px solid var(--border);font-size:12.5px;align-items:center;}
.slv-feed-row:last-child{border-bottom:none;}
.slv-feed-q{color:var(--t1);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.slv-feed-count{color:var(--t3);font-size:11.5px;text-align:right;}
.slv-feed-count.zero{color:#b91c1c;font-weight:600;}
.slv-feed-when{color:var(--t4);font-size:11px;text-align:right;}
`;
