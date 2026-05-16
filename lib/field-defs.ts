// Field definitions: per-org schema for every field that exists on
// an asset. Three categories of fields:
//
//   • System + Vimeo-populated — Title, Description, Transcript,
//     Thumbnail, Publish date. Locked: synced from Vimeo on every
//     source sync. Admin can rename label but not change the source.
//
//   • System + AI-populated — Client name, Company, Client role,
//     Industry, Geography, Org size, Challenge, Outcome, Pull quote.
//     Filled in on import by /api/extract-metadata reading the
//     transcript. Each has an `aiAutoFill` toggle that admins can
//     switch off, in which case the field stays blank until manually
//     filled. Admin manual edits always win — AI never overwrites a
//     non-empty value.
//
//   • System + Manual — Type, Client status. Admin sets these.
//     Optional aiAutoFill toggle to opt in to AI guessing.
//
//   • Custom — Admin-defined. Default populator "manual". Optional
//     aiAutoFill toggle.
//
// This file is the single source of truth for what fields exist and
// how each gets populated. The Manage Fields panel reads + writes
// through this DAL; the extract-metadata route reads it to decide
// which fields to ask AI for.
//
// Migration strategy for the populator + aiAutoFill expansion:
//   fetchOrgFieldDefs merges in any missing default system fields on
//   read. Existing orgs that pre-date this change get the new fields
//   transparently on their next page load. Admin-customized fields
//   keep their state — only NEW system fields get inserted.

import { supabaseAdmin } from "./supabase-server";

export type FieldType = "text" | "select" | "multi_select" | "number" | "date";

// Where a field's value comes from. "vimeo" is locked (source of
// truth is Vimeo on every sync). "ai" runs through Claude's metadata
// extraction call. "manual" requires admin entry.
export type FieldPopulator = "manual" | "vimeo" | "ai";

export interface FieldDef {
  id: string;            // stable UUID across renames
  key: string;           // canonical key — used in JSONB; immutable post-create
  label: string;         // display name; admin can rename
  type: FieldType;
  options?: string[];    // for select / multi_select
  showInFilters: boolean;
  position: number;      // sort order in UI
  system: boolean;       // true → backed by a typed column on assets
  systemColumn?: string; // column name when system === true
  populator: FieldPopulator; // how this field's value gets in
  aiAutoFill: boolean;       // only meaningful when populator !== "vimeo"
}

// Default field roster for new orgs. Order matches the typical
// admin's mental model: identity → filterable metadata → long-form
// content → governance. Each block is also positioned so admins can
// reorder freely without bumping into surprises.
export function defaultFieldDefs(): FieldDef[] {
  return [
    // ── Vimeo-pulled (locked; synced on every Vimeo source sync) ──
    {
      id: "f-headline", key: "headline", label: "Title",
      type: "text",
      showInFilters: false, position: 0,
      system: true, systemColumn: "headline",
      populator: "vimeo", aiAutoFill: false,
    },
    {
      id: "f-description", key: "description", label: "Description",
      type: "text",
      showInFilters: false, position: 1,
      system: true, systemColumn: "description",
      populator: "vimeo", aiAutoFill: false,
    },
    {
      id: "f-thumbnail", key: "thumbnail", label: "Thumbnail",
      type: "text",
      showInFilters: false, position: 2,
      system: true, systemColumn: "thumbnail",
      populator: "vimeo", aiAutoFill: false,
    },
    {
      id: "f-publishedAt", key: "publishedAt", label: "Publish date",
      type: "date",
      showInFilters: false, position: 3,
      system: true, systemColumn: "published_at",
      populator: "vimeo", aiAutoFill: false,
    },
    {
      id: "f-transcript", key: "transcript", label: "Transcript",
      type: "text",
      showInFilters: false, position: 4,
      system: true, systemColumn: "transcript",
      populator: "vimeo", aiAutoFill: false,
    },

    // ── AI-extracted (Claude reads the transcript on import) ──
    {
      id: "f-clientName", key: "clientName", label: "Client name",
      type: "text",
      showInFilters: false, position: 5,
      system: true, systemColumn: "client_name",
      populator: "ai", aiAutoFill: true,
    },
    {
      id: "f-company", key: "company", label: "Company",
      type: "text",
      showInFilters: false, position: 6,
      system: true, systemColumn: "company",
      populator: "ai", aiAutoFill: true,
    },
    {
      id: "f-clientRole", key: "clientRole", label: "Client role",
      type: "text",
      showInFilters: false, position: 7,
      system: true, systemColumn: "client_role",
      populator: "ai", aiAutoFill: true,
    },
    {
      id: "f-vertical", key: "vertical", label: "Industry",
      type: "select",
      options: ["Logistics", "Healthcare", "Manufacturing", "Financial Services", "Retail", "Education", "Real Estate", "Technology", "Philanthropy"],
      showInFilters: true, position: 8,
      system: true, systemColumn: "vertical",
      populator: "ai", aiAutoFill: true,
    },
    {
      id: "f-geography", key: "geography", label: "Geography",
      type: "text",
      showInFilters: true, position: 9,
      system: true, systemColumn: "geography",
      populator: "ai", aiAutoFill: true,
    },
    {
      id: "f-companySize", key: "companySize", label: "Org size",
      type: "select",
      options: ["Small", "Mid-market", "Enterprise"],
      showInFilters: true, position: 10,
      system: true, systemColumn: "company_size",
      populator: "ai", aiAutoFill: true,
    },
    {
      id: "f-challenge", key: "challenge", label: "Challenge",
      type: "text",
      showInFilters: false, position: 11,
      system: true, systemColumn: "challenge",
      populator: "ai", aiAutoFill: true,
    },
    {
      id: "f-outcome", key: "outcome", label: "Outcome",
      type: "text",
      showInFilters: false, position: 12,
      system: true, systemColumn: "outcome",
      populator: "ai", aiAutoFill: true,
    },
    {
      id: "f-pullQuote", key: "pullQuote", label: "Pull quote",
      type: "text",
      showInFilters: false, position: 13,
      system: true, systemColumn: "pull_quote",
      populator: "ai", aiAutoFill: true,
    },

    // ── Manual (admin-set) ──
    {
      id: "f-assetType", key: "assetType", label: "Type",
      type: "select",
      options: ["Video Testimonial", "Written Case Study", "Quote"],
      showInFilters: true, position: 14,
      system: true, systemColumn: "asset_type",
      populator: "manual", aiAutoFill: false,
    },
    {
      id: "f-clientStatus", key: "clientStatus", label: "Client status",
      type: "select",
      options: ["current", "former", "unknown"],
      showInFilters: false, position: 15,
      system: true, systemColumn: "client_status",
      populator: "manual", aiAutoFill: false,
    },
  ];
}

// Validate a single FieldDef. Tolerant on read: missing populator /
// aiAutoFill default to "manual" / false so pre-expansion field defs
// load fine and get the new fields filled in.
export function validateFieldDef(d: unknown): { ok: true; def: FieldDef } | { ok: false; error: string } {
  if (!d || typeof d !== "object") return { ok: false, error: "field must be an object" };
  const f = d as Partial<FieldDef>;
  if (!f.id || typeof f.id !== "string") return { ok: false, error: "id required" };
  if (!f.key || typeof f.key !== "string") return { ok: false, error: "key required" };
  if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(f.key)) {
    return { ok: false, error: "key must start with a letter and contain only letters, numbers, underscores" };
  }
  if (!f.label || typeof f.label !== "string") return { ok: false, error: "label required" };
  if (!f.type || !["text", "select", "multi_select", "number", "date"].includes(f.type)) {
    return { ok: false, error: "type must be text / select / multi_select / number / date" };
  }
  if (f.options !== undefined && !Array.isArray(f.options)) {
    return { ok: false, error: "options must be an array of strings" };
  }
  const populator: FieldPopulator =
    f.populator === "vimeo" || f.populator === "ai" || f.populator === "manual"
      ? f.populator
      : "manual";
  // Vimeo-populated fields can never AI-fill. Force it off regardless
  // of what the client sent so the invariant holds at the data layer.
  const aiAutoFill = populator === "vimeo" ? false : !!f.aiAutoFill;
  return {
    ok: true,
    def: {
      id: f.id,
      key: f.key,
      label: f.label.trim(),
      type: f.type,
      options: Array.isArray(f.options) ? f.options.filter(o => typeof o === "string").map(o => o.trim()).filter(Boolean) : undefined,
      showInFilters: !!f.showInFilters,
      position: typeof f.position === "number" ? f.position : 9999,
      system: !!f.system,
      systemColumn: typeof f.systemColumn === "string" ? f.systemColumn : undefined,
      populator,
      aiAutoFill,
    },
  };
}

// Fetch the org's field definitions. On first call for a brand-new
// org, seeds the full default roster. For existing orgs, MERGES in
// any default system fields that aren't already stored — this is how
// the populator + aiAutoFill expansion reaches old orgs without a
// manual migration. Admin customizations to existing fields stay
// untouched.
export async function fetchOrgFieldDefs(orgId: string): Promise<FieldDef[]> {
  const { data, error } = await supabaseAdmin
    .from("organizations")
    .select("field_definitions")
    .eq("id", orgId)
    .maybeSingle();
  if (error) {
    console.error("[field-defs] fetch failed:", error);
    return defaultFieldDefs();
  }
  const raw = (data?.field_definitions as unknown[]) || null;
  const defaults = defaultFieldDefs();
  const defaultSystemByKey = new Map(defaults.filter(d => d.system).map(d => [d.key, d]));

  if (!Array.isArray(raw) || raw.length === 0) {
    // Brand-new org — seed full default set.
    await supabaseAdmin
      .from("organizations")
      .update({ field_definitions: defaults })
      .eq("id", orgId);
    return defaults;
  }

  // Filter to validated entries, tolerant on read.
  const cleaned: FieldDef[] = [];
  for (const item of raw) {
    const v = validateFieldDef(item);
    if (v.ok) cleaned.push(v.def);
  }

  // Merge step: insert any default system fields that aren't already
  // present. Drives the schema expansion for orgs that pre-date the
  // populator/aiAutoFill change. New entries get appended at the end
  // (max position + 1, +2, ...) so admin ordering preserves where it
  // can; admins can drag-reorder afterward.
  const existingKeys = new Set(cleaned.map(c => c.key));
  let nextPos = cleaned.length > 0 ? Math.max(...cleaned.map(c => c.position)) + 1 : 0;
  let inserted = false;
  for (const def of defaults) {
    if (!def.system) continue;
    if (existingKeys.has(def.key)) continue;
    cleaned.push({ ...def, position: nextPos++ });
    inserted = true;
  }
  // Also patch any existing system field that's missing the new
  // populator / aiAutoFill flags (validateFieldDef would have given
  // them defaults — but those defaults are "manual" / false, which
  // is wrong for, say, "vertical" which should be "ai"). For each
  // existing system field, if its populator looks default-stale
  // compared to the canonical default, copy the canonical's
  // populator + aiAutoFill across. Label, options, showInFilters,
  // position stay as admin customized them.
  for (let i = 0; i < cleaned.length; i++) {
    const c = cleaned[i];
    if (!c.system) continue;
    const canon = defaultSystemByKey.get(c.key);
    if (!canon) continue;
    // If we read raw JSON without populator at all (legacy), it
    // becomes "manual" + false. Patch toward the canonical default in
    // that case. Heuristic: if BOTH populator and aiAutoFill match
    // the validate-defaults pattern AND canonical disagrees, patch.
    const looksStale = c.populator === "manual" && c.aiAutoFill === false && canon.populator !== "manual";
    if (looksStale) {
      cleaned[i] = { ...c, populator: canon.populator, aiAutoFill: canon.aiAutoFill };
      inserted = true;
    }
  }

  cleaned.sort((a, b) => a.position - b.position);

  // Persist the merge so future reads skip this work.
  if (inserted) {
    await supabaseAdmin
      .from("organizations")
      .update({ field_definitions: cleaned })
      .eq("id", orgId);
  }

  return cleaned.length > 0 ? cleaned : defaults;
}

export async function writeOrgFieldDefs(orgId: string, defs: FieldDef[]): Promise<{ ok: true } | { ok: false; error: string }> {
  // Re-validate everything before writing.
  const validated: FieldDef[] = [];
  for (const d of defs) {
    const v = validateFieldDef(d);
    if (!v.ok) return { ok: false, error: v.error };
    validated.push(v.def);
  }
  // Enforce unique keys.
  const seen = new Set<string>();
  for (const d of validated) {
    if (seen.has(d.key)) return { ok: false, error: `duplicate key: ${d.key}` };
    seen.add(d.key);
  }
  // Reindex positions to keep storage tidy.
  validated.sort((a, b) => a.position - b.position).forEach((d, i) => { d.position = i; });
  const { error } = await supabaseAdmin
    .from("organizations")
    .update({ field_definitions: validated })
    .eq("id", orgId);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

// Generate a new UUID-ish id for a custom field.
export function buildFieldId(): string {
  return "f-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 7);
}
