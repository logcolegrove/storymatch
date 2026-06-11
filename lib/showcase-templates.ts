// Showcase template DSL.
//
// A Template describes the structure of a public showcase page as
// an ordered list of Block instances. Each block is a {type, props}
// pair — type names a registered block component, props is the
// type-checked config the renderer passes to it.
//
// This file is pure data + types. No React. Two consumers:
//   - lib + server can validate/transform Template JSON
//   - app/components/ShowcaseRenderer.tsx walks a Template and
//     renders each block via the registered React component.
//
// Why JSON-shaped instead of React components-as-templates?
// The DSL is a config language Claude (or any non-developer) can
// safely generate. Pages don't ship arbitrary code; they ship
// config that drives a vetted block library. Security, brand
// consistency, and accessibility all stay inside our renderer.
// See the design discussion: "Claude is the autocomplete on the
// structure layer — never the renderer."
//
// Adding a new block:
//   1. Add a new variant to BlockProps (props it accepts).
//   2. Add a TemplateBlock union case.
//   3. Build the React component under app/components/showcase-blocks/.
//   4. Register it in ShowcaseRenderer.tsx.
//   5. Optionally include it in one of the built-in templates below.

// ── Block prop shapes ─────────────────────────────────────────────
// Each block has its own props interface, type-checked at the
// template-creation site. The renderer passes props + a context
// object containing the resolved showcase data graph.

export interface HeroBlockProps {
  // Source of the headline. "showcase.name" pulls the showcase's
  // own name; "literal" lets the template hard-code a title (used
  // by built-in templates that want a different headline than the
  // showcase title).
  titleSource?: "showcase.name" | "literal";
  titleText?: string;
  subtitleSource?: "showcase.description" | "literal" | "none";
  subtitleText?: string;
  align?: "left" | "center";
  padding?: "compact" | "comfortable" | "spacious";
}

export interface AssetGridBlockProps {
  // Number of columns at the widest breakpoint. Smaller breakpoints
  // collapse automatically. 0 = "auto" (uses CSS auto-fill).
  columns?: 2 | 3 | 4;
  // All three optional context lines default OFF — title-only cards
  // are the cleanest baseline and the most common admin preference.
  // When on, both render BELOW the title (no eyebrow above).
  showCompany?: boolean;
  showDescription?: boolean;
  // showQuote is deprecated as of the description swap. Kept on the
  // type so legacy templateConfig blobs validate cleanly; the
  // renderer ignores it. Admins re-enable secondary text via
  // showDescription on the new toggle.
  showQuote?: boolean;
  aspect?: "16/9" | "4/3" | "1/1";
  // What happens when a viewer clicks an asset card:
  //   "modal"   — opens AssetDetail inline within the showcase
  //               page (current default — preserves showcase
  //               context, asset-detail loads in-place).
  //   "newpage" — opens the public asset detail page in a new
  //               tab. Better when admins want the showcase to
  //               feel more "directory" than "experience."
  clickTarget?: "modal" | "newpage";
}

export interface QuoteRotatorBlockProps {
  // "showcase-assets" rotates through the pull_quote of each asset
  // in the showcase. "org-featured" (future) would pull from the
  // org-level featured quotes table. v1 only supports the first.
  source?: "showcase-assets";
  intervalSec?: number;
  // Match the existing FeaturedQuoteRotator visual size options.
  // "full" = current default behavior; "compact" suits sidebars.
  size?: "full" | "compact";
}

export interface IntroTextBlockProps {
  // Plaintext body, rendered as paragraphs (no Markdown for v1).
  content: string;
  align?: "left" | "center";
}

export interface DividerBlockProps {
  spacing?: "tight" | "normal" | "wide";
}

export interface FooterBlockProps {
  // When true, render the "Shared via StoryMatch" attribution.
  // Future templates may toggle off for white-label showcases.
  showBrand?: boolean;
}

// Filter category keys reference either:
//   • A FieldDef.key from the org's master library schema
//     ("vertical", "company", "geography", etc.) — both system
//     fields and custom admin-defined fields are eligible
//   • A built-in concept that doesn't live in field defs:
//     "assetType" (Video Testimonial / Customer Story)
//
// We keep this as plain strings (not a union) so admin-defined
// custom fields are first-class — the DSL never has to learn about
// new field types when the admin adds one.
export type FilterCategoryKey = string;

// Unified filters element. Earlier slices shipped two separate
// block types (filters-inline + filters-sticky); admins found that
// confusing in the Add-element picker, so we collapsed them into
// one element with a `style` switch. The legacy block types stay in
// the discriminated union so previously-saved templateConfigs still
// validate — the renderer migrates them to FiltersBlock on read.
export interface FiltersBlockProps {
  // Which visual the element renders as.
  //   "bar"     — subtle horizontal Sort + Filter + Search toolbar
  //   "sidebar" — vertical accordion pinned beside the asset grid
  // Defaults to "bar" because it's the less-disruptive default.
  style?: "bar" | "sidebar";

  // Shared across both styles. Built-in keys ("assetType") plus
  // FieldDef.key values the admin opted in to. Empty = no filter
  // popover content in bar mode, empty sidebar in sidebar mode.
  filterCategoryKeys?: FilterCategoryKey[];

  // ── Bar-mode props ──────────────────────────────────────────
  showSort?: boolean;
  showFilter?: boolean;
  showSearch?: boolean;
  align?: "left" | "center" | "right";
  sortOptions?: ("recent" | "az" | "za")[];

  // ── Sidebar-mode props ──────────────────────────────────────
  heading?: string;
  side?: "left" | "right";
}

// Legacy: inline filter element — sort + filter + search trio that
// mirrors the master library lib-bar. Kept in the DSL for backward
// compat with old saved configs. New showcases use FiltersBlock
// with style="bar" instead.
export interface FiltersInlineBlockProps {
  showSort?: boolean;
  showFilter?: boolean;
  // Search defaults OFF (admins explicitly opt in) — the icon was
  // proving noisy on most showcase layouts. Sort + Filter remain
  // on by default.
  showSearch?: boolean;
  // Horizontal placement of the bar within the asset-grid frame.
  // Defaults to "left" so it reads as a tool bar rather than a hero.
  align?: "left" | "center" | "right";
  // Which categories the Filter popover exposes. Empty = no filter
  // popover content (the button hides itself even when showFilter is
  // on). Admin opts in to specific categories from the settings panel.
  filterCategoryKeys?: FilterCategoryKey[];
  // Sort options offered in the Sort popover. Default to the sensible
  // four; admins can prune. Kept tight intentionally — public viewers
  // shouldn't see ten sort options the way admins do in the library.
  sortOptions?: ("recent" | "az" | "za")[];
}

// Legacy: sticky vertical filter sidebar. Kept in the DSL for
// backward compat. New showcases use FiltersBlock with
// style="sidebar".
export interface FiltersStickyBlockProps {
  heading?: string;
  filterCategoryKeys?: FilterCategoryKey[];
  side?: "left" | "right";
}

// ── Block union ───────────────────────────────────────────────────
// Discriminated union — each variant pairs a type tag with its
// strongly-typed props. The renderer narrows on `type` to pick the
// right component + props pair.

export type TemplateBlock =
  | { type: "hero"; props: HeroBlockProps }
  | { type: "asset-grid"; props: AssetGridBlockProps }
  | { type: "quote-rotator"; props: QuoteRotatorBlockProps }
  | { type: "intro-text"; props: IntroTextBlockProps }
  | { type: "divider"; props: DividerBlockProps }
  | { type: "footer"; props: FooterBlockProps }
  | { type: "filters"; props: FiltersBlockProps }
  // Legacy. Migrated to "filters" on read.
  | { type: "filters-inline"; props: FiltersInlineBlockProps }
  | { type: "filters-sticky"; props: FiltersStickyBlockProps };

export type BlockType = TemplateBlock["type"];

// ── Template shape ────────────────────────────────────────────────
export interface Template {
  id: string;
  name: string;
  description?: string;
  // Whether the template ships in the picker by default. Built-in
  // templates are seeded; admin-created (Claude-generated) ones
  // would also be flagged here so the registry can list them.
  builtIn: true;
  blocks: TemplateBlock[];
}

// ── Built-in templates ────────────────────────────────────────────
// Three templates seed the system. Each composes the same block
// library in a different rhythm — pick one as the showcase's
// default; admin can later pick alternatives from the editor.

export const TEMPLATES: Template[] = [
  {
    id: "default",
    name: "Default",
    description: "Clean hero + asset grid. Best for browsing-style showcases where the assets are the star.",
    builtIn: true,
    blocks: [
      { type: "hero", props: { titleSource: "showcase.name", subtitleSource: "showcase.description", align: "center", padding: "comfortable" } },
      { type: "asset-grid", props: { columns: 3, aspect: "16/9" } },
    ],
  },
  {
    id: "with-quotes",
    name: "With quote rotator",
    description: "Adds a rotating pull-quote band between the hero and the asset grid. Punchier for storytelling-first showcases.",
    builtIn: true,
    blocks: [
      { type: "hero", props: { titleSource: "showcase.name", subtitleSource: "showcase.description", align: "center", padding: "comfortable" } },
      { type: "quote-rotator", props: { source: "showcase-assets", intervalSec: 6, size: "full" } },
      { type: "divider", props: { spacing: "wide" } },
      { type: "asset-grid", props: { columns: 3, aspect: "16/9" } },
    ],
  },
  {
    id: "minimal",
    name: "Minimal",
    description: "Hero only with a single-column grid below. Best when each asset deserves the full attention of the viewer.",
    builtIn: true,
    blocks: [
      { type: "hero", props: { titleSource: "showcase.name", subtitleSource: "showcase.description", align: "left", padding: "spacious" } },
      { type: "asset-grid", props: { columns: 2, aspect: "16/9" } },
    ],
  },
];

// Default template ID used when a showcase has no template_id set
// (or the saved template ID can't be resolved — defensive).
export const DEFAULT_TEMPLATE_ID = "default";

export function getTemplate(id: string | null | undefined): Template {
  if (!id) return TEMPLATES[0];
  const found = TEMPLATES.find(t => t.id === id);
  return found || TEMPLATES[0];
}

// Resolves the template a showcase should actually render with.
//
//   1. If templateConfig has data, the showcase has been customized
//      — it owns its block array (fork-from-template). Build a
//      synthetic Template around the saved blocks. The id + name
//      come from templateId so the "Edit" UI still shows which
//      preset the showcase started from.
//   2. Else if templateId resolves, use the named template directly.
//   3. Else fall through to the "default" preset.
//
// This indirection means the renderer never has to know about
// "is this a fork?" — it just renders whatever Template comes back.
export function effectiveTemplate(
  templateConfig: TemplateBlock[] | null | undefined,
  templateId: string | null | undefined,
): Template {
  if (templateConfig && Array.isArray(templateConfig) && templateConfig.length > 0) {
    const base = getTemplate(templateId);
    return {
      id: base.id,
      name: base.name,
      description: base.description,
      builtIn: true,
      blocks: templateConfig,
    };
  }
  return getTemplate(templateId);
}

// Migrate any legacy filters-inline / filters-sticky blocks to the
// unified filters block with a style switch. Idempotent — modern
// "filters" blocks pass through untouched. Used by both the renderer
// and the builder when consuming a templateConfig from disk.
export function migrateLegacyFilterBlock(b: TemplateBlock): TemplateBlock {
  if (b.type === "filters-inline") {
    return { type: "filters", props: { ...(b.props as FiltersInlineBlockProps), style: "bar" } };
  }
  if (b.type === "filters-sticky") {
    const p = b.props as FiltersStickyBlockProps;
    return { type: "filters", props: { style: "sidebar", heading: p.heading, side: p.side, filterCategoryKeys: p.filterCategoryKeys } };
  }
  return b;
}

// Returns a deep clone of the template's blocks, suitable for
// initializing a showcase's templateConfig on first fork. Avoids
// shared-reference bugs where editing one showcase's blocks would
// mutate the built-in template.
export function cloneTemplateBlocks(templateId: string | null | undefined): TemplateBlock[] {
  const t = getTemplate(templateId);
  // JSON round-trip is the simplest deep clone for our DSL — all
  // values are JSON-safe (strings, numbers, booleans, arrays).
  return JSON.parse(JSON.stringify(t.blocks)) as TemplateBlock[];
}
