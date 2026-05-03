// Quotes data-access layer.
//
// Quotes are a top-level entity (not embedded in assets) so the hero
// rotator can query them directly and we can later sync quotes from
// review-platform sources (Capterra, G2, etc.) without touching the
// assets table.
//
// During the migration window, asset-attached quotes ALSO exist as
// JSONB on the assets table (`pull_quote` + `additional_quotes`). The
// PUT /api/assets handler dual-writes both representations. Reads
// still come from JSONB until Phase 2 of the refactor flips them.
// Phase 3 drops the JSONB columns.
//
// Provenance: a quote can be attached to an asset (asset_id set), to
// a review-platform source (source_id set), or be manually entered
// standalone (both null).

import { supabaseAdmin } from "./supabase-server";

// ── Types ────────────────────────────────────────────────────────
export type QuoteKind = "video" | "case" | "static";

export type StaticSource =
  | "manual"
  | "trustpilot"
  | "g2"
  | "google"
  | "linkedin"
  | "capterra"
  | "other";

export type WashToken =
  | "rose"
  | "sage"
  | "sand"
  | "lavender"
  | "cream"
  | "mist";

// Snake-case row shape, matching the DB columns 1:1. Use this in
// queries; convert to QuoteFE via dbToFe() at the API boundary.
export interface QuoteRow {
  id: string;
  org_id: string;
  text: string;
  attr_name: string | null;
  attr_title: string | null;
  attr_org: string | null;
  initials_override: string | null;
  asset_id: string | null;
  source_id: string | null;
  kind: QuoteKind;
  static_source: StaticSource | null;
  static_url: string | null;
  stars: number | null;
  is_featured: boolean;
  featured_position: number | null;
  featured_at: string | null;
  wash_token: WashToken | null;
  is_favorite: boolean;
  position_within_parent: number | null;
  created_at: string;
  updated_at: string;
}

// CamelCase shape returned to the FE. Same fields, JSON-friendly.
export interface QuoteFE {
  id: string;
  orgId: string;
  text: string;
  attrName: string | null;
  attrTitle: string | null;
  attrOrg: string | null;
  initialsOverride: string | null;
  assetId: string | null;
  sourceId: string | null;
  kind: QuoteKind;
  staticSource: StaticSource | null;
  staticUrl: string | null;
  stars: number | null;
  isFeatured: boolean;
  featuredPosition: number | null;
  featuredAt: string | null;
  washToken: WashToken | null;
  isFavorite: boolean;
  positionWithinParent: number | null;
  createdAt: string;
  updatedAt: string;
}

export function dbToFe(r: QuoteRow): QuoteFE {
  return {
    id: r.id,
    orgId: r.org_id,
    text: r.text,
    attrName: r.attr_name,
    attrTitle: r.attr_title,
    attrOrg: r.attr_org,
    initialsOverride: r.initials_override,
    assetId: r.asset_id,
    sourceId: r.source_id,
    kind: r.kind,
    staticSource: r.static_source,
    staticUrl: r.static_url,
    stars: r.stars,
    isFeatured: r.is_featured,
    featuredPosition: r.featured_position,
    featuredAt: r.featured_at,
    washToken: r.wash_token,
    isFavorite: r.is_favorite,
    positionWithinParent: r.position_within_parent,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

// ── Helpers ──────────────────────────────────────────────────────
// Deterministic ID for asset-attached quotes so the dual-write
// handler can upsert without checking what already exists. Every
// quote at position N on asset A always has the same ID.
export function buildAssetQuoteId(assetId: string, position: number): string {
  return `q-${assetId}-${position}`;
}

// Determine the quote kind for a given parent asset type. Mirrors
// the logic baked into the migration backfill SQL so dual-writes
// match the backfilled rows exactly.
export function kindForAssetType(assetType: string | null | undefined): QuoteKind {
  return assetType === "Video Testimonial" ? "video" : "case";
}

// ── DAL functions used by the dual-write path ───────────────────

// Sync the full quote set for one asset. Replaces any existing rows
// for that asset_id with the provided list, preserving deterministic
// IDs (so a quote that didn't change keeps the same row).
//
// `quotes` MUST be in display order — index 0 is the primary, then
// the additional quotes. position_within_parent is set from index.
//
// Inputs are minimal — just text + favorite — because attribution
// for asset-attached quotes is derived from the parent asset's
// primary client (matching the historic JSONB shape).
export interface AssetQuoteInput {
  text: string;
  favorite: boolean;
}

export interface AssetQuoteContext {
  assetId: string;
  orgId: string;
  assetType: string;
  // Primary client info, used as default attribution for the quote
  // rows. Per-quote overrides (different speaker than primary
  // client) come later in the V2 admin flow.
  attrName: string | null;
  attrTitle: string | null;
  attrOrg: string | null;
}

export async function syncAssetQuotes(
  ctx: AssetQuoteContext,
  quotes: AssetQuoteInput[],
): Promise<{ ok: true } | { ok: false; error: string }> {
  const kind = kindForAssetType(ctx.assetType);
  const now = new Date().toISOString();

  // Cleanse inputs once.
  const cleaned = quotes
    .map((q, i) => ({
      raw: q,
      idx: i,
      text: (q.text || "").trim(),
    }))
    .filter(q => q.text.length > 0);

  // 1. Upsert the rows we want to keep.
  if (cleaned.length > 0) {
    const rows: Partial<QuoteRow>[] = cleaned.map(c => ({
      id: buildAssetQuoteId(ctx.assetId, c.idx),
      org_id: ctx.orgId,
      text: c.text,
      attr_name: ctx.attrName,
      attr_title: ctx.attrTitle,
      attr_org: ctx.attrOrg,
      asset_id: ctx.assetId,
      source_id: null,
      kind,
      is_favorite: !!c.raw.favorite,
      position_within_parent: c.idx,
      updated_at: now,
    }));
    const { error } = await supabaseAdmin
      .from("quotes")
      .upsert(rows, { onConflict: "id" });
    if (error) {
      return { ok: false, error: `upsert quotes failed: ${error.message}` };
    }
  }

  // 2. Delete any prior rows for this asset whose deterministic
  //    position is no longer in the cleaned set. (E.g. admin
  //    deleted quote #2 from an asset that previously had 3.)
  const keepIds = cleaned.map(c => buildAssetQuoteId(ctx.assetId, c.idx));
  const delQuery = supabaseAdmin
    .from("quotes")
    .delete()
    .eq("asset_id", ctx.assetId);
  if (keepIds.length > 0) {
    delQuery.not("id", "in", `(${keepIds.map(id => `"${id}"`).join(",")})`);
  }
  const { error: delErr } = await delQuery;
  if (delErr) {
    return { ok: false, error: `prune quotes failed: ${delErr.message}` };
  }

  return { ok: true };
}

// Fetch all quotes for one asset, ordered. Used by Phase 2 when we
// flip reads from JSONB to the new table.
export async function fetchQuotesForAsset(assetId: string): Promise<QuoteFE[]> {
  const { data, error } = await supabaseAdmin
    .from("quotes")
    .select("*")
    .eq("asset_id", assetId)
    .order("position_within_parent", { ascending: true, nullsFirst: false });
  if (error) {
    console.error("[quotes-dal] fetchQuotesForAsset failed:", error);
    return [];
  }
  return (data || []).map(dbToFe);
}

// Fetch the featured set for the hero rotator. Used by the
// rotator endpoint in a later phase.
export async function fetchFeaturedQuotes(orgId: string): Promise<QuoteFE[]> {
  const { data, error } = await supabaseAdmin
    .from("quotes")
    .select("*")
    .eq("org_id", orgId)
    .eq("is_featured", true)
    .order("featured_position", { ascending: true, nullsFirst: false })
    .order("featured_at", { ascending: false, nullsFirst: false })
    .limit(12);
  if (error) {
    console.error("[quotes-dal] fetchFeaturedQuotes failed:", error);
    return [];
  }
  return (data || []).map(dbToFe);
}
