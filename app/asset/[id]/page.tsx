// Public asset page reached from a showcase's "Open in new tab"
// click target. Unlike /s/[id] (which is the tracked-share-link
// route with click counting + visitor tracking), this is a plain
// public URL — anyone with the asset ID can open it as long as
// the asset is Public. No tracking, no auth, no admin chrome.
//
// Used by showcase asset cards configured with clickTarget="newpage"
// so middle-click / cmd-click open natively in a new tab. Single-
// asset shares should still go through /api/share + /s/[id] when
// engagement tracking matters; this route is for the "send me a
// link to this asset" casual case.

import { notFound } from "next/navigation";
import { supabaseAdmin } from "@/lib/supabase-server";
import SharePageClient from "../../s/[id]/SharePageClient";

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

export default async function AssetPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const { data: asset } = await supabaseAdmin
    .from("assets")
    .select(
      "id, headline, pull_quote, description, video_url, thumbnail, client_name, company, vertical, asset_type, challenge, outcome, geography, company_size, transcript, status",
    )
    .eq("id", id)
    .eq("status", "published")
    .maybeSingle<Asset>();

  if (!asset) notFound();

  // Reuse the share page's client component — it already renders
  // AssetDetail in publicMode with all the right chrome. We pass
  // empty share-tracking so the client's analytics code becomes
  // a no-op (no shareId, no visitor counting).
  return (
    <SharePageClient asset={asset} shareId="" visitorId={null} />
  );
}
