import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import crypto from "crypto";

// Helper: get current user + their org from auth header
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

// GET /api/vimeo/connect — returns a URL the frontend should redirect to
export async function GET(req: NextRequest) {
  const ctx = await getCurrentUserOrg(req);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (ctx.role !== "admin") {
    return NextResponse.json({ error: "Admins only" }, { status: 403 });
  }

  const clientId = process.env.VIMEO_CLIENT_ID!;
  if (!clientId) {
    return NextResponse.json(
      { error: "Vimeo OAuth not configured" },
      { status: 500 }
    );
  }

  // Build redirect URI — must match what's registered in Vimeo app settings
  const proto = req.nextUrl.protocol; // e.g., "https:"
  const host = req.nextUrl.host;      // e.g., "storymatch-gilt.vercel.app"
  const redirectUri = `${proto}//${host}/api/vimeo/callback`;

  // Generate a random state token for CSRF protection
  const state = crypto.randomBytes(16).toString("hex");

  // Save state to DB so the callback can verify it
  await supabaseAdmin.from("vimeo_oauth_state").insert({
    state,
    user_id: ctx.userId,
    org_id: ctx.orgId,
    return_to: req.nextUrl.searchParams.get("return_to") || "/",
  });

  // Build the Vimeo authorization URL
  const authUrl = new URL("https://api.vimeo.com/oauth/authorize");
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("client_id", clientId);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("state", state);
  authUrl.searchParams.set("scope", "public private video_files");

  return NextResponse.json({ url: authUrl.toString() });
}
