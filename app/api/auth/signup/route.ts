import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";

const BOOTSTRAP_ADMIN_EMAIL = "logcolegrove@gmail.com";

export async function POST(req: NextRequest) {
  try {
    const { email, password, inviteToken } = await req.json();

    if (!email || !password) {
      return NextResponse.json(
        { error: "Email and password required" },
        { status: 400 }
      );
    }

    if (password.length < 8) {
      return NextResponse.json(
        { error: "Password must be at least 8 characters" },
        { status: 400 }
      );
    }

    const isBootstrapAdmin = email.toLowerCase() === BOOTSTRAP_ADMIN_EMAIL.toLowerCase();

    // If not bootstrap admin, require a valid invite
    let invite: {
      id: string;
      org_id: string;
      role: "admin" | "sales";
      accepted_at: string | null;
      expires_at: string;
    } | null = null;

    if (!isBootstrapAdmin) {
      if (!inviteToken) {
        return NextResponse.json(
          { error: "An invite link is required to sign up. Ask an admin for an invite." },
          { status: 403 }
        );
      }

      const { data: inviteData, error: inviteError } = await supabaseAdmin
        .from("invites")
        .select("id, org_id, role, accepted_at, expires_at")
        .eq("token", inviteToken)
        .maybeSingle();

      if (inviteError || !inviteData) {
        return NextResponse.json(
          { error: "Invalid or expired invite link" },
          { status: 403 }
        );
      }

      if (inviteData.accepted_at) {
        return NextResponse.json(
          { error: "This invite has already been used" },
          { status: 403 }
        );
      }

      // expires_at is nullable now — invites without an expiration always work
      // until accepted or revoked. Older invites still honor their stored expiry.
      if (inviteData.expires_at && new Date(inviteData.expires_at) < new Date()) {
        return NextResponse.json(
          { error: "This invite has expired" },
          { status: 403 }
        );
      }

      invite = inviteData;
    }

    // Create the user
    const { data: userData, error: userError } =
      await supabaseAdmin.auth.admin.createUser({
        email,
        password,
        email_confirm: true, // auto-confirm, no email verification
      });

    if (userError || !userData.user) {
      return NextResponse.json(
        { error: userError?.message || "Failed to create user" },
        { status: 500 }
      );
    }

    const userId = userData.user.id;

    // If this is an invited user, add them to the org and mark invite as used
    if (invite) {
      await supabaseAdmin.from("org_members").insert({
        user_id: userId,
        org_id: invite.org_id,
        role: invite.role,
      });

      await supabaseAdmin
        .from("invites")
        .update({ accepted_at: new Date().toISOString(), accepted_by: userId })
        .eq("id", invite.id);
    }
    // Bootstrap admin gets an org auto-created by the DB trigger, nothing to do here

    return NextResponse.json({ ok: true, userId });
  } catch (e) {
    console.error("Signup error:", e);
    return NextResponse.json(
      { error: (e as Error).message || "Signup failed" },
      { status: 500 }
    );
  }
}
