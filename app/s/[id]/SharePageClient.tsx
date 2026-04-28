"use client";

// Public-facing testimonial page. Renders the same AssetDetail component the
// internal library uses, with publicMode=true to strip admin chrome.

import AssetDetail, { AssetDetailAsset } from "../../components/AssetDetail";

interface ServerAsset {
  id: string;
  headline: string | null;
  pull_quote: string | null;
  description: string | null;
  video_url: string | null;
  thumbnail: string | null;
  client_name: string | null;
  company: string | null;
  vertical: string | null;
  // Optional extra fields the detail view uses; missing on the server query
  // get sensible defaults below.
  asset_type?: string | null;
  challenge?: string | null;
  outcome?: string | null;
  geography?: string | null;
  company_size?: string | null;
  transcript?: string | null;
  status?: string | null;
}

// Map server snake_case → camelCase so the shared component sees the shape it expects.
function toAssetDetail(s: ServerAsset): AssetDetailAsset {
  return {
    id: s.id,
    headline: s.headline || "Customer story",
    pullQuote: s.pull_quote || "",
    description: s.description || "",
    transcript: s.transcript || "",
    videoUrl: s.video_url || "",
    thumbnail: s.thumbnail || "",
    clientName: s.client_name || "",
    company: s.company || "",
    vertical: s.vertical || "",
    geography: s.geography || "",
    companySize: s.company_size || "",
    challenge: s.challenge || "",
    outcome: s.outcome || "",
    assetType: s.asset_type || "Video Testimonial",
    status: s.status || "published",
  };
}

export default function SharePageClient({ asset, shareId }: { asset: ServerAsset; shareId: string }) {
  return (
    <div style={{ minHeight: "100vh", background: "#fafafa" }}>
      <AssetDetail
        asset={toAssetDetail(asset)}
        publicMode
        shareTracking={{ shareId }}
      />
    </div>
  );
}
