// StoryMatchCard — the rich result card shown when StoryMatch AI
// search is active. Replaces the simple TCard/QCard overlay with a
// fully-structured layout:
//
//   • Big match badge with hover-popover showing factor breakdown
//   • Why-this-match prose (1-2 sentences, **bold** rendered as
//     accent chips)
//   • Talking points (paraphrased claims with topic headers)
//   • Quotes (verbatim italic serif, copy-on-hover)
//   • Footer with View full story link + Share / Copy summary
//
// Spec finalised in storymatch-results-mockup.html v6.

"use client";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export interface StoryMatchCardProps {
  assetId: string;
  rank: number;
  thumbnail: string | null;
  title: string;
  metaParts: string[];
  isVideo: boolean;
  durationLabel?: string;        // "2:14" for videos
  readLabel?: string;            // "6 min" for case studies
  reasoning: string;             // may contain **bold** markdown
  // factorScores stays in the type for back-compat with the API,
  // but the popover no longer renders the breakdown — it shows the
  // reasoning prose + "things to watch out for" instead. Kept on
  // the type so callers don't need to change shape.
  factorScores?: {
    orgSimilarity: number;
    painPoints: number;
    quoteMatch: number;
  };
  lowestFactorNote?: string;
  talkingPoints?: { topic: string; text: string }[];
  quotes?: string[];
  relevanceScore: number;
  onOpen?: () => void;
  onShare?: () => void;
  onCopySummary?: () => void;
  onCopyQuote?: (q: string) => void;
  // Auth bridge for the inline rating control. Without this the
  // thumbs render as disabled — the card stays useful in
  // non-authenticated contexts (mockups, screenshots).
  authHeaders?: () => Promise<HeadersInit>;
}

// Renders text with **bold** markdown as accent chips. Splits the
// string by **...** pairs and wraps the bold parts in a span.
function renderWithChips(text: string): React.ReactNode {
  const parts: React.ReactNode[] = [];
  const regex = /\*\*([^*]+)\*\*/g;
  let lastIdx = 0;
  let m: RegExpExecArray | null;
  let key = 0;
  while ((m = regex.exec(text)) !== null) {
    if (m.index > lastIdx) parts.push(text.slice(lastIdx, m.index));
    parts.push(<strong key={`b${key++}`}>{m[1]}</strong>);
    lastIdx = regex.lastIndex;
  }
  if (lastIdx < text.length) parts.push(text.slice(lastIdx));
  return parts.length > 0 ? parts : text;
}

function tierClass(score: number): "strong" | "good" | "weak" {
  if (score >= 80) return "strong";
  if (score >= 65) return "good";
  return "weak";
}

type Rating = "up" | "down";

export default function StoryMatchCard(props: StoryMatchCardProps) {
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [popoverPos, setPopoverPos] = useState<{ top: number; right: number } | null>(null);
  const badgeRef = useRef<HTMLButtonElement | null>(null);
  const {
    assetId, rank, thumbnail, title, metaParts, isVideo, durationLabel, readLabel,
    reasoning, lowestFactorNote, talkingPoints = [], quotes = [],
    relevanceScore, onOpen, onShare, onCopySummary, onCopyQuote, authHeaders,
  } = props;

  const matchTier = tierClass(relevanceScore);

  // Inline rating state. Fetched once on mount via the same
  // /api/feedback endpoint the modal uses. Clicking a thumb saves
  // immediately; clicking the active thumb a second time clears the
  // vote. We deliberately don't surface a comment field on the card
  // itself — comments live in the modal, reachable from the asset's
  // 3-dot menu in the library. Inline thumbs are about quick
  // signal capture while reps are evaluating matches.
  const [myRating, setMyRating] = useState<Rating | null>(null);
  const [voteSaving, setVoteSaving] = useState(false);
  const [voteFlash, setVoteFlash] = useState(false);

  useEffect(() => {
    if (!authHeaders || !assetId) return;
    let cancelled = false;
    (async () => {
      try {
        const headers = await authHeaders();
        const r = await fetch(`/api/feedback?asset_id=${encodeURIComponent(assetId)}`, { headers });
        if (!r.ok) return;
        const data = (await r.json()) as { myVote: { rating: Rating } | null };
        if (cancelled) return;
        if (data.myVote) setMyRating(data.myVote.rating);
      } catch { /* non-fatal */ }
    })();
    return () => { cancelled = true; };
  }, [assetId, authHeaders]);

  const toggleRating = async (next: Rating) => {
    if (!authHeaders || !assetId || voteSaving) return;
    const prev = myRating;
    const willClear = prev === next;
    // Optimistic local update.
    setMyRating(willClear ? null : next);
    setVoteSaving(true);
    try {
      const headers: HeadersInit = { "Content-Type": "application/json", ...(await authHeaders()) };
      if (willClear) {
        const r = await fetch(`/api/feedback?asset_id=${encodeURIComponent(assetId)}`, {
          method: "DELETE",
          headers,
        });
        if (!r.ok) throw new Error("delete failed");
      } else {
        const r = await fetch(`/api/feedback`, {
          method: "POST",
          headers,
          body: JSON.stringify({ asset_id: assetId, rating: next }),
        });
        if (!r.ok) throw new Error("save failed");
      }
      // Brief flash to confirm save without a full toast.
      setVoteFlash(true);
      setTimeout(() => setVoteFlash(false), 600);
    } catch (e) {
      console.error("[StoryMatchCard] vote save failed", e);
      // Roll back.
      setMyRating(prev);
    } finally {
      setVoteSaving(false);
    }
  };

  // Position the popover via portal in viewport space, anchored just
  // under the badge. Recompute on scroll/resize so it follows.
  useEffect(() => {
    if (!popoverOpen) { setPopoverPos(null); return; }
    const update = () => {
      const el = badgeRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      setPopoverPos({
        top: r.bottom + 8,
        right: window.innerWidth - r.right,
      });
    };
    update();
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [popoverOpen]);

  return (
    <>
      <style>{css}</style>
      <article className="smc">
        <div className="smc-thumb" onClick={onOpen} role={onOpen ? "button" : undefined}>
          {thumbnail ? (
            <img src={thumbnail} alt={title} loading="lazy"/>
          ) : (
            <div className="smc-thumb-fallback">
              <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
            </div>
          )}
          <div className="smc-rank">{rank}</div>
          {/* Share link icon — fades in on card hover, top-right.
              Same affordance as the library cards. Stacked to the
              LEFT of the match badge so neither obscures the other. */}
          {onShare && (
            <button
              type="button"
              className="smc-share"
              onClick={(e) => { e.stopPropagation(); onShare(); }}
              title="Copy share link"
              aria-label="Copy share link"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
                <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
              </svg>
            </button>
          )}
          {/* Match badge — tier-coloured, click to toggle popover.
              The popover renders via portal (below) so it escapes
              the card's overflow:hidden and never gets clipped.
              Content is no longer a factor breakdown — instead it
              mirrors the "why + what's different" frame the rest of
              the card uses, which is closer to how real search
              engines explain rankings (semantic, not numeric). */}
          <button
            ref={badgeRef}
            type="button"
            className={`smc-match smc-match-${matchTier}`}
            onClick={(e) => { e.stopPropagation(); setPopoverOpen(o => !o); }}
            onMouseEnter={() => setPopoverOpen(true)}
            onMouseLeave={() => setPopoverOpen(false)}
            aria-label={`Match score ${relevanceScore} percent`}
          >
            <span className="smc-match-num">{relevanceScore}%</span>
            <span>match</span>
          </button>
          {popoverOpen && popoverPos && typeof document !== "undefined" && createPortal(
            <div
              className="smc-pop"
              style={{ position: "fixed", top: popoverPos.top, right: popoverPos.right }}
              onMouseEnter={() => setPopoverOpen(true)}
              onMouseLeave={() => setPopoverOpen(false)}
              onClick={e => e.stopPropagation()}
            >
              <div className="smc-pop-title">{relevanceScore}% match</div>
              {reasoning && (
                <div className="smc-pop-section">
                  <div className="smc-pop-section-h">Why this matches</div>
                  <p className="smc-pop-text">{renderWithChips(reasoning)}</p>
                </div>
              )}
              {lowestFactorNote && (
                <div className="smc-pop-section smc-pop-section-diff">
                  <div className="smc-pop-section-h">Things to watch out for</div>
                  <p className="smc-pop-text">{lowestFactorNote}</p>
                </div>
              )}
            </div>,
            document.body,
          )}
          {(durationLabel || readLabel) && (
            <div className="smc-thumb-badge">
              {isVideo ? (
                <>
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><polygon points="6 4 20 12 6 20"/></svg>
                  Watch · {durationLabel}
                </>
              ) : (
                <>
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                  Read · {readLabel}
                </>
              )}
            </div>
          )}
        </div>

        <div className="smc-body">
          <h3 className="smc-title" onClick={onOpen} role={onOpen ? "button" : undefined}>{title || "Untitled"}</h3>
          {metaParts.length > 0 && (
            <p className="smc-meta">
              {metaParts.map((p, i) => (
                <span key={i}>{i > 0 ? <span className="smc-dot"/> : null}<span>{p}</span></span>
              ))}
            </p>
          )}

          {reasoning && (
            <div className="smc-sec">
              <div className="smc-sec-h">Why this is a match</div>
              <p className="smc-why">{renderWithChips(reasoning)}</p>
            </div>
          )}

          {talkingPoints.length > 0 && (
            <div className="smc-sec">
              <div className="smc-sec-h">Talking points <span className="smc-sec-num">{talkingPoints.length}</span></div>
              {talkingPoints.map((tp, i) => (
                <div key={i} className="smc-tp">
                  <div className="smc-tp-topic">{tp.topic}</div>
                  <p className="smc-tp-text">{tp.text}</p>
                </div>
              ))}
            </div>
          )}

          {quotes.length > 0 && (
            <div className="smc-sec">
              <div className="smc-sec-h">Quotes <span className="smc-sec-num">{quotes.length}</span></div>
              {quotes.map((q, i) => (
                <div key={i} className="smc-quote">
                  <p className="smc-quote-text">"{q}"</p>
                  <button
                    type="button"
                    className="smc-quote-copy"
                    onClick={() => onCopyQuote?.(q)}
                    title="Copy quote"
                    aria-label="Copy quote"
                  >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="smc-foot">
          <button type="button" className="smc-foot-link" onClick={onOpen}>
            View full story <span className="smc-arr">→</span>
          </button>
          <div className="smc-foot-actions">
            {/* Inline thumbs — quick rating capture without leaving
                the card. Saves directly on click; brief flash on
                successful save. Comments live in the rate-this-asset
                modal reachable from the library 3-dot menu. */}
            {authHeaders && assetId && (
              <div className={`smc-rate${voteFlash ? " flash" : ""}`}>
                <button
                  type="button"
                  className={`smc-rate-btn ${myRating === "up" ? "active up" : ""}`}
                  onClick={() => toggleRating("up")}
                  disabled={voteSaving}
                  title={myRating === "up" ? "Remove your thumbs-up" : "Thumbs up"}
                  aria-label={myRating === "up" ? "Remove your thumbs-up" : "Thumbs up"}
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M7 11v9H4a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1h3z"/>
                    <path d="M7 11l4-7a2 2 0 0 1 4 .8V9h4.4a2 2 0 0 1 1.97 2.35l-1.5 7A2 2 0 0 1 18 20H7"/>
                  </svg>
                </button>
                <button
                  type="button"
                  className={`smc-rate-btn ${myRating === "down" ? "active down" : ""}`}
                  onClick={() => toggleRating("down")}
                  disabled={voteSaving}
                  title={myRating === "down" ? "Remove your thumbs-down" : "Thumbs down"}
                  aria-label={myRating === "down" ? "Remove your thumbs-down" : "Thumbs down"}
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M17 13V4h3a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1h-3z"/>
                    <path d="M17 13l-4 7a2 2 0 0 1-4-.8V15H4.6a2 2 0 0 1-1.97-2.35l1.5-7A2 2 0 0 1 6 4h11"/>
                  </svg>
                </button>
              </div>
            )}
            {onCopySummary && <button type="button" className="smc-foot-btn" onClick={onCopySummary}>Copy summary</button>}
          </div>
        </div>
      </article>
    </>
  );
}

// (PopRow + barColor removed in the popover redesign — the popover
// now shows reasoning prose + "things to watch out for" instead of
// a numeric factor breakdown.)

const css = `
.smc{position:relative;background:#fff;border:1px solid var(--border);border-radius:16px;overflow:hidden;transition:box-shadow .35s cubic-bezier(.4,0,.2,1),border-color .2s;display:flex;flex-direction:column;}
.smc:hover{box-shadow:0 22px 50px rgba(0,0,0,.09);border-color:var(--border2);}

.smc-thumb{position:relative;width:100%;aspect-ratio:16/9;overflow:hidden;background:var(--bg3);cursor:pointer;}
.smc-thumb img{width:100%;height:100%;object-fit:cover;transition:transform .5s cubic-bezier(.2,.8,.2,1),filter .35s ease;filter:brightness(.97);}
.smc:hover .smc-thumb img{transform:scale(1.04);filter:brightness(1.02);}
.smc-thumb-fallback{width:100%;height:100%;display:flex;align-items:center;justify-content:center;color:var(--t4);}
.smc-thumb-badge{position:absolute;bottom:11px;right:11px;background:rgba(20,20,28,.55);color:rgba(255,255,255,.94);font-size:11px;padding:4px 8px;border-radius:5px;font-weight:500;display:inline-flex;align-items:center;gap:4px;backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);letter-spacing:.01em;font-family:var(--font);}

.smc-share{position:absolute;top:14px;right:108px;display:grid;place-items:center;width:32px;height:32px;border-radius:99px;background:#fff;border:1px solid var(--border);color:var(--t2);cursor:pointer;box-shadow:0 6px 18px rgba(0,0,0,.12);opacity:0;transform:translateX(6px);transition:opacity .15s,transform .15s,color .12s,border-color .12s;padding:0;}
.smc:hover .smc-share{opacity:1;transform:translateX(0);}
.smc-share:hover{color:var(--accent);border-color:var(--accent);}
.smc-match{position:absolute;top:14px;right:14px;display:inline-flex;align-items:center;gap:6px;padding:7px 13px 7px 11px;border-radius:99px;background:#fff;border:1px solid var(--border);font-family:var(--font);font-size:13.5px;font-weight:600;cursor:help;box-shadow:0 6px 18px rgba(0,0,0,.12);letter-spacing:-.005em;}
.smc-match-num{font-variant-numeric:tabular-nums;letter-spacing:-.015em;}
.smc-match-strong{color:#0F6E56;background:#E1F5EE;border-color:#9FE1CB;}
.smc-match-good{color:#854F0B;background:#FAEEDA;border-color:#FAC775;}
.smc-match-weak{color:var(--t3);background:#fff;}

.smc-rank{position:absolute;top:14px;left:14px;width:28px;height:28px;border-radius:50%;background:var(--accent);color:#fff;font-size:12px;font-weight:700;display:grid;place-items:center;box-shadow:0 4px 12px rgba(109,40,217,.32);font-family:var(--font);}

.smc-body{padding:28px 30px 24px;flex:1;}
.smc-title{font-family:var(--font);font-size:21px;font-weight:600;color:var(--t1);line-height:1.28;letter-spacing:-.018em;margin:0 0 6px;cursor:pointer;}
.smc-title:hover{color:var(--accent);}
.smc-meta{font-size:12.5px;color:var(--t3);margin:0 0 22px;display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-family:var(--font);}
.smc-meta > span{display:inline-flex;align-items:center;gap:8px;}
.smc-dot{width:3px;height:3px;border-radius:50%;background:var(--t4);display:inline-block;}

.smc-sec{padding-top:18px;margin-top:18px;border-top:1px solid var(--bg2);}
.smc-sec:first-of-type{padding-top:0;margin-top:0;border-top:none;}
.smc-sec-h{font-size:10.5px;letter-spacing:.1em;text-transform:uppercase;color:var(--t3);font-weight:700;margin:0 0 12px;display:flex;align-items:baseline;gap:7px;font-family:var(--font);}
.smc-sec-num{display:inline-flex;align-items:center;justify-content:center;min-width:18px;height:17px;padding:0 6px;border-radius:9px;background:transparent;color:var(--t4);font-size:10px;font-weight:700;letter-spacing:0;border:1px solid var(--border);}

.smc-why{font-family:var(--font);font-size:15px;font-weight:400;line-height:1.55;color:var(--t1);margin:0;letter-spacing:-.005em;}
.smc-why strong{font-weight:600;color:var(--accent);background:var(--accentLL);padding:1px 7px;border-radius:4px;font-size:13.5px;letter-spacing:0;}

/* Talking points — cool/clean styling. */
.smc-tp{padding:14px 18px;background:#f8f8fb;border:1px solid var(--bg2);border-radius:10px;margin-bottom:8px;transition:background .15s,border-color .15s,transform .15s;position:relative;}
.smc-tp:last-child{margin-bottom:0;}
.smc-tp:hover{background:var(--accentLL);border-color:var(--accentL);transform:translateX(2px);}
.smc-tp-topic{font-size:11px;font-weight:700;color:var(--accent);text-transform:uppercase;letter-spacing:.08em;margin:0 0 5px;font-family:var(--font);}
.smc-tp-text{font-family:var(--font);font-size:14.5px;line-height:1.5;color:var(--t1);margin:0;letter-spacing:-.005em;}

/* Quotes — italic serif, copy on hover. */
.smc-quote{position:relative;padding:10px 36px 10px 16px;border-left:2px solid var(--accentL);margin-bottom:10px;border-radius:0 6px 6px 0;transition:background .12s;}
.smc-quote:last-child{margin-bottom:0;}
.smc-quote:hover{background:var(--accentLL);}
.smc-quote-text{font-family:var(--serif);font-style:italic;font-size:15.5px;line-height:1.5;color:var(--t2);margin:0;letter-spacing:-.005em;}
.smc-quote:hover .smc-quote-text{color:var(--t1);}
.smc-quote-copy{position:absolute;top:50%;right:8px;transform:translateY(-50%);width:28px;height:28px;border-radius:6px;background:#fff;border:1px solid var(--border);color:var(--t3);display:grid;place-items:center;cursor:pointer;opacity:0;transition:opacity .15s,color .12s,border-color .12s;}
.smc-quote:hover .smc-quote-copy{opacity:1;}
.smc-quote-copy:hover{color:var(--accent);border-color:var(--accent);}

.smc-foot{padding:16px 30px;border-top:1px solid var(--bg2);background:#fcfcfb;display:flex;align-items:center;justify-content:space-between;}
.smc-foot-link{background:none;border:none;cursor:pointer;font-size:13px;font-weight:600;color:var(--accent);display:inline-flex;align-items:center;gap:5px;letter-spacing:-.005em;font-family:var(--font);padding:0;}
.smc-foot-link:hover{color:var(--accent2);}
.smc-arr{transition:transform .15s;display:inline-block;}
.smc-foot-link:hover .smc-arr{transform:translateX(2px);}
.smc-foot-actions{display:flex;gap:4px;}
.smc-foot-btn{background:none;border:none;color:var(--t3);font-family:var(--font);font-size:12px;font-weight:500;padding:6px 10px;border-radius:6px;cursor:pointer;transition:all .12s;letter-spacing:-.005em;}
.smc-foot-btn:hover{background:var(--bg2);color:var(--t1);}

/* Match-badge popover — rendered via portal, position:fixed in
   viewport space so it escapes any parent overflow clipping.
   Content is prose-first: a tight "why this matches" summary plus
   a "things to watch out for" callout. Replaces the old factor
   breakdown which mirrored numbers the LLM made up anyway. */
.smc-pop{width:340px;background:#fff;border:1px solid var(--border);border-radius:12px;box-shadow:0 20px 50px rgba(0,0,0,.16);padding:18px 20px;z-index:1000;font-family:var(--font);}
.smc-pop-title{font-size:10.5px;letter-spacing:.1em;text-transform:uppercase;color:var(--t3);font-weight:700;margin-bottom:14px;}
.smc-pop-section{margin-bottom:14px;}
.smc-pop-section:last-child{margin-bottom:0;}
.smc-pop-section-h{font-size:10.5px;letter-spacing:.08em;text-transform:uppercase;color:var(--t3);font-weight:700;margin-bottom:6px;}
.smc-pop-section-diff .smc-pop-section-h{color:#854F0B;}
.smc-pop-text{margin:0;font-size:13px;color:var(--t1);line-height:1.55;letter-spacing:-.005em;}
.smc-pop-text strong{font-weight:600;color:var(--accent);background:var(--accentLL);padding:1px 6px;border-radius:4px;font-size:12px;letter-spacing:0;}
.smc-pop-section-diff{padding:10px 12px;background:#FDF6EA;border-radius:8px;border-left:2px solid #EF9F27;}
.smc-pop-section-diff .smc-pop-text{color:var(--t2);font-size:12.5px;}

/* Inline thumbs in the card footer. Small enough not to compete
   with the primary "View full story" link, but obvious enough to
   invite the quick rating. Active state mirrors the modal: green
   for up, red for down. A brief flash class confirms saves
   without a full toast. */
.smc-rate{display:inline-flex;align-items:center;gap:2px;padding:2px;border-radius:8px;transition:background .2s;}
.smc-rate.flash{background:#E1F5EE;}
.smc-rate-btn{display:grid;place-items:center;width:30px;height:30px;border-radius:6px;border:1px solid transparent;background:transparent;color:var(--t3);cursor:pointer;transition:all .12s;}
.smc-rate-btn:hover:not(:disabled){border-color:var(--border);color:var(--t1);background:#fff;}
.smc-rate-btn:disabled{opacity:.5;cursor:not-allowed;}
.smc-rate-btn.active.up{background:#dcfce7;border-color:#86efac;color:#15803d;}
.smc-rate-btn.active.down{background:#fee2e2;border-color:#fca5a5;color:#b91c1c;}
`;
