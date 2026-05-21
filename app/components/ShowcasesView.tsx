"use client";

// ShowcasesView — admin-only, full-page view that lists every
// showcase in the org and lets admins create, edit, share, and
// delete them. Mounted in the main area when the Showcases rail
// button is active, the same way Insights takes over the canvas.
//
// A showcase = an ordered list of asset references + name +
// description. Admins build them as branded landing pages that
// can be shared as a URL or (eventually) embedded on a customer's
// marketing site. Sales reps will get their own simpler "quick
// playlist" surface later — for now the admin view is the only
// place to create/manage showcases.
//
// Live-reference contract: when the public showcase URL is opened,
// the resolver silently drops assets that no longer exist or
// aren't Public. Admins should know if their showcase contains
// references that have gone dark, so the list row shows
// "{n} assets" — but if some are missing on the public side, that
// number can be higher than what gets rendered. We surface a
// "missing" badge in the editor when the gap is detected.

import { useEffect, useMemo, useState } from "react";
import ShowcaseBuilder from "./ShowcaseBuilder";
import type { TemplateBlock } from "@/lib/showcase-templates";

// Minimal asset shape — just what the editor needs to render
// pickable cards. The parent already has full Asset[] in scope;
// we project down to this slim shape so the editor doesn't
// re-import the full Asset type from StoryMatchApp.
export interface ShowcaseAssetRef {
  id: string;
  headline: string;
  company: string;
  clientName: string;
  thumbnail: string;
  status: string;
  assetType: string;
  // For the Watch · MM:SS frosted badge on showcase tiles. Null
  // for written case studies; the badge falls back to "Read."
  durationSeconds: number | null;
}

interface Showcase {
  id: string;
  orgId: string;
  ownerUserId: string;
  name: string;
  description: string | null;
  assetIds: string[];
  templateId: string | null;
  // Forked template blocks (when admin has customized). Null
  // means the showcase still uses the named templateId's preset.
  // The builder reads this and the renderer falls back gracefully.
  templateConfig: TemplateBlock[] | null;
  createdAt: string;
  updatedAt: string;
}

interface Props {
  authHeaders: () => Promise<HeadersInit>;
  assets: ShowcaseAssetRef[];
  onToast: (msg: string) => void;
}

function timeAgo(iso: string | null): string {
  if (!iso) return "";
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.round(ms / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d}d ago`;
  const mo = Math.round(d / 30);
  if (mo < 12) return `${mo}mo ago`;
  return `${Math.round(mo / 12)}y ago`;
}

export default function ShowcasesView({ authHeaders, assets, onToast }: Props) {
  const [loading, setLoading] = useState(true);
  const [showcases, setShowcases] = useState<Showcase[]>([]);
  // The builder takes over the full viewport when a showcase is
  // being edited. Setting this to a Showcase mounts the builder;
  // closing the builder (back arrow, Esc) resets to null.
  const [builderShowcase, setBuilderShowcase] = useState<Showcase | null>(null);

  const loadShowcases = async () => {
    try {
      const headers = await authHeaders();
      const r = await fetch("/api/showcases", { headers });
      if (!r.ok) throw new Error("Failed");
      const data = await r.json() as { showcases: Showcase[] };
      setShowcases(data.showcases || []);
    } catch (e) {
      console.error("[ShowcasesView] load failed", e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setLoading(true);
    loadShowcases();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const copyShareLink = (id: string) => {
    if (typeof window === "undefined") return;
    const url = `${window.location.origin}/showcase/${id}`;
    try {
      navigator.clipboard?.writeText(url);
      onToast("Link copied to clipboard");
    } catch {
      onToast("Couldn't copy — try selecting the URL manually");
    }
  };

  const deleteShowcase = async (id: string, name: string) => {
    if (typeof window !== "undefined" && !confirm(`Delete "${name}"? Anyone who has the link will see a Not Found page after this.`)) return;
    try {
      const headers = await authHeaders();
      const r = await fetch(`/api/showcases/${encodeURIComponent(id)}`, { method: "DELETE", headers });
      if (!r.ok) throw new Error("Failed");
      setShowcases(prev => prev.filter(s => s.id !== id));
      onToast("Showcase deleted");
    } catch (e) {
      console.error("[ShowcasesView] delete failed", e);
      onToast("Couldn't delete showcase");
    }
  };

  // "New showcase" flow — POSTs an empty draft up front so the
  // builder always has a backing row to PUT against. The downside
  // is that aborting without changes leaves an empty "Untitled
  // showcase" in the list — admins can delete from the row menu.
  // We accept that trade for simplicity; the alternative is
  // builder-handles-create which complicates state in two places.
  const createBlankShowcase = async () => {
    try {
      const headers = await authHeaders();
      const r = await fetch("/api/showcases", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify({ name: "", description: null, asset_ids: [] }),
      });
      if (!r.ok) throw new Error("Failed");
      const data = await r.json() as { showcase: Showcase };
      setShowcases(prev => [data.showcase, ...prev]);
      setBuilderShowcase(data.showcase);
    } catch (e) {
      console.error("[ShowcasesView] create blank failed", e);
      onToast("Couldn't create showcase");
    }
  };

  // Patches the local list after the builder saves. Same shape as
  // the create flow's response handling — keeps the row order
  // recent-first by moving the saved one to the top.
  const handleBuilderClose = (updated?: Showcase) => {
    if (updated) {
      setShowcases(prev => {
        const next = prev.filter(s => s.id !== updated.id);
        next.unshift(updated);
        return next;
      });
    }
    setBuilderShowcase(null);
  };

  // Map asset_id → ShowcaseAssetRef for the list-row "first few
  // thumbnails" preview AND the editor.
  const assetMap = useMemo(() => {
    const m = new Map<string, ShowcaseAssetRef>();
    for (const a of assets) m.set(a.id, a);
    return m;
  }, [assets]);

  return (
    <div className="sv">
      <style>{css}</style>

      <header className="sv-page-head">
        <div>
          <h2>Showcases</h2>
          <p className="sv-page-sub">Curated bundles of assets you can share as a single link. New sales reps inherit the showcases you build here.</p>
        </div>
        <button className="sv-create-btn" onClick={createBlankShowcase}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19"/>
            <line x1="5" y1="12" x2="19" y2="12"/>
          </svg>
          New showcase
        </button>
      </header>

      {loading ? (
        <div className="sv-empty">Loading…</div>
      ) : showcases.length === 0 ? (
        <div className="sv-empty">
          <div className="sv-empty-h">No showcases yet</div>
          <p className="sv-empty-sub">Build one with the assets you want to send to prospects. You can curate a branded landing page or just bundle a few testimonials into one URL.</p>
          <button className="sv-create-btn primary" onClick={createBlankShowcase}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19"/>
              <line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
            Create your first showcase
          </button>
        </div>
      ) : (
        <div className="sv-grid">
          {showcases.map(s => {
            // Show the first 4 thumbnails as a preview strip. If
            // some assetIds don't resolve in the asset list, those
            // slots stay empty (consistent with the live-reference
            // contract: missing assets silently drop).
            const previewIds = s.assetIds.slice(0, 4);
            const previewAssets = previewIds.map(id => assetMap.get(id)).filter((x): x is ShowcaseAssetRef => !!x);
            return (
              <button key={s.id} type="button" className="sv-card" onClick={() => setBuilderShowcase(s)}>
                <div className="sv-card-thumbs">
                  {previewAssets.length > 0 ? previewAssets.map(a => (
                    <div key={a.id} className="sv-card-thumb">
                      {a.thumbnail
                        ? <img src={a.thumbnail} alt="" loading="lazy"/>
                        : <div className="sv-card-thumb-empty"/>}
                    </div>
                  )) : (
                    <div className="sv-card-thumbs-empty">No assets yet</div>
                  )}
                </div>
                <div className="sv-card-body">
                  <div className="sv-card-head">
                    <h3>{s.name}</h3>
                    <div className="sv-card-actions" onClick={(e) => e.stopPropagation()}>
                      <button type="button" className="sv-card-act" onClick={() => copyShareLink(s.id)} title="Copy share link" aria-label="Copy share link">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
                          <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
                        </svg>
                      </button>
                      <button type="button" className="sv-card-act danger" onClick={() => deleteShowcase(s.id, s.name)} title="Delete showcase" aria-label="Delete">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="3 6 5 6 21 6"/>
                          <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
                          <path d="M10 11v6"/>
                          <path d="M14 11v6"/>
                          <path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"/>
                        </svg>
                      </button>
                    </div>
                  </div>
                  {s.description && <p className="sv-card-desc">{s.description}</p>}
                  <div className="sv-card-meta">
                    <span>{s.assetIds.length} {s.assetIds.length === 1 ? "asset" : "assets"}</span>
                    <span className="sv-card-dot">·</span>
                    <span>Updated {timeAgo(s.updatedAt)}</span>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {builderShowcase && (
        <ShowcaseBuilder
          showcase={builderShowcase}
          assets={assets}
          authHeaders={authHeaders}
          onClose={handleBuilderClose}
          onToast={onToast}
        />
      )}
    </div>
  );
}

const css = `
.sv{flex:1;min-width:0;overflow-y:auto;font-family:var(--font);color:var(--t1);padding:32px 40px 64px;display:flex;flex-direction:column;gap:24px;}

.sv-page-head{display:flex;align-items:flex-start;justify-content:space-between;gap:24px;}
.sv-page-head h2{font-family:var(--serif);font-size:30px;font-weight:600;letter-spacing:-.6px;color:var(--t1);margin:0;}
.sv-page-sub{font-size:13.5px;color:var(--t3);margin:6px 0 0;line-height:1.5;max-width:680px;}

.sv-create-btn{display:inline-flex;align-items:center;gap:6px;padding:8px 14px;border:1px solid var(--accent);border-radius:8px;background:var(--accent);color:#fff;font-family:var(--font);font-size:12.5px;font-weight:600;cursor:pointer;flex-shrink:0;transition:filter .12s;}
.sv-create-btn:hover{filter:brightness(1.08);}
.sv-create-btn.primary{margin-top:14px;}

.sv-empty{padding:64px 24px;text-align:center;color:var(--t3);font-size:13px;background:#fff;border:1px dashed var(--border2);border-radius:12px;}
.sv-empty-h{font-family:var(--serif);font-size:18px;font-weight:600;color:var(--t1);margin-bottom:6px;}
.sv-empty-sub{font-size:13px;color:var(--t3);margin:0 auto;line-height:1.55;max-width:480px;}

.sv-grid{display:grid;grid-template-columns:repeat(auto-fill, minmax(320px, 1fr));gap:18px;}

.sv-card{display:flex;flex-direction:column;text-align:left;background:#fff;border:1px solid var(--border);border-radius:12px;overflow:hidden;cursor:pointer;font:inherit;color:inherit;padding:0;transition:border-color .12s,box-shadow .12s;}
.sv-card:hover{border-color:var(--border2);box-shadow:0 4px 16px rgba(0,0,0,.06);}

.sv-card-thumbs{display:grid;grid-template-columns:repeat(4, 1fr);gap:2px;background:var(--bg2);aspect-ratio:16/6;}
.sv-card-thumb{overflow:hidden;background:var(--bg3);}
.sv-card-thumb img{width:100%;height:100%;object-fit:cover;display:block;}
.sv-card-thumb-empty{width:100%;height:100%;background:var(--bg3);}
.sv-card-thumbs-empty{grid-column:1 / -1;display:grid;place-items:center;color:var(--t4);font-size:12px;}

.sv-card-body{padding:14px 16px 16px;display:flex;flex-direction:column;gap:6px;}
.sv-card-head{display:flex;align-items:flex-start;justify-content:space-between;gap:8px;}
.sv-card-head h3{font-family:var(--serif);font-size:15.5px;font-weight:600;letter-spacing:-.2px;color:var(--t1);margin:0;line-height:1.3;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.sv-card-actions{display:flex;gap:2px;flex-shrink:0;opacity:0;transition:opacity .12s;}
.sv-card:hover .sv-card-actions{opacity:1;}
.sv-card-act{width:26px;height:26px;display:grid;place-items:center;border:none;background:none;color:var(--t3);border-radius:5px;cursor:pointer;}
.sv-card-act:hover{background:var(--bg2);color:var(--t1);}
.sv-card-act.danger:hover{background:#fef2f2;color:#b91c1c;}

.sv-card-desc{font-size:12.5px;color:var(--t3);line-height:1.5;margin:0;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;}
.sv-card-meta{font-size:11.5px;color:var(--t4);display:flex;align-items:center;gap:6px;margin-top:4px;}
.sv-card-dot{opacity:.6;}

@media (max-width: 900px) {
  .sv{padding:20px 18px 48px;}
  .sv-grid{grid-template-columns:1fr;}
  .sv-page-head{flex-direction:column;align-items:stretch;}
}
`;
