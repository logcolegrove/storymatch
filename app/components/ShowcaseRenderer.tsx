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

// (useState/useEffect previously powered the inline QuoteRotator
// implementation — replaced by FeaturedQuoteRotator which owns its
// own state. No top-level hooks needed here anymore.)
import { useState, useRef, useEffect } from "react";
import type {
  TemplateBlock,
  Template,
  HeroBlockProps,
  AssetGridBlockProps,
  QuoteRotatorBlockProps,
  IntroTextBlockProps,
  DividerBlockProps,
  FooterBlockProps,
  FiltersBlockProps,
  FiltersStickyBlockProps,
  FilterCategoryKey,
} from "@/lib/showcase-templates";
import { migrateLegacyFilterBlock } from "@/lib/showcase-templates";
import FeaturedQuoteRotator, { type FeaturedQuote } from "./FeaturedQuoteRotator";

// Slim FieldDef shape — only the bits the renderer needs. Kept here
// (not imported from lib/field-defs) so the renderer stays decoupled
// from the FieldDef DAL. Public showcase pages project orgFieldDefs
// to this shape before passing into the context.
export interface ShowcaseFieldDef {
  key: string;
  label: string;
  type: "text" | "select" | "multi_select" | "number" | "date";
  options?: string[];
}

// Active filter values per category key. Each entry is a SET of
// selected values (the filter is "any of these values"). A category
// with no entry (or empty set) means "no filter on that category".
export type FilterState = Record<string, string[]>;

export type SortKey = "recent" | "az" | "za";

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
  // Admin-only "Manage content" shortcut. When set, the asset-grid
  // block gets a SECOND hover button (alongside Edit) that opens
  // the asset list + picker view. Only asset-grid blocks render
  // this because they're the only block whose content lives in
  // showcase.assetIds rather than in the block's own props.
  onManageContent?: () => void;
  // Block-level drag-reorder (admin preview only). The host owns
  // the drag state + transitions; the renderer just applies the
  // pointer-down handler to each block wrap and renders magic-shift
  // transforms when a drag is engaged. Mirrors how onAssetReorder
  // works for asset cards within the grid.
  onBlockReorderBegin?: (blockIdx: number, e: React.PointerEvent) => void;
  blockDrag?: {
    fromIdx: number;
    insertIdx: number;
    pointerDx: number;
    pointerDy: number;
    rects: { left: number; top: number }[];
    engaged: boolean;
    source: "list" | "preview";
  };
  // Field definitions for the org — drives filter category labels +
  // value pickers in the filter blocks. The renderer never fetches;
  // the host passes whatever roster they want exposed. Empty list is
  // fine (filter blocks then hide themselves gracefully).
  fieldDefs?: ShowcaseFieldDef[];
  // Live filter / sort / search state. Owned by the host (public
  // ShowcasePageClient or builder preview). Filter blocks call the
  // setters; the asset-grid block reads ctx.assets which is already
  // the filtered + sorted result.
  filterState?: FilterState;
  onFilterChange?: (next: FilterState) => void;
  sortKey?: SortKey;
  onSortChange?: (next: SortKey) => void;
  searchQuery?: string;
  onSearchChange?: (next: string) => void;
}

export interface ShowcaseRenderAsset {
  id: string;
  headline: string;
  pull_quote: string;
  // Asset description — rendered below the title on grid cards when
  // showDescription is on. Optional; empty string when the asset
  // doesn't carry one.
  description: string;
  client_name: string;
  company: string;
  thumbnail: string;
  // Drives the Watch / Read frosted badge — matches the library
  // grid card so showcase tiles feel exactly like internal tiles.
  asset_type: string;
  duration_seconds: number | null;
  // Field-keyed value map — populated by the host with every value
  // the filter blocks might need to read. Keys match FieldDef.key
  // ("vertical", "company", "geography", ...) plus the built-in
  // "assetType" key. Values are strings (typed fields), arrays of
  // strings (multi_select), null/undefined, or whatever the host's
  // custom_field_values JSONB happens to carry. Filter logic uses
  // `fieldValueAsArray(a, key)` to normalize → string[].
  fieldValues?: Record<string, unknown>;
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
              {/* Title always renders. Company + description default
                  off and, when on, appear BELOW the title — eyebrow-
                  above was distracting and not what admins expect.
                  showQuote is deprecated; description replaces it
                  as the secondary text option. */}
              <h3 className="sr-card-headline">{a.headline || "Customer story"}</h3>
              {props.showCompany === true && (a.company || a.client_name) && (
                <div className="sr-card-co">{a.company || a.client_name}</div>
              )}
              {props.showDescription === true && a.description && (
                <p className="sr-card-desc">{a.description}</p>
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
// Reuses the FeaturedQuoteRotator from the library hero — same two-
// column pastel-wash treatment we polished extensively. Mapping
// from ShowcaseRenderAsset → FeaturedQuote covers what's available;
// fields we don't have (washToken, stars, static source) fall
// through to the rotator's deterministic defaults.
function QuoteRotatorBlock({ props, ctx }: BlockProps<QuoteRotatorBlockProps>) {
  const intervalSec = Math.max(2, props.intervalSec ?? 6);
  // Filter to assets with a real pull_quote — assets with no quote
  // shouldn't take a turn in the rotation. Then project to the
  // FeaturedQuote shape the rotator expects.
  const quotes: FeaturedQuote[] = ctx.assets
    .filter(a => a.pull_quote && a.pull_quote.trim().length > 0)
    .map(a => ({
      id: a.id,
      text: a.pull_quote,
      attrName: a.client_name || null,
      attrTitle: null,
      attrOrg: a.company || null,
      initialsOverride: null,
      // Video testimonials get the "video" CTA shape; everything
      // else falls into "case" (case-study link). The rotator's
      // CTA click is forwarded back to the showcase via onAssetClick
      // so we can open the in-builder preview / public asset page.
      kind: a.asset_type === "Video Testimonial" ? "video" : "case",
      assetId: a.id,
      assetVideoUrl: null,
      assetHeadline: a.headline || null,
      staticSource: null,
      staticUrl: null,
      stars: null,
      washToken: null,
    }));

  if (quotes.length === 0) return null;

  return (
    <section className={`sr-rotator-wrap sr-rotator-${props.size || "full"}`}>
      <FeaturedQuoteRotator
        quotes={quotes}
        intervalSec={intervalSec}
        onCtaClick={(q) => { if (q.assetId) ctx.onAssetClick(q.assetId); }}
      />
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

// ── Filter helpers ────────────────────────────────────────────────
// Normalize a field value to an array of strings so multi_select +
// scalar values share a single comparison path. Numbers cast to
// strings; null/undefined → empty array.
function fieldValueAsArray(a: ShowcaseRenderAsset, key: string): string[] {
  // Built-in keys not stored in fieldValues map. Project from the
  // canonical fields on the asset itself.
  if (key === "assetType") return a.asset_type ? [a.asset_type] : [];
  if (key === "company") return a.company ? [a.company] : (a.fieldValues?.[key] ? coerceArray(a.fieldValues[key]) : []);
  if (key === "client_name" || key === "clientName") return a.client_name ? [a.client_name] : [];
  const v = a.fieldValues?.[key];
  return coerceArray(v);
}
function coerceArray(v: unknown): string[] {
  if (v == null) return [];
  if (Array.isArray(v)) return v.map(String).filter(s => s.length > 0);
  const s = String(v).trim();
  return s ? [s] : [];
}

// Compute the unique set of values across all assets for a given
// category key. Used to populate dropdown options when the field def
// doesn't ship a fixed options list. Sorted alphabetically for
// predictable UI order.
export function distinctValuesForCategory(assets: ShowcaseRenderAsset[], key: string): string[] {
  const seen = new Set<string>();
  for (const a of assets) {
    for (const v of fieldValueAsArray(a, key)) seen.add(v);
  }
  return Array.from(seen).sort((x, y) => x.localeCompare(y));
}

// Resolve a filter category key → friendly label. Field defs win;
// built-in keys fall through to a hard-coded label table.
function labelForCategory(key: string, fieldDefs: ShowcaseFieldDef[] | undefined): string {
  const def = fieldDefs?.find(d => d.key === key);
  if (def) return def.label;
  if (key === "assetType") return "Type";
  if (key === "company") return "Company";
  if (key === "clientName" || key === "client_name") return "Client name";
  return key;
}

// Resolve the options to show in the picker for a category. Field
// defs ship a fixed list when they're select / multi_select types;
// otherwise we derive from the asset set so admins don't have to
// curate dropdown values by hand.
function optionsForCategory(
  key: string,
  assets: ShowcaseRenderAsset[],
  fieldDefs: ShowcaseFieldDef[] | undefined,
): string[] {
  const def = fieldDefs?.find(d => d.key === key);
  if (def && (def.type === "select" || def.type === "multi_select") && def.options && def.options.length > 0) {
    return def.options;
  }
  return distinctValuesForCategory(assets, key);
}

// Filter + sort + search pipeline. Public ShowcasePageClient
// (or builder preview) calls this with full asset list + current
// filter/sort/search state and passes the result as ctx.assets to
// the renderer. AssetGridBlock + QuoteRotatorBlock both see the
// already-filtered list, so filtering "above the grid" is transparent
// to the downstream blocks.
export function applyFilters(
  assets: ShowcaseRenderAsset[],
  filterState: FilterState | undefined,
  sortKey: SortKey | undefined,
  searchQuery: string | undefined,
): ShowcaseRenderAsset[] {
  let out = assets;
  // 1. Filter by category. AND across categories, OR within.
  if (filterState) {
    const activeKeys = Object.keys(filterState).filter(k => (filterState[k]?.length ?? 0) > 0);
    if (activeKeys.length > 0) {
      out = out.filter(a => activeKeys.every(k => {
        const need = new Set(filterState[k]);
        const have = fieldValueAsArray(a, k);
        return have.some(v => need.has(v));
      }));
    }
  }
  // 2. Search — case-insensitive substring across title + description.
  const q = (searchQuery || "").trim().toLowerCase();
  if (q.length > 0) {
    out = out.filter(a => {
      const hay = `${a.headline} ${a.description} ${a.pull_quote} ${a.company} ${a.client_name}`.toLowerCase();
      return hay.includes(q);
    });
  }
  // 3. Sort.
  if (sortKey === "az") out = [...out].sort((a, b) => a.headline.localeCompare(b.headline));
  else if (sortKey === "za") out = [...out].sort((a, b) => b.headline.localeCompare(a.headline));
  // "recent" — assets are already in newest-first order from the host.
  return out;
}

// ── FiltersBlock ──────────────────────────────────────────────────
// Unified filters element. Branches internally on `style`:
//   "bar"     — horizontal Sort + Filter + Search toolbar (mirrors
//               the master library lib-bar 1:1)
//   "sidebar" — vertical Asana-style accordion. NOTE: the actual
//               side-by-side LAYOUT (sidebar next to the grid) is
//               handled by ShowcaseRenderer's outer container — the
//               sidebar block here just renders its own contents.
function FiltersBlock({ props, ctx }: BlockProps<FiltersBlockProps>) {
  const style = props.style || "bar";
  if (style === "sidebar") return <FiltersSidebarBody props={props} ctx={ctx}/>;
  return <FiltersBarBody props={props} ctx={ctx}/>;
}

// The horizontal toolbar variant. Extracted as its own component so
// the dispatcher can pick the right body without nesting conditional
// hooks (each variant uses different state).
function FiltersBarBody({ props, ctx }: BlockProps<FiltersBlockProps>) {
  const showSort = props.showSort !== false;
  const showFilter = props.showFilter !== false;
  // Search defaults OFF — admins explicitly opt in. (Sort + Filter
  // still default on; they're the affordances that matter for any
  // showcase with more than a handful of assets.)
  const showSearch = props.showSearch === true;
  const align = props.align || "left";
  const categoryKeys = props.filterCategoryKeys || [];
  const sortOptions = props.sortOptions || ["recent", "az", "za"];
  const [openMenu, setOpenMenu] = useState<"sort" | "filter" | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!openMenu && !searchOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) {
        setOpenMenu(null);
        // Close the search popover when clicking outside — but only
        // if it's empty, so users don't accidentally lose their query
        // by clicking away.
        if (searchOpen && !(ctx.searchQuery || "").trim()) setSearchOpen(false);
      }
    };
    window.addEventListener("mousedown", onDoc);
    return () => window.removeEventListener("mousedown", onDoc);
  }, [openMenu, searchOpen, ctx.searchQuery]);

  // Count the total number of selected filter values across exposed
  // categories — drives the badge on the Filters button.
  const filterCount = categoryKeys.reduce((n, k) => n + (ctx.filterState?.[k]?.length || 0), 0);

  const sortLabel = (k: SortKey): string => {
    if (k === "az") return "A → Z";
    if (k === "za") return "Z → A";
    return "Recent";
  };

  // If everything's toggled off, render nothing — the element is a
  // no-op (admin can remove it from the layout).
  if (!showSort && !showFilter && !showSearch) return null;

  return (
    <div className={`sr-fin-wrap sr-fin-align-${align}`} ref={wrapRef}>
      {showFilter && categoryKeys.length > 0 && (
        <div className="sr-fin-pop-wrap">
          <button
            type="button"
            className={`sr-fin-filter${filterCount > 0 ? " on" : ""}`}
            onClick={() => setOpenMenu(openMenu === "filter" ? null : "filter")}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>
            <span>Filters</span>
            {filterCount > 0 && <span className="sr-fin-count">{filterCount}</span>}
          </button>
          {openMenu === "filter" && (
            <div className="sr-fin-pop sr-fin-pop-filter">
              {categoryKeys.map(k => (
                <FilterCategorySection
                  key={k}
                  catKey={k}
                  ctx={ctx}
                />
              ))}
              {filterCount > 0 && (
                <div className="sr-fin-pop-foot">
                  <button
                    type="button"
                    className="sr-fin-clear"
                    onClick={() => ctx.onFilterChange?.({})}
                  >Clear all</button>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {showSort && sortOptions.length > 0 && (
        <div className="sr-fin-pop-wrap">
          <button
            type="button"
            className={`sr-fin-btn${openMenu === "sort" ? " on" : ""}`}
            onClick={() => setOpenMenu(openMenu === "sort" ? null : "sort")}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><line x1="3" y1="6" x2="21" y2="6"/><line x1="6" y1="12" x2="18" y2="12"/><line x1="9" y1="18" x2="15" y2="18"/></svg>
            Sort: {sortLabel(ctx.sortKey || "recent")}
          </button>
          {openMenu === "sort" && (
            <div className="sr-fin-pop sr-fin-pop-sort">
              {sortOptions.map(o => (
                <div
                  key={o}
                  className={`sr-fin-menu-item${(ctx.sortKey || "recent") === o ? " on" : ""}`}
                  onClick={() => { ctx.onSortChange?.(o); setOpenMenu(null); }}
                >
                  <svg className="sr-fin-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                  {sortLabel(o)}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {showSearch && (
        <div className={`sr-fin-search${searchOpen ? " open" : ""}`}>
          <button
            type="button"
            className="sr-fin-search-toggle"
            onClick={() => setSearchOpen(s => !s)}
            aria-label="Search assets"
            title="Search"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="11" cy="11" r="7"/>
              <line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
          </button>
          {searchOpen && (
            <input
              type="text"
              className="sr-fin-search-input"
              placeholder="Search…"
              value={ctx.searchQuery || ""}
              onChange={(e) => ctx.onSearchChange?.(e.target.value)}
              autoFocus
            />
          )}
        </div>
      )}
    </div>
  );
}

// One category section inside the Filters popover. Renders a small
// header + a checkbox row per option. Toggling a checkbox edits the
// filterState in place via ctx.onFilterChange.
function FilterCategorySection({ catKey, ctx }: { catKey: string; ctx: ShowcaseContext }) {
  const label = labelForCategory(catKey, ctx.fieldDefs);
  const opts = optionsForCategory(catKey, ctx.assets, ctx.fieldDefs);
  // assets passed in here are already filtered, which means hiding
  // options that are no longer reachable. We want to surface ALL
  // options for the category regardless of current filters so users
  // can broaden their query — use the unfiltered counterpart from
  // ctx (host should pass unfiltered list... but for simplicity here
  // we read from ctx.assets, which is the filtered set; admins can
  // still see currently-selected filter values rendered as on regardless).
  const selected = new Set(ctx.filterState?.[catKey] || []);
  const toggle = (v: string) => {
    const cur = new Set(ctx.filterState?.[catKey] || []);
    if (cur.has(v)) cur.delete(v); else cur.add(v);
    const next: FilterState = { ...(ctx.filterState || {}), [catKey]: Array.from(cur) };
    ctx.onFilterChange?.(next);
  };
  return (
    <div className="sr-fin-cat">
      <div className="sr-fin-cat-h">{label}</div>
      {opts.length === 0 ? (
        <div className="sr-fin-cat-empty">No values to filter</div>
      ) : (
        <div className="sr-fin-cat-opts">
          {opts.map(v => (
            <label key={v} className="sr-fin-cat-opt">
              <input type="checkbox" checked={selected.has(v)} onChange={() => toggle(v)}/>
              <span>{v}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

// The vertical accordion variant. The outer container's layout
// (placing the sidebar beside the main column with a sticky position)
// is handled by ShowcaseRenderer — this component renders just the
// sidebar's inner content.
function FiltersSidebarBody({ props, ctx }: BlockProps<FiltersBlockProps>) {
  const heading = props.heading || "FILTER BY";
  const categoryKeys = props.filterCategoryKeys || [];
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  if (categoryKeys.length === 0) {
    // Render an empty-state hint so admins (in editor preview) see
    // why nothing's showing. On public viewer pages this just won't
    // render because admin shouldn't ship an empty sidebar.
    return (
      <div className="sr-fsb">
        <div className="sr-fsb-h">{heading}</div>
        <div className="sr-fsb-empty">Pick categories in the element settings.</div>
      </div>
    );
  }
  const toggleExpand = (k: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k); else next.add(k);
      return next;
    });
  };
  return (
    <div className="sr-fsb">
      <div className="sr-fsb-h">{heading}</div>
      {categoryKeys.map(k => {
        const isOpen = expanded.has(k);
        const label = labelForCategory(k, ctx.fieldDefs);
        const opts = optionsForCategory(k, ctx.assets, ctx.fieldDefs);
        const selected = new Set(ctx.filterState?.[k] || []);
        const toggle = (v: string) => {
          const cur = new Set(selected);
          if (cur.has(v)) cur.delete(v); else cur.add(v);
          ctx.onFilterChange?.({ ...(ctx.filterState || {}), [k]: Array.from(cur) });
        };
        return (
          <div key={k} className="sr-fsb-cat">
            <button type="button" className="sr-fsb-row" onClick={() => toggleExpand(k)}>
              <span className="sr-fsb-row-l">{label}</span>
              <span className={`sr-fsb-chev${isOpen ? " open" : ""}`}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>
              </span>
            </button>
            {isOpen && (
              <div className="sr-fsb-opts">
                {opts.length === 0 ? (
                  <div className="sr-fsb-empty">No values</div>
                ) : (
                  opts.map(v => (
                    <label key={v} className="sr-fsb-opt">
                      <input type="checkbox" checked={selected.has(v)} onChange={() => toggle(v)}/>
                      <span>{v}</span>
                    </label>
                  ))
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Block registry ────────────────────────────────────────────────
// Discriminated dispatch: given a block, pick the right renderer.
// Each renderer narrows the props through its own type via the
// discriminator union.
function renderBlock(block: TemplateBlock, ctx: ShowcaseContext, key: number) {
  // Migrate legacy filter block types up-front so the switch below
  // only has to know about the modern shape.
  const b = migrateLegacyFilterBlock(block);
  switch (b.type) {
    case "hero":            return <HeroBlock            key={key} props={b.props} ctx={ctx}/>;
    case "asset-grid":      return <AssetGridBlock       key={key} props={b.props} ctx={ctx}/>;
    case "quote-rotator":   return <QuoteRotatorBlock    key={key} props={b.props} ctx={ctx}/>;
    case "intro-text":      return <IntroTextBlock       key={key} props={b.props} ctx={ctx}/>;
    case "divider":         return <DividerBlock         key={key} props={b.props} ctx={ctx}/>;
    case "footer":          return <FooterBlock          key={key} props={b.props} ctx={ctx}/>;
    case "filters":         return <FiltersBlock         key={key} props={b.props} ctx={ctx}/>;
    // filters-inline / filters-sticky never reach this point — the
    // migration above converts them. Defensive null return:
    case "filters-inline":
    case "filters-sticky":  return null;
  }
}

// ── ShowcaseRenderer ──────────────────────────────────────────────
interface Props {
  template: Template;
  context: ShowcaseContext;
}

// Identify a block as the sidebar variant of the unified filters
// element (modern OR legacy). The outer renderer pulls these blocks
// out of the main vertical flow and renders them in a viewport-
// sticky aside next to the main column.
function isSidebarFilterBlock(b: TemplateBlock): boolean {
  if (b.type === "filters" && (b.props.style || "bar") === "sidebar") return true;
  if (b.type === "filters-sticky") return true;
  return false;
}

// Resolve the side prop for a sidebar filter block, defaulting to
// "left". Works for both modern and legacy block shapes.
function sidebarSideOf(b: TemplateBlock): "left" | "right" {
  if (b.type === "filters") return (b.props.side || "left");
  if (b.type === "filters-sticky") return ((b.props as FiltersStickyBlockProps).side || "left");
  return "left";
}

// Render-one-block-with-chrome helper. Extracted from the renderer's
// main loop so we can call it from BOTH the sidebar aside AND the
// main column when a sidebar filter exists. Keeps the edit overlay
// + drag chrome consistent across both surfaces. `withDrag`=false
// disables drag/transform on the sidebar variant (admins reorder
// sidebar blocks via the left rail's list instead).
function renderBlockWithChrome(
  b: TemplateBlock,
  i: number,
  context: ShowcaseContext,
  editable: boolean,
  drag: { fromIdx: number; insertIdx: number; pointerDx: number; pointerDy: number; rects: { left: number; top: number }[]; engaged: boolean; source: "list" | "preview" } | null,
  withDrag: boolean,
) {
  const rendered = renderBlock(b, context, i);
  if (!editable) return rendered;
  let dragStyle: React.CSSProperties | undefined;
  if (withDrag && drag && drag.engaged) {
    if (i === drag.fromIdx) {
      dragStyle = {
        transform: `translate(${drag.pointerDx}px, ${drag.pointerDy}px)`,
        transition: "none",
        zIndex: 10,
        position: "relative",
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
  // Migrate before computing the type-specific overlay shortcuts so
  // legacy filter blocks still get the right label + actions.
  const bm = migrateLegacyFilterBlock(b);
  return (
    <div
      key={`edit-${i}`}
      className="sr-edit-wrap"
      data-block-idx={i}
      style={dragStyle}
    >
      {rendered}
      {withDrag && context.onBlockReorderBegin && (
        <span
          className="sr-drag-handle"
          title="Drag to reorder"
          onPointerDown={(e) => { e.stopPropagation(); context.onBlockReorderBegin?.(i, e); }}
        >
          <svg width="12" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <circle cx="9" cy="5" r="1.6"/><circle cx="15" cy="5" r="1.6"/>
            <circle cx="9" cy="12" r="1.6"/><circle cx="15" cy="12" r="1.6"/>
            <circle cx="9" cy="19" r="1.6"/><circle cx="15" cy="19" r="1.6"/>
          </svg>
        </span>
      )}
      <div className="sr-edit-actions">
        {bm.type === "asset-grid" && context.onManageContent && (
          <button
            type="button"
            className="sr-edit-btn"
            onClick={(e) => { e.stopPropagation(); context.onManageContent?.(); }}
            title="Add, remove, or reorder the assets in this showcase"
            aria-label="Manage showcase content"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="3" y="3" width="7" height="7" rx="1"/>
              <rect x="14" y="3" width="7" height="7" rx="1"/>
              <rect x="3" y="14" width="7" height="7" rx="1"/>
              <rect x="14" y="14" width="7" height="7" rx="1"/>
            </svg>
            Manage content
          </button>
        )}
        <button
          type="button"
          className="sr-edit-btn"
          onClick={(e) => { e.stopPropagation(); context.onEditBlock?.(i); }}
          title={`Edit ${blockTypeLabel(bm.type)} settings`}
          aria-label={`Edit ${blockTypeLabel(bm.type)} block`}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 20h9"/>
            <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>
          </svg>
          Edit {blockTypeLabel(bm.type)}
        </button>
      </div>
    </div>
  );
}

export default function ShowcaseRenderer({ template, context }: Props) {
  const editable = !!context.onEditBlock;
  const drag = context.blockDrag && context.blockDrag.source === "preview" ? context.blockDrag : null;

  // Split template blocks into sidebar vs main. Indices preserved
  // so data-block-idx + drag-reorder still hit the right slot in
  // templateConfig. v1: first sidebar block wins for layout side;
  // any additional sidebar blocks render too (stacked in the aside).
  const sidebarEntries: { block: TemplateBlock; idx: number }[] = [];
  const mainEntries: { block: TemplateBlock; idx: number }[] = [];
  template.blocks.forEach((b, i) => {
    if (isSidebarFilterBlock(b)) sidebarEntries.push({ block: b, idx: i });
    else mainEntries.push({ block: b, idx: i });
  });
  const hasSidebar = sidebarEntries.length > 0;
  const sidebarSide = hasSidebar ? sidebarSideOf(sidebarEntries[0].block) : "left";

  if (hasSidebar) {
    return (
      <div className={`sr sr-layout sr-layout-${sidebarSide}`}>
        <style>{css}</style>
        <aside className="sr-aside">
          {sidebarEntries.map(({ block, idx }) =>
            renderBlockWithChrome(block, idx, context, editable, drag, false)
          )}
        </aside>
        <div className="sr-main">
          {mainEntries.map(({ block, idx }) =>
            renderBlockWithChrome(block, idx, context, editable, drag, true)
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="sr">
      <style>{css}</style>
      {template.blocks.map((b, i) =>
        renderBlockWithChrome(b, i, context, editable, drag, true)
      )}
    </div>
  );
}

// Magic-rearrange shift function. Mirror of the helper in
// ShowcaseBuilder so the renderer doesn't reach across files.
function shiftFor(idx: number, fromIdx: number, insertIdx: number): number {
  if (idx === fromIdx) return insertIdx;
  if (fromIdx < insertIdx) {
    if (idx > fromIdx && idx <= insertIdx) return idx - 1;
  } else {
    if (idx >= insertIdx && idx < fromIdx) return idx + 1;
  }
  return idx;
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
    case "filters":        return "filters";
    case "filters-inline": return "filters";
    case "filters-sticky": return "filters";
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
.sr-edit-actions{position:absolute;top:10px;right:10px;display:flex;gap:6px;z-index:5;}
/* Drag handle for preview-side block reorder. Top-LEFT so it
   doesn't collide with the Edit buttons at top-right. Same fade-in
   pattern as the Edit buttons. */
.sr-drag-handle{position:absolute;top:12px;left:12px;display:grid;place-items:center;width:26px;height:26px;background:#1c1c1c;color:rgba(255,255,255,.92);border-radius:6px;cursor:grab;opacity:0;transform:translateY(-2px);transition:opacity .15s, transform .15s, background .15s;z-index:5;box-shadow:0 4px 12px rgba(0,0,0,.22);touch-action:none;}
.sr-edit-wrap:hover .sr-drag-handle{opacity:1;transform:translateY(0);}
.sr-drag-handle:hover{background:var(--accent);}
.sr-drag-handle:active{cursor:grabbing;}
.sr-edit-btn{display:inline-flex;align-items:center;gap:6px;padding:6px 11px;background:#1c1c1c;color:#fff;border:none;border-radius:7px;font-family:var(--font);font-size:12px;font-weight:600;cursor:pointer;opacity:0;transform:translateY(-2px);transition:opacity .15s, transform .15s, background .15s;box-shadow:0 6px 18px rgba(0,0,0,.22);}
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
.sr-card-headline{font-size:17px;font-weight:600;letter-spacing:-.012em;color:var(--t1);margin:0;line-height:1.38;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;}
/* Company + description sit below the title when toggled on. The
   company line is a quieter color (t3) so it reads as metadata
   rather than competing with the headline. */
.sr-card-co{font-size:12.5px;color:var(--t3);margin:5px 0 0;line-height:1.45;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.sr-card-desc{font-size:13px;color:var(--t2);margin:8px 0 0;line-height:1.55;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;}
/* Drag-state styling — applied by the host when a card is being
   reordered. The dragged card dims; the rest stay normal. Live
   reorder visual feedback comes from the host repositioning the
   array, not from any extra ghost element. */
.sr-card[data-dragging="true"]{opacity:.4;cursor:grabbing;}
.sr-card[data-asset-idx]:hover{cursor:pointer;}

.sr-empty{max-width:560px;margin:64px auto;padding:48px 24px;text-align:center;color:var(--t3);font-size:14px;background:#fff;border:1px dashed var(--border2);border-radius:14px;}

/* Quote rotator wrapper — the rotator itself owns its visual
   treatment (FeaturedQuoteRotator self-contained styles). The
   wrapper just constrains width to align with the rest of the
   page and applies the size variant. */
.sr-rotator-wrap{max-width:1100px;margin:32px auto;padding:0 32px;}
.sr-rotator-compact{max-width:760px;}
/* The rotator's own narrow-layout media query keys on VIEWPORT
   width — fine on the public showcase page (rotator gets a full
   browser width) but breaks in the builder's narrow preview frame
   where the viewport is still desktop-wide. Force the narrow
   layout whenever the rotator's container itself is below 900px;
   the @container query keeps it self-contained. */
.sr-rotator-wrap{container-type:inline-size;}
@container (max-width: 900px) {
  .sr-rotator-wrap .fqr-hero{grid-template-columns:1fr;}
  .sr-rotator-wrap .fqr-meta{border-left:none;border-top:1px solid var(--border);}
  .sr-rotator-wrap .fqr-quote{padding:36px 30px;aspect-ratio:auto;}
  .sr-rotator-wrap .fqr-glyph{font-size:96px;margin-right:18px;}
  .sr-rotator-wrap .fqr-q-default .fqr-text{font-size:24px;}
  .sr-rotator-wrap .fqr-q-medium .fqr-text{font-size:20px;}
  .sr-rotator-wrap .fqr-q-long .fqr-text{font-size:17px;}
}
/* Extra-tight container (the builder preview at default rail state
   sits around 500–620px). Shrink padding + type one more notch so
   the quote doesn't overflow. */
@container (max-width: 640px) {
  .sr-rotator-wrap .fqr-quote{padding:28px 24px;}
  .sr-rotator-wrap .fqr-glyph{font-size:72px;margin-right:12px;}
  .sr-rotator-wrap .fqr-q-default .fqr-text{font-size:20px;}
  .sr-rotator-wrap .fqr-q-medium .fqr-text{font-size:17px;}
  .sr-rotator-wrap .fqr-q-long .fqr-text{font-size:15px;}
}

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

/* ─── Filters: inline (subtle) variant ──────────────────────────
   Mirrors the master library lib-bar 1:1. Filters button is a
   filled accent pill with a count badge; Sort is an outline button
   with a popover; Search is an icon-only button that expands inline
   to an input when clicked. */
.sr-fin-wrap{max-width:1100px;margin:0 auto;padding:0 32px 16px;display:flex;align-items:center;gap:10px;flex-wrap:wrap;position:relative;}
.sr-fin-align-left{justify-content:flex-start;}
.sr-fin-align-center{justify-content:center;}
.sr-fin-align-right{justify-content:flex-end;}
.sr-fin-pop-wrap{position:relative;}
.sr-fin-filter{display:inline-flex;align-items:center;gap:7px;padding:7px 13px;border:1px solid var(--border);background:#fff;border-radius:7px;font-family:var(--font);font-size:12.5px;font-weight:600;color:var(--t2);cursor:pointer;transition:all .12s;}
.sr-fin-filter:hover{border-color:var(--border2);color:var(--t1);}
.sr-fin-filter.on{background:var(--accent);color:#fff;border-color:var(--accent);}
.sr-fin-count{background:rgba(255,255,255,.25);color:#fff;font-size:10px;font-weight:700;padding:1px 6px;border-radius:10px;}
.sr-fin-filter:not(.on) .sr-fin-count{background:var(--accent);color:#fff;}
.sr-fin-btn{display:inline-flex;align-items:center;gap:7px;padding:7px 13px;border:1px solid var(--border);background:#fff;border-radius:7px;font-family:var(--font);font-size:12.5px;font-weight:600;color:var(--t2);cursor:pointer;transition:all .12s;}
.sr-fin-btn:hover{border-color:var(--border2);color:var(--t1);}
.sr-fin-btn.on{border-color:var(--accent);box-shadow:0 0 0 3px var(--accentL);}
/* Popovers anchored under the buttons */
.sr-fin-pop{position:absolute;top:calc(100% + 6px);left:0;min-width:200px;background:#fff;border:1px solid var(--border);border-radius:9px;box-shadow:0 14px 36px rgba(0,0,0,.14), 0 4px 10px rgba(0,0,0,.05);padding:6px;z-index:40;}
.sr-fin-pop-filter{min-width:260px;max-width:340px;padding:10px;display:flex;flex-direction:column;gap:12px;max-height:420px;overflow-y:auto;}
.sr-fin-menu-item{display:flex;align-items:center;gap:8px;padding:7px 10px;font-family:var(--font);font-size:12.5px;color:var(--t1);cursor:pointer;border-radius:6px;transition:background .12s;}
.sr-fin-menu-item:hover{background:var(--bg2);}
.sr-fin-menu-item.on{color:var(--accent);font-weight:600;}
.sr-fin-check{width:13px;height:13px;visibility:hidden;color:var(--accent);}
.sr-fin-menu-item.on .sr-fin-check{visibility:visible;}
.sr-fin-cat-h{font-size:10.5px;font-weight:700;color:var(--t3);text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px;}
.sr-fin-cat-opts{display:flex;flex-direction:column;gap:2px;}
.sr-fin-cat-opt{display:flex;align-items:center;gap:8px;padding:5px 4px;font-size:12.5px;color:var(--t1);cursor:pointer;border-radius:4px;}
.sr-fin-cat-opt:hover{background:var(--bg);}
.sr-fin-cat-opt input{accent-color:var(--accent);}
.sr-fin-cat-empty{font-size:11.5px;color:var(--t4);font-style:italic;padding:4px 0;}
.sr-fin-pop-foot{display:flex;justify-content:flex-end;border-top:1px solid var(--border);padding-top:8px;margin-top:4px;}
.sr-fin-clear{background:none;border:none;font-family:var(--font);font-size:12px;color:var(--t3);font-weight:600;cursor:pointer;padding:4px 8px;border-radius:5px;}
.sr-fin-clear:hover{background:var(--bg2);color:var(--t1);}
/* Search — icon collapses to a button; expanded shows an input */
.sr-fin-search{display:inline-flex;align-items:center;gap:6px;border:1px solid var(--border);border-radius:7px;background:#fff;transition:all .15s;}
.sr-fin-search.open{padding-right:8px;}
.sr-fin-search-toggle{display:grid;place-items:center;width:30px;height:30px;background:none;border:none;color:var(--t2);cursor:pointer;border-radius:7px 0 0 7px;transition:color .12s;}
.sr-fin-search-toggle:hover{color:var(--t1);}
.sr-fin-search.open .sr-fin-search-toggle{color:var(--accent);}
.sr-fin-search-input{border:none;outline:none;background:transparent;font-family:var(--font);font-size:12.5px;color:var(--t1);width:180px;padding:6px 0;animation:srFinSearchIn .15s ease;}
@keyframes srFinSearchIn{from{width:0;opacity:0;}to{width:180px;opacity:1;}}

/* ─── Filters: sidebar variant ──────────────────────────────────
   Renders inside an .sr-aside column (see .sr-layout below). The
   accordion content is sticky within the aside so it follows the
   viewer as they scroll through the long main column. */
.sr-fsb{position:sticky;top:24px;width:100%;padding:0 0 32px;}
.sr-fsb-h{font-family:var(--font);font-size:13px;font-weight:600;color:var(--t3);text-transform:uppercase;letter-spacing:.6px;padding:8px 0 14px;border-bottom:1px solid var(--border);}
.sr-fsb-cat{border-bottom:1px solid var(--border);}
.sr-fsb-row{display:flex;align-items:center;justify-content:space-between;width:100%;padding:18px 0;background:none;border:none;cursor:pointer;font-family:var(--font);}
.sr-fsb-row-l{font-size:15px;font-weight:600;color:var(--t1);text-align:left;}
.sr-fsb-chev{display:grid;place-items:center;width:28px;height:28px;border-radius:50%;background:var(--bg2);color:var(--t2);transition:transform .15s, background .12s;}
.sr-fsb-row:hover .sr-fsb-chev{background:var(--bg3);color:var(--t1);}
.sr-fsb-chev.open{transform:rotate(180deg);background:var(--bg3);color:var(--t1);}
.sr-fsb-opts{display:flex;flex-direction:column;gap:6px;padding:0 0 18px 16px;}
.sr-fsb-opt{display:flex;align-items:center;gap:10px;font-family:var(--font);font-size:14px;color:var(--t1);cursor:pointer;padding:4px 0;}
.sr-fsb-opt input{accent-color:var(--accent);width:14px;height:14px;}
.sr-fsb-empty{font-size:12px;color:var(--t4);font-style:italic;padding:14px 0;}

/* ─── Sidebar layout ────────────────────────────────────────────
   When the template contains a sidebar-style filters element, the
   renderer wraps everything in a 2-column CSS Grid: the sidebar
   pins to one side, the main column stacks blocks vertically. The
   sidebar inner content uses position:sticky to follow scroll. */
.sr-layout{display:grid;align-items:start;gap:32px;max-width:1360px;margin:0 auto;padding:24px 32px 32px;}
.sr-layout-left{grid-template-columns:240px 1fr;grid-template-areas:"aside main";}
.sr-layout-right{grid-template-columns:1fr 240px;grid-template-areas:"main aside";}
.sr-aside{grid-area:aside;align-self:stretch;}
.sr-main{grid-area:main;display:flex;flex-direction:column;min-width:0;}
/* The main column already wraps blocks with their own max-width
   (sr-hero/sr-grid/etc. cap at 1100px). Inside the sidebar layout
   those caps should yield to the column width so they share space
   gracefully with the sidebar. */
.sr-layout .sr-hero,
.sr-layout .sr-grid,
.sr-layout .sr-intro,
.sr-layout .sr-rotator-wrap{max-width:none;}
.sr-layout .sr-hero,
.sr-layout .sr-grid,
.sr-layout .sr-rotator-wrap{padding-left:0;padding-right:0;}

@media (max-width: 800px) {
  /* On narrow viewports collapse the sidebar to a regular vertical
     block above the main column — the side-by-side layout doesn't
     read well when the main column gets squeezed. */
  .sr-layout{grid-template-columns:1fr;grid-template-areas:"aside" "main";}
  .sr-fsb{position:static;}
}

@media (max-width: 700px) {
  .sr-hero{padding:40px 20px 24px;}
  .sr-hero-spacious{padding:56px 20px 32px;}
  .sr-hero h1{font-size:32px;}
  .sr-grid{padding:0 20px 32px;gap:16px;}
  .sr-grid-cols-2{grid-template-columns:1fr;}
  .sr-grid-cols-3,.sr-grid-cols-4{grid-template-columns:1fr;}
  .sr-rotator-wrap{padding:0 16px;}
}
`;
