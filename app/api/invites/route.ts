import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
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

const INVITE_DAYS = 7;
const ALLOWED_ROLES = new Set(["admin", "sales"]);

// POST /api/invites
// Body: { role: "admin" | "sales" }
// Generates a fresh invite token bound to the admin's org. The link the admin
// shares is `/signup?invite=<token>`. Token is single-use (existing signup
// route already checks accepted_at and expires_at).
export async function POST(req: NextRequest) {
  const ctx = await getCurrentUserOrg(req);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (ctx.role !== "admin") {
    return NextResponse.json({ error: "Only admins can create invites" }, { status: 403 });
  }

  let body: { role?: string; email?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const role = body.role;
  if (!role || !ALLOWED_ROLES.has(role)) {
    return NextResponse.json({ error: "role must be 'admin' or 'sales'" }, { status: 400 });
  }
  // Optional email — stored on the invite so the admin can see who they sent
  // it to in the pending-invites list. We don't actually email it out (admin
  // shares the link manually), but tracking the recipient is useful.
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : null;
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: "Invalid email address" }, { status: 400 });
  }

  // 32 bytes of randomness → ~43 char base64url string. More than enough entropy.
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + INVITE_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabaseAdmin
    .from("invites")
    .insert({
      token,
      org_id: ctx.orgId,
      role,
      expires_at: expiresAt,
      invited_email: email,
    })
    .select("id, token, role, expires_at, created_at, invited_email")
    .single();

  if (error) {
    console.error("invite create failed:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    id: data.id,
    token: data.token,
    role: data.role,
    invited_email: data.invited_email,
    expires_at: data.expires_at,
    url: `${req.nextUrl.origin}/signup?invite=${data.token}`,
  });
}
