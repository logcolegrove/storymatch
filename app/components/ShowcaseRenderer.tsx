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
}

export interface ShowcaseRenderAsset {
  id: string;
  headline: string;
  pull_quote: string;
  client_name: string;
  company: string;
  thumbnail: string;
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
// Renders the showcase's resolved assets as a clickable card grid.
// The clickTarget prop controls whether clicks open AssetDetail
// inline (default) or pop a new tab to the public asset page.
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
  // When target is "newpage", we wrap each card in a real <a> with
  // target="_blank" so the browser opens a new tab natively (and
  // middle-click / Cmd-click work). Modal target keeps the button
  // semantics + calls back into the showcase page's state.
  return (
    <div className={`sr-grid sr-grid-cols-${cols}`}>
      {ctx.assets.map(a => {
        const inner = (
          <>
            {a.thumbnail
              ? <img src={a.thumbnail} alt="" className="sr-card-thumb" style={{aspectRatio:aspect}} loading="lazy"/>
              : <div className="sr-card-thumb sr-card-thumb-empty" style={{aspectRatio:aspect}}/>}
            <div className="sr-card-body">
              {props.showCompany !== false && (
                <div className="sr-card-eyebrow">{a.company || a.client_name}</div>
              )}
              <h3 className="sr-card-headline">{a.headline || "Customer story"}</h3>
              {props.showQuote !== false && a.pull_quote && (
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
            >
              {inner}
            </a>
          );
        }
        return (
          <button
            key={a.id}
            type="button"
            className="sr-card"
            onClick={() => ctx.onAssetClick(a.id)}
            title={a.headline}
          >
            {inner}
          </button>
        );
      })}
    </div>
  );
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

// ── FooterBlock ───────────────────────────────────────────────────
function FooterBlock({ props }: BlockProps<FooterBlockProps>) {
  if (props.showBrand === false) return <div className="sr-footer-spacer"/>;
  return (
    <footer className="sr-footer">
      Shared via <span className="sr-footer-brand">StoryMatch</span>
    </footer>
  );
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
  return (
    <div className="sr">
      <style>{css}</style>
      {template.blocks.map((b, i) => renderBlock(b, context, i))}
    </div>
  );
}

// ── Styles ────────────────────────────────────────────────────────
// All blocks share a single CSS context so spacing + typography
// stay consistent. CSS variables are inherited from the page-level
// root that wraps the renderer (see ShowcasePageClient).
const css = `
.sr{display:flex;flex-direction:column;}

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
.sr-grid{max-width:1100px;margin:0 auto;padding:0 32px 32px;display:grid;gap:24px;}
.sr-grid-cols-2{grid-template-columns:repeat(2, 1fr);}
.sr-grid-cols-3{grid-template-columns:repeat(auto-fill, minmax(300px, 1fr));}
.sr-grid-cols-4{grid-template-columns:repeat(auto-fill, minmax(260px, 1fr));}
.sr-card{display:flex;flex-direction:column;text-align:left;background:#fff;border:1px solid var(--border);border-radius:14px;overflow:hidden;cursor:pointer;font:inherit;color:inherit;padding:0;transition:border-color .12s,box-shadow .15s,transform .15s;text-decoration:none;}
.sr-card:hover{border-color:var(--border2);box-shadow:0 8px 24px rgba(0,0,0,.08);transform:translateY(-1px);}
.sr-card-thumb{width:100%;object-fit:cover;background:var(--bg3);display:block;}
.sr-card-thumb-empty{background:linear-gradient(135deg,var(--bg2),var(--bg3));}
.sr-card-body{padding:16px 18px 20px;display:flex;flex-direction:column;gap:8px;}
.sr-card-eyebrow{font-size:11px;font-weight:700;color:var(--accent);text-transform:uppercase;letter-spacing:.5px;}
.sr-card-headline{font-family:var(--serif);font-size:18px;font-weight:600;letter-spacing:-.3px;color:var(--t1);margin:0;line-height:1.25;}
.sr-card-quote{font-size:13px;color:var(--t2);margin:4px 0 0;line-height:1.5;font-style:italic;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;}

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
