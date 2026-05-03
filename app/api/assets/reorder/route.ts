// POST /api/assets/reorder — admin-only bulk update of display_order.
// Called when an admin drag-reorders cards in the library. Body is a
// list of {id, position} pairs; we update each row in one round trip.

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";

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

interface ReorderBody {
  positions?: { id: string; position: number }[];
}

export async function POST(req: NextRequest) {
  const ctx = await getCurrentUserOrg(req);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (ctx.role !== "admin") {
    return NextResponse.json({ error: "Admins only" }, { status: 403 });
  }

  const body = (await req.json().catch(() => ({}))) as ReorderBody;
  const positions = Array.isArray(body.positions) ? body.positions : [];
  if (positions.length === 0) {
    return NextResponse.json({ error: "positions required" }, { status: 400 });
  }
  // Cap at 5000 — sanity limit. A real org won't ship that many in one go.
  if (positions.length > 5000) {
    return NextResponse.json({ error: "too many positions" }, { status: 400 });
  }

  // Update each row. We could batch this with a CASE expression but
  // the simpler N-row update is fast enough for typical libraries
  // (hundreds of assets, not thousands). We always scope by org_id
  // so admins can't shuffle another org's data even with a forged id.
  const errors: string[] = [];
  await Promise.all(positions.map(async p => {
    if (typeof p.id !== "string" || typeof p.position !== "number" || !Number.isFinite(p.position)) {
      errors.push(`bad row: ${JSON.stringify(p)}`);
      return;
    }
    const { error } = await supabaseAdmin
      .from("assets")
      .update({ display_order: Math.round(p.position) })
      .eq("id", p.id)
      .eq("org_id", ctx.orgId);
    if (error) errors.push(`${p.id}: ${error.message}`);
  }));

  if (errors.length > 0) {
    console.error("[assets/reorder] partial failure:", errors);
    return NextResponse.json(
      { ok: false, errors, updated: positions.length - errors.length },
      { status: 207 }, // 207 Multi-Status — some succeeded
    );
  }
  return NextResponse.json({ ok: true, updated: positions.length });
}
