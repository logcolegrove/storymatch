"use client";

// Public-facing showcase renderer. Hardcoded "default" layout for
// v1 — hero (showcase name + description) over a grid of asset
// cards. Clicking an asset card swaps the page to render
// AssetDetail (publicMode) for that asset, with a back-to-
// showcase nav at the top. URL stays at /showcase/[id]; the
// active asset is client-side state only. Good enough for v1;
// Phase B2 will move this layout into a template definition so
// admins can pick alternatives.

import { useState } from "react";
import AssetDetail, { type AssetDetailAsset } from "../../components/AssetDetail";

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
  };
  assets: ShowcaseAsset[];
}

// Server-side ShowcaseAsset → AssetDetail's camelCase shape. We
// only ship a slim subset back to the public page; AssetDetail's
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

export default function ShowcasePageClient({ showcase, assets }: Props) {
  // The active asset (if any) drives whether we render the
  // showcase index or the asset-detail view. null = showing index.
  const [activeAssetId, setActiveAssetId] = useState<string | null>(null);
  const activeAsset = activeAssetId ? assets.find(a => a.id === activeAssetId) || null : null;

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
        <>
          <header className="sp-hero">
            <h1>{showcase.name}</h1>
            {showcase.description && <p className="sp-hero-desc">{showcase.description}</p>}
          </header>

          {assets.length === 0 ? (
            <div className="sp-empty">
              <p>This showcase has no assets to display right now.</p>
            </div>
          ) : (
            <div className="sp-grid">
              {assets.map(a => (
                <button
                  key={a.id}
                  type="button"
                  className="sp-card"
                  onClick={() => setActiveAssetId(a.id)}
                  title={a.headline}
                >
                  {a.thumbnail
                    ? <img src={a.thumbnail} alt="" className="sp-card-thumb" loading="lazy"/>
                    : <div className="sp-card-thumb sp-card-thumb-empty"/>}
                  <div className="sp-card-body">
                    <div className="sp-card-eyebrow">{a.company || a.client_name}</div>
                    <h3 className="sp-card-headline">{a.headline || "Customer story"}</h3>
                    {a.pull_quote && <p className="sp-card-quote">&ldquo;{a.pull_quote}&rdquo;</p>}
                  </div>
                </button>
              ))}
            </div>
          )}

          <footer className="sp-footer">
            Shared via <span className="sp-brand">StoryMatch</span>
          </footer>
        </>
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

.sp-hero{max-width:1100px;margin:0 auto;padding:64px 32px 32px;text-align:center;}
.sp-hero h1{font-family:var(--serif);font-size:44px;font-weight:600;letter-spacing:-1px;color:var(--t1);margin:0;line-height:1.1;}
.sp-hero-desc{font-size:16px;color:var(--t2);margin:14px auto 0;line-height:1.6;max-width:680px;}

.sp-grid{max-width:1100px;margin:0 auto;padding:0 32px 64px;display:grid;grid-template-columns:repeat(auto-fill, minmax(300px, 1fr));gap:24px;}

.sp-card{display:flex;flex-direction:column;text-align:left;background:#fff;border:1px solid var(--border);border-radius:14px;overflow:hidden;cursor:pointer;font:inherit;color:inherit;padding:0;transition:border-color .12s,box-shadow .15s,transform .15s;}
.sp-card:hover{border-color:var(--border2);box-shadow:0 8px 24px rgba(0,0,0,.08);transform:translateY(-1px);}
.sp-card-thumb{width:100%;aspect-ratio:16/9;object-fit:cover;background:var(--bg3);display:block;}
.sp-card-thumb-empty{background:linear-gradient(135deg,var(--bg2),var(--bg3));}
.sp-card-body{padding:16px 18px 20px;display:flex;flex-direction:column;gap:8px;}
.sp-card-eyebrow{font-size:11px;font-weight:700;color:var(--accent);text-transform:uppercase;letter-spacing:.5px;}
.sp-card-headline{font-family:var(--serif);font-size:18px;font-weight:600;letter-spacing:-.3px;color:var(--t1);margin:0;line-height:1.25;}
.sp-card-quote{font-size:13px;color:var(--t2);margin:4px 0 0;line-height:1.5;font-style:italic;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;}

.sp-empty{max-width:560px;margin:64px auto;padding:48px 24px;text-align:center;color:var(--t3);font-size:14px;background:#fff;border:1px dashed var(--border2);border-radius:14px;}

.sp-asset-wrap{padding-top:0;}
.sp-asset-nav{max-width:1100px;margin:0 auto;padding:18px 32px 0;}
.sp-back{display:inline-flex;align-items:center;gap:6px;padding:7px 12px;border:1px solid var(--border);border-radius:8px;background:#fff;color:var(--t2);font-family:var(--font);font-size:12.5px;font-weight:600;cursor:pointer;transition:all .12s;}
.sp-back:hover{background:var(--bg2);color:var(--t1);}

.sp-footer{text-align:center;padding:32px 24px 48px;color:var(--t4);font-size:12px;}
.sp-brand{font-family:var(--serif);font-weight:600;color:var(--accent);}

@media (max-width: 700px) {
  .sp-hero{padding:40px 20px 24px;}
  .sp-hero h1{font-size:32px;}
  .sp-grid{padding:0 20px 48px;gap:16px;}
  .sp-asset-nav{padding:14px 20px 0;}
}
`;
