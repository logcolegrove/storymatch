"use client";

// ShowcaseBuilder — full-page editor for a single showcase.
// Modeled after Vimeo Showcases + Elfsight: slim left rail of
// category icons that fly out into settings panels, a live
// preview as the main canvas, and a top bar with the showcase
// name and primary actions.
//
// State model: the builder holds a local `draft` that's the
// in-flight edit. The preview renders directly from this draft so
// every change shows up instantly. Saves PUT to /api/showcases
// and update both the draft baseline AND the parent's list cache.
//
// v1 categories:
//   Content    — name + description + asset picker
//   Layout     — template selector (3 built-in templates)
//   Style      — stubbed ("Coming soon")
//   Settings   — stubbed ("Coming soon")
//
// Phase B2.3 (next slice) adds per-block prop editing inside the
// Layout panel — admins click a block in the preview to inspect/
// tweak its props. For now the templates are pre-tuned and the
// admin's customization stops at "pick a template."

import { useEffect, useMemo, useState } from "react";
import ShowcaseRenderer, { type ShowcaseRenderAsset } from "./ShowcaseRenderer";
import { effectiveTemplate, cloneTemplateBlocks, TEMPLATES, type TemplateBlock, type HeroBlockProps, type AssetGridBlockProps, type QuoteRotatorBlockProps, type IntroTextBlockProps, type DividerBlockProps, type FooterBlockProps } from "@/lib/showcase-templates";
import type { ShowcaseAssetRef } from "./ShowcasesView";

interface ShowcaseDraft {
  name: string;
  description: string | null;
  assetIds: string[];
  templateId: string | null;
  // The showcase's owned block array. Lives in the draft so per-
  // block prop edits flow into the preview immediately, then PUT
  // when the admin saves. Null until the admin actually
  // customizes — at which point we clone the named template's
  // blocks and the showcase is "forked."
  templateConfig: TemplateBlock[] | null;
}

interface SavedShowcase {
  id: string;
  orgId: string;
  ownerUserId: string;
  name: string;
  description: string | null;
  assetIds: string[];
  templateId: string | null;
  templateConfig: TemplateBlock[] | null;
  createdAt: string;
  updatedAt: string;
}

interface Props {
  // The showcase being edited. Drives the initial draft. When
  // null, the builder isn't mounted (parent gates on this).
  showcase: SavedShowcase;
  // All assets in the org. Used for the picker + the preview's
  // resolved-assets list.
  assets: ShowcaseAssetRef[];
  authHeaders: () => Promise<HeadersInit>;
  // Called when the admin clicks "← Back" or after a successful
  // save (with the updated showcase). Parent uses it to update
  // the showcases list and close the builder.
  onClose: (updated?: SavedShowcase) => void;
  onToast: (msg: string) => void;
}

type Category = "content" | "layout" | "style" | "settings";

export default function ShowcaseBuilder({ showcase, assets, authHeaders, onClose, onToast }: Props) {
  const [draft, setDraft] = useState<ShowcaseDraft>({
    name: showcase.name,
    description: showcase.description,
    assetIds: showcase.assetIds,
    templateId: showcase.templateId,
    templateConfig: showcase.templateConfig,
  });
  // Saved baseline — what the draft was last persisted as. Drives
  // the dirty-state indicator on the Save button.
  const [baseline, setBaseline] = useState<ShowcaseDraft>({
    name: showcase.name,
    description: showcase.description,
    assetIds: showcase.assetIds,
    templateId: showcase.templateId,
    templateConfig: showcase.templateConfig,
  });
  const [activeCategory, setActiveCategory] = useState<Category | null>("content");
  const [saving, setSaving] = useState(false);

  // Esc-to-close. Only fires when no category is open — otherwise
  // Esc closes the panel first (one layer at a time).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (activeCategory) setActiveCategory(null);
      else onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [activeCategory, onClose]);

  // Dirty check — JSON-compare draft to baseline. Cheap because
  // both objects are shallow.
  const dirty = useMemo(() => {
    if (draft.name !== baseline.name) return true;
    if (draft.description !== baseline.description) return true;
    if (draft.templateId !== baseline.templateId) return true;
    if (draft.assetIds.length !== baseline.assetIds.length) return true;
    for (let i = 0; i < draft.assetIds.length; i++) {
      if (draft.assetIds[i] !== baseline.assetIds[i]) return true;
    }
    // Compare templateConfig via JSON — block trees are small and
    // JSON-safe by DSL design. Cheaper than a deep-equal helper.
    if (JSON.stringify(draft.templateConfig) !== JSON.stringify(baseline.templateConfig)) return true;
    return false;
  }, [draft, baseline]);

  // Resolved assets for the live preview — filtered to live +
  // ordered to match draft.assetIds. We project down to the
  // renderer's slim asset shape (the preview doesn't need the
  // full Asset detail).
  const assetMap = useMemo(() => {
    const m = new Map<string, ShowcaseAssetRef>();
    for (const a of assets) m.set(a.id, a);
    return m;
  }, [assets]);

  const previewAssets: ShowcaseRenderAsset[] = useMemo(() => {
    const out: ShowcaseRenderAsset[] = [];
    for (const id of draft.assetIds) {
      const a = assetMap.get(id);
      if (!a) continue; // silent drop, matches the live-reference contract
      if (a.status !== "published") continue;
      out.push({
        id: a.id,
        headline: a.headline,
        pull_quote: "",  // ShowcaseAssetRef doesn't carry pull_quote; rendered placeholders are fine for the preview
        client_name: a.clientName,
        company: a.company,
        thumbnail: a.thumbnail,
      });
    }
    return out;
  }, [draft.assetIds, assetMap]);

  // Effective template the preview renders against. When the
  // admin has started customizing, this comes from templateConfig;
  // otherwise from the named templateId.
  const template = effectiveTemplate(draft.templateConfig, draft.templateId);

  // ── Save ──────────────────────────────────────────────────────
  const handleSave = async () => {
    setSaving(true);
    try {
      const headers = await authHeaders();
      const r = await fetch(`/api/showcases/${encodeURIComponent(showcase.id)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify({
          name: draft.name,
          description: draft.description,
          asset_ids: draft.assetIds,
          template_id: draft.templateId,
          template_config: draft.templateConfig,
        }),
      });
      if (!r.ok) throw new Error("Save failed");
      const data = await r.json() as { showcase: SavedShowcase };
      // Sync baseline to the freshly-saved values so dirty flips
      // back to false. We use the server's response (not the
      // local draft) in case the server normalized anything.
      setBaseline({
        name: data.showcase.name,
        description: data.showcase.description,
        assetIds: data.showcase.assetIds,
        templateId: data.showcase.templateId,
        templateConfig: data.showcase.templateConfig,
      });
      setDraft({
        name: data.showcase.name,
        description: data.showcase.description,
        assetIds: data.showcase.assetIds,
        templateId: data.showcase.templateId,
        templateConfig: data.showcase.templateConfig,
      });
      onToast("Showcase saved");
    } catch (e) {
      console.error("[ShowcaseBuilder] save failed", e);
      onToast("Couldn't save showcase");
    } finally {
      setSaving(false);
    }
  };

  const copyShareLink = () => {
    if (typeof window === "undefined") return;
    const u = `${window.location.origin}/showcase/${showcase.id}`;
    try {
      navigator.clipboard?.writeText(u);
      onToast("Link copied to clipboard");
    } catch {
      onToast("Couldn't copy — try selecting the URL manually");
    }
  };

  return (
    <div className="sb">
      <style>{css}</style>

      {/* Top bar — back, title (editable inline), save + share. */}
      <header className="sb-top">
        <button className="sb-back" onClick={() => onClose()} aria-label="Back to showcases">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="19" y1="12" x2="5" y2="12"/>
            <polyline points="12 19 5 12 12 5"/>
          </svg>
        </button>
        <div className="sb-trail">
          <span className="sb-trail-crumb">Showcases</span>
          <span className="sb-trail-sep">/</span>
          <input
            type="text"
            className="sb-title-input"
            value={draft.name}
            onChange={e => setDraft(d => ({ ...d, name: e.target.value }))}
            placeholder="Untitled showcase"
          />
        </div>
        <div className="sb-top-r">
          <button className="sb-share" onClick={copyShareLink} title="Copy public link">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
              <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
            </svg>
            Share
          </button>
          <button
            className={`sb-save${dirty ? " dirty" : ""}`}
            onClick={handleSave}
            disabled={saving || !dirty}
          >
            {saving ? "Saving…" : dirty ? "Save" : "Saved"}
          </button>
        </div>
      </header>

      <div className="sb-body">
        {/* Left rail — category icons. Click toggles the slide-
            out panel for that category. Selected state highlights
            the active category. */}
        <aside className="sb-rail">
          <button
            className={`sb-rail-btn${activeCategory === "content" ? " on" : ""}`}
            onClick={() => setActiveCategory(activeCategory === "content" ? null : "content")}
            title="Content — assets, title, description"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <line x1="3" y1="6" x2="21" y2="6"/>
              <line x1="3" y1="12" x2="21" y2="12"/>
              <line x1="3" y1="18" x2="21" y2="18"/>
            </svg>
            <span>Content</span>
          </button>
          <button
            className={`sb-rail-btn${activeCategory === "layout" ? " on" : ""}`}
            onClick={() => setActiveCategory(activeCategory === "layout" ? null : "layout")}
            title="Layout — template + block settings"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="7" height="7" rx="1"/>
              <rect x="14" y="3" width="7" height="7" rx="1"/>
              <rect x="3" y="14" width="7" height="7" rx="1"/>
              <rect x="14" y="14" width="7" height="7" rx="1"/>
            </svg>
            <span>Layout</span>
          </button>
          <button
            className={`sb-rail-btn${activeCategory === "style" ? " on" : ""}`}
            onClick={() => setActiveCategory(activeCategory === "style" ? null : "style")}
            title="Style — colors, fonts, branding (coming soon)"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="13.5" cy="6.5" r="2.5"/>
              <circle cx="19" cy="13" r="2.5"/>
              <circle cx="6" cy="12" r="2.5"/>
              <circle cx="10" cy="20" r="2.5"/>
              <path d="M2 12a10 10 0 0 1 20 0"/>
            </svg>
            <span>Style</span>
          </button>
          <button
            className={`sb-rail-btn${activeCategory === "settings" ? " on" : ""}`}
            onClick={() => setActiveCategory(activeCategory === "settings" ? null : "settings")}
            title="Settings — autoplay, behavior (coming soon)"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3"/>
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
            </svg>
            <span>Settings</span>
          </button>
        </aside>

        {/* Slide-out category panel. Width is fixed; the preview
            takes whatever's left. When activeCategory is null,
            the panel collapses entirely. */}
        {activeCategory && (
          <section className="sb-panel">
            <header className="sb-panel-head">
              <h2>{activeCategory === "content" ? "Content"
                : activeCategory === "layout" ? "Layout"
                : activeCategory === "style" ? "Style"
                : "Settings"}</h2>
              <button className="sb-panel-close" onClick={() => setActiveCategory(null)} aria-label="Close panel">×</button>
            </header>

            <div className="sb-panel-body">
              {activeCategory === "content" && (
                <ContentPanel
                  draft={draft}
                  setDraft={setDraft}
                  assets={assets}
                />
              )}
              {activeCategory === "layout" && (
                <LayoutPanel
                  templateId={draft.templateId}
                  effectiveBlocks={template.blocks}
                  onSelectTemplate={(id) => {
                    // Picking a template clones its blocks into
                    // templateConfig (fork-from-template). Resets
                    // any prior per-block customizations.
                    setDraft(d => ({
                      ...d,
                      templateId: id,
                      templateConfig: cloneTemplateBlocks(id),
                    }));
                  }}
                  onUpdateBlock={(idx, newProps) => {
                    // Per-block prop edit. If templateConfig is
                    // still null (admin hasn't customized yet),
                    // clone the named template's blocks first so
                    // we have something to mutate.
                    setDraft(d => {
                      const base = d.templateConfig ?? cloneTemplateBlocks(d.templateId);
                      const next = base.map((b, i) => i === idx ? { ...b, props: { ...b.props, ...newProps } } as TemplateBlock : b);
                      return { ...d, templateConfig: next };
                    });
                  }}
                />
              )}
              {activeCategory === "style" && (
                <ComingSoonStub
                  title="Style controls"
                  body="Colors, fonts, and brand presets. These will let you align the showcase with your customer's brand guidelines without touching code."
                />
              )}
              {activeCategory === "settings" && (
                <ComingSoonStub
                  title="Showcase settings"
                  body="Autoplay behavior, asset-click target (modal vs. new page), pagination size, and embed dimensions. These map to the existing block props — once exposed they'll live here."
                />
              )}
            </div>
          </section>
        )}

        {/* Preview area — ShowcaseRenderer driven by the live
            draft. Updates as the admin tweaks any setting. Click
            handler is a no-op for v1 — clicking an asset in the
            preview shouldn't navigate away from the builder. */}
        <main className="sb-preview">
          <div className="sb-preview-frame">
            <ShowcaseRenderer
              template={template}
              context={{
                showcase: { id: showcase.id, name: draft.name || "Untitled showcase", description: draft.description },
                assets: previewAssets,
                onAssetClick: () => { /* no-op in builder preview */ },
              }}
            />
          </div>
        </main>
      </div>
    </div>
  );
}

// ─── Content panel ───────────────────────────────────────────────
function ContentPanel({ draft, setDraft, assets }: {
  draft: ShowcaseDraft;
  setDraft: React.Dispatch<React.SetStateAction<ShowcaseDraft>>;
  assets: ShowcaseAssetRef[];
}) {
  const [search, setSearch] = useState("");
  const assetMap = useMemo(() => {
    const m = new Map<string, ShowcaseAssetRef>();
    for (const a of assets) m.set(a.id, a);
    return m;
  }, [assets]);
  const selectedAssets = useMemo(() => draft.assetIds.map(id => assetMap.get(id) ?? null), [draft.assetIds, assetMap]);

  const availableAssets = useMemo(() => {
    const included = new Set(draft.assetIds);
    const q = search.trim().toLowerCase();
    return assets.filter(a => {
      if (included.has(a.id)) return false;
      if (a.status !== "published") return false;
      if (!q) return true;
      return (
        a.headline.toLowerCase().includes(q) ||
        a.company.toLowerCase().includes(q) ||
        a.clientName.toLowerCase().includes(q)
      );
    });
  }, [assets, draft.assetIds, search]);

  const addAsset = (id: string) => setDraft(d => d.assetIds.includes(id) ? d : { ...d, assetIds: [...d.assetIds, id] });
  const removeAsset = (id: string) => setDraft(d => ({ ...d, assetIds: d.assetIds.filter(x => x !== id) }));
  const moveAsset = (id: string, dir: -1 | 1) => {
    setDraft(d => {
      const idx = d.assetIds.indexOf(id);
      if (idx === -1) return d;
      const target = idx + dir;
      if (target < 0 || target >= d.assetIds.length) return d;
      const next = d.assetIds.slice();
      const [item] = next.splice(idx, 1);
      next.splice(target, 0, item);
      return { ...d, assetIds: next };
    });
  };

  return (
    <div className="sb-content">
      <section className="sb-section">
        <label className="sb-field">
          <span>Description <em>(optional)</em></span>
          <textarea
            value={draft.description || ""}
            onChange={e => setDraft(d => ({ ...d, description: e.target.value || null }))}
            placeholder="A short intro shown at the top of the public page."
            rows={3}
          />
        </label>
      </section>

      <section className="sb-section">
        <header className="sb-section-head">
          <h3>In this showcase</h3>
          <span className="sb-section-count">{draft.assetIds.length}</span>
        </header>
        {selectedAssets.length === 0 ? (
          <div className="sb-empty">Pick assets from below — they&apos;ll show up in your showcase in the order you add them.</div>
        ) : (
          <div className="sb-row-list">
            {selectedAssets.map((a, i) => (
              <div key={draft.assetIds[i]} className="sb-row">
                <span className="sb-row-pos">{i + 1}</span>
                {a?.thumbnail
                  ? <img src={a.thumbnail} alt="" className="sb-row-thumb"/>
                  : <div className="sb-row-thumb sb-row-thumb-empty"/>}
                <div className="sb-row-body">
                  <div className="sb-row-h">{a?.headline || "(asset unavailable)"}</div>
                  <div className="sb-row-sub">{a?.company || a?.clientName || ""}</div>
                </div>
                <div className="sb-row-actions">
                  <button disabled={i === 0} onClick={() => moveAsset(draft.assetIds[i], -1)} title="Move up">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><polyline points="18 15 12 9 6 15"/></svg>
                  </button>
                  <button disabled={i === selectedAssets.length - 1} onClick={() => moveAsset(draft.assetIds[i], 1)} title="Move down">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
                  </button>
                  <button onClick={() => removeAsset(draft.assetIds[i])} title="Remove" className="sb-row-remove">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="sb-section">
        <header className="sb-section-head">
          <h3>Add assets</h3>
          <span className="sb-section-count">{availableAssets.length}</span>
        </header>
        <div className="sb-search-wrap">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="sb-search-icon">
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          <input
            type="text"
            className="sb-search"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by title, company, or client"
          />
        </div>
        {availableAssets.length === 0 ? (
          <div className="sb-empty">{search ? "Nothing matches." : "Every Public asset is already in this showcase."}</div>
        ) : (
          <div className="sb-row-list">
            {availableAssets.map(a => (
              <button key={a.id} type="button" className="sb-row sb-row-add" onClick={() => addAsset(a.id)}>
                {a.thumbnail
                  ? <img src={a.thumbnail} alt="" className="sb-row-thumb"/>
                  : <div className="sb-row-thumb sb-row-thumb-empty"/>}
                <div className="sb-row-body">
                  <div className="sb-row-h">{a.headline || "Untitled"}</div>
                  <div className="sb-row-sub">{a.company || a.clientName || ""}</div>
                </div>
                <span className="sb-row-add-glyph">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                </span>
              </button>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

// ─── Layout panel ────────────────────────────────────────────────
// Two-level navigation. Top level shows the template picker + a
// block list (one row per block in the effective template). Click
// a block row to drill into its per-block settings; back arrow
// returns. Mirrors the Vimeo Showcases / Elfsight pattern.
function LayoutPanel({ templateId, effectiveBlocks, onSelectTemplate, onUpdateBlock }: {
  templateId: string | null;
  effectiveBlocks: TemplateBlock[];
  onSelectTemplate: (id: string) => void;
  onUpdateBlock: (idx: number, props: Record<string, unknown>) => void;
}) {
  // null = top-level list; a number = drilled into that block's
  // settings. Reset to null whenever templateId changes (clearer
  // mental model — switching templates pops you back to the list).
  const [drillIdx, setDrillIdx] = useState<number | null>(null);
  useEffect(() => { setDrillIdx(null); }, [templateId]);

  const visualFor = (id: string) => {
    if (id === "default")     return ["hero", "grid-3", "footer"];
    if (id === "with-quotes") return ["hero", "rotator", "grid-3", "footer"];
    if (id === "minimal")     return ["hero-l", "grid-2", "footer"];
    return ["hero", "grid-3", "footer"];
  };

  // Drill-in view
  if (drillIdx !== null && effectiveBlocks[drillIdx]) {
    const block = effectiveBlocks[drillIdx];
    return (
      <div className="sb-content">
        <button type="button" className="sb-drill-back" onClick={() => setDrillIdx(null)}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <line x1="19" y1="12" x2="5" y2="12"/>
            <polyline points="12 19 5 12 12 5"/>
          </svg>
          Back to layout
        </button>
        <div className="sb-drill-head">
          <span className="sb-drill-icon">{blockIcon(block.type)}</span>
          <div>
            <div className="sb-drill-kicker">Block · {drillIdx + 1}</div>
            <h3 className="sb-drill-h">{blockLabel(block.type)}</h3>
          </div>
        </div>
        <BlockSettings
          block={block}
          onChange={(props) => onUpdateBlock(drillIdx, props)}
        />
      </div>
    );
  }

  // Top-level view: template picker + block list
  return (
    <div className="sb-content">
      <section className="sb-section">
        <header className="sb-section-head">
          <h3>Template</h3>
        </header>
        <p className="sb-section-help">Pick a starting layout. Each template ships pre-tuned, then you can fine-tune individual blocks below.</p>
        <div className="sb-template-list">
          {TEMPLATES.map(t => {
            const selected = (templateId || "default") === t.id;
            return (
              <button
                key={t.id}
                type="button"
                className={`sb-template${selected ? " on" : ""}`}
                onClick={() => onSelectTemplate(t.id)}
              >
                <div className="sb-template-vis">
                  {visualFor(t.id).map((piece, i) => (
                    <div key={i} className={`sb-template-piece sb-template-piece-${piece}`}/>
                  ))}
                </div>
                <div className="sb-template-meta">
                  <div className="sb-template-h">{t.name}</div>
                  <div className="sb-template-desc">{t.description}</div>
                </div>
                {selected && (
                  <span className="sb-template-check" aria-label="Selected">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </section>

      <section className="sb-section">
        <header className="sb-section-head">
          <h3>Blocks</h3>
          <span className="sb-section-count">{effectiveBlocks.length}</span>
        </header>
        <p className="sb-section-help">Each block has its own settings — click one to dive in.</p>
        <div className="sb-block-list">
          {effectiveBlocks.map((b, i) => (
            <button
              key={i}
              type="button"
              className="sb-block-row"
              onClick={() => setDrillIdx(i)}
            >
              <span className="sb-block-icon">{blockIcon(b.type)}</span>
              <div className="sb-block-body">
                <div className="sb-block-h">{blockLabel(b.type)}</div>
                <div className="sb-block-sub">{blockSummary(b)}</div>
              </div>
              <svg className="sb-block-chev" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="9 18 15 12 9 6"/>
              </svg>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}

// ─── Block metadata helpers ──────────────────────────────────────
// Friendly labels + brief summaries that appear in the block list
// row. Keeps the drill-down hierarchy navigable at a glance.
function blockLabel(type: TemplateBlock["type"]): string {
  switch (type) {
    case "hero": return "Hero";
    case "asset-grid": return "Asset grid";
    case "quote-rotator": return "Quote rotator";
    case "intro-text": return "Intro text";
    case "divider": return "Divider";
    case "footer": return "Footer";
  }
}
function blockSummary(b: TemplateBlock): string {
  switch (b.type) {
    case "hero": return `${b.props.align === "left" ? "Left" : "Center"} aligned · ${b.props.padding || "comfortable"} padding`;
    case "asset-grid": return `${b.props.columns || 3} columns · ${b.props.aspect || "16/9"} aspect`;
    case "quote-rotator": return `Every ${b.props.intervalSec ?? 6}s · ${b.props.size === "compact" ? "compact" : "full"} size`;
    case "intro-text": return b.props.content ? b.props.content.slice(0, 60) + (b.props.content.length > 60 ? "…" : "") : "Empty";
    case "divider": return `${b.props.spacing || "normal"} spacing`;
    case "footer": return b.props.showBrand === false ? "Unbranded" : "StoryMatch branded";
  }
}
function blockIcon(type: TemplateBlock["type"]) {
  const common = { width: 14, height: 14, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2 as const, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  switch (type) {
    case "hero":          return <svg {...common}><rect x="3" y="5" width="18" height="9" rx="1"/><line x1="3" y1="19" x2="14" y2="19"/></svg>;
    case "asset-grid":    return <svg {...common}><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>;
    case "quote-rotator": return <svg {...common}><path d="M3 21c0-7 6-13 13-13"/><path d="M14 8a5 5 0 0 1 5 5"/></svg>;
    case "intro-text":    return <svg {...common}><line x1="4" y1="7" x2="20" y2="7"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="17" x2="14" y2="17"/></svg>;
    case "divider":       return <svg {...common}><line x1="3" y1="12" x2="21" y2="12"/></svg>;
    case "footer":        return <svg {...common}><rect x="3" y="5" width="18" height="9" rx="1"/><line x1="3" y1="19" x2="21" y2="19"/></svg>;
  }
}

// ─── Per-block settings ──────────────────────────────────────────
// Discriminated dispatch — one render path per block type. Each
// returns a set of typed form controls bound to that block's
// props. Changes flow up via the onChange callback which the
// parent merges into templateConfig[idx].props.
function BlockSettings({ block, onChange }: {
  block: TemplateBlock;
  onChange: (newProps: Record<string, unknown>) => void;
}) {
  switch (block.type) {
    case "hero":          return <HeroSettings          props={block.props} onChange={onChange}/>;
    case "asset-grid":    return <AssetGridSettings     props={block.props} onChange={onChange}/>;
    case "quote-rotator": return <QuoteRotatorSettings  props={block.props} onChange={onChange}/>;
    case "intro-text":    return <IntroTextSettings     props={block.props} onChange={onChange}/>;
    case "divider":       return <DividerSettings       props={block.props} onChange={onChange}/>;
    case "footer":        return <FooterSettings        props={block.props} onChange={onChange}/>;
  }
}

function HeroSettings({ props, onChange }: { props: HeroBlockProps; onChange: (p: Record<string, unknown>) => void }) {
  return (
    <div className="sb-bs">
      <FieldLabel label="Alignment">
        <RadioGroup
          value={props.align || "center"}
          options={[{ value: "left", label: "Left" }, { value: "center", label: "Center" }]}
          onChange={(v) => onChange({ align: v })}
        />
      </FieldLabel>
      <FieldLabel label="Padding">
        <Select
          value={props.padding || "comfortable"}
          options={[
            { value: "compact", label: "Compact" },
            { value: "comfortable", label: "Comfortable" },
            { value: "spacious", label: "Spacious" },
          ]}
          onChange={(v) => onChange({ padding: v })}
        />
      </FieldLabel>
      <FieldLabel label="Show subtitle">
        <Select
          value={props.subtitleSource || "showcase.description"}
          options={[
            { value: "showcase.description", label: "Use showcase description" },
            { value: "none", label: "Hide subtitle" },
          ]}
          onChange={(v) => onChange({ subtitleSource: v })}
        />
      </FieldLabel>
    </div>
  );
}

function AssetGridSettings({ props, onChange }: { props: AssetGridBlockProps; onChange: (p: Record<string, unknown>) => void }) {
  return (
    <div className="sb-bs">
      <FieldLabel label="Columns">
        <RadioGroup
          value={String(props.columns || 3)}
          options={[{ value: "2", label: "2" }, { value: "3", label: "3" }, { value: "4", label: "4" }]}
          onChange={(v) => onChange({ columns: parseInt(v, 10) })}
        />
      </FieldLabel>
      <FieldLabel label="Thumbnail aspect">
        <Select
          value={props.aspect || "16/9"}
          options={[
            { value: "16/9", label: "16:9 — Widescreen" },
            { value: "4/3", label: "4:3 — Classic" },
            { value: "1/1", label: "1:1 — Square" },
          ]}
          onChange={(v) => onChange({ aspect: v })}
        />
      </FieldLabel>
      <Toggle
        label="Show company name"
        checked={props.showCompany !== false}
        onChange={(v) => onChange({ showCompany: v })}
      />
      <Toggle
        label="Show pull-quote excerpt"
        checked={props.showQuote !== false}
        onChange={(v) => onChange({ showQuote: v })}
      />
    </div>
  );
}

function QuoteRotatorSettings({ props, onChange }: { props: QuoteRotatorBlockProps; onChange: (p: Record<string, unknown>) => void }) {
  return (
    <div className="sb-bs">
      <FieldLabel label="Auto-advance interval">
        <div className="sb-bs-inline">
          <input
            type="number"
            min={2}
            max={30}
            value={props.intervalSec ?? 6}
            onChange={(e) => {
              const n = parseInt(e.target.value, 10);
              if (Number.isFinite(n)) onChange({ intervalSec: Math.max(2, Math.min(30, n)) });
            }}
          />
          <span className="sb-bs-suffix">seconds</span>
        </div>
      </FieldLabel>
      <FieldLabel label="Size">
        <RadioGroup
          value={props.size || "full"}
          options={[{ value: "full", label: "Full" }, { value: "compact", label: "Compact" }]}
          onChange={(v) => onChange({ size: v })}
        />
      </FieldLabel>
    </div>
  );
}

function IntroTextSettings({ props, onChange }: { props: IntroTextBlockProps; onChange: (p: Record<string, unknown>) => void }) {
  return (
    <div className="sb-bs">
      <FieldLabel label="Body">
        <textarea
          className="sb-bs-textarea"
          value={props.content || ""}
          onChange={(e) => onChange({ content: e.target.value })}
          rows={6}
          placeholder="Write a short intro paragraph. Blank lines separate paragraphs."
        />
      </FieldLabel>
      <FieldLabel label="Alignment">
        <RadioGroup
          value={props.align || "left"}
          options={[{ value: "left", label: "Left" }, { value: "center", label: "Center" }]}
          onChange={(v) => onChange({ align: v })}
        />
      </FieldLabel>
    </div>
  );
}

function DividerSettings({ props, onChange }: { props: DividerBlockProps; onChange: (p: Record<string, unknown>) => void }) {
  return (
    <div className="sb-bs">
      <FieldLabel label="Spacing">
        <Select
          value={props.spacing || "normal"}
          options={[
            { value: "tight", label: "Tight" },
            { value: "normal", label: "Normal" },
            { value: "wide", label: "Wide" },
          ]}
          onChange={(v) => onChange({ spacing: v })}
        />
      </FieldLabel>
    </div>
  );
}

function FooterSettings({ props, onChange }: { props: FooterBlockProps; onChange: (p: Record<string, unknown>) => void }) {
  return (
    <div className="sb-bs">
      <Toggle
        label="Show &quot;Shared via StoryMatch&quot; brand mark"
        checked={props.showBrand !== false}
        onChange={(v) => onChange({ showBrand: v })}
      />
    </div>
  );
}

// ─── Form primitives ─────────────────────────────────────────────
// Lightweight shared form controls used by all block-settings
// panels. Keeps each settings component focused on its semantics,
// not styling boilerplate.
function FieldLabel({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="sb-bs-field">
      <span>{label}</span>
      {children}
    </label>
  );
}
function RadioGroup({ value, options, onChange }: { value: string; options: { value: string; label: string }[]; onChange: (v: string) => void }) {
  return (
    <div className="sb-bs-radios">
      {options.map(o => (
        <button
          key={o.value}
          type="button"
          className={`sb-bs-radio${value === o.value ? " on" : ""}`}
          onClick={() => onChange(o.value)}
        >{o.label}</button>
      ))}
    </div>
  );
}
function Select({ value, options, onChange }: { value: string; options: { value: string; label: string }[]; onChange: (v: string) => void }) {
  return (
    <select className="sb-bs-select" value={value} onChange={e => onChange(e.target.value)}>
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}
function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="sb-bs-toggle">
      <span className="sb-bs-toggle-label">{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        className={`sb-bs-switch${checked ? " on" : ""}`}
        onClick={() => onChange(!checked)}
      >
        <span className="sb-bs-switch-thumb"/>
      </button>
    </label>
  );
}

// ─── Coming-soon stub ────────────────────────────────────────────
function ComingSoonStub({ title, body }: { title: string; body: string }) {
  return (
    <div className="sb-coming-soon">
      <div className="sb-coming-soon-h">{title}</div>
      <p>{body}</p>
    </div>
  );
}

// ─── Styles ──────────────────────────────────────────────────────
const css = `
.sb{position:fixed;inset:0;background:var(--bg);z-index:100;display:flex;flex-direction:column;font-family:var(--font);color:var(--t1);}

/* Top bar */
.sb-top{display:flex;align-items:center;gap:14px;padding:12px 20px;background:#fff;border-bottom:1px solid var(--border);flex-shrink:0;}
.sb-back{width:34px;height:34px;display:grid;place-items:center;border:1px solid var(--border);border-radius:8px;background:#fff;color:var(--t2);cursor:pointer;transition:all .12s;}
.sb-back:hover{background:var(--bg2);color:var(--t1);}

.sb-trail{display:flex;align-items:center;gap:8px;flex:1;min-width:0;}
.sb-trail-crumb{font-size:13px;color:var(--t3);font-weight:500;flex-shrink:0;}
.sb-trail-sep{color:var(--t4);}
.sb-title-input{flex:1;border:none;background:none;font-family:var(--serif);font-size:18px;font-weight:600;letter-spacing:-.3px;color:var(--t1);padding:6px 8px;border-radius:6px;min-width:0;}
.sb-title-input:hover{background:var(--bg2);}
.sb-title-input:focus{outline:none;background:var(--bg);box-shadow:inset 0 0 0 1px var(--border);}

.sb-top-r{display:flex;gap:8px;align-items:center;flex-shrink:0;}
.sb-share{display:inline-flex;align-items:center;gap:6px;padding:7px 12px;border:1px solid var(--border);border-radius:7px;background:#fff;color:var(--t2);font-family:var(--font);font-size:12.5px;font-weight:600;cursor:pointer;transition:all .12s;}
.sb-share:hover{background:var(--bg2);color:var(--t1);}
.sb-save{padding:8px 18px;border:none;border-radius:7px;background:var(--bg2);color:var(--t3);font-family:var(--font);font-size:12.5px;font-weight:600;cursor:default;transition:all .12s;}
.sb-save.dirty{background:var(--accent);color:#fff;cursor:pointer;}
.sb-save.dirty:hover:not(:disabled){filter:brightness(1.08);}
.sb-save:disabled{opacity:.6;}

/* Body — rail + panel + preview */
.sb-body{flex:1;display:flex;min-height:0;}

/* Left rail */
.sb-rail{width:72px;background:#fff;border-right:1px solid var(--border);display:flex;flex-direction:column;padding:14px 0;gap:4px;flex-shrink:0;}
.sb-rail-btn{display:flex;flex-direction:column;align-items:center;gap:4px;padding:10px 6px;margin:0 8px;border:none;background:none;color:var(--t3);font-family:var(--font);font-size:10.5px;font-weight:600;cursor:pointer;border-radius:8px;transition:all .12s;}
.sb-rail-btn:hover{background:var(--bg2);color:var(--t1);}
.sb-rail-btn.on{background:var(--accentLL);color:var(--accent);}

/* Slide-out panel */
.sb-panel{width:380px;background:#fff;border-right:1px solid var(--border);display:flex;flex-direction:column;flex-shrink:0;animation:sbPanelIn .15s ease;}
@keyframes sbPanelIn{from{transform:translateX(-12px);opacity:0;}to{transform:translateX(0);opacity:1;}}
.sb-panel-head{display:flex;align-items:center;justify-content:space-between;padding:18px 20px 12px;border-bottom:1px solid var(--border);}
.sb-panel-head h2{font-family:var(--serif);font-size:17px;font-weight:600;letter-spacing:-.3px;color:var(--t1);margin:0;}
.sb-panel-close{background:none;border:none;color:var(--t3);cursor:pointer;width:26px;height:26px;display:grid;place-items:center;font-size:20px;border-radius:5px;}
.sb-panel-close:hover{background:var(--bg2);color:var(--t1);}
.sb-panel-body{flex:1;overflow-y:auto;padding:14px 18px 24px;}

.sb-content{display:flex;flex-direction:column;gap:18px;}
.sb-section{display:flex;flex-direction:column;gap:8px;}
.sb-section-head{display:flex;align-items:center;justify-content:space-between;}
.sb-section-head h3{font-size:12px;font-weight:700;color:var(--t2);text-transform:uppercase;letter-spacing:.5px;margin:0;}
.sb-section-count{font-size:11px;font-weight:700;color:var(--t3);background:var(--bg2);padding:2px 8px;border-radius:99px;}
.sb-section-help{font-size:12px;color:var(--t3);line-height:1.5;margin:0 0 4px;}

.sb-field{display:flex;flex-direction:column;gap:5px;}
.sb-field>span{font-size:11px;font-weight:700;color:var(--t3);text-transform:uppercase;letter-spacing:.5px;}
.sb-field>span em{font-style:normal;text-transform:none;letter-spacing:0;font-weight:500;color:var(--t4);margin-left:4px;}
.sb-field textarea{padding:8px 10px;border:1px solid var(--border);border-radius:7px;background:#fff;font-family:var(--font);font-size:13px;color:var(--t1);resize:vertical;line-height:1.5;}
.sb-field textarea:focus{outline:none;border-color:var(--accent);}

.sb-empty{padding:18px 14px;text-align:center;color:var(--t3);font-size:12.5px;line-height:1.5;background:var(--bg);border-radius:8px;}

.sb-search-wrap{position:relative;margin-bottom:6px;}
.sb-search-icon{position:absolute;left:10px;top:50%;transform:translateY(-50%);color:var(--t4);pointer-events:none;}
.sb-search{width:100%;padding:7px 10px 7px 28px;border:1px solid var(--border);border-radius:7px;background:var(--bg);color:var(--t1);font-family:var(--font);font-size:12.5px;}
.sb-search:focus{outline:none;border-color:var(--accent);background:#fff;}

.sb-row-list{display:flex;flex-direction:column;gap:3px;}
.sb-row{display:flex;align-items:center;gap:10px;padding:7px 9px;border-radius:8px;background:#fff;border:1px solid transparent;font-family:var(--font);color:var(--t1);font-size:12px;text-align:left;width:100%;}
.sb-row:hover{background:var(--bg);border-color:var(--border);}
.sb-row-add{cursor:pointer;}
.sb-row-add:hover{background:var(--accentLL);border-color:var(--accent);}
.sb-row-pos{width:18px;text-align:center;font-size:10.5px;font-weight:700;color:var(--t4);font-variant-numeric:tabular-nums;flex-shrink:0;}
.sb-row-thumb{width:44px;height:26px;object-fit:cover;border-radius:4px;flex-shrink:0;}
.sb-row-thumb-empty{background:var(--bg2);}
.sb-row-body{flex:1;min-width:0;}
.sb-row-h{font-size:12px;font-weight:600;color:var(--t1);line-height:1.3;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.sb-row-sub{font-size:10.5px;color:var(--t3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-top:1px;}
.sb-row-actions{display:flex;gap:1px;flex-shrink:0;}
.sb-row-actions button{width:22px;height:22px;display:grid;place-items:center;border:none;background:none;color:var(--t3);border-radius:4px;cursor:pointer;}
.sb-row-actions button:hover:not(:disabled){background:var(--bg2);color:var(--t1);}
.sb-row-actions button:disabled{opacity:.3;cursor:default;}
.sb-row-actions .sb-row-remove:hover{background:#fef2f2;color:#b91c1c;}
.sb-row-add-glyph{display:grid;place-items:center;width:22px;height:22px;border-radius:50%;background:var(--bg2);color:var(--t3);flex-shrink:0;}
.sb-row-add:hover .sb-row-add-glyph{background:var(--accent);color:#fff;}

/* Template picker */
.sb-template-list{display:flex;flex-direction:column;gap:8px;}
.sb-template{display:flex;align-items:center;gap:12px;padding:10px;border:1.5px solid var(--border);border-radius:10px;background:#fff;color:var(--t1);font-family:var(--font);text-align:left;cursor:pointer;position:relative;transition:all .12s;}
.sb-template:hover{border-color:var(--border2);background:var(--bg);}
.sb-template.on{border-color:var(--accent);background:var(--accentLL);}
.sb-template-vis{width:64px;height:48px;background:var(--bg2);border-radius:5px;padding:3px;display:flex;flex-direction:column;gap:2px;flex-shrink:0;overflow:hidden;}
.sb-template-piece{background:#fff;border-radius:1.5px;}
.sb-template-piece-hero{height:8px;}
.sb-template-piece-hero-l{height:8px;width:55%;}
.sb-template-piece-rotator{height:7px;background:linear-gradient(135deg,#f5efe2,#ebe6ef);}
.sb-template-piece-grid-3{flex:1;background:repeating-linear-gradient(90deg,#fff 0 30%,transparent 30% 33.33%);background-size:100% 100%;border-radius:1.5px;}
.sb-template-piece-grid-2{flex:1;background:repeating-linear-gradient(90deg,#fff 0 47%,transparent 47% 50%);background-size:100% 100%;border-radius:1.5px;}
.sb-template-piece-footer{height:4px;}
.sb-template-meta{flex:1;min-width:0;}
.sb-template-h{font-size:13px;font-weight:600;color:var(--t1);line-height:1.3;}
.sb-template-desc{font-size:11.5px;color:var(--t3);margin-top:3px;line-height:1.45;}
.sb-template-check{display:grid;place-items:center;width:22px;height:22px;border-radius:50%;background:var(--accent);color:#fff;flex-shrink:0;}

.sb-coming-soon-inline{padding:12px 14px;background:var(--bg);border:1px dashed var(--border2);border-radius:8px;font-size:11.5px;color:var(--t3);line-height:1.5;}

/* Block list — top-level Layout view shows one row per block in
   the effective template. Click to drill into per-block settings. */
.sb-block-list{display:flex;flex-direction:column;gap:4px;}
.sb-block-row{display:flex;align-items:center;gap:10px;padding:9px 12px;border:1px solid var(--border);border-radius:8px;background:#fff;color:var(--t1);font-family:var(--font);text-align:left;cursor:pointer;transition:all .12s;}
.sb-block-row:hover{background:var(--bg);border-color:var(--border2);}
.sb-block-icon{display:grid;place-items:center;width:28px;height:28px;border-radius:6px;background:var(--bg2);color:var(--t2);flex-shrink:0;}
.sb-block-body{flex:1;min-width:0;}
.sb-block-h{font-size:13px;font-weight:600;color:var(--t1);line-height:1.3;}
.sb-block-sub{font-size:11px;color:var(--t3);margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.sb-block-chev{color:var(--t4);flex-shrink:0;}
.sb-block-row:hover .sb-block-chev{color:var(--t2);}

/* Drill-in panel — header strip + the block-specific settings. */
.sb-drill-back{display:inline-flex;align-items:center;gap:5px;background:none;border:none;padding:4px 8px 4px 4px;margin:-4px -8px 8px -4px;font-family:var(--font);font-size:11.5px;font-weight:600;color:var(--t3);cursor:pointer;border-radius:5px;}
.sb-drill-back:hover{background:var(--bg2);color:var(--t1);}
.sb-drill-head{display:flex;align-items:center;gap:10px;margin-bottom:14px;padding-bottom:14px;border-bottom:1px solid var(--border);}
.sb-drill-icon{display:grid;place-items:center;width:34px;height:34px;border-radius:8px;background:var(--accentLL);color:var(--accent);flex-shrink:0;}
.sb-drill-kicker{font-size:10.5px;text-transform:uppercase;letter-spacing:.5px;color:var(--t4);font-weight:700;}
.sb-drill-h{font-family:var(--serif);font-size:17px;font-weight:600;letter-spacing:-.3px;color:var(--t1);margin:2px 0 0;line-height:1.2;}

/* Per-block settings — form primitives shared across all
   BlockSettings sub-components. */
.sb-bs{display:flex;flex-direction:column;gap:16px;}
.sb-bs-field{display:flex;flex-direction:column;gap:6px;}
.sb-bs-field>span{font-size:11px;font-weight:700;color:var(--t3);text-transform:uppercase;letter-spacing:.5px;}
.sb-bs-radios{display:flex;gap:4px;background:var(--bg);padding:3px;border-radius:8px;border:1px solid var(--border);}
.sb-bs-radio{flex:1;padding:6px 10px;border:none;background:none;color:var(--t3);font-family:var(--font);font-size:12px;font-weight:600;border-radius:5px;cursor:pointer;transition:all .12s;}
.sb-bs-radio:hover:not(.on){color:var(--t1);}
.sb-bs-radio.on{background:#fff;color:var(--accent);box-shadow:0 1px 2px rgba(0,0,0,.06);}
.sb-bs-select{width:100%;padding:7px 10px;border:1px solid var(--border);border-radius:7px;background:#fff;font-family:var(--font);font-size:12.5px;color:var(--t1);cursor:pointer;}
.sb-bs-select:focus{outline:none;border-color:var(--accent);}
.sb-bs-inline{display:flex;align-items:center;gap:8px;}
.sb-bs-inline input[type=number]{width:72px;padding:7px 10px;border:1px solid var(--border);border-radius:7px;background:#fff;font-family:var(--font);font-size:13px;color:var(--t1);font-variant-numeric:tabular-nums;}
.sb-bs-inline input[type=number]:focus{outline:none;border-color:var(--accent);}
.sb-bs-suffix{font-size:12px;color:var(--t3);}
.sb-bs-textarea{padding:8px 10px;border:1px solid var(--border);border-radius:7px;background:#fff;font-family:var(--font);font-size:13px;color:var(--t1);resize:vertical;line-height:1.5;}
.sb-bs-textarea:focus{outline:none;border-color:var(--accent);}
.sb-bs-toggle{display:flex;align-items:center;justify-content:space-between;gap:12px;cursor:pointer;}
.sb-bs-toggle-label{font-size:12.5px;color:var(--t1);flex:1;line-height:1.4;}
.sb-bs-switch{position:relative;width:36px;height:20px;border:none;background:var(--border2);border-radius:99px;cursor:pointer;transition:background .15s;flex-shrink:0;padding:0;}
.sb-bs-switch.on{background:var(--accent);}
.sb-bs-switch-thumb{position:absolute;top:2px;left:2px;width:16px;height:16px;background:#fff;border-radius:50%;transition:transform .15s;box-shadow:0 1px 2px rgba(0,0,0,.2);}
.sb-bs-switch.on .sb-bs-switch-thumb{transform:translateX(16px);}
.sb-coming-soon{padding:36px 24px;text-align:center;color:var(--t3);font-size:12.5px;line-height:1.55;background:var(--bg);border:1px dashed var(--border2);border-radius:10px;}
.sb-coming-soon-h{font-family:var(--serif);font-size:15px;font-weight:600;color:var(--t1);margin-bottom:6px;}
.sb-coming-soon p{margin:0;}

/* Preview */
.sb-preview{flex:1;overflow-y:auto;background:var(--bg);padding:24px;min-width:0;}
.sb-preview-frame{max-width:1200px;margin:0 auto;background:#fff;border-radius:14px;border:1px solid var(--border);box-shadow:0 4px 24px rgba(0,0,0,.04);overflow:hidden;min-height:calc(100vh - 130px);}
`;
