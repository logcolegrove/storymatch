import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";

// GET /api/share/list — list shares (with aggregated engagement metrics) for
// the current authenticated user. Sales reps see their own; admins can pass
// ?scope=org to see everyone in their org.

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

interface ShareRow {
  id: string;
  asset_id: string;
  sender_user_id: string;
  recipient_label: string | null;
  created_at: string;
  click_count: number;
  last_clicked_at: string | null;
}

interface EventRow {
  share_id: string;
  event_type: string;
  watched_seconds: number | null;
  watched_percent: number | null;
  created_at: string;
}

export async function GET(req: NextRequest) {
  const ctx = await getCurrentUserOrg(req);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const scope = req.nextUrl.searchParams.get("scope"); // "org" for admin org-wide view
  const orgWide = scope === "org" && ctx.role === "admin";

  // Pull share_links — own (default) or org-wide (admin only)
  let q = supabaseAdmin
    .from("share_links")
    .select("id, asset_id, sender_user_id, recipient_label, created_at, click_count, last_clicked_at")
    .eq("org_id", ctx.orgId)
    .order("created_at", { ascending: false })
    .limit(200);
  if (!orgWide) q = q.eq("sender_user_id", ctx.userId);

  const { data: shares, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const shareRows = (shares || []) as ShareRow[];
  if (shareRows.length === 0) {
    return NextResponse.json({ shares: [] });
  }

  // Pull all events for those shares in one round-trip, then aggregate in JS.
  const shareIds = shareRows.map((s) => s.id);
  const { data: events } = await supabaseAdmin
    .from("share_events")
    .select("share_id, event_type, watched_seconds, watched_percent, created_at")
    .in("share_id", shareIds);
  const eventRows = (events || []) as EventRow[];

  // Aggregate
  const byShare = new Map<string, {
    maxPercent: number;
    maxSeconds: number;
    completed: boolean;
    plays: number;
    lastEventAt: string | null;
  }>();
  for (const e of eventRows) {
    const cur = byShare.get(e.share_id) || {
      maxPercent: 0,
      maxSeconds: 0,
      completed: false,
      plays: 0,
      lastEventAt: null,
    };
    if (e.watched_percent != null) cur.maxPercent = Math.max(cur.maxPercent, e.watched_percent);
    if (e.watched_seconds != null) cur.maxSeconds = Math.max(cur.maxSeconds, e.watched_seconds);
    if (e.event_type === "complete") cur.completed = true;
    if (e.event_type === "play") cur.plays += 1;
    if (!cur.lastEventAt || e.created_at > cur.lastEventAt) cur.lastEventAt = e.created_at;
    byShare.set(e.share_id, cur);
  }

  // Pull asset titles + thumbnails in one round-trip
  const assetIds = Array.from(new Set(shareRows.map((s) => s.asset_id)));
  const { data: assets } = await supabaseAdmin
    .from("assets")
    .select("id, headline, company, thumbnail, video_url")
    .in("id", assetIds);
  const assetMap = new Map<string, { headline: string; company: string; thumbnail: string; video_url: string }>();
  (assets || []).forEach((a) => {
    assetMap.set(a.id as string, {
      headline: (a.headline as string) || "",
      company: (a.company as string) || "",
      thumbnail: (a.thumbnail as string) || "",
      video_url: (a.video_url as string) || "",
    });
  });

  // Pull sender emails (only for org-wide view; otherwise it's all the same user)
  let senderEmailMap = new Map<string, string>();
  if (orgWide) {
    const senderIds = Array.from(new Set(shareRows.map((s) => s.sender_user_id)));
    // Use auth admin API to get emails for these users
    const { data: usersData } = await supabaseAdmin.auth.admin.listUsers({ perPage: 200 });
    if (usersData?.users) {
      const idSet = new Set(senderIds);
      for (const u of usersData.users) {
        if (idSet.has(u.id) && u.email) senderEmailMap.set(u.id, u.email);
      }
    }
  }

  const result = shareRows.map((s) => {
    const agg = byShare.get(s.id);
    const asset = assetMap.get(s.asset_id);
    return {
      id: s.id,
      asset_id: s.asset_id,
      sender_user_id: s.sender_user_id,
      sender_email: orgWide ? senderEmailMap.get(s.sender_user_id) || null : null,
      recipient_label: s.recipient_label,
      created_at: s.created_at,
      click_count: s.click_count,
      last_clicked_at: s.last_clicked_at,
      asset_headline: asset?.headline || "",
      asset_company: asset?.company || "",
      asset_thumbnail: asset?.thumbnail || "",
      max_watched_percent: agg?.maxPercent ?? 0,
      max_watched_seconds: agg?.maxSeconds ?? 0,
      completed: agg?.completed ?? false,
      play_count: agg?.plays ?? 0,
      last_event_at: agg?.lastEventAt ?? null,
    };
  });

  return NextResponse.json({ shares: result, scope: orgWide ? "org" : "self" });
}
