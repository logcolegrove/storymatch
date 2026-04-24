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

// GET /api/vimeo/status
export async function GET(req: NextRequest) {
  const ctx = await getCurrentUserOrg(req);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data } = await supabaseAdmin
    .from("vimeo_connections")
    .select("vimeo_user_name, vimeo_user_id, created_at")
    .eq("user_id", ctx.userId)
    .maybeSingle();

  if (!data) {
    return NextResponse.json({ connected: false });
  }

  return NextResponse.json({
    connected: true,
    vimeoUserName: data.vimeo_user_name,
    vimeoUserId: data.vimeo_user_id,
    connectedAt: data.created_at,
  });
}

// DELETE /api/vimeo/status  (disconnect)
export async function DELETE(req: NextRequest) {
  const ctx = await getCurrentUserOrg(req);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { error } = await supabaseAdmin
    .from("vimeo_connections")
    .delete()
    .eq("user_id", ctx.userId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
