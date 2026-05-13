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
  rank: number;
  thumbnail: string | null;
  title: string;
  metaParts: string[];
  isVideo: boolean;
  durationLabel?: string;        // "2:14" for videos
  readLabel?: string;            // "6 min" for case studies
  reasoning: string;             // may contain **bold** markdown
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

// Mirrors the server-side weights in /api/storymatch/route.ts.
// Displayed in the popover so admins can see how each factor
// contributes to the overall percent.
const FACTOR_WEIGHTS = {
  orgSimilarity: 45,
  painPoints: 35,
  quoteMatch: 20,
} as const;

function tierClass(score: number): "strong" | "good" | "weak" {
  if (score >= 80) return "strong";
  if (score >= 65) return "good";
  return "weak";
}
function barColor(score: number): string {
  if (score >= 75) return "#1D9E75";   // green
  if (score >= 55) return "#EF9F27";   // amber
  return "#F0997B";                    // coral (weakest)
}

export default function StoryMatchCard(props: StoryMatchCardProps) {
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [popoverPos, setPopoverPos] = useState<{ top: number; right: number } | null>(null);
  const badgeRef = useRef<HTMLButtonElement | null>(null);
  const {
    rank, thumbnail, title, metaParts, isVideo, durationLabel, readLabel,
    reasoning, factorScores, lowestFactorNote, talkingPoints = [], quotes = [],
    relevanceScore, onOpen, onShare, onCopySummary, onCopyQuote,
  } = props;

  const matchTier = tierClass(relevanceScore);

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
          {/* Match badge — tier-coloured, click to toggle popover.
              The popover renders via portal (below) so it escapes
              the card's overflow:hidden and never gets clipped. */}
          <button
            ref={badgeRef}
            type="button"
            className={`smc-match smc-match-${matchTier}`}
            onClick={(e) => { e.stopPropagation(); setPopoverOpen(o => !o); }}
            onMouseEnter={() => setPopoverOpen(true)}
            onMouseLeave={() => setPopoverOpen(false)}
            aria-label={`Match score ${relevanceScore} percent — click for breakdown`}
          >
            <span className="smc-match-num">{relevanceScore}%</span>
            <span>match</span>
          </button>
          {popoverOpen && factorScores && popoverPos && typeof document !== "undefined" && createPortal(
            <div
              className="smc-pop"
              style={{ position: "fixed", top: popoverPos.top, right: popoverPos.right }}
              onMouseEnter={() => setPopoverOpen(true)}
              onMouseLeave={() => setPopoverOpen(false)}
              onClick={e => e.stopPropagation()}
            >
              <div className="smc-pop-title">Why {relevanceScore}%</div>
              <PopRow label="Org similarity" weight={FACTOR_WEIGHTS.orgSimilarity} score={factorScores.orgSimilarity}/>
              <PopRow label="Pain points addressed" weight={FACTOR_WEIGHTS.painPoints} score={factorScores.painPoints}/>
              <PopRow label="Specific quote match" weight={FACTOR_WEIGHTS.quoteMatch} score={factorScores.quoteMatch}/>
              {lowestFactorNote && <div className="smc-pop-note">{lowestFactorNote}</div>}
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
            {onShare && <button type="button" className="smc-foot-btn" onClick={onShare}>Share</button>}
            {onCopySummary && <button type="button" className="smc-foot-btn" onClick={onCopySummary}>Copy summary</button>}
          </div>
        </div>
      </article>
    </>
  );
}

function PopRow({ label, weight, score }: { label: string; weight: number; score: number }) {
  return (
    <div className="smc-pop-factor">
      <div className="smc-pop-head">
        <span className="smc-pop-name">{label}</span>
        <span className="smc-pop-weight">{weight}% weight</span>
        <span className="smc-pop-score">{score}</span>
      </div>
      <div className="smc-pop-bar">
        <div className="smc-pop-bar-fill" style={{ width: `${score}%`, background: barColor(score) }}/>
      </div>
    </div>
  );
}

const css = `
.smc{position:relative;background:#fff;border:1px solid var(--border);border-radius:16px;overflow:hidden;transition:box-shadow .35s cubic-bezier(.4,0,.2,1),border-color .2s;display:flex;flex-direction:column;}
.smc:hover{box-shadow:0 22px 50px rgba(0,0,0,.09);border-color:var(--border2);}

.smc-thumb{position:relative;width:100%;aspect-ratio:16/9;overflow:hidden;background:var(--bg3);cursor:pointer;}
.smc-thumb img{width:100%;height:100%;object-fit:cover;transition:transform .5s cubic-bezier(.2,.8,.2,1),filter .35s ease;filter:brightness(.97);}
.smc:hover .smc-thumb img{transform:scale(1.04);filter:brightness(1.02);}
.smc-thumb-fallback{width:100%;height:100%;display:flex;align-items:center;justify-content:center;color:var(--t4);}
.smc-thumb-badge{position:absolute;bottom:11px;right:11px;background:rgba(20,20,28,.55);color:rgba(255,255,255,.94);font-size:11px;padding:4px 8px;border-radius:5px;font-weight:500;display:inline-flex;align-items:center;gap:4px;backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);letter-spacing:.01em;font-family:var(--font);}

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
   viewport space so it escapes any parent overflow clipping. */
.smc-pop{width:320px;background:#fff;border:1px solid var(--border);border-radius:12px;box-shadow:0 20px 50px rgba(0,0,0,.16);padding:18px 20px;z-index:1000;font-family:var(--font);}
.smc-pop-title{font-size:10.5px;letter-spacing:.1em;text-transform:uppercase;color:var(--t3);font-weight:700;margin-bottom:14px;}
.smc-pop-factor{margin-bottom:14px;}
.smc-pop-factor:last-child{margin-bottom:0;}
.smc-pop-head{display:flex;align-items:baseline;justify-content:space-between;gap:8px;margin-bottom:6px;}
.smc-pop-name{font-size:12.5px;color:var(--t1);font-weight:600;letter-spacing:-.005em;}
.smc-pop-weight{font-size:10.5px;color:var(--t4);font-weight:500;font-variant-numeric:tabular-nums;margin-left:auto;}
.smc-pop-score{font-size:12.5px;color:var(--t1);font-weight:600;font-variant-numeric:tabular-nums;letter-spacing:-.01em;min-width:24px;text-align:right;}
.smc-pop-bar{height:6px;background:var(--bg2);border-radius:99px;overflow:hidden;}
.smc-pop-bar-fill{height:100%;border-radius:99px;transition:width .25s ease;}
.smc-pop-note{margin-top:14px;padding-top:12px;border-top:1px solid var(--bg2);font-size:11.5px;color:var(--t3);line-height:1.55;}
`;
