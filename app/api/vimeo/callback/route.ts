import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";

// GET /api/vimeo/callback?code=xxx&state=yyy
export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  const errorParam = req.nextUrl.searchParams.get("error");

  // User declined, or Vimeo sent an error
  if (errorParam) {
    return NextResponse.redirect(
      new URL(`/?vimeo_error=${encodeURIComponent(errorParam)}`, req.nextUrl.origin)
    );
  }

  if (!code || !state) {
    return NextResponse.redirect(new URL("/?vimeo_error=missing_params", req.nextUrl.origin));
  }

  // Look up the saved state from DB
  const { data: stateRow, error: stateError } = await supabaseAdmin
    .from("vimeo_oauth_state")
    .select("*")
    .eq("state", state)
    .maybeSingle();

  if (stateError || !stateRow) {
    return NextResponse.redirect(new URL("/?vimeo_error=invalid_state", req.nextUrl.origin));
  }

  if (new Date(stateRow.expires_at) < new Date()) {
    return NextResponse.redirect(new URL("/?vimeo_error=state_expired", req.nextUrl.origin));
  }

  // Delete the state row (one-time use)
  await supabaseAdmin.from("vimeo_oauth_state").delete().eq("state", state);

  // Build redirect URI (must match the one used in the authorize step)
  const proto = req.nextUrl.protocol;
  const host = req.nextUrl.host;
  const redirectUri = `${proto}//${host}/api/vimeo/callback`;

  // Exchange the code for an access token
  const clientId = process.env.VIMEO_CLIENT_ID!;
  const clientSecret = process.env.VIMEO_CLIENT_SECRET!;
  const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

  try {
    const tokenRes = await fetch("https://api.vimeo.com/oauth/access_token", {
      method: "POST",
      headers: {
        Authorization: `Basic ${basicAuth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
      }),
    });

    if (!tokenRes.ok) {
      const errText = await tokenRes.text();
      console.error("Vimeo token exchange failed:", tokenRes.status, errText);
      return NextResponse.redirect(
        new URL(`/?vimeo_error=token_exchange_failed`, req.nextUrl.origin)
      );
    }

    const tokenData = await tokenRes.json();
    // tokenData: { access_token, token_type, scope, user, app }

    // Extract user info from the response
    const vimeoUserId = tokenData.user?.uri?.split("/").pop() || null;
    const vimeoUserName = tokenData.user?.name || null;
    const vimeoUserUri = tokenData.user?.uri || null;

    // Upsert the connection
    const { error: upsertError } = await supabaseAdmin
      .from("vimeo_connections")
      .upsert(
        {
          user_id: stateRow.user_id,
          org_id: stateRow.org_id,
          vimeo_user_id: vimeoUserId,
          vimeo_user_name: vimeoUserName,
          vimeo_user_uri: vimeoUserUri,
          access_token: tokenData.access_token,
          scope: tokenData.scope,
        },
        { onConflict: "user_id" }
      );

    if (upsertError) {
      console.error("Failed to save vimeo connection:", upsertError);
      return NextResponse.redirect(
        new URL(`/?vimeo_error=save_failed`, req.nextUrl.origin)
      );
    }

    // Success — redirect back to the app
    return NextResponse.redirect(
      new URL(`${stateRow.return_to || "/"}?vimeo_connected=1`, req.nextUrl.origin)
    );
  } catch (e) {
    console.error("Vimeo callback error:", e);
    return NextResponse.redirect(
      new URL(`/?vimeo_error=${encodeURIComponent((e as Error).message)}`, req.nextUrl.origin)
    );
  }
}
