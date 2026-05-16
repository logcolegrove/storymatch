"use client";

// Feedback view — anonymized asset rating + comments for sales reps,
// and a feedback dashboard for admins. Both roles share the same list
// of assets; the admin view adds aggregate counts + a per-asset
// comment stream (without attribution).
//
// Submission UX:
//   • Clicking a thumbs control auto-saves the rating immediately.
//     Clicking the already-active thumb a second time clears the vote.
//   • Comment textarea saves on blur and on any thumbs change.
// One vote per user per asset is enforced by the DB unique constraint
// (asset_id, user_id) — the server-side upsert handles the round-trip.
//
// Anonymity contract: the API never returns user_id alongside comments
// for non-self rows. Sales reps see only their own ratings + comments;
// admins see aggregate counts plus an anonymized comment list per asset.

import { useEffect, useMemo, useState } from "react";

type Rating = "up" | "down";

interface AssetSlim {
  id: string;
  headline: string;
  company: string;
  clientName: string;
  vertical: string;
  thumbnail: string;
  assetType: string;
  status: string;
}

interface MyFeedback {
  rating: Rating;
  comment: string | null;
  updatedAt: string;
}

interface AdminAggregate {
  assetId: string;
  up: number;
  down: number;
  total: number;
  netScore: number;
  comments: Array<{ rating: Rating; comment: string | null; createdAt: string; updatedAt: string }>;
}

interface Props {
  assets: AssetSlim[];
  role: "admin" | "sales";
  authHeaders: () => Promise<HeadersInit>;
  onBack: () => void;
}

type SortMode = "all" | "loved" | "rejected" | "mixed" | "unrated";

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

export default function FeedbackView({ assets, role, authHeaders, onBack }: Props) {
  // Map asset_id → caller's own vote. Empty when the rep hasn't rated
  // a given asset; set after the first thumbs click.
  const [myVotes, setMyVotes] = useState<Map<string, MyFeedback>>(new Map());
  // Admin-only aggregates keyed by asset_id. We load these on mount
  // when the role is admin; sales reps never receive them from the API.
  const [aggregates, setAggregates] = useState<Map<string, AdminAggregate>>(new Map());
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortMode>("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Local in-flight comment edits per asset. Persisted by blur or by
  // any thumbs click. We track the draft separately from myVotes so
  // typing doesn't fire one save per keystroke.
  const [commentDrafts, setCommentDrafts] = useState<Record<string, string>>({});

  // ── Initial load ───────────────────────────────────────────
  // Sales: hit GET /api/feedback?asset_id=... per asset to collect
  // their own votes. We could fold these into a single endpoint, but
  // most reps only have votes on a handful of assets, so the cost is
  // capped. Admins also hit GET /api/feedback?summary=true once for
  // the aggregate dashboard.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const headers = await authHeaders();
        // 1. Per-asset my-vote pull. This also returns aggregate counts
        //    in the payload (admin) but for sales reps the counts stay
        //    private — we just throw them away on the FE.
        const own = new Map<string, MyFeedback>();
        // Batch in parallel for snappiness; bail early if we get unmounted.
        const results = await Promise.all(
          assets.map(a =>
            fetch(`/api/feedback?asset_id=${encodeURIComponent(a.id)}`, { headers })
              .then(r => r.ok ? r.json() : null)
              .catch(() => null)
              .then((data: { myVote: MyFeedback | null } | null) => ({ id: a.id, myVote: data?.myVote || null }))
          )
        );
        if (cancelled) return;
        for (const { id, myVote } of results) {
          if (myVote) own.set(id, myVote);
        }
        setMyVotes(own);

        // 2. Admin-only dashboard summary.
        if (role === "admin") {
          const r = await fetch("/api/feedback?summary=true", { headers });
          if (r.ok) {
            const body = (await r.json()) as { assets: AdminAggregate[] };
            const m = new Map<string, AdminAggregate>();
            for (const e of body.assets || []) m.set(e.assetId, e);
            if (!cancelled) setAggregates(m);
          }
        }
      } catch (e) {
        console.error("[FeedbackView] load failed", e);
      }
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [assets, role, authHeaders]);

  // Save the caller's vote (rating + comment) for an asset. Pass
  // rating=null to clear (DELETE). Optimistic local update, then sync
  // with the server's response. Errors roll back to the prior state
  // so a network hiccup doesn't leave the UI lying about save status.
  const saveVote = async (assetId: string, rating: Rating | null, comment: string | null) => {
    const prev = myVotes.get(assetId);
    try {
      const headers: HeadersInit = { "Content-Type": "application/json", ...(await authHeaders()) };
      if (rating === null) {
        // Optimistic: drop the local entry immediately.
        setMyVotes(m => { const n = new Map(m); n.delete(assetId); return n; });
        const r = await fetch(`/api/feedback?asset_id=${encodeURIComponent(assetId)}`, {
          method: "DELETE",
          headers,
        });
        if (!r.ok) throw new Error("DELETE failed");
        return;
      }
      // Optimistic insert/update.
      const nowIso = new Date().toISOString();
      setMyVotes(m => {
        const n = new Map(m);
        n.set(assetId, { rating, comment, updatedAt: nowIso });
        return n;
      });
      const r = await fetch("/api/feedback", {
        method: "POST",
        headers,
        body: JSON.stringify({ asset_id: assetId, rating, comment: comment ?? null }),
      });
      if (!r.ok) throw new Error("POST failed");
      const body = (await r.json()) as { feedback: { rating: Rating; comment: string | null; updatedAt: string } };
      setMyVotes(m => {
        const n = new Map(m);
        n.set(assetId, body.feedback);
        return n;
      });
      // Refresh admin aggregate for this asset so the row reflects
      // the new count without a full reload. Sales reps don't have
      // access to the summary endpoint so we skip the refetch.
      if (role === "admin") {
        try {
          const refresh = await fetch(`/api/feedback?asset_id=${encodeURIComponent(assetId)}`, { headers: await authHeaders() });
          if (refresh.ok) {
            const data = (await refresh.json()) as { up: number; down: number; total: number; comments?: AdminAggregate["comments"] };
            setAggregates(m => {
              const n = new Map(m);
              const existing = n.get(assetId);
              n.set(assetId, {
                assetId,
                up: data.up,
                down: data.down,
                total: data.total,
                netScore: data.up - data.down,
                comments: data.comments ?? existing?.comments ?? [],
              });
              return n;
            });
          }
        } catch { /* non-fatal */ }
      }
    } catch (e) {
      console.error("[FeedbackView] save failed", e);
      // Roll back.
      setMyVotes(m => {
        const n = new Map(m);
        if (prev) n.set(assetId, prev);
        else n.delete(assetId);
        return n;
      });
      setToast("Couldn't save");
      setTimeout(() => setToast(null), 2000);
    }
  };

  // ── Filter + sort ──────────────────────────────────────────
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = assets.filter(a => a.status === "published" || role === "admin");
    if (q) {
      list = list.filter(a =>
        (a.headline || "").toLowerCase().includes(q) ||
        (a.company || "").toLowerCase().includes(q) ||
        (a.clientName || "").toLowerCase().includes(q) ||
        (a.vertical || "").toLowerCase().includes(q),
      );
    }
    // Sort modes only matter for admins (they're aggregate-aware).
    // Sales reps just see assets in their incoming order.
    if (role !== "admin" || sort === "all") return list;
    const score = (a: AssetSlim) => aggregates.get(a.id) || null;
    if (sort === "loved") {
      return list
        .filter(a => (score(a)?.up ?? 0) > 0)
        .sort((a, b) => (score(b)?.netScore ?? 0) - (score(a)?.netScore ?? 0));
    }
    if (sort === "rejected") {
      return list
        .filter(a => (score(a)?.down ?? 0) > 0)
        .sort((a, b) => (score(a)?.netScore ?? 0) - (score(b)?.netScore ?? 0));
    }
    if (sort === "mixed") {
      // Mixed = both up and down votes present, sorted by total volume.
      return list
        .filter(a => {
          const s = score(a);
          return s && s.up > 0 && s.down > 0;
        })
        .sort((a, b) => (score(b)?.total ?? 0) - (score(a)?.total ?? 0));
    }
    // unrated: no votes at all
    return list.filter(a => !aggregates.has(a.id) || (score(a)?.total ?? 0) === 0);
  }, [assets, role, search, sort, aggregates]);

  return (
    <div className="fbv">
      <style>{css}</style>
      <div className="fbv-head">
        <button className="fbv-back" onClick={onBack}>← Back to library</button>
        <h1 className="fbv-title">Feedback</h1>
        <p className="fbv-sub">
          {role === "admin"
            ? "How your sales team rates each testimonial. Comments are anonymous — counts and notes show up here, but never the rep who left them."
            : "Rate the testimonials you've used with prospects. Your name is never attached to your feedback — admins see the count and the note, but never who wrote it."}
        </p>
      </div>

      <div className="fbv-controls">
        <input
          className="fbv-search"
          placeholder="Search by company, name, headline…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        {role === "admin" && (
          <select
            className="fbv-sort"
            value={sort}
            onChange={e => setSort(e.target.value as SortMode)}
            title="Filter by sentiment"
          >
            <option value="all">All assets</option>
            <option value="loved">Most loved</option>
            <option value="rejected">Most rejected</option>
            <option value="mixed">Mixed signals</option>
            <option value="unrated">Unrated</option>
          </select>
        )}
      </div>

      {loading ? (
        <div className="fbv-empty">Loading feedback…</div>
      ) : visible.length === 0 ? (
        <div className="fbv-empty">{search ? "Nothing matches that search." : "No assets to show."}</div>
      ) : (
        <div className="fbv-list">
          {visible.map(a => {
            const my = myVotes.get(a.id);
            const draftKey = a.id;
            const commentDraft = draftKey in commentDrafts ? commentDrafts[draftKey] : (my?.comment ?? "");
            const agg = role === "admin" ? aggregates.get(a.id) : undefined;
            const expanded = expandedId === a.id;
            const onThumb = (next: Rating) => {
              if (my?.rating === next) {
                // Clicking the active thumb a second time clears the vote.
                saveVote(a.id, null, null);
              } else {
                saveVote(a.id, next, commentDraft || null);
              }
            };
            const onCommentBlur = () => {
              const next = commentDraft.trim();
              if (!my) return; // can't save a comment without a rating
              if ((my.comment ?? "") === next) return;
              saveVote(a.id, my.rating, next || null);
            };
            return (
              <div key={a.id} className="fbv-row">
                <div className="fbv-row-thumb">
                  {a.thumbnail ? (
                    <img src={a.thumbnail} alt=""/>
                  ) : (
                    <div className="fbv-thumb-placeholder">{a.company?.[0] || "?"}</div>
                  )}
                </div>
                <div className="fbv-row-info">
                  <div className="fbv-row-co">{a.company || "—"}</div>
                  <div className="fbv-row-head">{a.headline || "(no headline)"}</div>
                  <div className="fbv-row-meta">
                    {a.vertical || "—"} · {a.clientName || "anonymous"}
                  </div>
                </div>
                <div className="fbv-row-vote">
                  <div className="fbv-thumbs">
                    <button
                      type="button"
                      className={`fbv-thumb ${my?.rating === "up" ? "active up" : ""}`}
                      onClick={() => onThumb("up")}
                      title={my?.rating === "up" ? "Remove your thumbs-up" : "Thumbs up"}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M7 11v9H4a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1h3z"/>
                        <path d="M7 11l4-7a2 2 0 0 1 4 .8V9h4.4a2 2 0 0 1 1.97 2.35l-1.5 7A2 2 0 0 1 18 20H7"/>
                      </svg>
                    </button>
                    <button
                      type="button"
                      className={`fbv-thumb ${my?.rating === "down" ? "active down" : ""}`}
                      onClick={() => onThumb("down")}
                      title={my?.rating === "down" ? "Remove your thumbs-down" : "Thumbs down"}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M17 13V4h3a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1h-3z"/>
                        <path d="M17 13l-4 7a2 2 0 0 1-4-.8V15H4.6a2 2 0 0 1-1.97-2.35l1.5-7A2 2 0 0 1 6 4h11"/>
                      </svg>
                    </button>
                  </div>
                  {my?.rating && (
                    <textarea
                      className="fbv-comment"
                      placeholder="Optional note — only the comment shows, not your name."
                      value={commentDraft}
                      maxLength={500}
                      onChange={e => setCommentDrafts(d => ({ ...d, [draftKey]: e.target.value }))}
                      onBlur={onCommentBlur}
                    />
                  )}
                </div>
                {role === "admin" && (
                  <div className="fbv-row-agg">
                    <div className="fbv-agg-counts" title="Aggregate ratings from your sales team">
                      <span className="fbv-agg-up">{agg?.up ?? 0} 👍</span>
                      <span className="fbv-agg-down">{agg?.down ?? 0} 👎</span>
                    </div>
                    {agg && agg.comments.length > 0 && (
                      <button
                        type="button"
                        className="fbv-expand"
                        onClick={() => setExpandedId(expanded ? null : a.id)}
                      >
                        {expanded ? "Hide" : `${agg.comments.length} ${agg.comments.length === 1 ? "comment" : "comments"}`}
                      </button>
                    )}
                  </div>
                )}
                {role === "admin" && expanded && agg && (
                  <div className="fbv-comments">
                    {agg.comments.map((c, i) => (
                      <div key={i} className={`fbv-comment-row ${c.rating}`}>
                        <span className={`fbv-pill ${c.rating}`}>{c.rating === "up" ? "👍" : "👎"}</span>
                        <span className="fbv-comment-text">{c.comment}</span>
                        <span className="fbv-comment-time">{timeAgo(c.createdAt)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      {toast && <div className="fbv-toast">{toast}</div>}
    </div>
  );
}

const css = `
.fbv{max-width:1100px;margin:0 auto;padding:24px 32px 80px;font-family:var(--font);color:var(--t1);}
.fbv-head{padding-bottom:18px;border-bottom:1px solid var(--border);margin-bottom:18px;}
.fbv-back{background:none;border:none;color:var(--t3);font-family:var(--font);font-size:12px;font-weight:600;cursor:pointer;padding:4px 8px;margin-left:-8px;border-radius:5px;}
.fbv-back:hover{background:var(--bg2);color:var(--t1);}
.fbv-title{font-family:var(--serif);font-size:28px;font-weight:600;letter-spacing:-.4px;margin:8px 0 4px;}
.fbv-sub{font-size:13.5px;color:var(--t3);line-height:1.5;margin:0;max-width:600px;}
.fbv-controls{display:flex;gap:10px;margin-bottom:16px;}
.fbv-search{flex:1;font-family:var(--font);font-size:13px;padding:9px 12px;border:1px solid var(--border);border-radius:8px;background:#fff;color:var(--t1);}
.fbv-search:focus{outline:none;border-color:var(--accent);}
.fbv-sort{font-family:var(--font);font-size:13px;padding:9px 28px 9px 12px;border:1px solid var(--border);border-radius:8px;background:#fff;color:var(--t1);cursor:pointer;}
.fbv-sort:focus{outline:none;border-color:var(--accent);}
.fbv-empty{padding:48px;text-align:center;color:var(--t3);font-size:13.5px;background:var(--bg);border-radius:10px;}
.fbv-list{display:flex;flex-direction:column;gap:10px;}
.fbv-row{display:grid;grid-template-columns:80px 1fr auto auto;gap:14px;align-items:start;padding:14px;background:#fff;border:1px solid var(--border);border-radius:12px;}
.fbv-row-thumb{width:80px;height:54px;border-radius:7px;overflow:hidden;background:var(--bg2);}
.fbv-row-thumb img{width:100%;height:100%;object-fit:cover;}
.fbv-thumb-placeholder{width:100%;height:100%;display:grid;place-items:center;font-family:var(--serif);font-size:22px;color:var(--t3);background:var(--bg2);}
.fbv-row-info{min-width:0;}
.fbv-row-co{font-size:11px;text-transform:uppercase;letter-spacing:.5px;color:var(--t3);font-weight:700;}
.fbv-row-head{font-size:14.5px;font-weight:600;color:var(--t1);margin-top:2px;line-height:1.35;overflow:hidden;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;}
.fbv-row-meta{font-size:11.5px;color:var(--t3);margin-top:4px;}
.fbv-row-vote{display:flex;flex-direction:column;gap:8px;align-items:flex-end;min-width:220px;}
.fbv-thumbs{display:flex;gap:6px;}
.fbv-thumb{display:grid;place-items:center;width:34px;height:34px;border-radius:8px;border:1px solid var(--border);background:#fff;color:var(--t3);cursor:pointer;transition:all .12s;}
.fbv-thumb:hover{border-color:var(--border2);color:var(--t1);}
.fbv-thumb.active.up{background:#dcfce7;border-color:#86efac;color:#15803d;}
.fbv-thumb.active.down{background:#fee2e2;border-color:#fca5a5;color:#b91c1c;}
.fbv-comment{width:240px;min-height:54px;padding:7px 10px;font-family:var(--font);font-size:12.5px;border:1px solid var(--border);border-radius:7px;background:var(--bg);color:var(--t1);resize:vertical;line-height:1.45;}
.fbv-comment:focus{outline:none;border-color:var(--accent);background:#fff;}
.fbv-row-agg{display:flex;flex-direction:column;gap:6px;align-items:flex-end;min-width:120px;font-size:11.5px;color:var(--t2);}
.fbv-agg-counts{display:flex;gap:10px;font-size:12px;font-weight:600;}
.fbv-agg-up{color:#15803d;}
.fbv-agg-down{color:#b91c1c;}
.fbv-expand{background:none;border:none;color:var(--accent);font-family:var(--font);font-size:11.5px;font-weight:600;cursor:pointer;padding:2px 6px;border-radius:4px;}
.fbv-expand:hover{background:var(--accentLL);}
.fbv-comments{grid-column:1 / -1;margin-top:6px;padding-top:10px;border-top:1px dashed var(--border);display:flex;flex-direction:column;gap:6px;}
.fbv-comment-row{display:flex;align-items:flex-start;gap:8px;padding:8px 10px;background:var(--bg);border-radius:7px;font-size:12.5px;color:var(--t1);}
.fbv-comment-row.down{background:#fef2f2;}
.fbv-comment-row.up{background:#f0fdf4;}
.fbv-pill{font-size:13px;flex-shrink:0;}
.fbv-comment-text{flex:1;line-height:1.45;}
.fbv-comment-time{font-size:10.5px;color:var(--t4);white-space:nowrap;}
.fbv-toast{position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#1c1c1c;color:#fff;padding:9px 16px;border-radius:8px;font-size:13px;box-shadow:0 4px 12px rgba(0,0,0,.2);z-index:50;}
`;
