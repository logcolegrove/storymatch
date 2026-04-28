import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";

// GET /api/team
// Admin-only. Returns the workspace's active members + pending invites with
// last-login info, so the admin can see who's on the team and when they were
// last active.

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

export async function GET(req: NextRequest) {
  const ctx = await getCurrentUserOrg(req);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (ctx.role !== "admin") {
    return NextResponse.json({ error: "Admins only" }, { status: 403 });
  }

  // Active members of this org
  const { data: members, error: membersError } = await supabaseAdmin
    .from("org_members")
    .select("user_id, role, created_at")
    .eq("org_id", ctx.orgId);
  if (membersError) {
    return NextResponse.json({ error: membersError.message }, { status: 500 });
  }

  // Look up emails + last-login timestamps from auth.users (admin API)
  const memberIds = new Set((members || []).map((m) => m.user_id as string));
  const { data: usersList } = await supabaseAdmin.auth.admin.listUsers({ perPage: 200 });
  const userMeta = new Map<string, { email: string; last_sign_in_at: string | null }>();
  if (usersList?.users) {
    for (const u of usersList.users) {
      if (memberIds.has(u.id)) {
        userMeta.set(u.id, {
          email: u.email || "",
          last_sign_in_at: u.last_sign_in_at || null,
        });
      }
    }
  }

  const teamMembers = (members || []).map((m) => {
    const meta = userMeta.get(m.user_id as string);
    return {
      user_id: m.user_id,
      email: meta?.email || "(unknown)",
      role: m.role,
      joined_at: m.created_at,
      last_sign_in_at: meta?.last_sign_in_at ?? null,
      is_self: m.user_id === ctx.userId,
    };
  }).sort((a, b) => {
    // Admins first, then by email alphabetically
    if (a.role !== b.role) return a.role === "admin" ? -1 : 1;
    return a.email.localeCompare(b.email);
  });

  // Pending invites (not yet accepted, not expired)
  const nowIso = new Date().toISOString();
  const { data: invites } = await supabaseAdmin
    .from("invites")
    .select("id, role, expires_at, created_at, accepted_at")
    .eq("org_id", ctx.orgId)
    .is("accepted_at", null)
    .gt("expires_at", nowIso)
    .order("created_at", { ascending: false });

  const pendingInvites = (invites || []).map((i) => ({
    id: i.id,
    role: i.role,
    created_at: i.created_at,
    expires_at: i.expires_at,
  }));

  return NextResponse.json({ members: teamMembers, pending_invites: pendingInvites });
}
