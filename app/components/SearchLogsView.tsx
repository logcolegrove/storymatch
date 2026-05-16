"use client";

// Search Insights — admin-only view that surfaces every library +
// StoryMatch search the org has run, newest first. Anonymized:
// admins see WHAT was searched, never WHO. Zero-result rows are
// styled prominently — they're the library gap signal.
//
// Designed to fit inside the narrow admin-rail panel: each search
// is a compact two-line card (query text + meta line) so nothing
// gets clipped by column widths the way a table would.

import { useEffect, useState } from "react";

type SearchSource = "library" | "storymatch";

interface SearchLogEntry {
  id: string;
  query: string;
  source: SearchSource;
  resultCount: number;
  topResultIds: string[];
  createdAt: string;
}

interface Props {
  authHeaders: () => Promise<HeadersInit>;
  // Fires when an admin clicks a logged search to re-run it. The
  // parent decides what "re-run" means per source: library searches
  // drop the query into the top-bar filter; StoryMatch searches
  // open the dialog and submit the query to /api/storymatch.
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

export default function SearchLogsView({ authHeaders, onRerunSearch }: Props) {
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
        console.error("[SearchLogsView] load failed", e);
      }
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [sourceFilter, authHeaders]);

  return (
    <div className="slv">
      <style>{css}</style>
      <div className="slv-head">
        <h3>Searches</h3>
        <p className="ap-sub">What your team is searching for, newest first. Anonymized — you see the search, never the searcher. Rows that returned nothing are highlighted.</p>
      </div>

      <div className="slv-filterbar">
        {([
          { v: "all", label: "All" },
          { v: "library", label: "Library" },
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

      <div className="slv-list">
        {loading ? (
          <div className="slv-empty">Loading…</div>
        ) : recent.length === 0 ? (
          <div className="slv-empty">
            <div className="slv-empty-h">Nothing searched yet</div>
            <p className="slv-empty-sub">Once your team starts running searches, they&apos;ll show up here.</p>
          </div>
        ) : recent.map(entry => {
          const zero = entry.resultCount === 0;
          return (
            <button
              key={entry.id}
              type="button"
              className="slv-row"
              onClick={() => onRerunSearch?.(entry.query, entry.source)}
              title="Click to re-run this search"
            >
              <div className="slv-q">{entry.query}</div>
              <div className="slv-meta">
                <span className={`slv-source-pill ${entry.source}`}>
                  {entry.source === "storymatch" ? "StoryMatch" : "Library"}
                </span>
                <span className={`slv-count${zero ? " zero" : ""}`}>
                  {zero ? "0 results" : `${entry.resultCount} ${entry.resultCount === 1 ? "result" : "results"}`}
                </span>
                <span className="slv-when">{timeAgo(entry.createdAt)}</span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

const css = `
.slv{display:flex;flex-direction:column;height:100%;overflow-y:auto;font-family:var(--font);color:var(--t1);}
.slv-head{padding:18px 20px 12px;border-bottom:1px solid var(--border);}
.slv-head h3{font-family:var(--serif);font-size:18px;font-weight:600;letter-spacing:-.3px;color:var(--t1);margin:0;}
.slv-head .ap-sub{font-size:11.5px;color:var(--t3);margin-top:4px;line-height:1.45;}

.slv-filterbar{display:flex;gap:6px;padding:12px 20px;border-bottom:1px solid var(--border);}
.slv-chip{padding:5px 11px;border:1px solid var(--border);border-radius:99px;background:#fff;color:var(--t2);font-family:var(--font);font-size:11.5px;font-weight:600;cursor:pointer;transition:all .12s;}
.slv-chip:hover{border-color:var(--border2);color:var(--t1);}
.slv-chip.on{background:var(--accent);border-color:var(--accent);color:#fff;}

.slv-list{padding:10px 14px 24px;display:flex;flex-direction:column;gap:6px;}
.slv-empty{padding:36px 16px;text-align:center;color:var(--t3);font-size:12.5px;}
.slv-empty-h{font-family:var(--serif);font-size:15px;font-weight:600;color:var(--t1);margin-bottom:4px;}
.slv-empty-sub{font-size:12px;color:var(--t3);margin:0;line-height:1.5;}

/* Clickable search row — query on top (wraps onto multiple lines
   so long queries stay fully readable), meta line below. Whole row
   is a button so admins can re-run any team member's search
   without retyping it. Zero-result rows keep red text on the count
   but no longer wear a light red wash — the red text alone is
   signal enough without dyeing the whole row. */
.slv-row{display:block;width:100%;text-align:left;padding:10px 12px;border:1px solid var(--border);border-radius:8px;background:#fff;font:inherit;color:inherit;cursor:pointer;transition:background .12s,border-color .12s,box-shadow .12s;}
.slv-row:hover{background:var(--bg);border-color:var(--border2);}
.slv-row:focus-visible{outline:2px solid var(--accent);outline-offset:1px;}
.slv-q{font-size:13px;font-weight:600;color:var(--t1);line-height:1.4;word-break:break-word;}
.slv-meta{display:flex;align-items:center;gap:8px;margin-top:6px;flex-wrap:wrap;}

.slv-source-pill{display:inline-block;font-size:9.5px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;padding:2px 6px;border-radius:4px;background:var(--bg2);color:var(--t3);flex-shrink:0;}
.slv-source-pill.storymatch{background:#F2EBF9;color:var(--accent);}
.slv-source-pill.library{background:var(--bg2);color:var(--t3);}

.slv-count{font-size:11px;color:var(--t3);font-weight:500;}
.slv-count.zero{color:#b91c1c;font-weight:700;}
.slv-when{font-size:11px;color:var(--t4);margin-left:auto;flex-shrink:0;}
`;
