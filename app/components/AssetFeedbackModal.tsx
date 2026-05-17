"use client";

// AssetFeedbackModal — admin-only modal that shows the rating
// stream for a single asset. Triggered from the Feedback column
// in ListView; meant for "I see this asset has 5 thumbs up and 1
// thumbs down — what did the team actually say?"
//
// View-only. Admins who want to rate an asset themselves use the
// Rate option from the row's 3-dot menu (RateAssetModal), which is
// a separate, write-mode flow. Keeping the two surfaces distinct
// avoids muddling "I'm reviewing what the team said" with "I'm
// adding my own vote."
//
// Data shape mirrors /api/feedback?asset_id={id}, which for admins
// returns aggregate counts + a comment stream with user
// attribution.

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

type Rating = "up" | "down";

interface Comment {
  rating: Rating;
  comment: string | null;
  createdAt: string;
  updatedAt: string;
  userId: string | null;
  userEmail: string | null;
}

interface FeedbackPayload {
  assetId: string;
  up: number;
  down: number;
  total: number;
  comments?: Comment[];
}

interface Props {
  open: boolean;
  assetId: string | null;
  // Display-only asset reference. The modal renders headline +
  // thumbnail when available so the admin sees which asset they're
  // looking at without context-switching back to the row.
  assetMeta?: { id: string; headline?: string; company?: string; thumbnail?: string };
  authHeaders: () => Promise<HeadersInit>;
  onClose: () => void;
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

export default function AssetFeedbackModal({ open, assetId, assetMeta, authHeaders, onClose }: Props) {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<FeedbackPayload | null>(null);

  // Reload whenever the modal opens for a new asset. The fetch is
  // skipped when the modal is closed so we don't pay the round-trip
  // cost for nothing.
  useEffect(() => {
    if (!open || !assetId) {
      setData(null);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const headers = await authHeaders();
        const r = await fetch(`/api/feedback?asset_id=${encodeURIComponent(assetId)}`, { headers });
        if (!r.ok) throw new Error("Failed");
        const body = await r.json() as FeedbackPayload;
        if (!cancelled) setData(body);
      } catch (e) {
        console.error("[AssetFeedbackModal] load failed", e);
      }
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [open, assetId, authHeaders]);

  // Esc-to-close. Bound only while the modal is open.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open || typeof document === "undefined") return null;

  const comments = data?.comments || [];
  const silent = data ? Math.max(0, (data.total ?? 0) - comments.length) : 0;

  return createPortal(
    <div className="afm-scrim" onClick={onClose}>
      <style>{css}</style>
      <div className="afm" role="dialog" aria-label="Asset feedback" onClick={e => e.stopPropagation()}>
        <header className="afm-head">
          <div className="afm-head-l">
            {assetMeta?.thumbnail ? (
              <img src={assetMeta.thumbnail} alt="" className="afm-thumb"/>
            ) : (
              <div className="afm-thumb afm-thumb-empty"/>
            )}
            <div className="afm-head-meta">
              <h3>{assetMeta?.headline || "Asset feedback"}</h3>
              {assetMeta?.company && <div className="afm-co">{assetMeta.company}</div>}
            </div>
          </div>
          <button className="afm-close" onClick={onClose} aria-label="Close">×</button>
        </header>

        <div className="afm-counts">
          <span className="afm-count up">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M7 11v9H4a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1h3z"/>
              <path d="M7 11l4-7a2 2 0 0 1 4 .8V9h4.4a2 2 0 0 1 1.97 2.35l-1.5 7A2 2 0 0 1 18 20H7"/>
            </svg>
            {data?.up ?? 0}
          </span>
          <span className="afm-count down">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{transform:"rotate(180deg)"}}>
              <path d="M7 11v9H4a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1h3z"/>
              <path d="M7 11l4-7a2 2 0 0 1 4 .8V9h4.4a2 2 0 0 1 1.97 2.35l-1.5 7A2 2 0 0 1 18 20H7"/>
            </svg>
            {data?.down ?? 0}
          </span>
          <span className="afm-count total">{data?.total ?? 0} {(data?.total ?? 0) === 1 ? "rating" : "ratings"}</span>
        </div>

        <div className="afm-body">
          {loading ? (
            <div className="afm-empty">Loading…</div>
          ) : comments.length === 0 ? (
            <div className="afm-empty">
              <div className="afm-empty-h">No comments yet</div>
              <p className="afm-empty-sub">
                {(data?.total ?? 0) > 0
                  ? `This asset has ${data?.total} silent ${data?.total === 1 ? "rating" : "ratings"} (thumbs without a note).`
                  : "Nobody on your team has rated this asset yet."}
              </p>
            </div>
          ) : (
            <>
              {silent > 0 && (
                <div className="afm-silent">
                  Plus {silent.toLocaleString()} silent {silent === 1 ? "rating" : "ratings"} (thumbs without a note).
                </div>
              )}
              {comments.map((c, i) => (
                <div key={`${c.userId || "anon"}-${c.createdAt}-${i}`} className={`afm-comment ${c.rating}`}>
                  <div className="afm-comment-head">
                    <span className={`afm-pill ${c.rating}`}>{c.rating === "up" ? "👍" : "👎"}</span>
                    {c.userEmail && <span className="afm-user" title={c.userEmail}>{c.userEmail}</span>}
                    <span className="afm-when">{timeAgo(c.createdAt)}</span>
                  </div>
                  {c.comment && <div className="afm-text">{c.comment}</div>}
                </div>
              ))}
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

const css = `
.afm-scrim{position:fixed;inset:0;background:rgba(20,20,30,.5);display:grid;place-items:center;z-index:1200;animation:afmFade .12s ease;}
@keyframes afmFade{from{opacity:0;}to{opacity:1;}}
.afm{width:min(560px, calc(100vw - 32px));max-height:min(720px, calc(100vh - 64px));background:#fff;border-radius:14px;box-shadow:0 24px 60px rgba(0,0,0,.25);display:flex;flex-direction:column;font-family:var(--font);color:var(--t1);overflow:hidden;}

.afm-head{display:flex;align-items:flex-start;gap:12px;padding:18px 20px 14px;border-bottom:1px solid var(--border);}
.afm-head-l{display:flex;align-items:flex-start;gap:12px;flex:1;min-width:0;}
.afm-thumb{width:80px;height:48px;object-fit:cover;border-radius:6px;flex-shrink:0;}
.afm-thumb-empty{background:var(--bg2);}
.afm-head-meta{flex:1;min-width:0;}
.afm-head-meta h3{font-family:var(--serif);font-size:17px;font-weight:600;letter-spacing:-.3px;color:var(--t1);margin:0;line-height:1.3;}
.afm-co{font-size:12px;color:var(--t3);margin-top:2px;}
.afm-close{margin-left:auto;background:none;border:none;color:var(--t3);cursor:pointer;width:28px;height:28px;display:grid;place-items:center;font-size:22px;border-radius:5px;flex-shrink:0;}
.afm-close:hover{background:var(--bg2);color:var(--t1);}

.afm-counts{display:flex;gap:14px;padding:14px 20px;border-bottom:1px solid var(--border);background:var(--bg);font-variant-numeric:tabular-nums;}
.afm-count{display:inline-flex;align-items:center;gap:4px;font-size:13px;font-weight:700;}
.afm-count.up{color:#15803d;}
.afm-count.down{color:#b91c1c;}
.afm-count.total{margin-left:auto;color:var(--t3);font-weight:500;font-size:12px;}

.afm-body{flex:1;overflow-y:auto;padding:14px 20px 20px;display:flex;flex-direction:column;gap:10px;}
.afm-empty{padding:28px 16px;text-align:center;color:var(--t3);font-size:12.5px;}
.afm-empty-h{font-family:var(--serif);font-size:15px;font-weight:600;color:var(--t1);margin-bottom:4px;}
.afm-empty-sub{font-size:12px;color:var(--t3);margin:0;line-height:1.5;}
.afm-silent{font-size:11.5px;color:var(--t3);font-style:italic;padding:2px 4px;}

.afm-comment{padding:12px 14px;border-radius:9px;background:var(--bg);}
.afm-comment.up{background:#f0fdf4;}
.afm-comment.down{background:#fef2f2;}
.afm-comment-head{display:flex;align-items:center;gap:8px;flex-wrap:wrap;}
.afm-pill{display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;border-radius:50%;font-size:13px;}
.afm-pill.up{background:#dcfce7;}
.afm-pill.down{background:#fee2e2;}
.afm-user{font-size:11.5px;font-weight:600;color:var(--t2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:280px;}
.afm-when{font-size:11px;color:var(--t4);margin-left:auto;}
.afm-text{font-size:13px;color:var(--t1);line-height:1.55;margin-top:6px;}
`;
