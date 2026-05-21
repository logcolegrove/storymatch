"use client";

// Public showcase page client. Walks the showcase's template via
// ShowcaseRenderer and lets viewers click into individual assets.
// The page itself is a thin shell — chrome + back-nav + the
// AssetDetail view. The actual layout lives in the template.
//
// v1 always uses the "default" template — admin template
// selection arrives in Phase B2.2 (a template_id column on the
// showcases table + picker in the editor modal).

import { useState } from "react";
import AssetDetail, { type AssetDetailAsset } from "../../components/AssetDetail";
import ShowcaseRenderer, { type ShowcaseRenderAsset } from "../../components/ShowcaseRenderer";
import { effectiveTemplate } from "@/lib/showcase-templates";
import type { TemplateBlock } from "@/lib/showcase-templates";

interface ShowcaseAsset {
  id: string;
  headline: string;
  pull_quote: string;
  description: string;
  video_url: string;
  thumbnail: string;
  client_name: string;
  company: string;
  vertical: string;
  asset_type: string;
}

interface Props {
  showcase: {
    id: string;
    name: string;
    description: string | null;
    templateId: string | null;
    templateConfig: TemplateBlock[] | null;
  };
  assets: ShowcaseAsset[];
}

// Server-side ShowcaseAsset → AssetDetail's camelCase shape. The
// public asset detail only needs the slim subset; AssetDetail's
// optional fields default sensibly when missing.
function toAssetDetail(a: ShowcaseAsset): AssetDetailAsset {
  return {
    id: a.id,
    headline: a.headline || "Customer story",
    pullQuote: a.pull_quote || "",
    description: a.description || "",
    transcript: "",
    videoUrl: a.video_url || "",
    thumbnail: a.thumbnail || "",
    clientName: a.client_name || "",
    company: a.company || "",
    vertical: a.vertical || "",
    geography: "",
    companySize: "",
    challenge: "",
    outcome: "",
    assetType: a.asset_type || "Video Testimonial",
    status: "published",
  };
}

// Server-side ShowcaseAsset → renderer-facing shape (only the
// fields the blocks need; keeps the data graph tight).
function toRenderAsset(a: ShowcaseAsset): ShowcaseRenderAsset {
  return {
    id: a.id,
    headline: a.headline,
    pull_quote: a.pull_quote,
    client_name: a.client_name,
    company: a.company,
    thumbnail: a.thumbnail,
  };
}

export default function ShowcasePageClient({ showcase, assets }: Props) {
  // Active asset (if any) drives whether we show the template-
  // rendered index or the asset detail view. null = showing index.
  const [activeAssetId, setActiveAssetId] = useState<string | null>(null);
  const activeAsset = activeAssetId ? assets.find(a => a.id === activeAssetId) || null : null;

  // Effective template = showcase's saved templateConfig (if it's
  // been customized) or the named template (if just a starter).
  // Defaults to "default" preset when both are null. Safe across
  // schema migrations and template-registry changes.
  const template = effectiveTemplate(showcase.templateConfig, showcase.templateId);

  return (
    <div className="sp">
      <style>{css}</style>

      {activeAsset ? (
        <div className="sp-asset-wrap">
          <div className="sp-asset-nav">
            <button type="button" className="sp-back" onClick={() => setActiveAssetId(null)}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="19" y1="12" x2="5" y2="12"/>
                <polyline points="12 19 5 12 12 5"/>
              </svg>
              Back to {showcase.name}
            </button>
          </div>
          <AssetDetail asset={toAssetDetail(activeAsset)} publicMode/>
        </div>
      ) : (
        <ShowcaseRenderer
          template={template}
          context={{
            showcase,
            assets: assets.map(toRenderAsset),
            onAssetClick: (id) => setActiveAssetId(id),
          }}
        />
      )}
    </div>
  );
}

const css = `
@import url('https://fonts.googleapis.com/css2?family=Instrument+Sans:wght@400;500;600;700&family=Newsreader:ital,opsz,wght@0,6..72,400;0,6..72,500;0,6..72,600&display=swap');
:root{
  --bg:#fafafa;--bg2:#f4f4f6;--bg3:#ededf0;
  --border:#e2e2e6;--border2:#d0d0d6;
  --t1:#111118;--t2:#55556a;--t3:#8888a0;--t4:#aaaabb;
  --accent:#6d28d9;--accent2:#7c3aed;--accentL:#ede9fe;--accentLL:#f5f3ff;
  --font:'Instrument Sans',-apple-system,sans-serif;
  --serif:'Newsreader',Georgia,serif;
}
body{background:var(--bg);margin:0;font-family:var(--font);color:var(--t1);}

.sp{min-height:100vh;background:var(--bg);font-family:var(--font);color:var(--t1);}

.sp-asset-wrap{padding-top:0;}
.sp-asset-nav{max-width:1100px;margin:0 auto;padding:18px 32px 0;}
.sp-back{display:inline-flex;align-items:center;gap:6px;padding:7px 12px;border:1px solid var(--border);border-radius:8px;background:#fff;color:var(--t2);font-family:var(--font);font-size:12.5px;font-weight:600;cursor:pointer;transition:all .12s;}
.sp-back:hover{background:var(--bg2);color:var(--t1);}

@media (max-width: 700px) {
  .sp-asset-nav{padding:14px 20px 0;}
}
`;
