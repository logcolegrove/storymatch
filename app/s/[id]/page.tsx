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
import { headers, cookies } from "next/headers";
import { supabaseAdmin } from "@/lib/supabase-server";
import { hashIp, isBotUserAgent } from "@/lib/share-tracking";
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

  // 3. Resolve the visitor identity. The middleware sets `sm_visitor_id` on
  // first visit; we read it here so this very first click event carries it
  // and so the client can include it in subsequent event POSTs.
  const cookieStore = await cookies();
  const visitorId = cookieStore.get("sm_visitor_id")?.value || null;

  // 4. Record a click event — but skip bot-like user agents (link-preview
  // scanners, email security gateways, etc.) so the dashboard isn't polluted.
  try {
    const h = await headers();
    const ip =
      h.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      h.get("x-real-ip") ||
      "unknown";
    const ua = (h.get("user-agent") || "").slice(0, 500);
    const ipHash = hashIp(ip);
    const isSelf = !!shareLink.sender_ip_hash && shareLink.sender_ip_hash === ipHash;
    const isBot = isBotUserAgent(ua);

    if (!isBot) {
      await supabaseAdmin.from("share_events").insert({
        share_id: shareLink.id,
        event_type: "click",
        ip_hash: ipHash,
        user_agent: ua,
        is_self: isSelf,
        visitor_id: visitorId,
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
    }
  } catch (e) {
    console.error("share click tracking failed:", e);
  }

  return <SharePageClient asset={asset} shareId={shareLink.id} visitorId={visitorId} />;
}
