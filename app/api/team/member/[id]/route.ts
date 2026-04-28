import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";

// PATCH /api/team/member/[id]  — change a member's role
// DELETE /api/team/member/[id] — remove a member from the org
//
// Both endpoints are admin-only and scope to the caller's org. Guards prevent
// admins from accidentally locking themselves out by demoting or removing
// themselves while they're the only admin.

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

const ALLOWED_ROLES = new Set(["admin", "sales"]);

// Returns true if removing/demoting `targetUserId` would leave the org with
// zero admins. Used as a safety guard in PATCH and DELETE below.
async function wouldLeaveOrgAdminless(orgId: string, targetUserId: string): Promise<boolean> {
  const { data: admins } = await supabaseAdmin
    .from("org_members")
    .select("user_id")
    .eq("org_id", orgId)
    .eq("role", "admin");
  const adminIds = (admins || []).map((m) => m.user_id as string);
  return adminIds.length === 1 && adminIds[0] === targetUserId;
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = await getCurrentUserOrg(req);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (ctx.role !== "admin") {
    return NextResponse.json({ error: "Admins only" }, { status: 403 });
  }

  const { id: targetUserId } = await params;
  let body: { role?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const role = body.role;
  if (!role || !ALLOWED_ROLES.has(role)) {
    return NextResponse.json({ error: "role must be 'admin' or 'sales'" }, { status: 400 });
  }

  // Confirm the target is in this admin's org
  const { data: target } = await supabaseAdmin
    .from("org_members")
    .select("user_id, role")
    .eq("user_id", targetUserId)
    .eq("org_id", ctx.orgId)
    .maybeSingle();
  if (!target) {
    return NextResponse.json({ error: "Member not found" }, { status: 404 });
  }

  // If demoting an admin to sales, make sure at least one admin remains
  if (target.role === "admin" && role === "sales") {
    if (await wouldLeaveOrgAdminless(ctx.orgId, targetUserId)) {
      return NextResponse.json(
        { error: "Can't demote the last admin — promote another member first." },
        { status: 400 }
      );
    }
  }

  const { error } = await supabaseAdmin
    .from("org_members")
    .update({ role })
    .eq("user_id", targetUserId)
    .eq("org_id", ctx.orgId);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, role });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = await getCurrentUserOrg(req);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (ctx.role !== "admin") {
    return NextResponse.json({ error: "Admins only" }, { status: 403 });
  }

  const { id: targetUserId } = await params;

  // Don't let an admin remove the last admin (including themselves)
  if (await wouldLeaveOrgAdminless(ctx.orgId, targetUserId)) {
    return NextResponse.json(
      { error: "Can't remove the last admin — promote another member first." },
      { status: 400 }
    );
  }

  const { error } = await supabaseAdmin
    .from("org_members")
    .delete()
    .eq("user_id", targetUserId)
    .eq("org_id", ctx.orgId);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
