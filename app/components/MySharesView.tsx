"use client";

// "My Shares" — sales rep / admin view of trackable share links and their
// engagement metrics. Reps see their own; admins can toggle to see the
// whole org. Each row shows: asset thumb + headline, when it was created,
// click count, max % of the video the prospect actually watched, and a
// completion check if they made it all the way through.

import { useEffect, useState } from "react";

interface VisitorSummary {
  visitor_id: string;
  first_seen_at: string;
  last_seen_at: string;
  max_watched_percent: number;
  max_page_seconds: number;
  completed: boolean;
  played: boolean;
}

interface ShareSummary {
  id: string;
  asset_id: string;
  sender_user_id: string;
  sender_email: string | null;
  recipient_label: string | null;
  created_at: string;
  open_count: number;            // non-self opens only
  last_clicked_at: string | null;
  asset_headline: string;
  asset_company: string;
  asset_thumbnail: string;
  max_watched_percent: number;
  max_watched_seconds: number;
  max_page_seconds: number;      // heartbeat-based: total time on page
  completed: boolean;
  play_count: number;
  last_event_at: string | null;
  visitor_count: number;
  visitors: VisitorSummary[];
}

function formatDuration(sec: number): string {
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}m ${s}s`;
}

interface Props {
  isAdmin: boolean;
  authHeaders: () => Promise<HeadersInit>;
  onBack: () => void;
}

function timeAgo(iso: string | null): string {
  if (!iso) return "—";
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

function copyToClipboard(text: string) {
  navigator.clipboard?.writeText(text);
}

export default function MySharesView({ isAdmin, authHeaders, onBack }: Props) {
  const [shares, setShares] = useState<ShareSummary[] | null>(null);
  const [scope, setScope] = useState<"self" | "org">("self");
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const url = `/api/share/list${scope === "org" ? "?scope=org" : ""}`;
        const r = await fetch(url, { headers: await authHeaders() });
        if (!r.ok) throw new Error("Failed to load shares");
        const body = (await r.json()) as { shares: ShareSummary[] };
        if (!cancelled) setShares(body.shares || []);
      } catch (e) {
        if (!cancelled) setShares([]);
        console.error(e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [scope, authHeaders]);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 1500);
  };

  return (
    <>
      <style>{css}</style>
      <div className="ms-wrap">
        <div className="ms-head">
          <button className="ms-back" onClick={onBack}>← Back</button>
          <div>
            <h1 className="ms-title">My shared links</h1>
            <div className="ms-sub">Track which prospects are actually engaging with the testimonials you sent.</div>
          </div>
          {isAdmin && (
            <div className="ms-scope-toggle">
              <button className={`ms-scope-btn ${scope === "self" ? "on" : ""}`} onClick={() => setScope("self")}>Mine</button>
              <button className={`ms-scope-btn ${scope === "org" ? "on" : ""}`} onClick={() => setScope("org")}>Whole team</button>
            </div>
          )}
        </div>

        {loading && <div className="ms-empty">Loading…</div>}
        {!loading && shares && shares.length === 0 && (
          <div className="ms-empty">
            <div style={{ fontSize: 16, fontWeight: 600, color: "var(--t1)", marginBottom: 6 }}>No shares yet</div>
            <div>Click the chain-link icon on any testimonial card to copy a trackable link.</div>
          </div>
        )}

        {!loading && shares && shares.length > 0 && (
          <div className="ms-table">
            <div className={`ms-row ms-row-head${scope === "org" ? " org-wide" : ""}`}>
              <div></div>
              <div>Testimonial</div>
              {scope === "org" && <div>Sent by</div>}
              <div>Link generated</div>
              <div title="Number of times the link was opened (excludes your own self-views)">Opens</div>
              <div title="Total time the visitor spent on the page (independent of video play)">Time on page</div>
              <div title="Furthest point reached in the video by any viewer">% of video watched</div>
              <div></div>
            </div>
            {shares.map((s) => {
              const url = `${window.location.origin}/s/${s.id}`;
              const watchedColor =
                s.completed ? "var(--green)" :
                s.max_watched_percent >= 75 ? "var(--green)" :
                s.max_watched_percent >= 25 ? "var(--amber)" :
                s.max_watched_percent > 0 ? "var(--t3)" : "var(--t4)";
              // Visitor count > 1 means the link was likely forwarded.
              // Filter out the "(unknown)" bucket from old pre-cookie events
              // when counting "real" distinct visitors.
              const realVisitors = s.visitors.filter(v => v.visitor_id !== "(unknown)");
              const visitorCount = realVisitors.length;
              const isExpanded = expandedId === s.id;
              const canExpand = visitorCount > 0;
              return (
                <div key={s.id} className="ms-share-block">
                  <div className={`ms-row${scope === "org" ? " org-wide" : ""}${isExpanded ? " expanded" : ""}`}>
                    <div className="ms-thumb">
                      {s.asset_thumbnail
                        ? <img src={s.asset_thumbnail} alt={s.asset_headline}/>
                        : <div className="ms-thumb-placeholder"/>}
                    </div>
                    <div className="ms-title-cell">
                      <div className="ms-title-h">
                        {s.asset_headline || "Untitled"}
                        {visitorCount > 1 && (
                          <span className="ms-forward-badge" title="This link was opened by multiple distinct viewers — likely forwarded">
                            ↗ Forwarded to {visitorCount - 1} other{visitorCount - 1 === 1 ? "" : "s"}
                          </span>
                        )}
                      </div>
                      <div className="ms-title-c">{s.asset_company || "—"}</div>
                    </div>
                    {scope === "org" && (
                      <div className="ms-sender">{s.sender_email || "—"}</div>
                    )}
                    <div className="ms-when">{timeAgo(s.created_at)}</div>
                    <div className="ms-clicks">
                      <span className="ms-click-num">{s.open_count}</span>
                      {s.last_event_at && s.open_count > 0 && (
                        <span className="ms-click-when">last {timeAgo(s.last_event_at)}</span>
                      )}
                    </div>
                    <div className="ms-page">
                      {s.max_page_seconds > 0 ? formatDuration(s.max_page_seconds) : <span style={{color:"var(--t4)"}}>—</span>}
                    </div>
                    <div className="ms-watched">
                      <div className="ms-watched-bar">
                        <div className="ms-watched-fill" style={{ width: `${Math.min(100, s.max_watched_percent)}%`, background: watchedColor }}/>
                      </div>
                      <div className="ms-watched-meta" style={{ color: watchedColor }}>
                        {s.completed ? "✓ Watched all" : s.max_watched_percent > 0 ? `${s.max_watched_percent}%` : "Not played"}
                      </div>
                    </div>
                    <div className="ms-actions">
                      {canExpand && (
                        <button
                          className="ms-mini-btn ms-expand-btn"
                          onClick={() => setExpandedId(isExpanded ? null : s.id)}
                          title="Show per-visitor breakdown"
                        >{isExpanded ? "▴" : "▾"}</button>
                      )}
                      <button
                        className="ms-mini-btn"
                        onClick={() => { copyToClipboard(url); showToast("Link copied!"); }}
                        title="Copy share link to clipboard"
                      >Copy link</button>
                    </div>
                  </div>
                  {isExpanded && (
                    <div className="ms-visitors">
                      <div className="ms-visitors-head">
                        Per-visitor breakdown
                        {visitorCount > 1 && <span className="ms-visitors-note">  ·  This link reached {visitorCount} distinct {visitorCount === 1 ? "viewer" : "viewers"}.</span>}
                      </div>
                      {realVisitors.length === 0 ? (
                        <div className="ms-visitors-empty">No viewer data captured yet for this link.</div>
                      ) : (
                        <div className="ms-visitor-list">
                          {realVisitors.map((v, i) => {
                            const watchedColor =
                              v.completed ? "var(--green)" :
                              v.max_watched_percent >= 75 ? "var(--green)" :
                              v.max_watched_percent >= 25 ? "var(--amber)" :
                              v.max_watched_percent > 0 ? "var(--t3)" : "var(--t4)";
                            return (
                              <div className="ms-visitor" key={v.visitor_id}>
                                <div className="ms-visitor-label">
                                  <strong>Visitor {i + 1}</strong>
                                  <span className="ms-visitor-when">  ·  first opened {timeAgo(v.first_seen_at)}</span>
                                </div>
                                <div className="ms-visitor-stats">
                                  <span className="ms-visitor-stat">
                                    Time on page: <strong>{v.max_page_seconds > 0 ? formatDuration(v.max_page_seconds) : "—"}</strong>
                                  </span>
                                  <span className="ms-visitor-stat" style={{ color: watchedColor }}>
                                    {v.completed ? "✓ Watched all" : v.played ? `Watched ${v.max_watched_percent}%` : "Did not play"}
                                  </span>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
        {toast && <div className="ms-toast">{toast}</div>}
      </div>
    </>
  );
}

const css = `
.ms-wrap{max-width:1100px;margin:0 auto;padding:32px 32px 60px;font-family:var(--font);}
.ms-head{display:grid;grid-template-columns:auto 1fr auto;gap:18px;align-items:center;margin-bottom:28px;}
.ms-back{padding:6px 12px;border-radius:var(--r3);border:1px solid var(--border);background:#fff;color:var(--t2);font-family:var(--font);font-size:12px;font-weight:600;cursor:pointer;}
.ms-back:hover{border-color:var(--border2);color:var(--t1);}
.ms-title{font-family:var(--serif);font-size:28px;font-weight:600;letter-spacing:-.4px;color:var(--t1);}
.ms-sub{font-size:13px;color:var(--t3);margin-top:3px;}
.ms-scope-toggle{display:flex;border:1px solid var(--border);border-radius:8px;overflow:hidden;background:#fff;}
.ms-scope-btn{padding:7px 14px;background:none;border:none;cursor:pointer;font-family:var(--font);font-size:12px;font-weight:600;color:var(--t3);}
.ms-scope-btn.on{background:var(--accentLL);color:var(--accent);}
.ms-scope-btn:hover:not(.on){background:var(--bg2);}
.ms-empty{padding:48px;text-align:center;color:var(--t3);background:#fff;border:1px solid var(--border);border-radius:var(--r2);}

.ms-table{background:#fff;border:1px solid var(--border);border-radius:var(--r2);overflow:hidden;}
.ms-row{display:grid;grid-template-columns:80px minmax(220px,2.4fr) 90px 90px 90px 180px 100px;gap:14px;padding:12px 16px;align-items:center;border-bottom:1px solid var(--border);font-size:13px;}
.ms-row.org-wide{grid-template-columns:80px minmax(180px,2fr) 130px 90px 90px 90px 170px 100px;}
.ms-page{font-size:12px;color:var(--t2);font-weight:500;}
.ms-row.ms-row-head{padding:11px 16px;background:var(--bg2);font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--t3);}
.ms-row:last-child{border-bottom:none;}
.ms-row:hover:not(.ms-row-head){background:var(--bg2);}

.ms-thumb{width:80px;height:50px;border-radius:6px;overflow:hidden;background:var(--bg3);}
.ms-thumb img{width:100%;height:100%;object-fit:cover;}
.ms-thumb-placeholder{width:100%;height:100%;background:var(--bg3);}

.ms-title-cell{min-width:0;display:flex;flex-direction:column;gap:2px;}
.ms-title-h{font-weight:600;color:var(--t1);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.ms-title-c{font-size:11.5px;color:var(--t3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}

.ms-sender{font-size:12px;color:var(--t2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.ms-when{font-size:12px;color:var(--t3);}
.ms-clicks{display:flex;flex-direction:column;gap:1px;}
.ms-click-num{font-weight:700;color:var(--t1);font-size:14px;}
.ms-click-when{font-size:11px;color:var(--t3);}

.ms-watched{display:flex;flex-direction:column;gap:5px;}
.ms-watched-bar{height:5px;background:var(--bg3);border-radius:3px;overflow:hidden;}
.ms-watched-fill{height:100%;border-radius:3px;transition:width .3s;}
.ms-watched-meta{font-size:11.5px;font-weight:600;}

.ms-actions{text-align:right;}
.ms-mini-btn{font-family:var(--font);font-size:11px;padding:5px 10px;border:1px solid var(--border);border-radius:5px;background:#fff;color:var(--accent);cursor:pointer;font-weight:600;}
.ms-mini-btn:hover{background:var(--accentLL);}

.ms-toast{position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#1a1a1f;color:#fff;padding:10px 18px;border-radius:8px;font-size:13px;font-weight:500;box-shadow:0 8px 24px rgba(0,0,0,.2);z-index:100;}

.ms-share-block{border-bottom:1px solid var(--border);}
.ms-share-block:last-child{border-bottom:none;}
.ms-share-block .ms-row{border-bottom:none;}
.ms-row.expanded{background:var(--bg2);}

.ms-forward-badge{display:inline-block;margin-left:8px;padding:2px 8px;border-radius:10px;font-size:10.5px;font-weight:700;background:var(--accentLL);color:var(--accent);border:1px solid var(--accentL);text-transform:none;letter-spacing:0;vertical-align:middle;}

.ms-expand-btn{padding:4px 8px;font-size:10px;color:var(--t3);min-width:28px;}

.ms-visitors{padding:12px 16px 18px 110px;background:var(--bg2);border-top:1px dashed var(--border);}
.ms-visitors-head{font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--t3);margin-bottom:10px;}
.ms-visitors-note{text-transform:none;letter-spacing:0;font-weight:500;color:var(--t2);}
.ms-visitors-empty{font-size:12px;color:var(--t3);font-style:italic;}
.ms-visitor-list{display:flex;flex-direction:column;gap:8px;}
.ms-visitor{display:grid;grid-template-columns:1fr auto;gap:14px;align-items:center;background:#fff;border:1px solid var(--border);border-radius:7px;padding:9px 14px;font-size:12.5px;}
.ms-visitor-label strong{color:var(--t1);font-weight:600;}
.ms-visitor-when{font-size:11.5px;color:var(--t3);}
.ms-visitor-stats{display:flex;gap:18px;font-size:12px;color:var(--t2);}
.ms-visitor-stat strong{color:var(--t1);font-weight:600;}
`;
