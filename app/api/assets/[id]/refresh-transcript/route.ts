import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { fetchTranscriptForVideoUrl } from "@/lib/source-sync";

// POST /api/assets/[id]/refresh-transcript
// Admin-only. Re-fetches the VTT from the asset's source video, parses
// it into timestamped segments, and writes both the plain transcript
// and segments back to the asset row. This exists so admins can
// backfill transcript_segments for assets that were imported before
// segment capture shipped — without having to run a full source sync.

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

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await getCurrentUserOrg(req);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (ctx.role !== "admin") {
    return NextResponse.json({ error: "Admins only" }, { status: 403 });
  }

  const { id } = await params;

  // Look up the asset's video URL (and confirm it belongs to this org).
  const { data: asset, error: assetErr } = await supabaseAdmin
    .from("assets")
    .select("id, org_id, video_url")
    .eq("id", id)
    .maybeSingle();
  if (assetErr || !asset) {
    return NextResponse.json({ error: "Asset not found" }, { status: 404 });
  }
  if ((asset.org_id as string) !== ctx.orgId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const videoUrl = (asset.video_url as string) || "";
  if (!videoUrl) {
    return NextResponse.json({ error: "Asset has no video URL" }, { status: 400 });
  }

  const result = await fetchTranscriptForVideoUrl(ctx.orgId, videoUrl);
  if (!result) {
    return NextResponse.json(
      { error: "Couldn't fetch transcript — make sure Vimeo is connected and the video has captions." },
      { status: 502 },
    );
  }

  const { plain, segments } = result;
  // Persist both fields. We don't touch last_synced_transcript here —
  // this is a manual re-fetch, not a true "sync from source", so we
  // leave drift detection alone.
  const { error: updateErr } = await supabaseAdmin
    .from("assets")
    .update({
      transcript: plain,
      transcript_segments: segments,
    })
    .eq("id", id);
  if (updateErr) {
    return NextResponse.json({ error: "Failed to save transcript" }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    transcript: plain,
    transcriptSegments: segments,
  });
}
