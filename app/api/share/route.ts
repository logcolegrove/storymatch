import { NextRequest, NextResponse } from "next/server";
import { createHash, randomBytes } from "crypto";
import { supabaseAdmin } from "@/lib/supabase-server";

// Hash an IP the same way the public share page does, so we can compare a
// link's sender_ip_hash against a visitor's hash and flag self-views.
function hashIp(ip: string): string {
  return createHash("sha256")
    .update(ip + "|storymatch-share")
    .digest("hex")
    .slice(0, 16);
}

// Resolve the current authenticated user + their org (admin or sales role).
// Same pattern as other authenticated routes in this codebase.
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

// Short URL-safe ID. 6 characters of base62 = ~56 billion possibilities,
// plenty for our scale and looks clean in a URL.
const SHARE_ID_CHARSET =
  "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
function generateShareId(length = 6): string {
  const bytes = randomBytes(length);
  let id = "";
  for (let i = 0; i < length; i++) {
    id += SHARE_ID_CHARSET[bytes[i] % SHARE_ID_CHARSET.length];
  }
  return id;
}

// POST /api/share
// Body: { asset_id: string }
// Always creates a NEW share_link — each "I just sent this to someone" gets
// its own tracked entity, even when it's the same asset twice. We also
// capture the sender's IP hash here so the public page can flag self-views
// and exclude them from engagement metrics.
export async function POST(req: NextRequest) {
  const ctx = await getCurrentUserOrg(req);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { asset_id?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const assetId = body.asset_id;
  if (!assetId) {
    return NextResponse.json({ error: "asset_id required" }, { status: 400 });
  }

  // Verify the asset exists and belongs to this user's org
  const { data: asset } = await supabaseAdmin
    .from("assets")
    .select("id, org_id")
    .eq("id", assetId)
    .eq("org_id", ctx.orgId)
    .maybeSingle();
  if (!asset) {
    return NextResponse.json({ error: "Asset not found" }, { status: 404 });
  }

  // Capture the sender's IP hash so we can flag self-views on the public page
  const senderIp =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "unknown";
  const senderIpHash = hashIp(senderIp);

  // Generate a new ID and retry on the (extremely rare) collision case.
  let shareId = "";
  for (let attempt = 0; attempt < 5; attempt++) {
    const candidate = generateShareId();
    const { error } = await supabaseAdmin.from("share_links").insert({
      id: candidate,
      org_id: ctx.orgId,
      asset_id: assetId,
      sender_user_id: ctx.userId,
      sender_ip_hash: senderIpHash,
    });
    if (!error) {
      shareId = candidate;
      break;
    }
    // 23505 is Postgres's unique_violation — collision, regenerate
    if (error.code !== "23505") {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }
  if (!shareId) {
    return NextResponse.json(
      { error: "Could not generate unique share id; try again" },
      { status: 500 }
    );
  }

  const url = `${req.nextUrl.origin}/s/${shareId}`;
  return NextResponse.json({ share_id: shareId, url });
}
