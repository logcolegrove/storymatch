"use client";

// Shared testimonial detail view. Used in two places:
//   1) The internal admin/library detail page (StoryMatchApp)
//   2) The public share page (/s/[id]) that prospects see after a rep
//      copies a share link
//
// `publicMode` strips admin/library-only chrome (status pill, back button,
// related stories) so the public version is the same visual but appropriate
// for a prospect. Both stay in sync because they're literally the same
// component — no risk of drift between internal and public views.

import { useState } from "react";

// ─── Types ─────────────────────────────────────────────────────────────────
export interface AssetDetailAsset {
  id: string;
  headline: string;
  pullQuote: string;
  description?: string;
  transcript: string;
  videoUrl: string;
  thumbnail: string;
  clientName: string;
  company: string;
  vertical: string;
  geography: string;
  companySize: string;
  challenge: string;
  outcome: string;
  assetType: string;
  status: string;
}

interface VidInfo { p: "yt" | "vm"; id: string }
interface Chapter { title: string; paras: string[] }

// ─── Helpers (duplicated from StoryMatchApp so this component is portable) ─
const VERT_CLR: Record<string, string> = {
  Logistics: "#2563eb",
  Healthcare: "#059669",
  Manufacturing: "#d97706",
  "Financial Services": "#7c3aed",
  Retail: "#db2777",
  Education: "#0891b2",
  "Real Estate": "#65a30d",
  Technology: "#4f46e5",
};

function extractVid(url: string | null | undefined): VidInfo | null {
  if (!url) return null;
  let m = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([^&?#]+)/);
  if (m) return { p: "yt", id: m[1] };
  m = url.match(/vimeo\.com\/(?:video\/)?(\d+)/);
  if (m) return { p: "vm", id: m[1] };
  return null;
}
function ytThumb(id: string): string {
  return `https://img.youtube.com/vi/${id}/hqdefault.jpg`;
}

// ─── Component ─────────────────────────────────────────────────────────────
interface Props {
  asset: AssetDetailAsset;
  // Public mode = prospect-facing. Hides admin-internal UI (status pill,
  // back button, related stories — which would require their own share links).
  publicMode?: boolean;
  // Internal-only props
  onBack?: () => void;
  allAssets?: AssetDetailAsset[];
  // We pass back just the id (not the full asset) to avoid TS variance
  // issues when the parent's stricter Asset type has fields the shared
  // AssetDetailAsset doesn't model. Parent looks up the full asset itself.
  onSelect?: (id: string) => void;
}

export default function AssetDetail({ asset, publicMode, onBack, allAssets, onSelect }: Props) {
  const c = VERT_CLR[asset.vertical] || "#4f46e5";
  const vid = extractVid(asset.videoUrl);
  let thumb = asset.thumbnail;
  if (!thumb && vid?.p === "yt") thumb = ytThumb(vid.id);
  if (!thumb) thumb = "https://images.unsplash.com/photo-1557804506-669a67965ba0?w=640&h=360&fit=crop";

  const statParts = (asset.outcome || "").split(/[,;]/).map(s => s.trim()).filter(Boolean);
  const parseStats = statParts.map(s => {
    const m = s.match(/([\d.]+)(%|[A-Z])?/);
    if (m) return { num: m[1], unit: m[2] || "", label: s.replace(m[0], "").trim().replace(/^[:\-–—]\s*/, "") };
    return { num: "", unit: "", label: s };
  }).filter(s => s.num);

  const paras = (asset.transcript || "").split(/\n\n+/).filter(Boolean);
  const chapters: Chapter[] = [];
  let cur: Chapter = { title: "The Story", paras: [] };
  paras.forEach(p => {
    if (p.match(/^(Background|Challenge|Solution|Results|Company|Problem|Implementation):/i)) {
      if (cur.paras.length > 0) chapters.push(cur);
      cur = { title: p.split(":")[0].trim(), paras: [p] };
    } else {
      cur.paras.push(p);
    }
  });
  if (cur.paras.length > 0) chapters.push(cur);
  if (chapters.length === 0) chapters.push({ title: "The Story", paras: [asset.transcript || ""] });

  const related = !publicMode
    ? (allAssets || []).filter(a => a.id !== asset.id).sort((a, b) => a.vertical === asset.vertical ? -1 : 1).slice(0, 3)
    : [];

  const [activeCh, setActiveCh] = useState(0);

  return (
    <>
      <style>{detailCss}</style>
      <div className="dp">
        {!publicMode && onBack && (
          <button className="dp-back" onClick={onBack}>← Back to library</button>
        )}
        <div className="dp-hero">
          <div className="dp-hero-img"><img src={thumb} alt={asset.company} /></div>
          <div className="dp-hero-content">
            <div className="dp-hero-eyebrow">
              <span className="dp-hero-co">{asset.company}</span>
              <span className="dp-hero-vbadge">{asset.assetType}</span>
            </div>
            <h1>{asset.headline}.</h1>
            <div className="dp-hero-sub">{asset.pullQuote}</div>
          </div>
        </div>
        <div className="dp-summary-bar">
          <div className="dp-summary"><h3>Summary</h3><p>{asset.pullQuote}</p></div>
          <div className="dp-about">
            <h3>About</h3>
            <p>
              {asset.clientName} at {asset.company}.
              {asset.companySize && <> {asset.companySize} employees,</>}
              {asset.geography && <> {asset.geography}.</>}
            </p>
            <div className="dp-about-tags">
              {asset.vertical && <span className="pill" style={{ borderColor: c, color: c }}>{asset.vertical}</span>}
              {asset.geography && <span className="pill">{asset.geography}</span>}
              {!publicMode && asset.status && (
                <span className="pill" style={{
                  borderColor: asset.status === "published" ? "var(--green)" : "var(--amber)",
                  color: asset.status === "published" ? "var(--green)" : "var(--amber)",
                }}>{asset.status}</span>
              )}
            </div>
          </div>
        </div>
        {parseStats.length > 0 && (
          <div className="dp-stats">
            {parseStats.map((s, i) => (
              <div className="dp-stat" key={i}>
                <div><span className="dp-stat-num">{s.num}</span><span className="dp-stat-unit">{s.unit}</span></div>
                <div className="dp-stat-label">{s.label || asset.challenge}</div>
              </div>
            ))}
          </div>
        )}
        {vid && (
          <div style={{ maxWidth: 900, margin: "0 auto 28px" }}>
            <div className="dp-video-embed">
              {vid.p === "yt" ? (
                <iframe src={`https://www.youtube.com/embed/${vid.id}`} frameBorder="0" allow="accelerometer;autoplay;clipboard-write;encrypted-media;gyroscope;picture-in-picture" allowFullScreen />
              ) : (
                <iframe src={`https://player.vimeo.com/video/${vid.id}`} frameBorder="0" allow="autoplay;fullscreen;picture-in-picture" allowFullScreen />
              )}
            </div>
          </div>
        )}
        <div className="dp-body">
          <nav className="dp-chapters-nav">
            {chapters.map((ch, i) => (
              <button key={i} className={`dp-ch-link ${activeCh === i ? "active" : ""}`} onClick={() => { setActiveCh(i); document.getElementById(`ch-${i}`)?.scrollIntoView({ behavior: "smooth", block: "start" }); }}>
                Ch {i + 1}: {ch.title}
              </button>
            ))}
          </nav>
          <div className="dp-content">
            {chapters.map((ch, i) => (
              <div className="dp-chapter" key={i} id={`ch-${i}`}>
                <div className="dp-chapter-label">Chapter {i + 1}</div>
                <h2>{ch.title}</h2>
                {ch.paras.map((p, pi) => {
                  const isQ = p.startsWith('"') || p.startsWith("“");
                  if (isQ) {
                    const cl = p.replace(/^[^"“]*["“]|["”]$/g, "").replace(/["”]$/, "");
                    return (
                      <div className="dp-bq" key={pi}>
                        <blockquote>{cl}</blockquote>
                        <div className="dp-bq-name">{asset.clientName}</div>
                        <div className="dp-bq-role">{asset.company}</div>
                      </div>
                    );
                  }
                  return <p key={pi}>{p}</p>;
                })}
              </div>
            ))}
            <div className="dp-bq">
              <blockquote>{asset.pullQuote}</blockquote>
              <div className="dp-bq-name">{asset.clientName}</div>
              <div className="dp-bq-role">{asset.company}</div>
            </div>
          </div>
        </div>
        {!publicMode && related.length > 0 && (
          <div className="dp-related">
            <h3>More customer stories</h3>
            <div className="dp-related-grid">
              {related.map(r => {
                const rvid = extractVid(r.videoUrl);
                const rt = r.thumbnail || (rvid?.p === "yt" ? ytThumb(rvid.id) : "https://images.unsplash.com/photo-1557804506-669a67965ba0?w=400&h=225&fit=crop");
                return (
                  <div className="dp-rel-card" key={r.id} onClick={() => onSelect?.(r.id)}>
                    {r.assetType !== "Quote" && <div className="dp-rel-thumb"><img src={rt} alt={r.company} loading="lazy" /></div>}
                    <div className="dp-rel-body">
                      <div className="dp-rel-label">{r.assetType}</div>
                      <div className="dp-rel-title">{r.headline}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
        {publicMode && (
          <div className="dp-shared-footer">
            Shared via <span className="dp-shared-brand">StoryMatch</span>
          </div>
        )}
      </div>
    </>
  );
}

// CSS — kept identical to the original DetailPage rules so internal and public
// renders are visually identical. Includes :root vars so the public page (which
// doesn't load StoryMatchApp's global css) still has them defined.
const detailCss = `
@import url('https://fonts.googleapis.com/css2?family=Instrument+Sans:wght@400;500;600;700&family=Newsreader:ital,opsz,wght@0,6..72,400;0,6..72,500;0,6..72,600&display=swap');
:root{
  --bg:#fafafa;--bg2:#f4f4f6;--bg3:#ededf0;
  --border:#e2e2e6;--border2:#d0d0d6;
  --t1:#111118;--t2:#55556a;--t3:#8888a0;--t4:#aaaabb;
  --accent:#6d28d9;--accent2:#7c3aed;--accentL:#ede9fe;--accentLL:#f5f3ff;
  --green:#059669;--red:#dc2626;--amber:#d97706;--amberL:#fef3c7;
  --font:'Instrument Sans',-apple-system,sans-serif;
  --serif:'Newsreader',Georgia,serif;
  --r:14px;--r2:10px;--r3:7px;
}
.dp{max-width:1100px;margin:0 auto;width:100%;padding:24px 32px 60px;font-family:var(--font);color:var(--t1);}
.dp-back{display:inline-flex;align-items:center;gap:6px;padding:6px 14px;border-radius:var(--r3);border:1px solid var(--border);background:#fff;color:var(--t2);font-family:var(--font);font-size:12px;font-weight:600;cursor:pointer;margin-bottom:20px;}
.dp-back:hover{border-color:var(--border2);color:var(--t1);}
.dp-hero{position:relative;width:100%;min-height:400px;border-radius:20px;overflow:hidden;display:flex;align-items:flex-end;}
.dp-hero-img{position:absolute;inset:0;}.dp-hero-img img{width:100%;height:100%;object-fit:cover;}
.dp-hero-img::after{content:'';position:absolute;inset:0;background:linear-gradient(to top,rgba(0,0,0,.72) 0%,rgba(0,0,0,.25) 50%,rgba(0,0,0,.12) 100%);}
.dp-hero-content{position:relative;z-index:2;padding:36px 44px;max-width:680px;}
.dp-hero-eyebrow{display:flex;align-items:center;gap:10px;margin-bottom:12px;}
.dp-hero-co{font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:1.2px;color:rgba(255,255,255,.7);}
.dp-hero-vbadge{padding:3px 10px;border-radius:12px;font-size:10px;font-weight:700;background:rgba(255,255,255,.15);color:rgba(255,255,255,.8);}
.dp-hero h1{font-family:var(--serif);font-size:30px;font-weight:600;letter-spacing:-.4px;line-height:1.2;color:#fff;margin-bottom:10px;}
.dp-hero-sub{font-size:14.5px;line-height:1.6;color:rgba(255,255,255,.75);}
.dp-summary-bar{display:grid;grid-template-columns:1fr 280px;border:1px solid var(--border);border-radius:0 0 20px 20px;background:#fff;margin-bottom:28px;}
.dp-summary{padding:24px 32px;border-right:1px solid var(--border);}
.dp-summary h3,.dp-about h3{font-size:10px;text-transform:uppercase;letter-spacing:1.2px;color:var(--t4);font-weight:700;margin-bottom:6px;}
.dp-summary p{font-size:13.5px;line-height:1.65;color:var(--t2);}
.dp-about{padding:24px 28px;}
.dp-about p{font-size:12.5px;line-height:1.55;color:var(--t2);}
.dp-about-tags{display:flex;flex-wrap:wrap;gap:5px;margin-top:10px;}
.pill{padding:3px 9px;border-radius:14px;font-size:10px;font-weight:600;border:1px solid var(--border);color:var(--t3);}
.dp-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));border:1px solid var(--border);border-radius:14px;overflow:hidden;background:#fff;margin-bottom:32px;}
.dp-stat{padding:24px 20px;text-align:center;border-right:1px solid var(--border);}.dp-stat:last-child{border-right:none;}
.dp-stat-num{font-family:var(--serif);font-size:36px;font-weight:600;letter-spacing:-1px;color:var(--accent);line-height:1;}
.dp-stat-unit{font-size:15px;font-weight:600;color:var(--accent);margin-left:2px;}
.dp-stat-label{font-size:12px;color:var(--t3);margin-top:5px;}
.dp-video-embed{width:100%;aspect-ratio:16/9;border-radius:var(--r);overflow:hidden;background:var(--bg3);margin-bottom:24px;}.dp-video-embed iframe{width:100%;height:100%;display:block;}
.dp-body{display:grid;grid-template-columns:180px 1fr;gap:36px;max-width:900px;margin:0 auto;align-items:start;}
.dp-chapters-nav{position:sticky;top:72px;display:flex;flex-direction:column;gap:3px;}
.dp-ch-link{padding:7px 12px;border-radius:var(--r3);font-size:12px;font-weight:600;color:var(--t3);cursor:pointer;border:none;background:none;text-align:left;font-family:var(--font);line-height:1.4;transition:all .12s;}
.dp-ch-link:hover{color:var(--t1);background:var(--bg2);}.dp-ch-link.active{color:var(--accent);background:var(--accentL);}
.dp-content{max-width:640px;}
.dp-chapter{margin-bottom:36px;}
.dp-chapter-label{font-size:10px;text-transform:uppercase;letter-spacing:1.5px;color:var(--accent);font-weight:700;margin-bottom:5px;}
.dp-chapter h2{font-family:var(--serif);font-size:20px;font-weight:600;margin-bottom:14px;line-height:1.3;}
.dp-chapter p{font-size:14px;line-height:1.75;color:var(--t2);margin-bottom:12px;}
.dp-bq{padding:24px 28px;margin:20px 0;background:var(--bg2);border-radius:var(--r);position:relative;}
.dp-bq::before{content:'"';position:absolute;top:8px;left:16px;font-family:var(--serif);font-size:52px;color:var(--accent);opacity:.12;line-height:1;}
.dp-bq blockquote{font-family:var(--serif);font-size:16px;font-style:italic;line-height:1.65;color:var(--t1);margin-bottom:12px;padding-left:6px;}
.dp-bq-name{font-size:12.5px;font-weight:700;color:var(--t1);padding-left:6px;}
.dp-bq-role{font-size:11.5px;color:var(--t3);padding-left:6px;}
.dp-related{margin-top:40px;padding-top:28px;border-top:1px solid var(--border);}
.dp-related h3{font-family:var(--serif);font-size:18px;font-weight:600;margin-bottom:16px;}
.dp-related-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:14px;}
.dp-rel-card{border-radius:var(--r2);overflow:hidden;border:1px solid var(--border);cursor:pointer;transition:all .2s;background:#fff;}
.dp-rel-card:hover{transform:translateY(-2px);box-shadow:0 6px 20px rgba(0,0,0,.05);}
.dp-rel-thumb{width:100%;aspect-ratio:16/9;overflow:hidden;background:var(--bg3);}.dp-rel-thumb img{width:100%;height:100%;object-fit:cover;}
.dp-rel-body{padding:12px 14px;}
.dp-rel-label{font-size:10px;text-transform:uppercase;letter-spacing:.8px;color:var(--t4);font-weight:700;margin-bottom:3px;}
.dp-rel-title{font-family:var(--serif);font-size:14px;font-weight:500;line-height:1.35;}
.dp-shared-footer{margin-top:48px;padding-top:24px;border-top:1px solid var(--border);text-align:center;font-size:12px;color:var(--t3);}
.dp-shared-brand{font-family:var(--serif);font-weight:500;color:var(--accent);letter-spacing:-0.2px;}
`;
