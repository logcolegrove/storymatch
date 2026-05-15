// /api/org/fields — list, replace, or batch-update the org's
// field schema. Single endpoint because the schema is one document
// per org — admins POST the full array of FieldDefs to update.

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { fetchOrgFieldDefs, writeOrgFieldDefs, validateFieldDef, type FieldDef } from "@/lib/field-defs";

async function getCurrentUserOrg(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;
  const token = authHeader.slice(7);
  const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !user) return null;
  const { data: membership } = await supabaseAdmin
    .from("org_members")
    .select("org_id, role")
    .eq("user_id", user.id)
    .limit(1)
    .maybeSingle();
  if (!membership) return null;
  return {
    userId: user.id,
    orgId: membership.org_id as string,
    role: membership.role as "admin" | "sales",
  };
}

// GET — returns the org's full field schema. Sales reps can read too
// (they need the schema to know what filters exist).
export async function GET(req: NextRequest) {
  const ctx = await getCurrentUserOrg(req);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const defs = await fetchOrgFieldDefs(ctx.orgId);
  return NextResponse.json({ fields: defs });
}

// PUT — replaces the entire field schema. Admins only. The body is
// the full array; the API enforces system-field invariants (system
// fields can't be deleted, system fields' key + systemColumn are
// immutable).
export async function PUT(req: NextRequest) {
  const ctx = await getCurrentUserOrg(req);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (ctx.role !== "admin") {
    return NextResponse.json({ error: "Admins only" }, { status: 403 });
  }
  const body = (await req.json().catch(() => ({}))) as { fields?: unknown };
  if (!Array.isArray(body.fields)) {
    return NextResponse.json({ error: "fields must be an array" }, { status: 400 });
  }

  // Validate each entry up front.
  const submitted: FieldDef[] = [];
  for (const f of body.fields) {
    const v = validateFieldDef(f);
    if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 });
    submitted.push(v.def);
  }

  // Enforce system-field invariants by diffing against the current schema.
  const current = await fetchOrgFieldDefs(ctx.orgId);
  const currentSystemById = new Map(current.filter(f => f.system).map(f => [f.id, f]));
  const submittedSystemIds = new Set(submitted.filter(f => f.system).map(f => f.id));
  // Every system field that existed must still exist (no deletion).
  for (const [id, sys] of currentSystemById) {
    if (!submittedSystemIds.has(id)) {
      return NextResponse.json({ error: `System field "${sys.label}" can't be removed` }, { status: 400 });
    }
  }
  // System fields' key + systemColumn are immutable.
  for (const f of submitted) {
    if (!f.system) continue;
    const orig = currentSystemById.get(f.id);
    if (!orig) {
      return NextResponse.json({ error: `Unknown system field id: ${f.id}` }, { status: 400 });
    }
    if (f.key !== orig.key) {
      return NextResponse.json({ error: `System field key is immutable for "${orig.label}"` }, { status: 400 });
    }
    if ((f.systemColumn || null) !== (orig.systemColumn || null)) {
      return NextResponse.json({ error: `System field column mapping can't change` }, { status: 400 });
    }
  }

  const result = await writeOrgFieldDefs(ctx.orgId, submitted);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 500 });
  const fresh = await fetchOrgFieldDefs(ctx.orgId);
  return NextResponse.json({ fields: fresh });
}
