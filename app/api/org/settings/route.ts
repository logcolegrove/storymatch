import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";

// /api/org/settings — read+write the current user's org-level Rules settings.
// GET: any member can read (so the cleared signal in the library reflects org policy).
// PUT: admins only — Rules are policy decisions.

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

// Camel-case shape returned to the FE. Keep this stable; future Rules add
// new optional fields here but never remove old ones.
type OrgSettingsFE = {
  freshnessWarnAfterMonths: number | null;
};

export async function GET(req: NextRequest) {
  const ctx = await getCurrentUserOrg(req);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { data, error } = await supabaseAdmin
    .from("organizations")
    .select("freshness_warn_after_months")
    .eq("id", ctx.orgId)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const settings: OrgSettingsFE = {
    freshnessWarnAfterMonths: (data?.freshness_warn_after_months as number | null) ?? null,
  };
  return NextResponse.json(settings);
}

export async function PUT(req: NextRequest) {
  const ctx = await getCurrentUserOrg(req);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (ctx.role !== "admin") {
    return NextResponse.json({ error: "Admins only" }, { status: 403 });
  }
  const body = (await req.json().catch(() => ({}))) as Partial<OrgSettingsFE>;
  // Validate: months must be a positive int (or null = "off")
  const months = body.freshnessWarnAfterMonths;
  if (months !== null && months !== undefined) {
    if (typeof months !== "number" || !Number.isInteger(months) || months <= 0 || months > 600) {
      return NextResponse.json({ error: "freshnessWarnAfterMonths must be a positive integer (or null to disable)" }, { status: 400 });
    }
  }
  const updates: { freshness_warn_after_months?: number | null } = {};
  if (body.freshnessWarnAfterMonths !== undefined) {
    updates.freshness_warn_after_months = body.freshnessWarnAfterMonths;
  }
  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }
  const { data, error } = await supabaseAdmin
    .from("organizations")
    .update(updates)
    .eq("id", ctx.orgId)
    .select("freshness_warn_after_months")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const settings: OrgSettingsFE = {
    freshnessWarnAfterMonths: (data?.freshness_warn_after_months as number | null) ?? null,
  };
  return NextResponse.json(settings);
}
