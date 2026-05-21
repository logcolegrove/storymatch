// Showcase data-access layer.
//
// A showcase is a curated, reusable bundle of assets — admins build
// branded landing pages for embedding, sales reps build quick
// playlists for prospect-specific outreach. Both shapes share the
// same backing table; the differences are pure UX (admin gets the
// full editor + template controls, sales gets a stripped-down
// "make a playlist" flow).
//
// Reference model: showcases hold an ORDERED list of asset IDs, not
// snapshots. When the showcase is rendered, the DAL resolves the
// IDs to live assets and silently drops any that no longer exist
// or aren't Public. That contract — committed to in the design
// discussion — means a sales rep's already-sent link can never
// 404 or error out; the worst case is the prospect sees fewer
// assets than the rep originally curated. The asset list is
// preserved as-is so an asset that becomes Public again
// re-appears in the showcase next time it's loaded.
//
// Visibility model: showcases are PUBLIC by default once shared —
// anyone with the URL can open them (matching the existing
// /s/[shareId] semantics for single-asset shares). No password or
// email gating in v1.

import { supabaseAdmin } from "./supabase-server";
import type { TemplateBlock } from "./showcase-templates";

// ── Types ─────────────────────────────────────────────────────────

// The raw shape — DB row mapped to camelCase.
export interface Showcase {
  id: string;
  orgId: string;
  ownerUserId: string;
  name: string;
  description: string | null;
  // Ordered list of asset IDs the showcase references. Order is
  // preserved from creation/edit and drives render order.
  assetIds: string[];
  // Which template the showcase renders with. References an entry
  // in lib/showcase-templates.ts TEMPLATES array. Null/missing
  // falls through to the "default" template at render time.
  templateId: string | null;
  // The showcase's owned block array. Null when the showcase
  // hasn't been customized yet — in that case the renderer falls
  // back to the named template (templateId). When set, this
  // ARRAY drives rendering directly (fork-from-template semantics).
  // The first per-block edit in the builder clones the template's
  // blocks here so the showcase owns its own copy.
  templateConfig: TemplateBlock[] | null;
  createdAt: string;
  updatedAt: string;
}

// Minimal asset row returned alongside a resolved showcase. Just
// enough for the public render path — full Asset details are out
// of scope for the DAL (the caller can refetch if needed).
export interface ShowcaseAssetSlim {
  id: string;
  headline: string;
  pull_quote: string;
  description: string;
  video_url: string;
  thumbnail: string;
  client_name: string;
  company: string;
  vertical: string;
  asset_type: string;
}

// A showcase fully resolved for rendering: same metadata as
// Showcase, plus the materialized list of asset rows (with
// archived/deleted ones silently filtered out).
export interface ResolvedShowcase extends Showcase {
  // Resolved + filtered assets in original order. Length may be
  // less than assetIds.length when references have been dropped.
  assets: ShowcaseAssetSlim[];
  // For diagnostics + future analytics: how many assetIds were
  // dropped during resolution. Never surfaced to the public
  // viewer — only useful to admins editing the showcase.
  droppedCount: number;
}

// ── ID generation ─────────────────────────────────────────────────
// Short URL-safe IDs so showcase URLs stay readable. Mirrors the
// share_links convention: 8 chars of base62 ≈ 2 × 10^14 possibilities,
// plenty for our scale.
const SHOWCASE_ID_CHARSET =
  "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
function generateShowcaseId(length = 8): string {
  let id = "";
  for (let i = 0; i < length; i++) {
    id += SHOWCASE_ID_CHARSET[Math.floor(Math.random() * SHOWCASE_ID_CHARSET.length)];
  }
  return id;
}

// ── Validation ────────────────────────────────────────────────────
// Names are optional from the user's perspective — a blank name
// resolves to "Untitled showcase" so the bulk "Add to showcase"
// flow can ship a draft straight to disk without prompting. Admin
// can rename later from the editor.
export const UNTITLED_SHOWCASE_NAME = "Untitled showcase";
function sanitizeName(raw: unknown): string {
  if (typeof raw !== "string") return UNTITLED_SHOWCASE_NAME;
  const trimmed = raw.trim().slice(0, 200);
  return trimmed.length === 0 ? UNTITLED_SHOWCASE_NAME : trimmed;
}
function sanitizeDescription(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim().slice(0, 2000);
  return trimmed.length === 0 ? null : trimmed;
}
function sanitizeAssetIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const v of raw) {
    if (typeof v !== "string") continue;
    const trimmed = v.trim();
    if (!trimmed) continue;
    if (seen.has(trimmed)) continue; // dedupe
    seen.add(trimmed);
    out.push(trimmed);
    if (out.length >= 500) break; // hard cap so a runaway payload can't DoS
  }
  return out;
}

// ── DB row → Showcase mapping ─────────────────────────────────────
type DbShowcaseRow = {
  id: string;
  org_id: string;
  owner_user_id: string;
  name: string;
  description: string | null;
  asset_ids: string[] | null;
  template_id: string | null;
  template_config: TemplateBlock[] | null;
  created_at: string;
  updated_at: string;
};

function rowToShowcase(row: DbShowcaseRow): Showcase {
  return {
    id: row.id,
    orgId: row.org_id,
    ownerUserId: row.owner_user_id,
    name: row.name,
    description: row.description,
    assetIds: Array.isArray(row.asset_ids) ? row.asset_ids : [],
    templateId: row.template_id ?? null,
    templateConfig: Array.isArray(row.template_config) ? row.template_config : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// Conservative validation — only accept template IDs we recognize.
// Unknown strings fall back to null (renderer defaults to "default").
// Update this list when new built-in templates ship, or accept
// arbitrary strings once admin-curated templates become a thing.
const KNOWN_TEMPLATE_IDS = new Set(["default", "with-quotes", "minimal"]);
function sanitizeTemplateId(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  return KNOWN_TEMPLATE_IDS.has(trimmed) ? trimmed : null;
}

// Block-array validation. Each entry must have a known `type` and
// an object `props`. We trust the props beyond shape — the
// renderer reads each block defensively (with defaults for missing
// keys), so junk props just render as the default value. Anything
// that fails the shape check drops the whole config to null so the
// renderer falls back to the template_id named template.
const KNOWN_BLOCK_TYPES = new Set([
  "hero", "asset-grid", "quote-rotator", "intro-text", "divider", "footer",
]);
function sanitizeTemplateConfig(raw: unknown): TemplateBlock[] | null {
  if (raw === null || raw === undefined) return null;
  if (!Array.isArray(raw)) return null;
  const out: TemplateBlock[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") return null;
    const e = entry as { type?: unknown; props?: unknown };
    if (typeof e.type !== "string" || !KNOWN_BLOCK_TYPES.has(e.type)) return null;
    if (!e.props || typeof e.props !== "object") return null;
    // Trust the shape from here — the renderer applies defaults
    // for any missing/invalid prop values per block.
    out.push(entry as TemplateBlock);
    if (out.length > 50) return null; // sanity cap
  }
  return out;
}

// ── CRUD helpers ──────────────────────────────────────────────────

export async function createShowcase(params: {
  orgId: string;
  ownerUserId: string;
  name: string;
  description?: string | null;
  assetIds?: string[];
  templateId?: string | null;
  templateConfig?: TemplateBlock[] | null;
}): Promise<{ ok: true; showcase: Showcase } | { ok: false; error: string }> {
  // Empty name → "Untitled showcase" via sanitizeName. We never
  // reject on missing name; admin can rename later.
  const name = sanitizeName(params.name);

  // Retry on the (rare) ID collision. 8-char base62 has plenty of
  // headroom, but we still loop a few times to be safe.
  for (let attempt = 0; attempt < 5; attempt++) {
    const candidate = generateShowcaseId();
    const { data, error } = await supabaseAdmin
      .from("showcases")
      .insert({
        id: candidate,
        org_id: params.orgId,
        owner_user_id: params.ownerUserId,
        name,
        description: sanitizeDescription(params.description ?? null),
        asset_ids: sanitizeAssetIds(params.assetIds ?? []),
        template_id: sanitizeTemplateId(params.templateId ?? null),
        template_config: sanitizeTemplateConfig(params.templateConfig ?? null),
      })
      .select("id, org_id, owner_user_id, name, description, asset_ids, template_id, template_config, created_at, updated_at")
      .single();
    if (!error && data) {
      return { ok: true, showcase: rowToShowcase(data as DbShowcaseRow) };
    }
    // 23505 = Postgres unique violation — regenerate and retry.
    if (error && error.code !== "23505") {
      console.error("[showcase-dal] create failed", error);
      return { ok: false, error: error.message };
    }
  }
  return { ok: false, error: "Couldn't generate a unique showcase ID; try again" };
}

export async function fetchShowcase(id: string): Promise<Showcase | null> {
  const { data, error } = await supabaseAdmin
    .from("showcases")
    .select("id, org_id, owner_user_id, name, description, asset_ids, template_id, template_config, created_at, updated_at")
    .eq("id", id)
    .maybeSingle();
  if (error) {
    console.error("[showcase-dal] fetch failed", error);
    return null;
  }
  if (!data) return null;
  return rowToShowcase(data as DbShowcaseRow);
}

// List all showcases in an org. Admin-only consumer — the API
// scopes this further by role.
export async function fetchOrgShowcases(orgId: string): Promise<Showcase[]> {
  const { data, error } = await supabaseAdmin
    .from("showcases")
    .select("id, org_id, owner_user_id, name, description, asset_ids, template_id, template_config, created_at, updated_at")
    .eq("org_id", orgId)
    .order("updated_at", { ascending: false })
    .limit(500);
  if (error || !data) {
    if (error) console.error("[showcase-dal] org fetch failed", error);
    return [];
  }
  return data.map(r => rowToShowcase(r as DbShowcaseRow));
}

// List only the showcases owned by a specific user. Sales reps see
// this — they can manage their own playlists but not admin-built
// org showcases.
export async function fetchUserShowcases(orgId: string, userId: string): Promise<Showcase[]> {
  const { data, error } = await supabaseAdmin
    .from("showcases")
    .select("id, org_id, owner_user_id, name, description, asset_ids, template_id, template_config, created_at, updated_at")
    .eq("org_id", orgId)
    .eq("owner_user_id", userId)
    .order("updated_at", { ascending: false })
    .limit(500);
  if (error || !data) {
    if (error) console.error("[showcase-dal] user fetch failed", error);
    return [];
  }
  return data.map(r => rowToShowcase(r as DbShowcaseRow));
}

export async function updateShowcase(params: {
  id: string;
  orgId: string;       // for tenant safety
  name?: string;
  description?: string | null;
  assetIds?: string[];
  templateId?: string | null;
  templateConfig?: TemplateBlock[] | null;
}): Promise<{ ok: true; showcase: Showcase } | { ok: false; error: string }> {
  const updates: Partial<DbShowcaseRow> = { updated_at: new Date().toISOString() };
  if (params.name !== undefined) {
    // Blank → "Untitled showcase" via sanitizeName, never reject.
    updates.name = sanitizeName(params.name);
  }
  if (params.description !== undefined) {
    updates.description = sanitizeDescription(params.description);
  }
  if (params.assetIds !== undefined) {
    updates.asset_ids = sanitizeAssetIds(params.assetIds);
  }
  if (params.templateId !== undefined) {
    updates.template_id = sanitizeTemplateId(params.templateId);
  }
  if (params.templateConfig !== undefined) {
    updates.template_config = sanitizeTemplateConfig(params.templateConfig);
  }
  const { data, error } = await supabaseAdmin
    .from("showcases")
    .update(updates)
    .eq("id", params.id)
    .eq("org_id", params.orgId)
    .select("id, org_id, owner_user_id, name, description, asset_ids, template_id, template_config, created_at, updated_at")
    .maybeSingle();
  if (error) {
    console.error("[showcase-dal] update failed", error);
    return { ok: false, error: error.message };
  }
  if (!data) return { ok: false, error: "Showcase not found" };
  return { ok: true, showcase: rowToShowcase(data as DbShowcaseRow) };
}

export async function deleteShowcase(id: string, orgId: string): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabaseAdmin
    .from("showcases")
    .delete()
    .eq("id", id)
    .eq("org_id", orgId);
  if (error) {
    console.error("[showcase-dal] delete failed", error);
    return { ok: false, error: error.message };
  }
  return { ok: true };
}

// ── Resolution for rendering ──────────────────────────────────────
// Fetch the showcase + its live assets, filtered to those that
// (a) still exist in the org, (b) are status=published. Order is
// preserved from showcase.assetIds. Missing/archived/deleted IDs
// are silently dropped — the public-facing showcase never 404s
// because a sales rep's link contains an asset that an admin
// archived later.
//
// `requireOrgPublic` controls whether we require the org-scoped
// match. The public render path doesn't have a user context so we
// look up the asset by id+org (org comes from the showcase row).
export async function resolveShowcase(id: string): Promise<ResolvedShowcase | null> {
  const showcase = await fetchShowcase(id);
  if (!showcase) return null;

  if (showcase.assetIds.length === 0) {
    return { ...showcase, assets: [], droppedCount: 0 };
  }

  const { data, error } = await supabaseAdmin
    .from("assets")
    .select("id, headline, pull_quote, description, video_url, thumbnail, client_name, company, vertical, asset_type, status, org_id")
    .in("id", showcase.assetIds)
    .eq("org_id", showcase.orgId)
    .eq("status", "published");
  if (error) {
    console.error("[showcase-dal] resolve fetch failed", error);
    // Best-effort: return the showcase with no assets rather than
    // failing — a degraded page is better than a hard error.
    return { ...showcase, assets: [], droppedCount: showcase.assetIds.length };
  }
  const byId = new Map<string, ShowcaseAssetSlim>();
  for (const row of (data || [])) {
    byId.set(row.id as string, {
      id: row.id as string,
      headline: (row.headline as string) || "",
      pull_quote: (row.pull_quote as string) || "",
      description: (row.description as string) || "",
      video_url: (row.video_url as string) || "",
      thumbnail: (row.thumbnail as string) || "",
      client_name: (row.client_name as string) || "",
      company: (row.company as string) || "",
      vertical: (row.vertical as string) || "",
      asset_type: (row.asset_type as string) || "Video Testimonial",
    });
  }
  // Preserve original order. IDs the lookup couldn't satisfy
  // (archived, deleted, status≠published) silently drop here.
  const assets: ShowcaseAssetSlim[] = [];
  for (const aid of showcase.assetIds) {
    const row = byId.get(aid);
    if (row) assets.push(row);
  }
  return {
    ...showcase,
    assets,
    droppedCount: showcase.assetIds.length - assets.length,
  };
}
