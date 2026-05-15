// Field definitions: per-org schema for what fields exist on every
// asset. Includes "system" fields (backed by typed columns on the
// assets table — admin can rename + hide but not delete) and
// "custom" fields (stored in assets.custom_field_values JSONB —
// fully admin-controlled).
//
// The library filter popover, the AssetEditPanel form, and (later)
// the list-view column picker all read from this single schema, so
// adding a new field is one action that propagates everywhere.

import { supabaseAdmin } from "./supabase-server";

export type FieldType = "text" | "select" | "multi_select" | "number" | "date";

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
}

// Foundant-style defaults. Every NEW org gets these on first read of
// /api/org/fields. Existing orgs with assets but no field_definitions
// get the same set, retro-fitted.
export function defaultFieldDefs(): FieldDef[] {
  return [
    {
      id: "f-vertical", key: "vertical", label: "Industry",
      type: "select",
      options: ["Logistics", "Healthcare", "Manufacturing", "Financial Services", "Retail", "Education", "Real Estate", "Technology", "Philanthropy"],
      showInFilters: true, position: 0, system: true, systemColumn: "vertical",
    },
    {
      id: "f-geography", key: "geography", label: "Geography",
      type: "text",
      showInFilters: true, position: 1, system: true, systemColumn: "geography",
    },
    {
      id: "f-companySize", key: "companySize", label: "Org size",
      type: "select",
      options: ["Small", "Mid-market", "Enterprise"],
      showInFilters: true, position: 2, system: true, systemColumn: "company_size",
    },
    {
      id: "f-assetType", key: "assetType", label: "Type",
      type: "select",
      options: ["Video Testimonial", "Written Case Study", "Quote"],
      showInFilters: true, position: 3, system: true, systemColumn: "asset_type",
    },
    {
      id: "f-clientStatus", key: "clientStatus", label: "Client status",
      type: "select",
      options: ["current", "former", "unknown"],
      showInFilters: false, position: 4, system: true, systemColumn: "client_status",
    },
  ];
}

// Validate that a single FieldDef has all required pieces. Used in
// the API on POST / PATCH to refuse malformed input.
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
    },
  };
}

// Fetch the org's field definitions. Seeds defaults on first call.
// Always returns a defined array.
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
  if (!Array.isArray(raw) || raw.length === 0) {
    // First read for this org → seed defaults so future reads find them.
    const defaults = defaultFieldDefs();
    await supabaseAdmin
      .from("organizations")
      .update({ field_definitions: defaults })
      .eq("id", orgId);
    return defaults;
  }
  // Filter out anything malformed; tolerant on read.
  const cleaned: FieldDef[] = [];
  for (const item of raw) {
    const v = validateFieldDef(item);
    if (v.ok) cleaned.push(v.def);
  }
  cleaned.sort((a, b) => a.position - b.position);
  return cleaned.length > 0 ? cleaned : defaultFieldDefs();
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
