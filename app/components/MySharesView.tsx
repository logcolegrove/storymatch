"use client";

// "My Shares" — sales rep / admin view of trackable share links and their
// engagement metrics. Reps see their own; admins can toggle to see the
// whole org. Each row shows: asset thumb + headline, when it was created,
// click count, max % of the video the prospect actually watched, and a
// completion check if they made it all the way through.

import { useEffect, useState } from "react";

interface ShareSummary {
  id: string;
  asset_id: string;
  sender_user_id: string;
  sender_email: string | null;
  recipient_label: string | null;
  created_at: string;
  click_count: number;
  last_clicked_at: string | null;
  asset_headline: string;
  asset_company: string;
  asset_thumbnail: string;
  max_watched_percent: number;
  max_watched_seconds: number;
  completed: boolean;
  play_count: number;
  last_event_at: string | null;
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
            <div className="ms-row ms-row-head">
              <div></div>
              <div>Testimonial</div>
              {scope === "org" && <div>Sent by</div>}
              <div>Sent</div>
              <div title="Number of times the link was opened">Clicks</div>
              <div title="Furthest point reached in the video by any viewer">Max watched</div>
              <div></div>
            </div>
            {shares.map((s) => {
              const url = `${window.location.origin}/s/${s.id}`;
              const watchedColor =
                s.completed ? "var(--green)" :
                s.max_watched_percent >= 75 ? "var(--green)" :
                s.max_watched_percent >= 25 ? "var(--amber)" :
                s.max_watched_percent > 0 ? "var(--t3)" : "var(--t4)";
              return (
                <div className="ms-row" key={s.id}>
                  <div className="ms-thumb">
                    {s.asset_thumbnail
                      ? <img src={s.asset_thumbnail} alt={s.asset_headline}/>
                      : <div className="ms-thumb-placeholder"/>}
                  </div>
                  <div className="ms-title-cell">
                    <div className="ms-title-h">{s.asset_headline || "Untitled"}</div>
                    <div className="ms-title-c">{s.asset_company || "—"}</div>
                  </div>
                  {scope === "org" && (
                    <div className="ms-sender">{s.sender_email || "—"}</div>
                  )}
                  <div className="ms-when">{timeAgo(s.created_at)}</div>
                  <div className="ms-clicks">
                    <span className="ms-click-num">{s.click_count}</span>
                    {s.last_clicked_at && <span className="ms-click-when">last {timeAgo(s.last_clicked_at)}</span>}
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
                    <button
                      className="ms-mini-btn"
                      onClick={() => { copyToClipboard(url); showToast("Link copied!"); }}
                      title="Copy share link to clipboard"
                    >Copy link</button>
                  </div>
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
.ms-row{display:grid;grid-template-columns:80px minmax(220px,2.4fr) 90px 100px 200px 100px;gap:16px;padding:12px 16px;align-items:center;border-bottom:1px solid var(--border);font-size:13px;}
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
`;
