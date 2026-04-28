// Public-facing testimonial page reached via a share link.
//
// No authentication required — this is what a sales rep's prospect sees when
// they click a link in an email. We render the testimonial cleanly (video
// front and center, headline, pull quote, description) and silently record a
// click event so the rep / admin can see engagement later.
//
// Phase 1: just records the click. Phase 2 will add player events
// (play / progress / completion) via Vimeo's Player JS API.

import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { createHash } from "crypto";
import { supabaseAdmin } from "@/lib/supabase-server";
import SharePageClient from "./SharePageClient";

interface Asset {
  id: string;
  headline: string | null;
  pull_quote: string | null;
  description: string | null;
  video_url: string | null;
  thumbnail: string | null;
  client_name: string | null;
  company: string | null;
  vertical: string | null;
  asset_type: string | null;
  challenge: string | null;
  outcome: string | null;
  geography: string | null;
  company_size: string | null;
  transcript: string | null;
  status: string | null;
}

function hashIp(ip: string): string {
  // Hash with a server-side suffix so the hash isn't a trivial rainbow-table
  // lookup. Keep it short — we only use it for rough de-dupe of repeat visits.
  return createHash("sha256")
    .update(ip + "|storymatch-share")
    .digest("hex")
    .slice(0, 16);
}

export default async function SharePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  // 1. Look up the share link
  const { data: shareLink } = await supabaseAdmin
    .from("share_links")
    .select("id, asset_id, sender_user_id, click_count, sender_ip_hash")
    .eq("id", id)
    .maybeSingle();

  if (!shareLink) notFound();

  // 2. Look up the underlying asset
  const { data: asset } = await supabaseAdmin
    .from("assets")
    .select(
      "id, headline, pull_quote, description, video_url, thumbnail, client_name, company, vertical, asset_type, challenge, outcome, geography, company_size, transcript, status"
    )
    .eq("id", shareLink.asset_id)
    .maybeSingle<Asset>();

  if (!asset) notFound();

  // 3. Record a click event (fire-and-forget — don't block render on it).
  // If the visitor's IP hash matches the share's sender_ip_hash, mark the
  // event as is_self so it gets excluded from engagement metrics. Reps
  // testing their own links shouldn't pollute the dashboard.
  try {
    const h = await headers();
    const ip =
      h.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      h.get("x-real-ip") ||
      "unknown";
    const ua = (h.get("user-agent") || "").slice(0, 500);
    const ipHash = hashIp(ip);
    const isSelf = !!shareLink.sender_ip_hash && shareLink.sender_ip_hash === ipHash;

    // Always log the event, but only bump the public click_count counter for
    // non-self views. (We aggregate from share_events anyway in /api/share/list,
    // but keep the denorm counter useful too.)
    await supabaseAdmin.from("share_events").insert({
      share_id: shareLink.id,
      event_type: "click",
      ip_hash: ipHash,
      user_agent: ua,
      is_self: isSelf,
    });
    if (!isSelf) {
      await supabaseAdmin
        .from("share_links")
        .update({
          click_count: (shareLink.click_count || 0) + 1,
          last_clicked_at: new Date().toISOString(),
        })
        .eq("id", shareLink.id);
    }
  } catch (e) {
    // Tracking failure should never block the prospect from seeing the testimonial
    console.error("share click tracking failed:", e);
  }

  return <SharePageClient asset={asset} shareId={shareLink.id} />;
}
