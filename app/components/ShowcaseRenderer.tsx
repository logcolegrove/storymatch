"use client";

// ShowcaseRenderer — walks a Template (JSON spec) and renders each
// block via its registered React component. This is the seam
// between the data layer (resolved showcase + assets) and the
// presentation layer (block components).
//
// All blocks are co-located in this file for v1 — they're each
// modest and share styling concerns. If the block library grows
// past ~10 entries, splitting into app/components/showcase-blocks/
// becomes worthwhile.
//
// Block registry pattern: BLOCK_RENDERERS maps each block type to
// its React component. Adding a new block means:
//   1. Define the block + props in lib/showcase-templates.ts
//   2. Build a {Block}Block component below
//   3. Register it in BLOCK_RENDERERS
// The renderer stays a 5-line iteration regardless of how many
// blocks exist.

import { useEffect, useState } from "react";
import type {
  TemplateBlock,
  Template,
  HeroBlockProps,
  AssetGridBlockProps,
  QuoteRotatorBlockProps,
  IntroTextBlockProps,
  DividerBlockProps,
  FooterBlockProps,
} from "@/lib/showcase-templates";

// ── Shared types ──────────────────────────────────────────────────

export interface ShowcaseContext {
  showcase: { id: string; name: string; description: string | null };
  assets: ShowcaseRenderAsset[];
  // Click handler for asset cards — parent decides whether to
  // open a modal, navigate to a sub-route, etc.
  onAssetClick: (assetId: string) => void;
  // Optional drag-reorder kickoff. Provided ONLY in editor preview
  // contexts (ShowcaseBuilder). When absent, asset cards aren't
  // draggable — public visitors can't reorder anything. The
  // handler receives the card's index + the pointer event so the
  // host can set up its own move/up listeners.
  onAssetReorderBegin?: (idx: number, e: React.PointerEvent) => void;
  // Live drag state, provided by the editor host while a drag is
  // in flight. Drives the library-style "magic rearrange": the
  // dragged card translates with the cursor and the other cards
  // animate to slot positions reflecting the new order. Absent
  // when no drag is active OR on public render paths.
  cardDrag?: {
    fromIdx: number;
    insertIdx: number;
    // Pointer-delta from drag start. Applied to the dragged card
    // as a translate so it follows the cursor 1:1.
    pointerDx: number;
    pointerDy: number;
    // Original positions of every card at drag start (viewport
    // coords). Used to compute dx/dy for non-dragged cards as
    // they shift into their new positions.
    rects: { left: number; top: number }[];
    // Whether pointer movement crossed the engagement threshold.
    // When false, we render no transforms (single click intent).
    engaged: boolean;
  };
  // Admin-only edit affordance. When set, each rendered block gets
  // wrapped in a hover-revealed "Edit block" overlay so admins can
  // jump straight from the live preview to that block's settings.
  // Public showcase renders never pass this so visitors don't see
  // the overlay. Receives the block index in template.blocks.
  onEditBlock?: (blockIdx: number) => void;
}

export interface ShowcaseRenderAsset {
  id: string;
  headline: string;
  pull_quote: string;
  client_name: string;
  company: string;
  thumbnail: string;
  // Drives the Watch / Read frosted badge — matches the library
  // grid card so showcase tiles feel exactly like internal tiles.
  asset_type: string;
  duration_seconds: number | null;
}

interface BlockProps<T> {
  props: T;
  ctx: ShowcaseContext;
}

// ── HeroBlock ─────────────────────────────────────────────────────
// Title + optional subtitle. Pulls from showcase data by default;
// templates can override with a literal string to hard-code copy.
function HeroBlock({ props, ctx }: BlockProps<HeroBlockProps>) {
  const title = props.titleSource === "literal" && props.titleText
    ? props.titleText
    : ctx.showcase.name;
  const subtitle = (() => {
    if (props.subtitleSource === "none") return null;
    if (props.subtitleSource === "literal" && props.subtitleText) return props.subtitleText;
    return ctx.showcase.description || null;
  })();
  const align = props.align || "center";
  const padding = props.padding || "comfortable";
  return (
    <header className={`sr-hero sr-hero-${padding} sr-hero-${align}`}>
      <h1>{title}</h1>
      {subtitle && <p className="sr-hero-sub">{subtitle}</p>}
    </header>
  );
}

// ── AssetGridBlock ────────────────────────────────────────────────
// Showcase tiles mirror the library grid card 1:1 — transparent
// wrapper, 16:9 thumbnail with rounded corners + soft shadow that
// lifts dramatically on hover, image scales + brightens, a frosted
// Watch/Read badge in the thumb's bottom-right, headline below.
// Company name + pull quote stay hidden by default (matching the
// library's grid defaults) but the block props expose toggles so
// admins can opt them back in per-showcase.
//
// clickTarget=newpage → wrap in a real <a target="_blank"> so the
// browser handles middle-click + cmd-click natively. clickTarget=
// modal keeps the button semantics + calls back into the page's
// state to render AssetDetail inline.
function AssetGridBlock({ props, ctx }: BlockProps<AssetGridBlockProps>) {
  const cols = props.columns || 3;
  const aspect = props.aspect || "16/9";
  const target = props.clickTarget || "modal";
  if (ctx.assets.length === 0) {
    return (
      <div className="sr-empty">
        <p>This showcase has no assets to display right now.</p>
      </div>
    );
  }
  // Drag-handler factory — provided by the showcase context when
  // the renderer is mounted in editor preview mode. When absent
  // (public showcase pages), cards aren't draggable.
  const buildPointerDown = (idx: number) => ctx.onAssetReorderBegin
    ? (e: React.PointerEvent) => ctx.onAssetReorderBegin!(idx, e)
    : undefined;
  const drag = ctx.cardDrag;
  // shiftFor: when card N is being dragged toward position M,
  // every card between them shifts one slot toward the gap so
  // the grid visually rearranges. Mirrors the library helper.
  const shiftFor = (idx: number, fromIdx: number, insertIdx: number): number => {
    if (idx === fromIdx) return insertIdx;
    if (fromIdx < insertIdx) {
      if (idx > fromIdx && idx <= insertIdx) return idx - 1;
    } else {
      if (idx >= insertIdx && idx < fromIdx) return idx + 1;
    }
    return idx;
  };
  return (
    <div className={`sr-grid sr-grid-cols-${cols}`}>
      {ctx.assets.map((a, i) => {
        const isV = a.asset_type === "Video Testimonial";
        // Per-card drag transform. The dragged card translates by
        // pointer delta; non-dragged cards translate from their
        // original rect to the rect at their *new* index, giving
        // the magic-rearrange feel.
        let dragStyle: React.CSSProperties | undefined;
        if (drag && drag.engaged) {
          if (i === drag.fromIdx) {
            dragStyle = {
              transform: `translate(${drag.pointerDx}px, ${drag.pointerDy}px)`,
              transition: "none",
              zIndex: 10,
              pointerEvents: "none",
            };
          } else {
            const newIdx = shiftFor(i, drag.fromIdx, drag.insertIdx);
            if (newIdx !== i) {
              const oldR = drag.rects[i];
              const newR = drag.rects[newIdx];
              if (oldR && newR) {
                dragStyle = {
                  transform: `translate(${newR.left - oldR.left}px, ${newR.top - oldR.top}px)`,
                  transition: "transform 0.18s cubic-bezier(0.4, 0, 0.2, 1)",
                };
              }
            } else {
              dragStyle = { transition: "transform 0.18s cubic-bezier(0.4, 0, 0.2, 1)" };
            }
          }
        }
        const inner = (
          <>
            <div className="sr-card-thumb" style={{aspectRatio:aspect}}>
              {a.thumbnail
                ? <img src={a.thumbnail} alt="" loading="lazy"/>
                : <div className="sr-card-thumb-empty"/>}
              <div className="sr-card-badge">
                {isV ? (
                  <>
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><polygon points="6 4 20 12 6 20"/></svg>
                    <span>Watch{a.duration_seconds ? ` · ${formatDuration(a.duration_seconds)}` : ""}</span>
                  </>
                ) : (
                  <>
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                    <span>Read</span>
                  </>
                )}
              </div>
            </div>
            <div className="sr-card-body">
              {props.showCompany === true && (
                <div className="sr-card-eyebrow">{a.company || a.client_name}</div>
              )}
              <h3 className="sr-card-headline">{a.headline || "Customer story"}</h3>
              {props.showQuote === true && a.pull_quote && (
                <p className="sr-card-quote">&ldquo;{a.pull_quote}&rdquo;</p>
              )}
            </div>
          </>
        );
        if (target === "newpage") {
          return (
            <a
              key={a.id}
              className="sr-card"
              href={`/asset/${a.id}`}
              target="_blank"
              rel="noopener noreferrer"
              title={a.headline}
              data-asset-idx={i}
              onPointerDown={buildPointerDown(i)}
              style={dragStyle}
            >
              {inner}
            </a>
          );
        }
        return (
          <div
            key={a.id}
            className="sr-card"
            onClick={() => ctx.onAssetClick(a.id)}
            title={a.headline}
            role="button"
            tabIndex={0}
            data-asset-idx={i}
            onPointerDown={buildPointerDown(i)}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); ctx.onAssetClick(a.id); } }}
            style={dragStyle}
          >
            {inner}
          </div>
        );
      })}
    </div>
  );
}

// Short Watch-badge duration formatter — mirrors the library's
// formatDuration so showcase badges read the same way ("4m 12s").
function formatDuration(secs: number): string {
  if (secs < 60) return `${secs}s`;
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}m ${s}s`;
}

// ── QuoteRotatorBlock ─────────────────────────────────────────────
// Pulls each asset's pull_quote into a rotating band. Auto-advances
// every N seconds with a cross-fade. No nav controls in v1 — a
// quieter, ambient version of the bigger FeaturedQuoteRotator. The
// data source defaults to the showcase's own assets so the rotator
// always reflects the curated selection.
function QuoteRotatorBlock({ props, ctx }: BlockProps<QuoteRotatorBlockProps>) {
  const intervalMs = Math.max(2000, (props.intervalSec ?? 6) * 1000);
  const size = props.size || "full";
  // Filter to assets that actually have a pull quote — silent
  // assets shouldn't take a turn in the rotation.
  const quotes = ctx.assets
    .filter(a => a.pull_quote && a.pull_quote.trim().length > 0)
    .map(a => ({ id: a.id, text: a.pull_quote, attr: a.client_name, org: a.company }));

  const [idx, setIdx] = useState(0);
  const [fadingOut, setFadingOut] = useState(false);

  useEffect(() => {
    if (quotes.length <= 1) return;
    const t = setInterval(() => {
      setFadingOut(true);
      window.setTimeout(() => {
        setIdx(prev => (prev + 1) % quotes.length);
        setFadingOut(false);
      }, 400);
    }, intervalMs);
    return () => clearInterval(t);
  }, [intervalMs, quotes.length]);

  if (quotes.length === 0) return null;
  const q = quotes[Math.min(idx, quotes.length - 1)];
  return (
    <section className={`sr-rotator sr-rotator-${size}`}>
      <div className={`sr-rotator-inner${fadingOut ? " fading" : ""}`}>
        <div className="sr-rotator-mark">&ldquo;</div>
        <blockquote className="sr-rotator-text">{q.text}</blockquote>
        <div className="sr-rotator-attr">
          {q.attr && <span className="sr-rotator-attr-name">{q.attr}</span>}
          {q.org && <span className="sr-rotator-attr-org">{q.org}</span>}
        </div>
      </div>
      {quotes.length > 1 && (
        <div className="sr-rotator-dots">
          {quotes.map((_, i) => (
            <span key={i} className={`sr-rotator-dot${i === idx ? " on" : ""}`}/>
          ))}
        </div>
      )}
    </section>
  );
}

// ── IntroTextBlock ────────────────────────────────────────────────
// Plain prose. v1 splits on blank lines into paragraphs — no
// Markdown. The block is text-only; templates can stack hero +
// intro-text + grid for a more editorial feel.
function IntroTextBlock({ props }: BlockProps<IntroTextBlockProps>) {
  const paragraphs = props.content.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);
  const align = props.align || "left";
  return (
    <section className={`sr-intro sr-intro-${align}`}>
      {paragraphs.map((p, i) => <p key={i}>{p}</p>)}
    </section>
  );
}

// ── DividerBlock ──────────────────────────────────────────────────
function DividerBlock({ props }: BlockProps<DividerBlockProps>) {
  const sp = props.spacing || "normal";
  return <hr className={`sr-divider sr-divider-${sp}`}/>;
}

// ── FooterBlock (deprecated) ──────────────────────────────────────
// As of B4.0 the "Shared via StoryMatch" attribution is gone. The
// block type stays in the DSL so legacy showcases that already
// reference it don't fail validation — they just render an empty
// spacer in its place. New built-in templates no longer include
// the block, and the block picker in the builder filters it out.
// The props are kept on the type for the same reason (legacy
// templateConfig blobs would otherwise fail the shape check).
function FooterBlock(_props: BlockProps<FooterBlockProps>) {
  void _props;
  return <div className="sr-footer-spacer" aria-hidden/>;
}

// ── Block registry ────────────────────────────────────────────────
// Discriminated dispatch: given a block, pick the right renderer.
// Each renderer narrows the props through its own type via the
// discriminator union.
function renderBlock(block: TemplateBlock, ctx: ShowcaseContext, key: number) {
  switch (block.type) {
    case "hero":          return <HeroBlock          key={key} props={block.props} ctx={ctx}/>;
    case "asset-grid":    return <AssetGridBlock     key={key} props={block.props} ctx={ctx}/>;
    case "quote-rotator": return <QuoteRotatorBlock  key={key} props={block.props} ctx={ctx}/>;
    case "intro-text":    return <IntroTextBlock     key={key} props={block.props} ctx={ctx}/>;
    case "divider":       return <DividerBlock       key={key} props={block.props} ctx={ctx}/>;
    case "footer":        return <FooterBlock        key={key} props={block.props} ctx={ctx}/>;
    // No default needed — exhaustive over the discriminated union.
  }
}

// ── ShowcaseRenderer ──────────────────────────────────────────────
interface Props {
  template: Template;
  context: ShowcaseContext;
}

export default function ShowcaseRenderer({ template, context }: Props) {
  const editable = !!context.onEditBlock;
  return (
    <div className="sr">
      <style>{css}</style>
      {template.blocks.map((b, i) => {
        const rendered = renderBlock(b, context, i);
        if (!editable) return rendered;
        // Wrap each block in a hover-revealed "Edit block" overlay.
        // Visible only when context.onEditBlock is provided (i.e.
        // the builder preview path) — public showcase pages render
        // the block bare. Label uses the block-type label table so
        // admins know exactly what they'll be editing.
        return (
          <div key={`edit-${i}`} className="sr-edit-wrap">
            {rendered}
            <button
              type="button"
              className="sr-edit-btn"
              onClick={(e) => { e.stopPropagation(); context.onEditBlock?.(i); }}
              title={`Edit ${blockTypeLabel(b.type)} settings`}
              aria-label={`Edit ${blockTypeLabel(b.type)} block`}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M12 20h9"/>
                <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>
              </svg>
              Edit {blockTypeLabel(b.type)}
            </button>
          </div>
        );
      })}
    </div>
  );
}

// Friendly labels for the edit overlay. Kept here (not imported) so
// the renderer stays self-contained; matches the labels used in the
// builder's block list.
function blockTypeLabel(type: TemplateBlock["type"]): string {
  switch (type) {
    case "hero": return "hero";
    case "asset-grid": return "asset grid";
    case "quote-rotator": return "quote rotator";
    case "intro-text": return "intro text";
    case "divider": return "divider";
    case "footer": return "footer";
  }
}

// ── Styles ────────────────────────────────────────────────────────
// All blocks share a single CSS context so spacing + typography
// stay consistent. CSS variables are inherited from the page-level
// root that wraps the renderer (see ShowcasePageClient).
const css = `
.sr{display:flex;flex-direction:column;}

/* Builder-only edit affordance. Each block sits inside an sr-edit-
   wrap that shows a dashed outline + floating Edit button on hover.
   Public render paths skip the wrap entirely so visitors never see
   the chrome. */
.sr-edit-wrap{position:relative;}
.sr-edit-wrap::after{content:"";position:absolute;inset:0;border:2px dashed transparent;border-radius:8px;pointer-events:none;transition:border-color .12s;}
.sr-edit-wrap:hover::after{border-color:color-mix(in srgb, var(--accent) 55%, transparent);}
.sr-edit-btn{position:absolute;top:10px;right:10px;display:inline-flex;align-items:center;gap:6px;padding:6px 11px;background:#1c1c1c;color:#fff;border:none;border-radius:7px;font-family:var(--font);font-size:12px;font-weight:600;cursor:pointer;opacity:0;transform:translateY(-2px);transition:opacity .15s, transform .15s, background .15s;z-index:5;box-shadow:0 6px 18px rgba(0,0,0,.22);}
.sr-edit-wrap:hover .sr-edit-btn{opacity:1;transform:translateY(0);}
.sr-edit-btn:hover{background:var(--accent);}

/* Hero */
.sr-hero{max-width:1100px;margin:0 auto;padding:64px 32px 32px;}
.sr-hero-compact{padding:36px 32px 24px;}
.sr-hero-spacious{padding:96px 32px 48px;}
.sr-hero-center{text-align:center;}
.sr-hero-left{text-align:left;}
.sr-hero h1{font-family:var(--serif);font-size:44px;font-weight:600;letter-spacing:-1px;color:var(--t1);margin:0;line-height:1.1;}
.sr-hero-sub{font-size:16px;color:var(--t2);margin:14px auto 0;line-height:1.6;max-width:680px;}
.sr-hero-left .sr-hero-sub{margin-left:0;margin-right:0;}

/* Asset grid */
/* Grid + card styling lifted verbatim from the library grid so
   the showcase tiles look and feel identical to internal tiles.
   Transparent card wrapper (no border, no panel), 16:9 thumb with
   rounded corners + soft shadow that grows dramatically on hover,
   image scales 1.045x with brightness lift, frosted Watch/Read
   badge in the bottom-right corner. Title sits below the thumb
   on the page background — no card frame to interrupt. */
.sr-grid{max-width:1100px;margin:0 auto;padding:0 32px 32px;display:grid;gap:28px 24px;}
.sr-grid-cols-2{grid-template-columns:repeat(2, 1fr);}
.sr-grid-cols-3{grid-template-columns:repeat(auto-fill, minmax(300px, 1fr));}
.sr-grid-cols-4{grid-template-columns:repeat(auto-fill, minmax(260px, 1fr));}
.sr-card{position:relative;display:flex;flex-direction:column;background:transparent;cursor:pointer;font:inherit;color:inherit;text-decoration:none;-webkit-tap-highlight-color:transparent;}
.sr-card-thumb{position:relative;width:100%;aspect-ratio:16/9;overflow:hidden;background:var(--bg3);border-radius:14px;box-shadow:0 1px 2px rgba(0,0,0,.04);transition:box-shadow .4s cubic-bezier(.4,0,.2,1);}
.sr-card:hover .sr-card-thumb{box-shadow:0 18px 44px rgba(0,0,0,.13),0 6px 14px rgba(0,0,0,.06);}
.sr-card-thumb img{width:100%;height:100%;object-fit:cover;display:block;transition:transform .7s cubic-bezier(.2,.8,.2,1),filter .35s ease;filter:brightness(.97);}
.sr-card:hover .sr-card-thumb img{transform:scale(1.045);filter:brightness(1.03);}
.sr-card-thumb-empty{width:100%;height:100%;background:linear-gradient(135deg,var(--bg2),var(--bg3));}
/* Frosted Watch/Read badge in the bottom-right corner of the
   thumb — identical to the library card so format is signaled
   at glance-scale on every surface. */
.sr-card-badge{position:absolute;bottom:8px;right:8px;background:rgba(20,20,28,.55);color:rgba(255,255,255,.94);font-size:10.5px;padding:3px 7px;border-radius:4px;font-weight:500;display:inline-flex;align-items:center;gap:4px;letter-spacing:.01em;backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);font-family:var(--font);}
.sr-card-body{padding:14px 4px 0;}
.sr-card-eyebrow{font-size:11px;font-weight:700;color:var(--accent);text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px;}
.sr-card-headline{font-size:17px;font-weight:600;letter-spacing:-.012em;color:var(--t1);margin:0;line-height:1.38;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;}
.sr-card-quote{font-size:13px;color:var(--t2);margin:8px 0 0;line-height:1.5;font-style:italic;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;}
/* Drag-state styling — applied by the host when a card is being
   reordered. The dragged card dims; the rest stay normal. Live
   reorder visual feedback comes from the host repositioning the
   array, not from any extra ghost element. */
.sr-card[data-dragging="true"]{opacity:.4;cursor:grabbing;}
.sr-card[data-asset-idx]:hover{cursor:pointer;}

.sr-empty{max-width:560px;margin:64px auto;padding:48px 24px;text-align:center;color:var(--t3);font-size:14px;background:#fff;border:1px dashed var(--border2);border-radius:14px;}

/* Quote rotator */
.sr-rotator{max-width:900px;margin:32px auto;padding:0 32px;}
.sr-rotator-compact{max-width:680px;}
.sr-rotator-inner{background:linear-gradient(135deg, #f5efe2, #ebe6ef);border-radius:18px;padding:48px 56px;position:relative;transition:opacity .4s ease;}
.sr-rotator-inner.fading{opacity:0;}
.sr-rotator-compact .sr-rotator-inner{padding:32px 36px;}
.sr-rotator-mark{position:absolute;top:18px;left:36px;font-family:var(--serif);font-size:80px;line-height:1;color:rgba(110,40,217,.18);user-select:none;}
.sr-rotator-text{font-family:var(--serif);font-size:24px;font-weight:500;font-style:italic;line-height:1.4;color:var(--t1);margin:0;padding-left:8px;}
.sr-rotator-compact .sr-rotator-text{font-size:19px;}
.sr-rotator-attr{margin-top:18px;display:flex;gap:10px;align-items:center;font-size:13px;color:var(--t3);padding-left:8px;}
.sr-rotator-attr-name{font-weight:600;color:var(--t2);}
.sr-rotator-attr-org{color:var(--t3);}
.sr-rotator-attr-org::before{content:"·";margin-right:8px;color:var(--t4);}
.sr-rotator-dots{display:flex;justify-content:center;gap:6px;margin-top:18px;}
.sr-rotator-dot{width:6px;height:6px;border-radius:50%;background:var(--border2);transition:background .2s;}
.sr-rotator-dot.on{background:var(--accent);}

/* Intro text */
.sr-intro{max-width:760px;margin:0 auto;padding:8px 32px 24px;font-family:var(--font);}
.sr-intro p{font-size:15.5px;color:var(--t2);line-height:1.7;margin:0 0 14px;}
.sr-intro p:last-child{margin-bottom:0;}
.sr-intro-center{text-align:center;}
.sr-intro-left{text-align:left;}

/* Divider */
.sr-divider{max-width:900px;margin:0 auto;border:none;border-top:1px solid var(--border);}
.sr-divider-tight{margin-top:8px;margin-bottom:8px;}
.sr-divider-normal{margin-top:24px;margin-bottom:24px;}
.sr-divider-wide{margin-top:48px;margin-bottom:24px;}

/* Footer */
.sr-footer{text-align:center;padding:32px 24px 48px;color:var(--t4);font-size:12px;}
.sr-footer-brand{font-family:var(--serif);font-weight:600;color:var(--accent);}
.sr-footer-spacer{height:48px;}

@media (max-width: 700px) {
  .sr-hero{padding:40px 20px 24px;}
  .sr-hero-spacious{padding:56px 20px 32px;}
  .sr-hero h1{font-size:32px;}
  .sr-grid{padding:0 20px 32px;gap:16px;}
  .sr-grid-cols-2{grid-template-columns:1fr;}
  .sr-grid-cols-3,.sr-grid-cols-4{grid-template-columns:1fr;}
  .sr-rotator-inner{padding:32px 28px;}
  .sr-rotator-text{font-size:18px;}
  .sr-rotator-mark{font-size:60px;left:20px;top:10px;}
}
`;
