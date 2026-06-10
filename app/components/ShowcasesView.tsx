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

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
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
  // The next three feed the in-builder AssetDetail preview modal
  // that opens when an admin clicks a card in the showcase preview.
  // ShowcaseAssetRef stays narrow elsewhere — these fields are
  // permitted to be empty strings when the host doesn't carry
  // them; AssetDetail handles missing fields gracefully.
  pullQuote: string;
  description: string;
  videoUrl: string;
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
  // B4.0 fields — see lib/showcase-dal.ts for the canonical
  // definitions. visibility="personal" stays in My showcases;
  // "team" promotes to the Whole team tab.
  visibility: "personal" | "team";
  autoplayNext: boolean;
  paginationSize: number;
  createdAt: string;
  updatedAt: string;
}

// Tab strip across the top of the showcase list. Both roles see
// the same three options; the underlying scope is just the org-
// visibility filter applied to the same fetched list.
type ShowcaseTab = "all" | "team" | "mine";

interface Props {
  authHeaders: () => Promise<HeadersInit>;
  assets: ShowcaseAssetRef[];
  // For "My showcases" filtering — the API returns everyone's
  // team-visible PLUS the caller's personal, so the client needs
  // to know which rows are theirs.
  currentUserId: string;
  // Drives whether the visibility toggle is shown when creating.
  // Sales reps can't promote to team; admins can.
  role: "admin" | "sales";
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

// Per-showcase dots menu. Renders a small ••• button that opens a
// portal-positioned popover with the full action set. Modeled after
// the library grid card pattern so the affordance feels familiar.
function ShowcaseCardMenu({ onCopyLink, onCopyEmbed, onView, onEdit, onDelete }: {
  onCopyLink: () => void;
  onCopyEmbed: () => void;
  onView: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  // Anchor the popup just under the button, right-aligned. Recompute
  // on scroll/resize so it stays glued while the user is mousing.
  useEffect(() => {
    if (!open) return;
    const update = () => {
      const el = btnRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      setPos({ top: r.bottom + 6, right: Math.max(8, window.innerWidth - r.right) });
    };
    update();
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [open]);

  // Outside-click + Escape closes the menu. Stop propagation inside
  // so clicking a menu item doesn't bubble to the card's onClick
  // (which opens the builder).
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest(".scm-pop") && !target.closest(".scm-trigger")) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("mousedown", onDoc);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDoc);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const item = (label: string, icon: React.ReactNode, action: () => void, danger?: boolean) => (
    <button
      type="button"
      className={`scm-item${danger ? " danger" : ""}`}
      onClick={(e) => { e.stopPropagation(); setOpen(false); action(); }}
    >
      {icon}
      <span>{label}</span>
    </button>
  );

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className="sv-card-act scm-trigger"
        onClick={(e) => { e.stopPropagation(); setOpen(o => !o); }}
        title="More actions"
        aria-label="More actions"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <circle cx="5" cy="12" r="1.6"/>
          <circle cx="12" cy="12" r="1.6"/>
          <circle cx="19" cy="12" r="1.6"/>
        </svg>
      </button>
      {open && pos && typeof document !== "undefined" && createPortal(
        <div
          className="scm-pop"
          style={{ position: "fixed", top: pos.top, right: pos.right }}
          onClick={(e) => e.stopPropagation()}
        >
          {item("Copy link", (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
              <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
            </svg>
          ), onCopyLink)}
          {item("Copy embed code", (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="16 18 22 12 16 6"/>
              <polyline points="8 6 2 12 8 18"/>
            </svg>
          ), onCopyEmbed)}
          {item("View showcase", (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
              <circle cx="12" cy="12" r="3"/>
            </svg>
          ), onView)}
          {item("Edit", (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 20h9"/>
              <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>
            </svg>
          ), onEdit)}
          <div className="scm-sep"/>
          {item("Delete", (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="3 6 5 6 21 6"/>
              <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
              <path d="M10 11v6"/>
              <path d="M14 11v6"/>
              <path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"/>
            </svg>
          ), onDelete, true)}
        </div>,
        document.body,
      )}
    </>
  );
}

export default function ShowcasesView({ authHeaders, assets, currentUserId, role, onToast }: Props) {
  const [loading, setLoading] = useState(true);
  const [showcases, setShowcases] = useState<Showcase[]>([]);
  // The builder takes over the full viewport when a showcase is
  // being edited. Setting this to a Showcase mounts the builder;
  // closing the builder (back arrow, Esc) resets to null.
  const [builderShowcase, setBuilderShowcase] = useState<Showcase | null>(null);
  // Tab state. "all" = everything visible to me (team + mine);
  // "team" = visibility==="team"; "mine" = ownerUserId===me. Default
  // to "all" so admins land on the broadest scope on first open.
  const [tab, setTab] = useState<ShowcaseTab>("all");

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

  // Embed code = an iframe snippet the admin pastes into a customer
  // marketing site. Default size sets a 16/9 aspect via CSS so the
  // embed scales gracefully. Width 100% means the showcase fills the
  // host container; admins can edit the snippet before pasting.
  const copyEmbedCode = (id: string) => {
    if (typeof window === "undefined") return;
    const url = `${window.location.origin}/showcase/${id}`;
    const snippet = `<iframe src="${url}" title="Customer showcase" width="100%" style="aspect-ratio:16/9;border:0;border-radius:12px;" loading="lazy" allow="autoplay; fullscreen; picture-in-picture" allowfullscreen></iframe>`;
    try {
      navigator.clipboard?.writeText(snippet);
      onToast("Embed code copied");
    } catch {
      onToast("Couldn't copy embed code");
    }
  };

  const viewShowcase = (id: string) => {
    if (typeof window === "undefined") return;
    window.open(`/showcase/${id}`, "_blank", "noopener,noreferrer");
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

  // Apply the active tab as a client-side filter. The fetched list
  // is the broadest scope visible to the caller (team + mine); the
  // tab narrows that view. Counts in the tab labels use the same
  // predicates so the user can spot which bucket has new content
  // without switching tabs first.
  const filteredShowcases = useMemo(() => {
    switch (tab) {
      case "team":
        return showcases.filter(s => s.visibility === "team");
      case "mine":
        return showcases.filter(s => s.ownerUserId === currentUserId);
      default:
        return showcases;
    }
  }, [showcases, tab, currentUserId]);

  const counts = useMemo(() => ({
    all: showcases.length,
    team: showcases.filter(s => s.visibility === "team").length,
    mine: showcases.filter(s => s.ownerUserId === currentUserId).length,
  }), [showcases, currentUserId]);

  // Per-tab empty-state copy. Drives the message the user sees when
  // their current tab is empty but other tabs may have content.
  const emptyCopy = (() => {
    if (tab === "team") return {
      h: "Nothing visible to the whole team yet",
      p: role === "admin"
        ? "Build a showcase, then flip its visibility to “Whole team” so everyone in your workspace sees it here."
        : "Admins post team-visible showcases here. Anything you build will land in My showcases.",
    };
    if (tab === "mine") return {
      h: "You haven't built a showcase yet",
      p: "Bundle a few testimonials into one URL you can send to a prospect. New showcases default to personal — only you see them until an admin promotes them.",
    };
    return {
      h: "No showcases yet",
      p: "Build one with the assets you want to send to prospects. You can curate a branded landing page or just bundle a few testimonials into one URL.",
    };
  })();

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

      {/* Tab strip — All / Whole team / My showcases. Counts come
          from the full fetched list so a user notices new content
          in tabs they aren't currently viewing. */}
      <div className="sv-tabs" role="tablist">
        <button type="button" role="tab" aria-selected={tab === "all"}
                className={`sv-tab ${tab === "all" ? "on" : ""}`}
                onClick={() => setTab("all")}>
          All <span className="sv-tab-c">{counts.all}</span>
        </button>
        <button type="button" role="tab" aria-selected={tab === "team"}
                className={`sv-tab ${tab === "team" ? "on" : ""}`}
                onClick={() => setTab("team")}>
          Whole team <span className="sv-tab-c">{counts.team}</span>
        </button>
        <button type="button" role="tab" aria-selected={tab === "mine"}
                className={`sv-tab ${tab === "mine" ? "on" : ""}`}
                onClick={() => setTab("mine")}>
          My showcases <span className="sv-tab-c">{counts.mine}</span>
        </button>
      </div>

      {loading ? (
        <div className="sv-empty">Loading…</div>
      ) : filteredShowcases.length === 0 ? (
        <div className="sv-empty">
          <div className="sv-empty-h">{emptyCopy.h}</div>
          <p className="sv-empty-sub">{emptyCopy.p}</p>
          {tab !== "team" && (
            <button className="sv-create-btn primary" onClick={createBlankShowcase}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="5" x2="12" y2="19"/>
                <line x1="5" y1="12" x2="19" y2="12"/>
              </svg>
              {tab === "mine" ? "Create your first" : "Create your first showcase"}
            </button>
          )}
        </div>
      ) : (
        <div className="sv-grid">
          {filteredShowcases.map(s => {
            // Show up to the first 4 thumbnails. Layout adapts to the
            // count to keep every card the same height (consistent
            // 16:9 strip aspect across the row, so titles line up):
            //   1  → fill the whole strip
            //   2  → 1×2 side-by-side
            //   3  → 1×3 in a row
            //   4+ → 2×2 grid so each thumb stays at its own 16:9
            //        instead of getting crushed into a portrait crop
            // Missing assetIds (deleted / archived) silently drop —
            // consistent with the live-reference contract elsewhere.
            const previewIds = s.assetIds.slice(0, 4);
            const previewAssets = previewIds.map(id => assetMap.get(id)).filter((x): x is ShowcaseAssetRef => !!x);
            const thumbCount = Math.max(0, Math.min(4, previewAssets.length));
            return (
              <button key={s.id} type="button" className="sv-card" onClick={() => setBuilderShowcase(s)}>
                <div className={`sv-card-thumbs n${thumbCount}`}>
                  {previewAssets.length > 0 ? previewAssets.map(a => (
                    <div key={a.id} className="sv-card-thumb">
                      {a.thumbnail
                        ? <img src={a.thumbnail} alt="" loading="lazy"/>
                        : <div className="sv-card-thumb-empty"/>}
                    </div>
                  )) : (
                    <div className="sv-card-thumbs-empty">No assets yet</div>
                  )}
                  {/* Hover actions live on the thumb (top-right) so
                      they're spatially separate from the title — same
                      pattern as the library grid cards. Click handlers
                      stop propagation so they don't trigger the card's
                      onClick (open in builder). */}
                  <div className="sv-card-actions" onClick={(e) => e.stopPropagation()}>
                    <button
                      type="button"
                      className="sv-card-act"
                      onClick={(e) => { e.stopPropagation(); copyShareLink(s.id); }}
                      title="Copy share link"
                      aria-label="Copy share link"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
                        <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
                      </svg>
                    </button>
                    <ShowcaseCardMenu
                      onCopyLink={() => copyShareLink(s.id)}
                      onCopyEmbed={() => copyEmbedCode(s.id)}
                      onView={() => viewShowcase(s.id)}
                      onEdit={() => setBuilderShowcase(s)}
                      onDelete={() => deleteShowcase(s.id, s.name)}
                    />
                  </div>
                </div>
                <div className="sv-card-body">
                  <h3 className="sv-card-title">{s.name}</h3>
                  {s.description && <p className="sv-card-desc">{s.description}</p>}
                  <div className="sv-card-meta">
                    {/* Team badge — only on team-visible showcases.
                        Personal stays implicit (no badge). The
                        chip leads so it sits next to the name area. */}
                    {s.visibility === "team" && (
                      <span className="sv-vis-chip" title="Visible to the whole team">Team</span>
                    )}
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
          role={role}
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

/* Tab strip — sits between header and grid. Mirrors the Insights
   metric tabs (underline-active style) for visual continuity. */
.sv-tabs{display:flex;gap:2px;border-bottom:1px solid var(--border);margin-top:-8px;}
.sv-tab{position:relative;padding:10px 16px 12px;border:none;background:none;font-family:var(--font);font-size:13px;font-weight:500;color:var(--t3);cursor:pointer;display:inline-flex;align-items:center;gap:6px;transition:color .12s;}
.sv-tab:hover{color:var(--t1);}
.sv-tab.on{color:var(--t1);font-weight:600;}
.sv-tab.on::after{content:"";position:absolute;left:12px;right:12px;bottom:-1px;height:2px;background:var(--accent);border-radius:2px;}
.sv-tab-c{font-size:11.5px;color:var(--t4);font-weight:500;background:var(--bg2);padding:1px 7px;border-radius:10px;min-width:18px;text-align:center;}
.sv-tab.on .sv-tab-c{color:var(--accent);background:color-mix(in srgb, var(--accent) 12%, transparent);}

/* Team-visibility badge on cards. Distinct from the tab pill so
   admins instantly know which rows are shared org-wide. */
.sv-vis-chip{display:inline-flex;align-items:center;font-size:10.5px;font-weight:600;letter-spacing:.2px;text-transform:uppercase;padding:2px 7px;border-radius:9px;background:color-mix(in srgb, var(--accent) 12%, transparent);color:var(--accent);}

.sv-empty{padding:64px 24px;text-align:center;color:var(--t3);font-size:13px;background:#fff;border:1px dashed var(--border2);border-radius:12px;}
.sv-empty-h{font-family:var(--serif);font-size:18px;font-weight:600;color:var(--t1);margin-bottom:6px;}
.sv-empty-sub{font-size:13px;color:var(--t3);margin:0 auto;line-height:1.55;max-width:480px;}

.sv-grid{display:grid;grid-template-columns:repeat(auto-fill, minmax(320px, 1fr));gap:18px;}

.sv-card{display:flex;flex-direction:column;text-align:left;background:#fff;border:1px solid var(--border);border-radius:12px;overflow:hidden;cursor:pointer;font:inherit;color:inherit;padding:0;transition:border-color .12s,box-shadow .12s;}
.sv-card:hover{border-color:var(--border2);box-shadow:0 4px 16px rgba(0,0,0,.06);}

/* Thumb strip aspect is FIXED at 16:9 across all card variants so
   the title sits at the same vertical position in every row — keeps
   row-to-row alignment clean. Per-count rules below control the
   internal grid layout (1×1, 1×2, 1×3, or 2×2). */
.sv-card-thumbs{position:relative;display:grid;gap:2px;background:var(--bg2);aspect-ratio:16/9;grid-template-columns:1fr;grid-template-rows:1fr;}
.sv-card-thumbs.n0{grid-template-columns:1fr;}
.sv-card-thumbs.n1{grid-template-columns:1fr;}
.sv-card-thumbs.n2{grid-template-columns:1fr 1fr;}
.sv-card-thumbs.n3{grid-template-columns:1fr 1fr 1fr;}
/* 4 thumbs: 2×2 grid. Each cell is half-width × half-height which
   keeps the cell aspect at the strip's 16:9 — Vimeo-style stills
   don't get crushed into portrait crops the way the old 1×4 strip
   did. */
.sv-card-thumbs.n4{grid-template-columns:1fr 1fr;grid-template-rows:1fr 1fr;}
.sv-card-thumb{overflow:hidden;background:var(--bg3);}
.sv-card-thumb img{width:100%;height:100%;object-fit:cover;display:block;}
.sv-card-thumb-empty{width:100%;height:100%;background:var(--bg3);}
.sv-card-thumbs-empty{grid-column:1 / -1;grid-row:1 / -1;display:grid;place-items:center;color:var(--t4);font-size:12px;}

/* Hover actions overlay top-right of the thumb. Same affordance
   pattern as the library grid cards — opacity 0 by default, fade
   in on card hover. Each button is a frosted disc so they stay
   legible on any thumbnail background. */
.sv-card-actions{position:absolute;top:10px;right:10px;display:flex;gap:6px;opacity:0;transition:opacity .12s;z-index:2;}
.sv-card:hover .sv-card-actions,.sv-card:focus-within .sv-card-actions{opacity:1;}
.sv-card-act{width:30px;height:30px;display:grid;place-items:center;border:none;background:rgba(20,20,28,.62);color:rgba(255,255,255,.96);border-radius:7px;cursor:pointer;backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);box-shadow:0 2px 6px rgba(0,0,0,.18);transition:background .12s,transform .12s;}
.sv-card-act:hover{background:rgba(20,20,28,.82);transform:translateY(-1px);}
.sv-card-act.danger:hover{background:#b91c1c;}

.sv-card-body{padding:14px 16px 16px;display:flex;flex-direction:column;gap:6px;}
/* Title font deliberately matches .card-headline in the library
   grid (17px, 2-line clamp, accent letter-spacing) so the
   Showcases view feels like a sibling of the asset grid rather
   than a side-quest with its own type system. */
.sv-card-title{font-family:var(--font);font-size:17px;font-weight:600;color:var(--t1);line-height:1.38;letter-spacing:-.012em;margin:0;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;}

.sv-card-desc{font-size:12.5px;color:var(--t3);line-height:1.5;margin:0;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;}
.sv-card-meta{font-size:11.5px;color:var(--t4);display:flex;align-items:center;gap:6px;margin-top:4px;}
.sv-card-dot{opacity:.6;}

/* Dots-menu popover. Portal-rendered + position:fixed so it
   escapes the card's overflow:hidden. Matches the library grid's
   dots menu so admins recognise the affordance immediately. */
.scm-pop{background:#fff;border:1px solid var(--border);border-radius:9px;box-shadow:0 14px 36px rgba(0,0,0,.18), 0 4px 10px rgba(0,0,0,.06);padding:5px;min-width:200px;z-index:1100;animation:scmFade .14s ease;}
@keyframes scmFade{from{opacity:0;transform:translateY(-3px);}to{opacity:1;transform:translateY(0);}}
.scm-item{display:flex;align-items:center;gap:9px;width:100%;padding:8px 10px;background:none;border:none;cursor:pointer;font-family:var(--font);font-size:12.5px;color:var(--t1);text-align:left;border-radius:5px;transition:background .12s;}
.scm-item svg{color:var(--t3);flex-shrink:0;}
.scm-item:hover{background:var(--bg2);}
.scm-item.danger{color:#b91c1c;}
.scm-item.danger svg{color:#b91c1c;}
.scm-item.danger:hover{background:#fef2f2;}
.scm-sep{height:1px;background:var(--border);margin:4px 4px;}

@media (max-width: 900px) {
  .sv{padding:20px 18px 48px;}
  .sv-grid{grid-template-columns:1fr;}
  .sv-page-head{flex-direction:column;align-items:stretch;}
}
`;
