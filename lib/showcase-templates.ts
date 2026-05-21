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
  showCompany?: boolean;
  showQuote?: boolean;
  aspect?: "16/9" | "4/3" | "1/1";
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
  | { type: "footer"; props: FooterBlockProps };

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
      { type: "asset-grid", props: { columns: 3, showCompany: true, showQuote: true, aspect: "16/9" } },
      { type: "footer", props: { showBrand: true } },
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
      { type: "asset-grid", props: { columns: 3, showCompany: true, showQuote: false, aspect: "16/9" } },
      { type: "footer", props: { showBrand: true } },
    ],
  },
  {
    id: "minimal",
    name: "Minimal",
    description: "Hero only with a single-column grid below. Best when each asset deserves the full attention of the viewer.",
    builtIn: true,
    blocks: [
      { type: "hero", props: { titleSource: "showcase.name", subtitleSource: "showcase.description", align: "left", padding: "spacious" } },
      { type: "asset-grid", props: { columns: 2, showCompany: true, showQuote: true, aspect: "16/9" } },
      { type: "footer", props: { showBrand: true } },
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
