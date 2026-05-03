// FeaturedQuoteRotator — hero rotator that interrupts the Library
// grid. Replaces the old 4-up "Featured quotes" mosaic with a single
// rotating quote that always feels live. Pulls from /api/quotes
// ?featured=true and cycles through the curated set.
//
// Visual design lifted from the Claude Design handoff (StoryMatch
// Featured Quote.html): two-column 1.55fr + 1fr inside a 14-radius
// card. Left column carries the pastel wash + giant italic quote;
// right column carries monogram pagination + attribution + a 3-state
// CTA (video / case study / static review-platform).
//
// Behaviour:
//   • Auto-advances every 7s; hover pauses (mouse) and prefers-
//     reduced-motion freezes auto-advance entirely.
//   • Click any monogram to jump; ←/→ when the rotator is focused.
//   • Cross-fades the quote text on swap (450ms ease) and transitions
//     the wash colour over 600ms.

"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

// ── Types — kept narrow to what the rotator needs. The /api/quotes
//    response is wider; we only consume the curation + display
//    fields here. ─────────────────────────────────────────────────
export interface FeaturedQuote {
  id: string;
  text: string;
  attrName: string | null;
  attrTitle: string | null;
  attrOrg: string | null;
  initialsOverride: string | null;
  kind: "video" | "case" | "static";
  // For asset-attached quotes — we'll populate this client-side from
  // the asset list in StoryMatchApp before passing in.
  assetId: string | null;
  assetVideoUrl?: string | null;
  assetHeadline?: string | null;
  // Static-only — populated for review-platform quotes.
  staticSource: string | null;
  staticUrl: string | null;
  stars: number | null;
  // Curation
  washToken: string | null;
}

interface Props {
  quotes: FeaturedQuote[];
  // Click handler for the CTA — receives the quote so the parent
  // can route to the right place (asset detail, external review URL,
  // etc.). Static quotes with no URL pass null and the parent should
  // no-op (the CTA label already says "via Trustpilot" in that case).
  onCtaClick?: (q: FeaturedQuote) => void;
  // Admin-only: opens the rotation curation panel. When provided, a
  // small gear button appears in the rotator's top-right.
  onCurate?: () => void;
}

// ── Wash palette ─────────────────────────────────────────────────
// Mirrors the tokens defined for the small quote cards. Keeping
// values inline avoids depending on the parent's CSS variables (the
// rotator is a self-contained component).
type WashName = "rose" | "sage" | "sand" | "lavender" | "cream" | "mist";
const WASHES: Record<WashName, { bg: string; ink: string; glyph: string }> = {
  rose:     { bg: "#f3e3d9", ink: "#3a2a22", glyph: "#A5563A" },
  sage:     { bg: "#e7ece1", ink: "#2a3a2c", glyph: "#5a7a5e" },
  sand:     { bg: "#f1e8d2", ink: "#3d2f12", glyph: "#9a7c2a" },
  lavender: { bg: "#ebe6ef", ink: "#2e2640", glyph: "#6a5a90" },
  cream:    { bg: "#f5efe2", ink: "#3a2f1a", glyph: "#9a7228" },
  mist:     { bg: "#e6ecf0", ink: "#1c2c3a", glyph: "#3e6a8a" },
};
const WASH_ORDER: WashName[] = ["rose", "sage", "sand", "lavender", "cream", "mist"];

function washForQuote(q: FeaturedQuote): WashName {
  if (q.washToken && q.washToken in WASHES) return q.washToken as WashName;
  // Deterministic round-robin fallback by hashing the id.
  let h = 0;
  for (let i = 0; i < q.id.length; i++) h = (h * 31 + q.id.charCodeAt(i)) | 0;
  return WASH_ORDER[Math.abs(h) % WASH_ORDER.length];
}

function initialsFor(q: FeaturedQuote): string {
  if (q.initialsOverride && q.initialsOverride.trim()) return q.initialsOverride.toUpperCase();
  const parts = (q.attrName || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "·";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

// Optical-size bucket by character count. Matches the design spec.
function sizeBucket(text: string): "default" | "medium" | "long" {
  const n = text.length;
  if (n > 140) return "long";
  if (n > 60) return "medium";
  return "default";
}

// Static-source label for the "★★★★★ on Trustpilot" CTA caption.
const STATIC_LABELS: Record<string, string> = {
  trustpilot: "Trustpilot",
  g2: "G2",
  google: "Google Reviews",
  linkedin: "LinkedIn",
  capterra: "Capterra",
  manual: "",
  other: "",
};

export default function FeaturedQuoteRotator({ quotes, onCtaClick, onCurate }: Props) {
  const [active, setActive] = useState(0);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const [reduceMotion, setReduceMotion] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Detect prefers-reduced-motion. When set, we skip auto-advance
  // entirely and disable the cross-fade animation.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => setReduceMotion(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  // Auto-advance every 7s. Reset whenever active changes (manual jump
  // restarts the timer so the user gets a full beat to read).
  const tick = useCallback(() => {
    setActive(i => (i + 1) % Math.max(quotes.length, 1));
  }, [quotes.length]);

  const startTimer = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (reduceMotion || quotes.length <= 1) return;
    timerRef.current = setInterval(tick, 7000);
  }, [tick, reduceMotion, quotes.length]);

  const stopTimer = useCallback(() => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
  }, []);

  useEffect(() => {
    startTimer();
    return stopTimer;
  }, [active, startTimer, stopTimer]);

  // Cross-fade the quote text on swap. Skipped when reduced motion.
  useEffect(() => {
    if (reduceMotion) return;
    const el = textRef.current;
    if (!el || typeof el.animate !== "function") return;
    el.animate(
      [
        { opacity: 0, transform: "translateY(6px)" },
        { opacity: 1, transform: "translateY(0)" },
      ],
      { duration: 450, easing: "cubic-bezier(.4,0,.2,1)" },
    );
  }, [active, reduceMotion]);

  // Keyboard nav when the rotator is focused.
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (quotes.length <= 1) return;
    if (e.key === "ArrowRight") {
      e.preventDefault();
      setActive(i => (i + 1) % quotes.length);
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      setActive(i => (i - 1 + quotes.length) % quotes.length);
    }
  };

  if (quotes.length === 0) return null;

  const q = quotes[active] || quotes[0];
  const wash = WASHES[washForQuote(q)];
  const bucket = sizeBucket(q.text);
  const counter = `${String(active + 1).padStart(2, "0")} / ${String(quotes.length).padStart(2, "0")}`;
  const hoverName = hoverIdx != null && hoverIdx !== active ? `→ ${quotes[hoverIdx].attrName || ""}` : " ";

  return (
    <>
      <style>{css}</style>
      <div className="fqr-eye">
        <span>Featured quote · {counter}</span>
        {onCurate && (
          <button type="button" className="fqr-curate" onClick={onCurate} title="Manage featured quotes">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
            <span>Manage rotation</span>
          </button>
        )}
      </div>
      <div
        className="fqr-hero"
        ref={containerRef}
        tabIndex={0}
        onMouseEnter={stopTimer}
        onMouseLeave={startTimer}
        onFocus={stopTimer}
        onBlur={startTimer}
        onKeyDown={onKeyDown}
        role="region"
        aria-label="Featured customer quote"
      >
        {/* Left — quote panel, wash + colors set per-quote */}
        <div
          className={`fqr-quote fqr-q-${bucket}`}
          style={{ background: wash.bg }}
        >
          <div className="fqr-glyph" style={{ color: wash.glyph }}>“</div>
          <div className="fqr-text" ref={textRef} style={{ color: wash.ink }}>
            {q.text}
          </div>
        </div>

        {/* Right — pagination + attribution + CTA */}
        <div className="fqr-meta">
          <div>
            <div className="fqr-pager" style={{ gridTemplateColumns: `repeat(${quotes.length}, 1fr)` }}>
              {quotes.map((p, i) => {
                const w = WASHES[washForQuote(p)];
                const on = i === active;
                return (
                  <button
                    key={p.id}
                    type="button"
                    className={`fqr-tile${on ? " on" : ""}`}
                    style={{ background: w.bg, color: w.ink }}
                    onClick={() => setActive(i)}
                    onMouseEnter={() => setHoverIdx(i)}
                    onMouseLeave={() => setHoverIdx(null)}
                    aria-label={`Show quote from ${p.attrName || "unknown"}`}
                    aria-pressed={on}
                  >
                    {initialsFor(p)}
                  </button>
                );
              })}
            </div>
            <div className="fqr-pager-hover">{hoverName}</div>
          </div>

          <div className="fqr-attr">
            <div className="fqr-attr-meta">
              <span>{q.attrTitle || "—"}</span>
              {q.attrOrg && <> <span className="fqr-at">at</span> <span className="fqr-org">{q.attrOrg}</span></>}
            </div>
            <div className="fqr-attr-name">{q.attrName || "—"}</div>
            <div className="fqr-cta">
              {q.kind === "video" && (
                <button type="button" className="fqr-cta-btn" onClick={() => onCtaClick?.(q)}>
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><polygon points="6 4 20 12 6 20"/></svg>
                  <span>Watch review</span>
                </button>
              )}
              {q.kind === "case" && (
                <button type="button" className="fqr-cta-btn" onClick={() => onCtaClick?.(q)}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 4h11l3 3v13H5z"/><path d="M9 9h6M9 13h6M9 17h4"/></svg>
                  <span>Read case study</span>
                </button>
              )}
              {q.kind === "static" && (
                <div className="fqr-cta-static">
                  {q.stars && q.stars > 0 ? (
                    <span className="fqr-stars" aria-label={`${q.stars} of 5 stars`}>
                      {"★".repeat(q.stars)}{"☆".repeat(5 - q.stars)}
                    </span>
                  ) : null}
                  <span>
                    {q.stars ? "on" : "via"} {STATIC_LABELS[q.staticSource || ""] || q.staticSource || "review"}
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

const css = `
.fqr-eye{display:flex;align-items:baseline;justify-content:space-between;font-family:var(--font);font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--t3);font-weight:600;margin:38px 0 14px;}
.fqr-curate{display:inline-flex;align-items:center;gap:6px;background:none;border:1px solid var(--border);color:var(--t3);font-family:var(--font);font-size:11px;font-weight:500;letter-spacing:0;text-transform:none;padding:5px 10px;border-radius:6px;cursor:pointer;transition:all .12s;}
.fqr-curate:hover{border-color:var(--accent);color:var(--accent);}

.fqr-hero{display:grid;grid-template-columns:1.55fr 1fr;border-radius:14px;overflow:hidden;border:1px solid rgba(0,0,0,.06);background:#fff;box-shadow:0 1px 2px rgba(0,0,0,.04);position:relative;outline:none;margin-bottom:42px;}
.fqr-hero:focus-visible{box-shadow:0 0 0 3px rgba(109,40,217,.25),0 1px 2px rgba(0,0,0,.04);}

/* Left — quote panel. Wash background transitions over 600ms so the
   colour change reads as a deliberate beat on auto-advance. */
.fqr-quote{position:relative;aspect-ratio:16/9;padding:54px 60px;display:flex;align-items:center;transition:background .6s ease;}
.fqr-glyph{font-family:var(--serif);font-style:italic;font-weight:400;font-size:140px;line-height:.6;margin-right:24px;align-self:flex-start;margin-top:12px;flex-shrink:0;transition:color .6s ease;}
.fqr-text{font-family:var(--serif);font-style:italic;font-weight:400;font-size:34px;line-height:1.18;letter-spacing:-.005em;text-wrap:pretty;max-width:22ch;transition:color .6s ease;}
/* Optical-size buckets by character count */
.fqr-q-medium .fqr-text{font-size:26px;line-height:1.22;}
.fqr-q-long   .fqr-text{font-size:20px;line-height:1.4;}

/* Right — pagination + attribution + CTA */
.fqr-meta{display:flex;flex-direction:column;justify-content:space-between;padding:28px 30px;border-left:1px solid var(--border);background:#fff;}

.fqr-pager{display:grid;gap:6px;}
.fqr-tile{aspect-ratio:1;border-radius:999px;border:1px solid transparent;padding:0;cursor:pointer;font-family:var(--serif);font-style:italic;font-weight:500;font-size:13px;letter-spacing:-.02em;transition:transform .15s ease,border-color .25s ease;}
.fqr-tile:hover{transform:translateY(-2px);}
.fqr-tile.on{border-color:var(--accent);transform:none;}
.fqr-pager-hover{height:14px;margin-top:8px;font-family:var(--font);font-size:10px;letter-spacing:.16em;text-transform:uppercase;color:var(--t4);}

.fqr-attr{margin-top:8px;}
.fqr-attr-meta{font-size:13px;color:var(--t2);letter-spacing:.005em;margin-bottom:6px;}
.fqr-attr-meta .fqr-at{color:var(--t4);}
.fqr-attr-meta .fqr-org{color:var(--t1);font-weight:600;}
.fqr-attr-name{font-family:var(--font);font-size:24px;font-weight:600;line-height:1.2;letter-spacing:-.012em;}

.fqr-cta{margin-top:18px;display:flex;align-items:center;}
.fqr-cta-btn{display:inline-flex;align-items:center;gap:10px;padding:10px 16px;border-radius:999px;border:none;background:var(--accent);color:#fff;cursor:pointer;font-family:var(--font);font-size:13.5px;font-weight:500;letter-spacing:-.005em;transition:background .12s;}
.fqr-cta-btn:hover{background:var(--accent2);}
.fqr-cta-static{display:inline-flex;align-items:baseline;gap:8px;padding:11px 0;font-family:var(--font);font-size:11.5px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--t3);}
.fqr-stars{color:var(--t1);letter-spacing:.04em;font-size:12px;}

/* Responsive — collapse to single column at narrow widths so the
   rotator doesn't squish. */
@media (max-width:900px){
  .fqr-hero{grid-template-columns:1fr;}
  .fqr-meta{border-left:none;border-top:1px solid var(--border);}
  .fqr-quote{padding:36px 30px;aspect-ratio:auto;}
  .fqr-glyph{font-size:96px;margin-right:18px;}
  .fqr-q-default .fqr-text{font-size:24px;}
  .fqr-q-medium .fqr-text{font-size:20px;}
  .fqr-q-long .fqr-text{font-size:17px;}
}
`;
