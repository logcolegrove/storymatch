"use client";

// In-context asset rating modal. Triggered from the 3-dot menu on
// every card and list row so reps + admins can leave feedback without
// navigating to the dedicated Feedback page.
//
// Flow:
//   1. Open modal — fetch the caller's existing vote (if any) so the
//      controls pre-fill. Show a loading shimmer briefly.
//   2. User picks thumbs-up / thumbs-down OR writes a comment (either
//      alone is enough — comment-only is supported).
//   3. Submit POSTs to /api/feedback. On success the modal flips to a
//      thank-you confirmation for ~1.5s, then auto-closes.
//   4. If the user already has a vote, Remove rating DELETEs and closes
//      with a "Rating removed" toast (no thank-you screen).
//
// Attribution: admins see who left each comment + rating (email). This
// is intentional — admins need to follow up with the rep who flagged
// the issue. The modal communicates this by tagging the surface as
// "internal feedback" up front; no anonymity promise is made.

import { useEffect, useState } from "react";

type Rating = "up" | "down";

interface AssetSlim {
  id: string;
  headline: string;
  company: string;
  clientName: string;
  thumbnail: string;
  vertical: string;
}

interface Props {
  asset: AssetSlim | null; // null = closed
  authHeaders: () => Promise<HeadersInit>;
  onClose: () => void;
  // Optional hook fired after a successful save so the parent can
  // refresh dashboard aggregates (e.g. the Feedback view). Not awaited.
  onSaved?: () => void;
}

type Phase = "loading" | "form" | "saving" | "thanks" | "error";

export default function RateAssetModal({ asset, authHeaders, onClose, onSaved }: Props) {
  const [phase, setPhase] = useState<Phase>("loading");
  const [rating, setRating] = useState<Rating | null>(null);
  const [comment, setComment] = useState("");
  const [hasExistingVote, setHasExistingVote] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Hydrate from the current vote on mount. Keep this in its own
  // effect so re-opening the same asset re-reads server state (admin
  // could have rated, closed, reopened — we want the fresh value).
  useEffect(() => {
    if (!asset) return;
    let cancelled = false;
    setPhase("loading");
    setRating(null);
    setComment("");
    setHasExistingVote(false);
    setErrorMsg(null);
    (async () => {
      try {
        const headers = await authHeaders();
        const r = await fetch(`/api/feedback?asset_id=${encodeURIComponent(asset.id)}`, { headers });
        if (!r.ok) throw new Error("Couldn't load feedback");
        const data = (await r.json()) as { myVote: { rating: Rating; comment: string | null } | null };
        if (cancelled) return;
        if (data.myVote) {
          setRating(data.myVote.rating);
          setComment(data.myVote.comment || "");
          setHasExistingVote(true);
        }
        setPhase("form");
      } catch (e) {
        console.error("[RateAssetModal] load failed", e);
        if (!cancelled) {
          setErrorMsg((e as Error).message || "Couldn't load");
          setPhase("error");
        }
      }
    })();
    return () => { cancelled = true; };
  }, [asset, authHeaders]);

  // Close on Escape — same affordance as the other modals.
  useEffect(() => {
    if (!asset) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [asset, onClose]);

  if (!asset) return null;

  // Comment-only submissions are allowed — either a rating or a
  // non-empty comment is sufficient. Both blank still bails (the
  // submit button is also disabled in that state).
  const trimmedComment = comment.trim();
  const canSubmit = !!rating || trimmedComment.length > 0;

  const submit = async () => {
    if (!canSubmit) return;
    setPhase("saving");
    try {
      const headers: HeadersInit = { "Content-Type": "application/json", ...(await authHeaders()) };
      const r = await fetch("/api/feedback", {
        method: "POST",
        headers,
        body: JSON.stringify({
          asset_id: asset.id,
          // null when no thumb is picked — server accepts comment-only.
          rating: rating ?? null,
          comment: trimmedComment ? trimmedComment.slice(0, 500) : null,
        }),
      });
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        throw new Error(body.error || "Couldn't save");
      }
      onSaved?.();
      setPhase("thanks");
      // Brief celebration before auto-closing. Long enough to read,
      // short enough not to feel like the modal is stuck.
      setTimeout(() => onClose(), 1500);
    } catch (e) {
      console.error("[RateAssetModal] submit failed", e);
      setErrorMsg((e as Error).message || "Couldn't save");
      setPhase("error");
    }
  };

  const removeRating = async () => {
    setPhase("saving");
    try {
      const headers = await authHeaders();
      const r = await fetch(`/api/feedback?asset_id=${encodeURIComponent(asset.id)}`, {
        method: "DELETE",
        headers,
      });
      if (!r.ok) throw new Error("Couldn't remove rating");
      onSaved?.();
      onClose();
    } catch (e) {
      console.error("[RateAssetModal] remove failed", e);
      setErrorMsg((e as Error).message || "Couldn't remove");
      setPhase("error");
    }
  };

  return (
    <div className="ram-backdrop" onClick={onClose}>
      <style>{css}</style>
      <div className="ram-modal" onClick={e => e.stopPropagation()}>
        {phase === "thanks" ? (
          <div className="ram-thanks">
            <div className="ram-check">
              <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="12" cy="12" r="11"/>
                <polyline points="7 12.5 10.5 16 17 9"/>
              </svg>
            </div>
            <div className="ram-thanks-title">Thanks for your feedback</div>
            <div className="ram-thanks-sub">Your rating helps the team find the right story for the right prospect.</div>
          </div>
        ) : (
          <>
            <div className="ram-head">
              <div className="ram-thumb">
                {asset.thumbnail
                  ? <img src={asset.thumbnail} alt=""/>
                  : <div className="ram-thumb-placeholder">{asset.company?.[0] || "?"}</div>}
              </div>
              <div className="ram-head-text">
                <div className="ram-co-row">
                  <span className="ram-co">{asset.company || "—"}</span>
                  {/* Internal-only badge — sits next to the company
                      tag so it's the first thing a rep sees when the
                      modal opens. Makes it obvious this feedback
                      stays on the team and never reaches the
                      customer or asset subject. */}
                  <span className="ram-internal-badge" title="Internal feedback — your team only">
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <rect x="3" y="11" width="18" height="11" rx="2"/>
                      <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                    </svg>
                    Internal
                  </span>
                </div>
                <div className="ram-title">{asset.headline || "(no headline)"}</div>
                <div className="ram-meta">{asset.vertical || "—"} · {asset.clientName || "anonymous"}</div>
              </div>
              <button className="ram-close" onClick={onClose} aria-label="Close" title="Close (Esc)">×</button>
            </div>

            <div className="ram-body">
              <div className="ram-section-label">{hasExistingVote ? "Update your rating" : "Rate this asset"} <span className="ram-optional">(optional)</span></div>
              <div className="ram-thumbs">
                <button
                  type="button"
                  className={`ram-thumb-btn ${rating === "up" ? "active up" : ""}`}
                  onClick={() => setRating("up")}
                  disabled={phase === "saving" || phase === "loading"}
                  aria-label="Thumbs up"
                  title="Thumbs up"
                >
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M7 11v9H4a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1h3z"/>
                    <path d="M7 11l4-7a2 2 0 0 1 4 .8V9h4.4a2 2 0 0 1 1.97 2.35l-1.5 7A2 2 0 0 1 18 20H7"/>
                  </svg>
                </button>
                <button
                  type="button"
                  className={`ram-thumb-btn ${rating === "down" ? "active down" : ""}`}
                  onClick={() => setRating("down")}
                  disabled={phase === "saving" || phase === "loading"}
                  aria-label="Thumbs down"
                  title="Thumbs down"
                >
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M17 13V4h3a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1h-3z"/>
                    <path d="M17 13l-4 7a2 2 0 0 1-4-.8V15H4.6a2 2 0 0 1-1.97-2.35l1.5-7A2 2 0 0 1 6 4h11"/>
                  </svg>
                </button>
              </div>

              <div className="ram-section-label" style={{ marginTop: 18 }}>Comment <span className="ram-optional">(optional)</span></div>
              <textarea
                className="ram-comment"
                placeholder="Anything you want the team to know? (e.g. 'killed it with healthcare prospects' or 'client churned — pull this')"
                value={comment}
                maxLength={500}
                onChange={e => setComment(e.target.value)}
                disabled={phase === "saving" || phase === "loading"}
              />
              <div className="ram-char-count">{comment.length} / 500</div>

              {phase === "error" && errorMsg && (
                <div className="ram-error">{errorMsg}</div>
              )}
            </div>

            <div className="ram-foot">
              {hasExistingVote && (
                <button
                  type="button"
                  className="ram-remove"
                  onClick={removeRating}
                  disabled={phase === "saving" || phase === "loading"}
                >Remove my rating</button>
              )}
              <div style={{ flex: 1 }}/>
              <button type="button" className="ram-cancel" onClick={onClose} disabled={phase === "saving"}>Cancel</button>
              <button
                type="button"
                className="ram-submit"
                onClick={submit}
                disabled={!canSubmit || phase === "saving" || phase === "loading"}
              >
                {phase === "saving" ? "Saving…" : hasExistingVote ? "Update" : "Submit"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

const css = `
.ram-backdrop{position:fixed;inset:0;background:rgba(20,20,25,.55);backdrop-filter:blur(2px);display:grid;place-items:center;z-index:200;animation:ramFade .15s ease;}
@keyframes ramFade{from{opacity:0}to{opacity:1}}
.ram-modal{width:480px;max-width:calc(100vw - 32px);background:#fff;border-radius:14px;box-shadow:0 20px 48px rgba(0,0,0,.22), 0 6px 16px rgba(0,0,0,.08);overflow:hidden;animation:ramScale .18s cubic-bezier(.2,.7,.3,1);font-family:var(--font);color:var(--t1);}
@keyframes ramScale{from{transform:scale(.96);opacity:0}to{transform:scale(1);opacity:1}}

.ram-head{display:flex;gap:12px;align-items:flex-start;padding:18px 20px;border-bottom:1px solid var(--border);background:var(--bg);}
.ram-thumb{width:80px;height:54px;flex-shrink:0;border-radius:7px;overflow:hidden;background:var(--bg2);}
.ram-thumb img{width:100%;height:100%;object-fit:cover;}
.ram-thumb-placeholder{width:100%;height:100%;display:grid;place-items:center;font-family:var(--serif);font-size:22px;color:var(--t3);background:var(--bg2);}
.ram-head-text{flex:1;min-width:0;}
.ram-co-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap;}
.ram-co{font-size:11px;text-transform:uppercase;letter-spacing:.6px;color:var(--t3);font-weight:700;}
.ram-internal-badge{display:inline-flex;align-items:center;gap:4px;padding:2px 7px;border-radius:99px;background:color-mix(in srgb, var(--accent) 12%, transparent);color:var(--accent);font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;}
.ram-title{font-size:14.5px;font-weight:600;color:var(--t1);margin-top:2px;line-height:1.35;overflow:hidden;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;}
.ram-meta{font-size:11.5px;color:var(--t3);margin-top:4px;}
.ram-close{background:none;border:none;color:var(--t3);font-size:22px;line-height:1;cursor:pointer;padding:0 4px;width:28px;height:28px;display:grid;place-items:center;border-radius:6px;flex-shrink:0;}
.ram-close:hover{background:var(--bg2);color:var(--t1);}

.ram-body{padding:20px;display:flex;flex-direction:column;}
.ram-section-label{font-size:10.5px;text-transform:uppercase;letter-spacing:.6px;color:var(--t3);font-weight:700;margin-bottom:8px;}
.ram-optional{text-transform:none;letter-spacing:0;color:var(--t4);font-weight:500;}
.ram-thumbs{display:grid;grid-template-columns:1fr 1fr;gap:10px;}
.ram-thumb-btn{display:flex;align-items:center;justify-content:center;padding:22px 12px;border-radius:10px;border:1.5px solid var(--border);background:#fff;color:var(--t2);cursor:pointer;font-family:var(--font);transition:all .15s;}
.ram-thumb-btn:hover:not(:disabled){border-color:var(--border2);color:var(--t1);transform:translateY(-1px);}
.ram-thumb-btn:disabled{opacity:.5;cursor:not-allowed;}
.ram-thumb-btn.active.up{background:#dcfce7;border-color:#22c55e;color:#15803d;}
.ram-thumb-btn.active.down{background:#fee2e2;border-color:#ef4444;color:#b91c1c;}

.ram-comment{width:100%;min-height:80px;padding:10px 12px;font-family:var(--font);font-size:13px;border:1px solid var(--border);border-radius:8px;background:var(--bg);color:var(--t1);resize:vertical;line-height:1.5;}
.ram-comment:focus{outline:none;border-color:var(--accent);background:#fff;}
.ram-comment:disabled{opacity:.6;}
.ram-char-count{font-size:10.5px;color:var(--t4);text-align:right;margin-top:4px;}
.ram-error{font-size:12.5px;color:#b91c1c;background:#fef2f2;border:1px solid #fecaca;padding:8px 10px;border-radius:7px;margin-top:12px;}

.ram-foot{display:flex;align-items:center;gap:8px;padding:14px 20px;border-top:1px solid var(--border);background:var(--bg);}
.ram-remove{background:none;border:none;color:var(--t3);font-family:var(--font);font-size:12px;font-weight:600;cursor:pointer;padding:6px 10px;border-radius:6px;}
.ram-remove:hover:not(:disabled){background:#fee2e2;color:#b91c1c;}
.ram-remove:disabled{opacity:.4;cursor:not-allowed;}
.ram-cancel{padding:8px 14px;border:1px solid var(--border);border-radius:7px;background:#fff;color:var(--t2);font-family:var(--font);font-size:12.5px;font-weight:600;cursor:pointer;}
.ram-cancel:hover:not(:disabled){border-color:var(--border2);color:var(--t1);}
.ram-cancel:disabled{opacity:.4;cursor:not-allowed;}
.ram-submit{padding:8px 18px;border:none;border-radius:7px;background:var(--accent);color:#fff;font-family:var(--font);font-size:12.5px;font-weight:600;cursor:pointer;}
.ram-submit:hover:not(:disabled){background:var(--accent2);}
.ram-submit:disabled{opacity:.4;cursor:not-allowed;}

.ram-thanks{padding:48px 32px;display:flex;flex-direction:column;align-items:center;text-align:center;gap:12px;}
.ram-check{color:#22c55e;animation:ramPop .35s cubic-bezier(.2,.8,.3,1.2);}
@keyframes ramPop{0%{transform:scale(.4);opacity:0}60%{transform:scale(1.1);opacity:1}100%{transform:scale(1)}}
.ram-thanks-title{font-family:var(--serif);font-size:22px;font-weight:600;color:var(--t1);margin-top:8px;letter-spacing:-.2px;}
.ram-thanks-sub{font-size:13.5px;color:var(--t3);line-height:1.5;max-width:340px;}
`;
