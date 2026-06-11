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

import React, { useEffect, useMemo, useState } from "react";
import ShowcaseRenderer, { type ShowcaseRenderAsset, type ShowcaseFieldDef, type FilterState, type SortKey, applyFilters } from "./ShowcaseRenderer";
import { effectiveTemplate, cloneTemplateBlocks, TEMPLATES, type TemplateBlock, type HeroBlockProps, type AssetGridBlockProps, type QuoteRotatorBlockProps, type IntroTextBlockProps, type DividerBlockProps, type FooterBlockProps, type FiltersInlineBlockProps, type FiltersStickyBlockProps } from "@/lib/showcase-templates";
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
  // B4.0 — Settings-panel fields. Held in the draft so the dirty
  // indicator + save flow treats them like any other edit. The
  // Settings UI binds directly to these.
  visibility: "personal" | "team";
  autoplayNext: boolean;
  paginationSize: number;
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
  visibility: "personal" | "team";
  autoplayNext: boolean;
  paginationSize: number;
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
  // Drives whether the visibility toggle in Settings is shown.
  // Sales reps can only build personal showcases; the toggle is
  // hidden for them. The API enforces this too.
  role: "admin" | "sales";
  // Called when the admin clicks "← Back" or after a successful
  // save (with the updated showcase). Parent uses it to update
  // the showcases list and close the builder.
  onClose: (updated?: SavedShowcase) => void;
  onToast: (msg: string) => void;
  // Slim org field defs — drives the filter-element category picker
  // (admin chooses which categories to expose) AND the live preview
  // (so dropdowns show real labels + values without a fetch). Empty
  // array is fine — filter elements just show fewer options.
  fieldDefs: ShowcaseFieldDef[];
}

type Category = "content" | "layout" | "style" | "settings";

export default function ShowcaseBuilder({ showcase, assets, authHeaders, role, onClose, onToast, fieldDefs }: Props) {
  const [draft, setDraft] = useState<ShowcaseDraft>({
    name: showcase.name,
    description: showcase.description,
    assetIds: showcase.assetIds,
    templateId: showcase.templateId,
    templateConfig: showcase.templateConfig,
    visibility: showcase.visibility,
    autoplayNext: showcase.autoplayNext,
    paginationSize: showcase.paginationSize,
  });
  // Saved baseline — what the draft was last persisted as. Drives
  // the dirty-state indicator on the Save button.
  const [baseline, setBaseline] = useState<ShowcaseDraft>({
    name: showcase.name,
    description: showcase.description,
    assetIds: showcase.assetIds,
    templateId: showcase.templateId,
    templateConfig: showcase.templateConfig,
    visibility: showcase.visibility,
    autoplayNext: showcase.autoplayNext,
    paginationSize: showcase.paginationSize,
  });
  const [activeCategory, setActiveCategory] = useState<Category | null>("content");
  const [saving, setSaving] = useState(false);
  // Drill-in index for the Layout panel. Hoisted here (instead of
  // owned inside LayoutPanel) so the preview-side hover-edit overlay
  // can open the Layout panel pre-focused on a specific block.
  const [layoutDrillIdx, setLayoutDrillIdx] = useState<number | null>(null);
  // Content panel view. "default" shows just Title + Description with
  // a "Manage content →" button. "manage-assets" drills into the
  // asset list + picker. Hoisted so the preview-side overlay button
  // can pre-drill it when the admin clicks "Manage content" on the
  // asset grid block.
  const [contentView, setContentView] = useState<"default" | "manage-assets">("default");

  // Holds the most recently saved showcase response so closeWithLatest()
  // can hand it back to the parent. Without this, the parent's
  // showcases list stays stale until a hard reload — the back/Esc
  // path calls onClose() with no argument and the parent only
  // syncs when handed an `updated` shape. Updated in handleSave's
  // success path; consumed on close.
  const lastSavedRef = React.useRef<SavedShowcase>(showcase);
  const closeWithLatest = () => onClose(lastSavedRef.current);

  // Esc-to-close. Only fires when no category is open — otherwise
  // Esc closes the panel first (one layer at a time).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (activeCategory) setActiveCategory(null);
      else onClose(lastSavedRef.current);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // lastSavedRef is a ref; ESLint doesn't need it in deps.
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
    if (draft.visibility !== baseline.visibility) return true;
    if (draft.autoplayNext !== baseline.autoplayNext) return true;
    if (draft.paginationSize !== baseline.paginationSize) return true;
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
      // Compose the fieldValues map exactly like the public path
      // does so the filter elements see real values. Built-ins
      // (vertical, geography, etc.) mirror in alongside any custom
      // fields admin defined.
      const fieldValues: Record<string, unknown> = {
        ...(a.customFieldValues || {}),
        vertical: a.vertical || "",
        geography: a.geography || "",
        clientRole: a.clientRole || "",
        company: a.company || "",
        clientName: a.clientName || "",
        headline: a.headline || "",
        description: a.description || "",
        assetType: a.assetType || "",
      };
      out.push({
        id: a.id,
        headline: a.headline,
        // ShowcaseAssetRef carries pullQuote + description — both
        // pipe through so the quote rotator has text to rotate and
        // the asset-grid block's showDescription toggle works.
        pull_quote: a.pullQuote || "",
        description: a.description || "",
        client_name: a.clientName,
        company: a.company,
        thumbnail: a.thumbnail,
        asset_type: a.assetType,
        duration_seconds: a.durationSeconds,
        fieldValues,
      });
    }
    return out;
  }, [draft.assetIds, assetMap]);

  // Live filter / sort / search state for the preview. Drives the
  // exact same applyFilters pipeline the public page uses, so what
  // the admin sees in the preview is what the viewer will see.
  const [previewFilterState, setPreviewFilterState] = useState<FilterState>({});
  const [previewSortKey, setPreviewSortKey] = useState<SortKey>("recent");
  const [previewSearchQuery, setPreviewSearchQuery] = useState<string>("");
  const filteredPreviewAssets = useMemo(
    () => applyFilters(previewAssets, previewFilterState, previewSortKey, previewSearchQuery),
    [previewAssets, previewFilterState, previewSortKey, previewSearchQuery],
  );

  // Effective template the preview renders against. When the
  // admin has started customizing, this comes from templateConfig;
  // otherwise from the named templateId.
  const template = effectiveTemplate(draft.templateConfig, draft.templateId);

  // Drag-reorder state — held in React state (not just a ref) so
  // every pointer movement re-renders the preview cards. The
  // dragged card translates with the cursor; the other cards
  // animate to their new slot positions. Mirrors the library
  // grid's "magic rearrange" feel exactly.
  //
  // Trade-off vs a ref-only approach: we re-render on every
  // pointermove, but only the AssetGridBlock cards re-render
  // (everything above is memo-stable), and the transforms are
  // GPU-accelerated. Smooth even on modest hardware.
  const [cardDrag, setCardDrag] = useState<{
    fromIdx: number;
    insertIdx: number;
    startX: number;
    startY: number;
    pointerX: number;
    pointerY: number;
    rects: { left: number; top: number; cx: number; cy: number }[];
    engaged: boolean;
  } | null>(null);
  const cardDragRef = React.useRef(cardDrag);
  cardDragRef.current = cardDrag;

  // Block-level drag for reordering blocks inside templateConfig.
  // Same shape as cardDrag but tracks "source" so both the left-rail
  // block list and the right-side preview can animate consistently
  // (the renderer/list both transform their rows based on the same
  // fromIdx + insertIdx). Closest-centroid wins for the insert idx.
  const [blockDrag, setBlockDrag] = useState<{
    fromIdx: number;
    insertIdx: number;
    startX: number;
    startY: number;
    pointerX: number;
    pointerY: number;
    rects: { left: number; top: number; cx: number; cy: number }[];
    engaged: boolean;
    source: "list" | "preview";
  } | null>(null);
  const blockDragRef = React.useRef(blockDrag);
  blockDragRef.current = blockDrag;

  // Commit a block reorder to draft.templateConfig. Both drag
  // surfaces call this on drop. Same fork-from-template dance as
  // onUpdateBlock — if the admin hasn't customized yet, we clone
  // the named template's blocks before splicing.
  const reorderBlocks = (fromIdx: number, insertIdx: number) => {
    if (fromIdx === insertIdx) return;
    setDraft(d => {
      const base = d.templateConfig ?? cloneTemplateBlocks(d.templateId);
      const next = [...base];
      const [moved] = next.splice(fromIdx, 1);
      next.splice(insertIdx, 0, moved);
      return { ...d, templateConfig: next };
    });
  };

  // Factory: returns a pointerdown handler bound to a specific index
  // and source. The handler captures rects via `selector` so each
  // surface measures its own layout (vertical list rows on the left,
  // block bands on the right).
  const beginBlockDrag = (idx: number, source: "list" | "preview", selector: string) => (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const els = Array.from(document.querySelectorAll<HTMLElement>(selector));
    const rects = els.map(el => {
      const r = el.getBoundingClientRect();
      return { left: r.left, top: r.top, cx: r.left + r.width / 2, cy: r.top + r.height / 2 };
    });
    if (rects.length === 0) return;
    setBlockDrag({
      fromIdx: idx,
      insertIdx: idx,
      startX: e.clientX,
      startY: e.clientY,
      pointerX: e.clientX,
      pointerY: e.clientY,
      rects,
      engaged: false,
      source,
    });
    const onMove = (ev: PointerEvent) => {
      const cur = blockDragRef.current;
      if (!cur) return;
      const dx = ev.clientX - cur.startX;
      const dy = ev.clientY - cur.startY;
      const engaged = cur.engaged || Math.hypot(dx, dy) >= 5;
      // Closest-centroid wins. For the vertical list we only care
      // about Y; for the preview we use Euclidean. Using the same
      // formula in both is fine — vertical lists naturally pick
      // the right row because horizontal deltas are ~0.
      let best = cur.fromIdx;
      let bestDist = Infinity;
      for (let i = 0; i < cur.rects.length; i++) {
        const d = Math.hypot(ev.clientX - cur.rects[i].cx, ev.clientY - cur.rects[i].cy);
        if (d < bestDist) { bestDist = d; best = i; }
      }
      setBlockDrag({
        ...cur,
        pointerX: ev.clientX,
        pointerY: ev.clientY,
        insertIdx: engaged ? best : cur.fromIdx,
        engaged,
      });
    };
    const onUp = () => {
      const cur = blockDragRef.current;
      setBlockDrag(null);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      if (!cur) return;
      // Suppress the synthetic click that follows pointerup so a
      // drag doesn't also open the block's drill-in or focus the
      // hover-edit button.
      if (cur.engaged) {
        dragJustEndedRef.current = true;
        setTimeout(() => { dragJustEndedRef.current = false; }, 150);
      }
      if (cur.engaged && cur.insertIdx !== cur.fromIdx) {
        reorderBlocks(cur.fromIdx, cur.insertIdx);
      }
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  };

  const beginAssetReorder = (idx: number, e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const els = Array.from(document.querySelectorAll<HTMLElement>(".sb-preview-frame .sr-card[data-asset-idx]"));
    const rects = els.map(el => {
      const r = el.getBoundingClientRect();
      return { left: r.left, top: r.top, cx: r.left + r.width / 2, cy: r.top + r.height / 2 };
    });
    setCardDrag({
      fromIdx: idx,
      insertIdx: idx,
      startX: e.clientX,
      startY: e.clientY,
      pointerX: e.clientX,
      pointerY: e.clientY,
      rects,
      engaged: false,
    });
    const onMove = (ev: PointerEvent) => {
      const cur = cardDragRef.current;
      if (!cur) return;
      const dx = ev.clientX - cur.startX;
      const dy = ev.clientY - cur.startY;
      const engaged = cur.engaged || Math.hypot(dx, dy) >= 5;
      // Closest-centroid wins as insertIdx. Once the pointer
      // crosses the 5px threshold, drag is live.
      let best = cur.fromIdx;
      let bestDist = Infinity;
      for (let i = 0; i < cur.rects.length; i++) {
        const d = Math.hypot(ev.clientX - cur.rects[i].cx, ev.clientY - cur.rects[i].cy);
        if (d < bestDist) {
          bestDist = d;
          best = i;
        }
      }
      setCardDrag({
        ...cur,
        pointerX: ev.clientX,
        pointerY: ev.clientY,
        insertIdx: engaged ? best : cur.fromIdx,
        engaged,
      });
    };
    const onUp = () => {
      const cur = cardDragRef.current;
      setCardDrag(null);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      if (!cur || !cur.engaged || cur.insertIdx === cur.fromIdx) {
        // Suppress the synthetic click that follows pointerup IF
        // a drag happened (even one that ended in the same slot).
        // For a true no-drag click, allow it through.
        if (cur?.engaged) {
          dragJustEndedRef.current = true;
          setTimeout(() => { dragJustEndedRef.current = false; }, 150);
        }
        return;
      }
      dragJustEndedRef.current = true;
      setTimeout(() => { dragJustEndedRef.current = false; }, 150);
      setDraft(dr => {
        const next = [...dr.assetIds];
        const [moved] = next.splice(cur.fromIdx, 1);
        next.splice(cur.insertIdx, 0, moved);
        return { ...dr, assetIds: next };
      });
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  };

  // After a drag ends, we want to swallow the synthetic click
  // event that pointerup fires (so dragging a card doesn't ALSO
  // open it). 150ms guard so genuine clicks (no preceding drag)
  // still register.
  const dragJustEndedRef = React.useRef(false);
  // Active asset for the in-builder preview modal. Click a card
  // in the preview → opens AssetDetail right inside the builder,
  // exactly the way it does on the public page. The previewed
  // asset is fetched lazily (the host passes a getAssetDetail
  // callback). null = no preview active.
  const [previewAssetId, setPreviewAssetId] = useState<string | null>(null);

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
          visibility: draft.visibility,
          autoplay_next: draft.autoplayNext,
          pagination_size: draft.paginationSize,
        }),
      });
      if (!r.ok) throw new Error("Save failed");
      const data = await r.json() as { showcase: SavedShowcase };
      // Remember the freshly-saved showcase so a subsequent close
      // hands the parent the new state (otherwise the showcases
      // list keeps the pre-save snapshot until a hard reload).
      lastSavedRef.current = data.showcase;
      // Sync baseline to the freshly-saved values so dirty flips
      // back to false. We use the server's response (not the
      // local draft) in case the server normalized anything.
      setBaseline({
        name: data.showcase.name,
        description: data.showcase.description,
        assetIds: data.showcase.assetIds,
        templateId: data.showcase.templateId,
        templateConfig: data.showcase.templateConfig,
        visibility: data.showcase.visibility,
        autoplayNext: data.showcase.autoplayNext,
        paginationSize: data.showcase.paginationSize,
      });
      setDraft({
        name: data.showcase.name,
        description: data.showcase.description,
        assetIds: data.showcase.assetIds,
        templateId: data.showcase.templateId,
        templateConfig: data.showcase.templateConfig,
        visibility: data.showcase.visibility,
        autoplayNext: data.showcase.autoplayNext,
        paginationSize: data.showcase.paginationSize,
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
        <button className="sb-back" onClick={closeWithLatest} aria-label="Back to showcases">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="19" y1="12" x2="5" y2="12"/>
            <polyline points="12 19 5 12 12 5"/>
          </svg>
        </button>
        <div className="sb-trail">
          <span className="sb-trail-crumb">Showcases</span>
          <span className="sb-trail-sep">/</span>
          {/* Top-bar title is now read-only — editing lives in the
              Content panel as a labeled "Title" field. Empty name
              renders as the system default so the breadcrumb still
              shows something when an admin hasn't named the showcase
              yet. Clicking it opens the Content panel for renaming. */}
          <button
            type="button"
            className="sb-trail-title"
            onClick={() => setActiveCategory("content")}
            title="Rename in the Content panel"
          >
            {draft.name || "Untitled showcase"}
          </button>
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
                  view={contentView}
                  onSetView={setContentView}
                />
              )}
              {activeCategory === "layout" && (
                <LayoutPanel
                  templateId={draft.templateId}
                  effectiveBlocks={template.blocks}
                  drillIdx={layoutDrillIdx}
                  onSetDrillIdx={setLayoutDrillIdx}
                  fieldDefs={fieldDefs}
                  blockDrag={blockDrag}
                  onBlockDragBegin={(idx, e) => beginBlockDrag(idx, "list", ".sb-block-row[data-block-idx]")(e)}
                  onSelectTemplate={(id) => {
                    // Picking a template clones its blocks into
                    // templateConfig (fork-from-template). Resets
                    // any prior per-block customizations + drops
                    // out of any active drill — the previous block
                    // index might not even map to a valid block in
                    // the new template's shape.
                    setDraft(d => ({
                      ...d,
                      templateId: id,
                      templateConfig: cloneTemplateBlocks(id),
                    }));
                    setLayoutDrillIdx(null);
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
                  onAddBlock={(type) => {
                    // Append a fresh block of the chosen type with
                    // sensible defaults. Same fork-from-template
                    // dance as onUpdateBlock — clone the named
                    // template's blocks first if the admin hasn't
                    // customized yet. After appending we leave
                    // drill-down to the new block so the admin can
                    // immediately tweak its settings.
                    setDraft(d => {
                      const base = d.templateConfig ?? cloneTemplateBlocks(d.templateId);
                      return { ...d, templateConfig: [...base, defaultBlockForType(type)] };
                    });
                  }}
                  onRemoveBlock={(idx) => {
                    setDraft(d => {
                      const base = d.templateConfig ?? cloneTemplateBlocks(d.templateId);
                      return { ...d, templateConfig: base.filter((_, i) => i !== idx) };
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
                <SettingsPanel
                  draft={draft}
                  setDraft={setDraft}
                  role={role}
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
                assets: filteredPreviewAssets,
                fieldDefs,
                filterState: previewFilterState,
                onFilterChange: setPreviewFilterState,
                sortKey: previewSortKey,
                onSortChange: setPreviewSortKey,
                searchQuery: previewSearchQuery,
                onSearchChange: setPreviewSearchQuery,
                onAssetClick: (id) => {
                  // Swallow the click if a drag just ended — otherwise
                  // releasing a drag would also open the asset.
                  if (dragJustEndedRef.current) return;
                  setPreviewAssetId(id);
                },
                // Hover-edit overlay: clicking "Edit <block>" in the
                // preview pops the Layout category open AND drills
                // straight into the block's per-block settings. The
                // category transition + drill change happen together
                // so the admin lands exactly where they want.
                onEditBlock: (idx) => {
                  setActiveCategory("layout");
                  setLayoutDrillIdx(idx);
                },
                // Asset-grid overlay's "Manage content" button. Opens
                // the Content category pre-drilled into the asset
                // list + picker view.
                onManageContent: () => {
                  setActiveCategory("content");
                  setContentView("manage-assets");
                },
                onAssetReorderBegin: beginAssetReorder,
                // Project our internal drag state to the renderer's
                // shape — it only needs the pointer DELTA + the
                // captured rects, not start positions.
                cardDrag: cardDrag ? {
                  fromIdx: cardDrag.fromIdx,
                  insertIdx: cardDrag.insertIdx,
                  pointerDx: cardDrag.pointerX - cardDrag.startX,
                  pointerDy: cardDrag.pointerY - cardDrag.startY,
                  rects: cardDrag.rects.map(r => ({ left: r.left, top: r.top })),
                  engaged: cardDrag.engaged,
                } : undefined,
                // Block-level drag-reorder in the preview surface.
                // Same idiom — the handler is bound to the block
                // index + selector for the preview wraps, and the
                // drag state gets projected to the slim shape the
                // renderer expects. `source: "preview"` lets the
                // renderer guard against applying preview transforms
                // when the drag started in the left-rail list.
                onBlockReorderBegin: (idx, e) => beginBlockDrag(idx, "preview", ".sr-edit-wrap[data-block-idx]")(e),
                blockDrag: blockDrag ? {
                  fromIdx: blockDrag.fromIdx,
                  insertIdx: blockDrag.insertIdx,
                  pointerDx: blockDrag.pointerX - blockDrag.startX,
                  pointerDy: blockDrag.pointerY - blockDrag.startY,
                  rects: blockDrag.rects.map(r => ({ left: r.left, top: r.top })),
                  engaged: blockDrag.engaged,
                  source: blockDrag.source,
                } : undefined,
              }}
            />
          </div>
        </main>
      </div>

      {/* In-builder preview modal — fires when admin clicks a
          card in the showcase preview. Renders the same
          AssetDetail (publicMode) the actual showcase page would
          render. Drag releases that happened to also be clicks
          are swallowed by dragJustEndedRef so reordering doesn't
          unexpectedly open this. */}
      {previewAssetId && (() => {
        const a = assetMap.get(previewAssetId);
        if (!a) return null;
        return (
          <div className="sb-asset-preview" onClick={() => setPreviewAssetId(null)}>
            <div className="sb-asset-preview-inner" onClick={e => e.stopPropagation()}>
              <button className="sb-asset-preview-close" onClick={() => setPreviewAssetId(null)} aria-label="Close preview">×</button>
              <BuilderAssetPreview asset={a}/>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

// ─── Builder asset preview ───────────────────────────────────────
// Lightweight preview of an asset rendered inside the builder
// when an admin clicks a card in the showcase preview. Shows the
// hero thumbnail (or video embed when a Vimeo/YouTube URL exists),
// headline, pull quote, and description — enough for the admin to
// confirm "yes, this is the asset I'm including" without leaving
// the builder. We don't reuse the full AssetDetail here because
// AssetDetail wires up share-tracking + the related-assets grid +
// chapter parsing, which add weight the preview doesn't need.
function BuilderAssetPreview({ asset }: { asset: ShowcaseAssetRef }) {
  const vid = (() => {
    const url = asset.videoUrl || "";
    if (!url) return null;
    const yt = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]+)/);
    if (yt) return { kind: "youtube" as const, id: yt[1] };
    const vm = url.match(/vimeo\.com\/(?:video\/)?(\d+)/);
    if (vm) return { kind: "vimeo" as const, id: vm[1] };
    return null;
  })();
  return (
    <div className="sb-asset-preview-body">
      <div className="sb-asset-preview-hero">
        {vid ? (
          <div className="sb-asset-preview-video">
            <iframe
              src={vid.kind === "youtube"
                ? `https://www.youtube.com/embed/${vid.id}`
                : `https://player.vimeo.com/video/${vid.id}`}
              frameBorder="0"
              allow="autoplay; fullscreen; picture-in-picture"
              allowFullScreen
            />
          </div>
        ) : asset.thumbnail ? (
          <img src={asset.thumbnail} alt={asset.company || asset.clientName || ""} className="sb-asset-preview-thumb"/>
        ) : (
          <div className="sb-asset-preview-thumb sb-asset-preview-thumb-empty"/>
        )}
      </div>
      <div className="sb-asset-preview-text">
        <div className="sb-asset-preview-eyebrow">{asset.company || asset.clientName}</div>
        <h2>{asset.headline || "Customer story"}</h2>
        {asset.pullQuote && <p className="sb-asset-preview-pq">&ldquo;{asset.pullQuote}&rdquo;</p>}
        {asset.description && <p className="sb-asset-preview-desc">{asset.description}</p>}
      </div>
    </div>
  );
}

// ─── Content panel ───────────────────────────────────────────────
function ContentPanel({ draft, setDraft, assets, view, onSetView }: {
  draft: ShowcaseDraft;
  setDraft: React.Dispatch<React.SetStateAction<ShowcaseDraft>>;
  assets: ShowcaseAssetRef[];
  // Two-level navigation. "default" shows just Title + Description
  // plus a "Manage content →" button. "manage-assets" drills into
  // the in-showcase list + available-asset picker. The split keeps
  // the panel feeling lightweight on first open.
  view: "default" | "manage-assets";
  onSetView: (next: "default" | "manage-assets") => void;
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

  // Default view: just Title + Description + a CTA into manage-assets.
  // Keeps the panel feeling lightweight on first open instead of
  // surfacing the long asset picker as the immediate UI.
  if (view === "default") {
    return (
      <div className="sb-content">
        <section className="sb-section">
          <label className="sb-field">
            <span>Title</span>
            <input
              type="text"
              value={draft.name === "Untitled showcase" ? "" : draft.name}
              onChange={e => setDraft(d => ({ ...d, name: e.target.value }))}
              placeholder="Name this showcase…"
              maxLength={200}
              autoFocus
            />
          </label>
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
        {/* Manage content CTA — drills into the asset list + picker.
            Same destination the preview-side "Manage content" overlay
            button uses. */}
        <button
          type="button"
          className="sb-manage-cta"
          onClick={() => onSetView("manage-assets")}
        >
          <span className="sb-manage-cta-icon">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="3" y="3" width="7" height="7" rx="1"/>
              <rect x="14" y="3" width="7" height="7" rx="1"/>
              <rect x="3" y="14" width="7" height="7" rx="1"/>
              <rect x="14" y="14" width="7" height="7" rx="1"/>
            </svg>
          </span>
          <div className="sb-manage-cta-body">
            <div className="sb-manage-cta-h">Manage content</div>
            <div className="sb-manage-cta-sub">
              {draft.assetIds.length === 0
                ? "Add the assets you want in this showcase."
                : `${draft.assetIds.length} asset${draft.assetIds.length === 1 ? "" : "s"} — add, remove, or reorder.`}
            </div>
          </div>
          <svg className="sb-manage-cta-chev" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="9 18 15 12 9 6"/>
          </svg>
        </button>
      </div>
    );
  }

  // manage-assets drill view: the original list + picker with a Back
  // affordance up top.
  return (
    <div className="sb-content">
      <button type="button" className="sb-drill-back" onClick={() => onSetView("default")}>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
          <line x1="19" y1="12" x2="5" y2="12"/>
          <polyline points="12 19 5 12 12 5"/>
        </svg>
        Back to content
      </button>

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

// Default props for newly-added blocks. Picking sensible defaults so
// the block renders something usable immediately — the admin can
// then drill in to fine-tune. Footer is intentionally excluded
// because B4.0 deprecated it; we don't want admins adding new ones.
function defaultBlockForType(type: TemplateBlock["type"]): TemplateBlock {
  switch (type) {
    case "hero":            return { type: "hero", props: { titleSource: "showcase.name", subtitleSource: "showcase.description", align: "center", padding: "comfortable" } };
    case "asset-grid":      return { type: "asset-grid", props: { columns: 3, aspect: "16/9", clickTarget: "modal" } };
    case "quote-rotator":   return { type: "quote-rotator", props: { source: "showcase-assets", intervalSec: 6, size: "full" } };
    case "intro-text":      return { type: "intro-text", props: { content: "Write an intro for this section.", align: "left" } };
    case "divider":         return { type: "divider", props: { spacing: "normal" } };
    case "footer":          return { type: "footer", props: { showBrand: false } };
    // Filter elements default to subtle defaults — the admin opts in
    // to categories from the settings panel. Showing Sort + Search
    // by default with empty category list still produces a useful
    // sort + search bar immediately.
    case "filters-inline":  return { type: "filters-inline", props: { showSort: true, showFilter: true, showSearch: true, filterCategoryKeys: [], sortOptions: ["recent", "az", "za"] } };
    case "filters-sticky":  return { type: "filters-sticky", props: { heading: "FILTER BY", filterCategoryKeys: [], side: "left" } };
  }
}

// Blocks the "Add block" picker exposes. Footer omitted (deprecated
// in B4.0). Order matches what an admin probably reaches for most.
const ADDABLE_BLOCK_TYPES: { type: TemplateBlock["type"]; label: string; help: string }[] = [
  { type: "filters-inline", label: "Filters bar",     help: "Subtle Sort + Filter + Search trio that sits above your grid." },
  { type: "filters-sticky", label: "Sticky filters",  help: "Vertical filter sidebar that follows the viewer as they scroll." },
  { type: "quote-rotator",  label: "Quote rotator",   help: "Rotates each asset's pull quote with auto-advance." },
  { type: "intro-text",     label: "Intro text",      help: "A short paragraph above or between sections." },
  { type: "asset-grid",     label: "Asset grid",      help: "A grid of testimonial cards. (Adds a second grid.)" },
  { type: "hero",           label: "Hero",            help: "A headline + subtitle band. (Adds a second hero.)" },
  { type: "divider",        label: "Divider",         help: "A horizontal rule between sections." },
];

// Magic-rearrange shift function. Given the static index of a row,
// the index of the dragged row, and where it's being inserted,
// returns the visual index that row should appear at — every row
// between source and destination slides one slot to make room.
// Same math both the renderer and the layout panel block list use.
function shiftFor(idx: number, fromIdx: number, insertIdx: number): number {
  if (idx === fromIdx) return insertIdx;
  if (fromIdx < insertIdx) {
    if (idx > fromIdx && idx <= insertIdx) return idx - 1;
  } else {
    if (idx >= insertIdx && idx < fromIdx) return idx + 1;
  }
  return idx;
}

// ─── Layout panel ────────────────────────────────────────────────
// Two-level navigation. Top level shows the template picker + a
// block list (one row per block in the effective template). Click
// a block row to drill into its per-block settings; back arrow
// returns. Mirrors the Vimeo Showcases / Elfsight pattern.
function LayoutPanel({ templateId, effectiveBlocks, drillIdx, onSetDrillIdx, fieldDefs, blockDrag, onBlockDragBegin, onSelectTemplate, onUpdateBlock, onAddBlock, onRemoveBlock }: {
  templateId: string | null;
  effectiveBlocks: TemplateBlock[];
  // Drill-in index is now controlled from above so the preview-side
  // hover-edit overlay can open the panel pre-focused on a block.
  drillIdx: number | null;
  onSetDrillIdx: (idx: number | null) => void;
  // Org field defs — needed by the filter-element settings sub-
  // components to render the category picker (which fields the
  // public viewer can filter on).
  fieldDefs: ShowcaseFieldDef[];
  // Shared block-drag state from the parent. Drives magic-shift
  // transforms on non-dragged rows + pointer-follow on the dragged
  // row. Null when no drag is in flight.
  blockDrag: {
    fromIdx: number;
    insertIdx: number;
    startX: number;
    startY: number;
    pointerX: number;
    pointerY: number;
    rects: { left: number; top: number; cx: number; cy: number }[];
    engaged: boolean;
    source: "list" | "preview";
  } | null;
  onBlockDragBegin: (idx: number, e: React.PointerEvent) => void;
  onSelectTemplate: (id: string) => void;
  onUpdateBlock: (idx: number, props: Record<string, unknown>) => void;
  onAddBlock: (type: TemplateBlock["type"]) => void;
  onRemoveBlock: (idx: number) => void;
}) {
  // Convenience aliases so we don't have to thread the controlled
  // props through every call site below.
  const setDrillIdx = onSetDrillIdx;
  // (Template-change reset is handled in the parent's onSelectTemplate
  // callback now. An effect tied to [templateId] also fires on initial
  // mount, which races the preview-side hover-edit overlay that just
  // set a specific drill index — caused the "click Edit, see top-level
  // Layout, click again to drill" double-click bug.)

  // Tiny visual previews on the template picker. B4.0 dropped the
  // "Shared via StoryMatch" footer block from built-in templates,
  // so the visuals follow suit.
  const visualFor = (id: string) => {
    if (id === "default")     return ["hero", "grid-3"];
    if (id === "with-quotes") return ["hero", "rotator", "grid-3"];
    if (id === "minimal")     return ["hero-l", "grid-2"];
    return ["hero", "grid-3"];
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
          fieldDefs={fieldDefs}
        />
      </div>
    );
  }

  // Top-level view: template picker + element list
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
          <h3>Elements</h3>
          <span className="sb-section-count">{effectiveBlocks.length}</span>
        </header>
        <p className="sb-section-help">Each element has its own settings — click one to dive in. Drag the handle to reorder.</p>
        <div className="sb-block-list">
          {effectiveBlocks.map((b, i) => {
            // Magic-shift transform: same pattern as the library
            // card drag. Dragged row follows the pointer; others
            // translate from their old slot to their new slot.
            const drag = blockDrag && blockDrag.source === "list" ? blockDrag : null;
            let style: React.CSSProperties | undefined;
            if (drag && drag.engaged) {
              if (i === drag.fromIdx) {
                style = {
                  transform: `translate(${drag.pointerX - drag.startX}px, ${drag.pointerY - drag.startY}px)`,
                  transition: "none",
                  zIndex: 10,
                  position: "relative",
                  pointerEvents: "none",
                };
              } else {
                const newIdx = shiftFor(i, drag.fromIdx, drag.insertIdx);
                if (newIdx !== i) {
                  const oldR = drag.rects[i];
                  const newR = drag.rects[newIdx];
                  if (oldR && newR) {
                    style = {
                      transform: `translate(${newR.left - oldR.left}px, ${newR.top - oldR.top}px)`,
                      transition: "transform 0.18s cubic-bezier(0.4, 0, 0.2, 1)",
                    };
                  }
                } else {
                  style = { transition: "transform 0.18s cubic-bezier(0.4, 0, 0.2, 1)" };
                }
              }
            }
            return (
              <button
                key={i}
                type="button"
                className="sb-block-row"
                data-block-idx={i}
                style={style}
                onClick={() => { if (!drag?.engaged) setDrillIdx(i); }}
              >
                {/* Drag handle — pointerdown here kicks off the
                    block drag. Sits to the left of the icon so the
                    rest of the row stays clickable for drill-in. */}
                <span
                  className="sb-block-handle"
                  title="Drag to reorder"
                  onPointerDown={(e) => { e.stopPropagation(); onBlockDragBegin(i, e); }}
                >
                  <svg width="10" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                    <circle cx="9" cy="5" r="1.6"/><circle cx="15" cy="5" r="1.6"/>
                    <circle cx="9" cy="12" r="1.6"/><circle cx="15" cy="12" r="1.6"/>
                    <circle cx="9" cy="19" r="1.6"/><circle cx="15" cy="19" r="1.6"/>
                  </svg>
                </span>
                <span className="sb-block-icon">{blockIcon(b.type)}</span>
                <div className="sb-block-body">
                  <div className="sb-block-h">{blockLabel(b.type)}</div>
                  <div className="sb-block-sub">{blockSummary(b)}</div>
                </div>
                <span
                  role="button"
                  tabIndex={0}
                  className="sb-block-remove"
                  title="Remove this block"
                  aria-label="Remove block"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (typeof window !== "undefined" && !window.confirm(`Remove the ${blockLabel(b.type).toLowerCase()} block?`)) return;
                    onRemoveBlock(i);
                  }}
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <polyline points="3 6 5 6 21 6"/>
                    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
                  </svg>
                </span>
                <svg className="sb-block-chev" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="9 18 15 12 9 6"/>
                </svg>
              </button>
            );
          })}
        </div>

        {/* Add-block picker. Renders all block types admins can drop
            into the current layout. New blocks land at the bottom;
            drilling into them via the block list lets the admin
            fine-tune props right away. */}
        <AddBlockPicker onAdd={onAddBlock}/>
      </section>
    </div>
  );
}

// Inline picker that turns the "Add block" button into a small
// dropdown listing every block type the admin can append. Closes
// on outside click + Esc.
function AddBlockPicker({ onAdd }: { onAdd: (type: TemplateBlock["type"]) => void }) {
  const [open, setOpen] = useState(false);
  const wrapRef = React.useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("mousedown", onDoc);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDoc);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return (
    <div className="sb-addblock-wrap" ref={wrapRef}>
      <button
        type="button"
        className="sb-addblock-btn"
        onClick={() => setOpen(o => !o)}
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <line x1="12" y1="5" x2="12" y2="19"/>
          <line x1="5" y1="12" x2="19" y2="12"/>
        </svg>
        Add element
      </button>
      {open && (
        <div className="sb-addblock-pop" role="menu">
          {ADDABLE_BLOCK_TYPES.map(opt => (
            <button
              key={opt.type}
              type="button"
              className="sb-addblock-item"
              onClick={() => { onAdd(opt.type); setOpen(false); }}
            >
              <span className="sb-addblock-icon">{blockIcon(opt.type)}</span>
              <div className="sb-addblock-body">
                <div className="sb-addblock-h">{opt.label}</div>
                <div className="sb-addblock-sub">{opt.help}</div>
              </div>
            </button>
          ))}
        </div>
      )}
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
    case "filters-inline": return "Filters bar";
    case "filters-sticky": return "Sticky filters";
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
    case "filters-inline": {
      const parts: string[] = [];
      if (b.props.showSort !== false) parts.push("Sort");
      if (b.props.showFilter !== false) parts.push("Filter");
      if (b.props.showSearch !== false) parts.push("Search");
      const cats = b.props.filterCategoryKeys?.length || 0;
      return `${parts.join(" · ") || "Disabled"}${cats ? ` · ${cats} categor${cats === 1 ? "y" : "ies"}` : ""}`;
    }
    case "filters-sticky": {
      const cats = b.props.filterCategoryKeys?.length || 0;
      return `${b.props.side === "right" ? "Right" : "Left"} sidebar · ${cats} categor${cats === 1 ? "y" : "ies"}`;
    }
  }
}
function blockIcon(type: TemplateBlock["type"]) {
  const common = { width: 14, height: 14, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2 as const, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  switch (type) {
    case "hero":            return <svg {...common}><rect x="3" y="5" width="18" height="9" rx="1"/><line x1="3" y1="19" x2="14" y2="19"/></svg>;
    case "asset-grid":      return <svg {...common}><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>;
    case "quote-rotator":   return <svg {...common}><path d="M3 21c0-7 6-13 13-13"/><path d="M14 8a5 5 0 0 1 5 5"/></svg>;
    case "intro-text":      return <svg {...common}><line x1="4" y1="7" x2="20" y2="7"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="17" x2="14" y2="17"/></svg>;
    case "divider":         return <svg {...common}><line x1="3" y1="12" x2="21" y2="12"/></svg>;
    case "footer":          return <svg {...common}><rect x="3" y="5" width="18" height="9" rx="1"/><line x1="3" y1="19" x2="21" y2="19"/></svg>;
    case "filters-inline":  return <svg {...common}><polyline points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>;
    case "filters-sticky":  return <svg {...common}><rect x="3" y="4" width="6" height="16" rx="1"/><line x1="13" y1="8" x2="20" y2="8"/><line x1="13" y1="14" x2="20" y2="14"/><line x1="13" y1="20" x2="20" y2="20"/></svg>;
  }
}

// ─── Per-block settings ──────────────────────────────────────────
// Discriminated dispatch — one render path per block type. Each
// returns a set of typed form controls bound to that block's
// props. Changes flow up via the onChange callback which the
// parent merges into templateConfig[idx].props.
function BlockSettings({ block, onChange, fieldDefs }: {
  block: TemplateBlock;
  onChange: (newProps: Record<string, unknown>) => void;
  fieldDefs: ShowcaseFieldDef[];
}) {
  switch (block.type) {
    case "hero":            return <HeroSettings            props={block.props} onChange={onChange}/>;
    case "asset-grid":      return <AssetGridSettings       props={block.props} onChange={onChange}/>;
    case "quote-rotator":   return <QuoteRotatorSettings    props={block.props} onChange={onChange}/>;
    case "intro-text":      return <IntroTextSettings       props={block.props} onChange={onChange}/>;
    case "divider":         return <DividerSettings         props={block.props} onChange={onChange}/>;
    case "footer":          return <FooterSettings          props={block.props} onChange={onChange}/>;
    case "filters-inline":  return <FiltersInlineSettings   props={block.props} onChange={onChange} fieldDefs={fieldDefs}/>;
    case "filters-sticky":  return <FiltersStickySettings   props={block.props} onChange={onChange} fieldDefs={fieldDefs}/>;
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
      <FieldLabel label="When viewer clicks a card">
        <Select
          value={props.clickTarget || "modal"}
          options={[
            { value: "modal", label: "Open in this page (modal-style)" },
            { value: "newpage", label: "Open in new tab" },
          ]}
          onChange={(v) => onChange({ clickTarget: v })}
        />
      </FieldLabel>
      {/* Both context-line toggles default OFF. Title-only is the
          cleanest baseline; admins opt in when they want richer
          cards. Company + description render BELOW the title (no
          eyebrow above) when on. */}
      <Toggle
        label="Show company name"
        checked={props.showCompany === true}
        onChange={(v) => onChange({ showCompany: v })}
      />
      <Toggle
        label="Show description"
        checked={props.showDescription === true}
        onChange={(v) => onChange({ showDescription: v })}
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

// ─── Filter settings (shared category picker) ────────────────────
// Both filter elements share a "which categories show?" picker —
// keep it as a single sub-component so the two settings panels stay
// thin. Field defs come in as the pool of choices; admin opts in
// per-field with a checkbox row.
function FilterCategoryPicker({ value, onChange, fieldDefs }: {
  value: string[];
  onChange: (next: string[]) => void;
  fieldDefs: ShowcaseFieldDef[];
}) {
  // Built-in keys not stored in field defs — admins can always
  // opt these in regardless of what's defined in the schema.
  const builtIns: { key: string; label: string }[] = [
    { key: "assetType", label: "Type (Video / Story)" },
  ];
  // Filter field defs to only categorical-ish types — text fields
  // make for noisy filters (one option per asset), so we cap to
  // select / multi_select. Numbers + dates are out for v1.
  const eligible = fieldDefs.filter(d => d.type === "select" || d.type === "multi_select" || d.key === "vertical" || d.key === "company" || d.key === "geography" || d.key === "clientRole");
  const selected = new Set(value);
  const toggle = (k: string) => {
    if (selected.has(k)) onChange(value.filter(v => v !== k));
    else onChange([...value, k]);
  };
  return (
    <FieldLabel label="Filter categories">
      <div className="sb-bs-cats">
        {builtIns.map(b => (
          <label key={b.key} className="sb-bs-cat-row">
            <input type="checkbox" checked={selected.has(b.key)} onChange={() => toggle(b.key)}/>
            <span>{b.label}</span>
          </label>
        ))}
        {eligible.length === 0 ? (
          <div className="sb-bs-cat-empty">No fields defined yet. Add fields in Manage fields to expose them as filters.</div>
        ) : (
          eligible.map(d => (
            <label key={d.key} className="sb-bs-cat-row">
              <input type="checkbox" checked={selected.has(d.key)} onChange={() => toggle(d.key)}/>
              <span>{d.label}</span>
            </label>
          ))
        )}
      </div>
    </FieldLabel>
  );
}

function FiltersInlineSettings({ props, onChange, fieldDefs }: {
  props: FiltersInlineBlockProps;
  onChange: (p: Record<string, unknown>) => void;
  fieldDefs: ShowcaseFieldDef[];
}) {
  return (
    <div className="sb-bs">
      <p className="sb-bs-hint">Three independent affordances — show any combination. Search expands inline when clicked.</p>
      <Toggle
        label="Show Sort button"
        checked={props.showSort !== false}
        onChange={(v) => onChange({ showSort: v })}
      />
      <Toggle
        label="Show Filters button"
        checked={props.showFilter !== false}
        onChange={(v) => onChange({ showFilter: v })}
      />
      <Toggle
        label="Show Search icon"
        checked={props.showSearch !== false}
        onChange={(v) => onChange({ showSearch: v })}
      />
      <FilterCategoryPicker
        value={props.filterCategoryKeys || []}
        onChange={(next) => onChange({ filterCategoryKeys: next })}
        fieldDefs={fieldDefs}
      />
    </div>
  );
}

function FiltersStickySettings({ props, onChange, fieldDefs }: {
  props: FiltersStickyBlockProps;
  onChange: (p: Record<string, unknown>) => void;
  fieldDefs: ShowcaseFieldDef[];
}) {
  return (
    <div className="sb-bs">
      <p className="sb-bs-hint">Vertical accordion sidebar — pins to one side of the viewport as viewers scroll.</p>
      <FieldLabel label="Heading">
        <input
          type="text"
          className="sb-bs-text"
          value={props.heading ?? "FILTER BY"}
          onChange={(e) => onChange({ heading: e.target.value })}
          placeholder="FILTER BY"
        />
      </FieldLabel>
      <FieldLabel label="Anchor">
        <RadioGroup
          value={props.side || "left"}
          options={[{ value: "left", label: "Left" }, { value: "right", label: "Right" }]}
          onChange={(v) => onChange({ side: v })}
        />
      </FieldLabel>
      <FilterCategoryPicker
        value={props.filterCategoryKeys || []}
        onChange={(next) => onChange({ filterCategoryKeys: next })}
        fieldDefs={fieldDefs}
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

// ─── Settings panel ──────────────────────────────────────────────
// Showcase-level (not per-block) settings. Layouts the controls in
// the same FieldLabel + primitive pattern the BlockSettings use so
// the panel feels consistent with the rest of the builder.
//
//   Visibility    — admin-only toggle. Sales reps can't promote
//                   to "team"; the API enforces it but we hide
//                   the toggle to avoid surfacing a no-op control.
//   Autoplay next — controls whether the public showcase auto-
//                   advances to the next asset after the current
//                   one ends. Pure UX toggle, no admin override.
//   Pagination    — 0 = show everything in one grid (current
//                   default). Positive N pages the asset grid.
function SettingsPanel({ draft, setDraft, role }: {
  draft: ShowcaseDraft;
  setDraft: React.Dispatch<React.SetStateAction<ShowcaseDraft>>;
  role: "admin" | "sales";
}) {
  return (
    <div className="sb-bs">
      {role === "admin" && (
        <FieldLabel label="Visibility">
          <Select
            value={draft.visibility}
            options={[
              { value: "personal", label: "Personal — only I see it" },
              { value: "team", label: "Whole team — everyone in the workspace" },
            ]}
            onChange={(v) => setDraft(d => ({ ...d, visibility: v === "team" ? "team" : "personal" }))}
          />
          <p className="sb-bs-hint">
            Personal showcases stay in your “My showcases” tab. Promote to
            the whole team and it shows up in everyone’s “Whole team” tab.
          </p>
        </FieldLabel>
      )}
      <Toggle
        label="Autoplay next asset"
        checked={draft.autoplayNext}
        onChange={(v) => setDraft(d => ({ ...d, autoplayNext: v }))}
      />
      <p className="sb-bs-hint">
        When a viewer finishes one asset, the next one in the showcase
        starts automatically. Best for storytelling-style showcases.
      </p>
      <FieldLabel label="Pagination">
        <Select
          value={String(draft.paginationSize || 0)}
          options={[
            { value: "0", label: "Show all in one grid" },
            { value: "6", label: "6 per page" },
            { value: "9", label: "9 per page" },
            { value: "12", label: "12 per page" },
            { value: "24", label: "24 per page" },
          ]}
          onChange={(v) => setDraft(d => ({ ...d, paginationSize: parseInt(v, 10) || 0 }))}
        />
        <p className="sb-bs-hint">
          Long showcases scroll forever. Pagination breaks the grid
          into pages with prev/next controls below the cards.
        </p>
      </FieldLabel>
    </div>
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
/* Top-bar breadcrumb title — read-only display. Clicking opens the
   Content panel where editing happens via a proper labeled input. */
.sb-trail-title{flex:1;min-width:0;background:none;border:none;padding:6px 8px;border-radius:6px;font-family:var(--serif);font-size:18px;font-weight:600;letter-spacing:-.3px;color:var(--t1);cursor:pointer;text-align:left;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;transition:background .12s;}
.sb-trail-title:hover{background:var(--bg2);}

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
.sb-panel-body{flex:1;overflow-y:auto;padding:14px 18px 24px;position:relative;}

.sb-content{display:flex;flex-direction:column;gap:18px;}
.sb-section{display:flex;flex-direction:column;gap:8px;}
.sb-section-head{display:flex;align-items:center;justify-content:space-between;}
.sb-section-head h3{font-size:12px;font-weight:700;color:var(--t2);text-transform:uppercase;letter-spacing:.5px;margin:0;}
.sb-section-count{font-size:11px;font-weight:700;color:var(--t3);background:var(--bg2);padding:2px 8px;border-radius:99px;}
.sb-section-help{font-size:12px;color:var(--t3);line-height:1.5;margin:0 0 4px;}

.sb-field{display:flex;flex-direction:column;gap:5px;}
.sb-field>span{font-size:11px;font-weight:700;color:var(--t3);text-transform:uppercase;letter-spacing:.5px;}
.sb-field>span em{font-style:normal;text-transform:none;letter-spacing:0;font-weight:500;color:var(--t4);margin-left:4px;}
.sb-field textarea,.sb-field input[type=text]{padding:8px 10px;border:1px solid var(--border);border-radius:7px;background:#fff;font-family:var(--font);font-size:13px;color:var(--t1);line-height:1.5;}
.sb-field textarea{resize:vertical;}
.sb-field textarea:focus,.sb-field input[type=text]:focus{outline:none;border-color:var(--accent);}

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

/* Manage content CTA — a quiet utility action surfaced inside the
   Content panel. White card with a subtle border that tints on
   hover. */
.sb-manage-cta{display:flex;align-items:center;gap:12px;width:100%;padding:12px 14px;border:1px solid var(--border);border-radius:10px;background:#fff;color:var(--t1);font-family:var(--font);text-align:left;cursor:pointer;transition:border-color .12s,background .12s;}
.sb-manage-cta:hover{border-color:var(--accent);background:color-mix(in srgb, var(--accent) 4%, transparent);}
.sb-manage-cta-icon{display:grid;place-items:center;width:30px;height:30px;border-radius:7px;background:var(--bg2);color:var(--t2);flex-shrink:0;}
.sb-manage-cta:hover .sb-manage-cta-icon{background:var(--accent);color:#fff;}
.sb-manage-cta-body{flex:1;min-width:0;}
.sb-manage-cta-h{font-size:13.5px;font-weight:600;color:var(--t1);}
.sb-manage-cta-sub{font-size:11.5px;color:var(--t3);margin-top:2px;line-height:1.45;}
.sb-manage-cta-chev{color:var(--t4);flex-shrink:0;}
.sb-manage-cta:hover .sb-manage-cta-chev{color:var(--accent);}

/* Element list — top-level Layout view shows one row per element in
   the effective template. Click to drill into per-element settings. */
.sb-block-list{display:flex;flex-direction:column;gap:4px;position:relative;}
.sb-block-row{display:flex;align-items:center;gap:10px;padding:9px 12px;border:1px solid var(--border);border-radius:8px;background:#fff;color:var(--t1);font-family:var(--font);text-align:left;cursor:pointer;transition:border-color .12s, background .12s;}
.sb-block-handle{display:grid;place-items:center;width:18px;height:24px;color:var(--t4);cursor:grab;flex-shrink:0;touch-action:none;}
.sb-block-handle:hover{color:var(--t2);}
.sb-block-handle:active{cursor:grabbing;}
.sb-block-row:hover{background:var(--bg);border-color:var(--border2);}
.sb-block-icon{display:grid;place-items:center;width:28px;height:28px;border-radius:6px;background:var(--bg2);color:var(--t2);flex-shrink:0;}
.sb-block-body{flex:1;min-width:0;}
.sb-block-h{font-size:13px;font-weight:600;color:var(--t1);line-height:1.3;}
.sb-block-sub{font-size:11px;color:var(--t3);margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.sb-block-chev{color:var(--t4);flex-shrink:0;}
.sb-block-row:hover .sb-block-chev{color:var(--t2);}
/* Per-row remove handle — opacity-0 unless the row is hovered, then
   a small trash icon appears. Click cycle: confirm → onRemoveBlock. */
.sb-block-remove{display:grid;place-items:center;width:24px;height:24px;border-radius:5px;color:var(--t4);cursor:pointer;flex-shrink:0;opacity:0;transition:opacity .12s,background .12s,color .12s;}
.sb-block-row:hover .sb-block-remove{opacity:1;}
.sb-block-remove:hover{background:#fef2f2;color:#b91c1c;}

/* Add block picker — small popdown right under the block list. */
.sb-addblock-wrap{position:relative;margin-top:6px;}
.sb-addblock-btn{width:100%;display:inline-flex;align-items:center;justify-content:center;gap:6px;padding:9px 12px;border:1.5px dashed var(--border2);background:var(--bg);color:var(--t2);font-family:var(--font);font-size:12.5px;font-weight:600;border-radius:8px;cursor:pointer;transition:all .12s;}
.sb-addblock-btn:hover{border-color:var(--accent);color:var(--accent);background:color-mix(in srgb, var(--accent) 5%, transparent);}
.sb-addblock-pop{position:absolute;top:calc(100% + 4px);left:0;right:0;background:#fff;border:1px solid var(--border);border-radius:9px;box-shadow:0 14px 36px rgba(0,0,0,.14), 0 4px 10px rgba(0,0,0,.05);padding:4px;z-index:30;animation:sbabFade .14s ease;}
@keyframes sbabFade{from{opacity:0;transform:translateY(-3px);}to{opacity:1;transform:translateY(0);}}
.sb-addblock-item{display:flex;align-items:center;gap:10px;width:100%;padding:9px 11px;background:none;border:none;cursor:pointer;font-family:var(--font);color:var(--t1);text-align:left;border-radius:6px;transition:background .12s;}
.sb-addblock-item:hover{background:var(--bg2);}
.sb-addblock-icon{display:grid;place-items:center;width:26px;height:26px;background:var(--bg);border-radius:6px;color:var(--t2);flex-shrink:0;}
.sb-addblock-body{flex:1;min-width:0;}
.sb-addblock-h{font-size:12.5px;font-weight:600;color:var(--t1);}
.sb-addblock-sub{font-size:11px;color:var(--t3);line-height:1.4;margin-top:1px;}

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
.sb-bs-hint{font-size:11.5px;color:var(--t3);line-height:1.5;margin:-2px 0 0;}
/* Filter category picker — list of checkboxes for the admin to
   opt in to per-category filter exposure. */
.sb-bs-text{width:100%;padding:8px 10px;border:1px solid var(--border);border-radius:7px;background:#fff;font-family:var(--font);font-size:13px;color:var(--t1);}
.sb-bs-text:focus{outline:none;border-color:var(--accent);}
.sb-bs-cats{display:flex;flex-direction:column;gap:2px;padding:8px 10px;border:1px solid var(--border);border-radius:7px;background:var(--bg);max-height:260px;overflow-y:auto;}
.sb-bs-cat-row{display:flex;align-items:center;gap:8px;padding:6px 4px;font-size:12.5px;color:var(--t1);cursor:pointer;border-radius:4px;}
.sb-bs-cat-row:hover{background:#fff;}
.sb-bs-cat-row input{accent-color:var(--accent);}
.sb-bs-cat-empty{font-size:11.5px;color:var(--t3);font-style:italic;padding:6px 4px;line-height:1.5;}
.sb-coming-soon{padding:36px 24px;text-align:center;color:var(--t3);font-size:12.5px;line-height:1.55;background:var(--bg);border:1px dashed var(--border2);border-radius:10px;}
.sb-coming-soon-h{font-family:var(--serif);font-size:15px;font-weight:600;color:var(--t1);margin-bottom:6px;}
.sb-coming-soon p{margin:0;}

/* Preview */
.sb-preview{flex:1;overflow-y:auto;background:var(--bg);padding:24px;min-width:0;}
.sb-preview-frame{max-width:1200px;margin:0 auto;background:#fff;border-radius:14px;border:1px solid var(--border);box-shadow:0 4px 24px rgba(0,0,0,.04);overflow:hidden;min-height:calc(100vh - 130px);}

/* In-builder asset preview modal. Slides up from the bottom of
   the viewport so the admin sees the full chrome. */
.sb-asset-preview{position:fixed;inset:0;background:rgba(20,20,30,.55);display:grid;place-items:center;z-index:200;animation:sbApIn .15s ease;padding:32px;}
@keyframes sbApIn{from{opacity:0;}to{opacity:1;}}
.sb-asset-preview-inner{position:relative;width:min(900px, 100%);max-height:calc(100vh - 64px);background:#fff;border-radius:14px;box-shadow:0 24px 60px rgba(0,0,0,.25);overflow:hidden;display:flex;flex-direction:column;}
.sb-asset-preview-close{position:absolute;top:12px;right:12px;width:34px;height:34px;border:none;background:rgba(255,255,255,.92);backdrop-filter:blur(6px);color:var(--t2);border-radius:50%;cursor:pointer;font-size:22px;line-height:1;display:grid;place-items:center;z-index:2;box-shadow:0 2px 8px rgba(0,0,0,.12);}
.sb-asset-preview-close:hover{background:#fff;color:var(--t1);}
.sb-asset-preview-body{display:flex;flex-direction:column;overflow-y:auto;}
.sb-asset-preview-hero{width:100%;background:var(--bg3);}
.sb-asset-preview-thumb{width:100%;aspect-ratio:16/9;object-fit:cover;display:block;}
.sb-asset-preview-thumb-empty{aspect-ratio:16/9;background:linear-gradient(135deg,var(--bg2),var(--bg3));}
.sb-asset-preview-video{position:relative;width:100%;aspect-ratio:16/9;background:#000;}
.sb-asset-preview-video iframe{position:absolute;inset:0;width:100%;height:100%;border:0;}
.sb-asset-preview-text{padding:28px 32px 36px;}
.sb-asset-preview-eyebrow{font-size:11px;font-weight:700;color:var(--accent);text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px;}
.sb-asset-preview-text h2{font-family:var(--serif);font-size:28px;font-weight:600;letter-spacing:-.6px;color:var(--t1);margin:0 0 14px;line-height:1.2;}
.sb-asset-preview-pq{font-family:var(--serif);font-style:italic;font-size:18px;color:var(--t1);line-height:1.5;margin:0 0 18px;padding-left:14px;border-left:3px solid var(--accent);}
.sb-asset-preview-desc{font-size:14.5px;color:var(--t2);line-height:1.6;margin:0;}
`;
