"use client";

// AddToShowcaseModal — fires from the bulk-select bar when an
// admin has multiple assets selected and chooses "Add to
// showcase…". Vimeo-style flow: pick an existing showcase to
// append to, or create a brand-new one in one click.
//
// "Create new" is a one-shot operation — we don't open the full
// editor, we just ship a new showcase straight to disk titled
// "Untitled showcase" containing the selection. Admin can rename
// + reorder later from the Showcases page. This keeps the bulk
// flow fast: 2 clicks total (open menu, pick destination).
//
// Append path merges + dedupes — assets already in the target
// showcase are not duplicated.

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

interface Showcase {
  id: string;
  name: string;
  description: string | null;
  assetIds: string[];
  updatedAt: string;
}

interface Props {
  // The asset IDs currently multi-selected in the library. These
  // become the contents of the new showcase, or the additions to
  // an existing one.
  selectedAssetIds: string[];
  authHeaders: () => Promise<HeadersInit>;
  onClose: () => void;
  onToast: (msg: string) => void;
}

export default function AddToShowcaseModal({ selectedAssetIds, authHeaders, onClose, onToast }: Props) {
  const [loading, setLoading] = useState(true);
  const [showcases, setShowcases] = useState<Showcase[]>([]);
  const [pending, setPending] = useState(false);
  const [search, setSearch] = useState("");

  // Load the org's existing showcases on mount so the user can
  // pick one to append to. Admin endpoint returns the full list.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const headers = await authHeaders();
        const r = await fetch("/api/showcases", { headers });
        if (!r.ok) throw new Error("Failed");
        const data = await r.json() as { showcases: Showcase[] };
        if (!cancelled) setShowcases(data.showcases || []);
      } catch (e) {
        console.error("[AddToShowcaseModal] load failed", e);
      }
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [authHeaders]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const filtered = (() => {
    const q = search.trim().toLowerCase();
    if (!q) return showcases;
    return showcases.filter(s =>
      s.name.toLowerCase().includes(q) ||
      (s.description || "").toLowerCase().includes(q),
    );
  })();

  const createNew = async () => {
    if (pending) return;
    setPending(true);
    try {
      const headers = await authHeaders();
      const r = await fetch("/api/showcases", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        // Empty name resolves to "Untitled showcase" server-side.
        body: JSON.stringify({ name: "", description: null, asset_ids: selectedAssetIds }),
      });
      if (!r.ok) throw new Error("Save failed");
      onToast(`Created showcase with ${selectedAssetIds.length} ${selectedAssetIds.length === 1 ? "asset" : "assets"}`);
      onClose();
    } catch (e) {
      console.error("[AddToShowcaseModal] createNew failed", e);
      onToast("Couldn't create showcase");
    } finally {
      setPending(false);
    }
  };

  const appendTo = async (target: Showcase) => {
    if (pending) return;
    setPending(true);
    try {
      const headers = await authHeaders();
      // Merge + dedupe — selected assets that are already in the
      // target showcase don't get duplicated, and the existing
      // order is preserved (new ones tacked onto the end).
      const existing = new Set(target.assetIds);
      const additions = selectedAssetIds.filter(id => !existing.has(id));
      if (additions.length === 0) {
        onToast(`All selected assets are already in "${target.name}"`);
        setPending(false);
        return;
      }
      const merged = [...target.assetIds, ...additions];
      const r = await fetch(`/api/showcases/${encodeURIComponent(target.id)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify({ asset_ids: merged }),
      });
      if (!r.ok) throw new Error("Save failed");
      const added = additions.length;
      const skipped = selectedAssetIds.length - added;
      onToast(
        skipped > 0
          ? `Added ${added} new ${added === 1 ? "asset" : "assets"} (${skipped} already in showcase)`
          : `Added ${added} ${added === 1 ? "asset" : "assets"} to "${target.name}"`,
      );
      onClose();
    } catch (e) {
      console.error("[AddToShowcaseModal] appendTo failed", e);
      onToast("Couldn't update showcase");
    } finally {
      setPending(false);
    }
  };

  if (typeof document === "undefined") return null;

  return createPortal(
    <div className="ats-scrim" onClick={onClose}>
      <style>{css}</style>
      <div className="ats" role="dialog" aria-label="Add to showcase" onClick={e => e.stopPropagation()}>
        <header className="ats-head">
          <div>
            <h2>Add to showcase</h2>
            <p className="ats-sub">{selectedAssetIds.length} {selectedAssetIds.length === 1 ? "asset" : "assets"} selected.</p>
          </div>
          <button className="ats-close" onClick={onClose} aria-label="Close">×</button>
        </header>

        {/* Create-new path — top-level "Create new showcase" row that
            ships a draft straight to disk with no extra prompts.
            Title defaults to "Untitled showcase" server-side; admin
            can rename + reorder from the Showcases page. */}
        <button
          type="button"
          className="ats-create"
          onClick={createNew}
          disabled={pending}
        >
          <span className="ats-create-glyph">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19"/>
              <line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
          </span>
          <div className="ats-create-body">
            <div className="ats-create-h">Create new showcase</div>
            <div className="ats-create-sub">Bundles the {selectedAssetIds.length} selected {selectedAssetIds.length === 1 ? "asset" : "assets"} into a new untitled showcase.</div>
          </div>
        </button>

        <div className="ats-divider">
          <span>or add to existing</span>
        </div>

        <div className="ats-search-wrap">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="ats-search-icon">
            <circle cx="11" cy="11" r="8"/>
            <line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          <input
            type="text"
            className="ats-search"
            placeholder="Search your showcases"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>

        <div className="ats-list">
          {loading ? (
            <div className="ats-empty">Loading…</div>
          ) : filtered.length === 0 ? (
            <div className="ats-empty">
              {search
                ? <p>No showcases match that search.</p>
                : <p>You haven&apos;t built any showcases yet. Use <strong>Create new</strong> above to make your first one.</p>}
            </div>
          ) : filtered.map(s => {
            const overlap = s.assetIds.filter(id => selectedAssetIds.includes(id)).length;
            const willAdd = selectedAssetIds.length - overlap;
            return (
              <button
                key={s.id}
                type="button"
                className="ats-row"
                onClick={() => appendTo(s)}
                disabled={pending || willAdd === 0}
                title={willAdd === 0 ? "All selected assets are already in this showcase" : `Add ${willAdd} ${willAdd === 1 ? "asset" : "assets"} to ${s.name}`}
              >
                <div className="ats-row-body">
                  <div className="ats-row-h">{s.name}</div>
                  <div className="ats-row-sub">
                    {s.assetIds.length} {s.assetIds.length === 1 ? "asset" : "assets"}
                    {overlap > 0 && <span className="ats-row-overlap"> · {overlap} already in</span>}
                  </div>
                </div>
                <span className="ats-row-add">
                  {willAdd === 0 ? "All in" : `+${willAdd}`}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>,
    document.body,
  );
}

const css = `
.ats-scrim{position:fixed;inset:0;background:rgba(20,20,30,.5);display:grid;place-items:center;z-index:1200;animation:atsFade .12s ease;}
@keyframes atsFade{from{opacity:0;}to{opacity:1;}}
.ats{width:min(520px, calc(100vw - 32px));max-height:min(640px, calc(100vh - 64px));background:#fff;border-radius:14px;box-shadow:0 24px 60px rgba(0,0,0,.25);display:flex;flex-direction:column;font-family:var(--font);color:var(--t1);overflow:hidden;}

.ats-head{display:flex;align-items:flex-start;gap:12px;padding:18px 20px 14px;border-bottom:1px solid var(--border);}
.ats-head h2{font-family:var(--serif);font-size:18px;font-weight:600;letter-spacing:-.3px;color:var(--t1);margin:0;}
.ats-sub{font-size:12px;color:var(--t3);margin:3px 0 0;}
.ats-close{margin-left:auto;background:none;border:none;color:var(--t3);cursor:pointer;width:28px;height:28px;display:grid;place-items:center;font-size:22px;border-radius:5px;flex-shrink:0;}
.ats-close:hover{background:var(--bg2);color:var(--t1);}

.ats-create{display:flex;align-items:center;gap:12px;margin:14px 16px 0;padding:12px 14px;border:1px solid var(--accent);border-radius:10px;background:var(--accentLL);color:var(--t1);font-family:var(--font);text-align:left;cursor:pointer;transition:background .12s;}
.ats-create:hover:not(:disabled){background:var(--accentL);}
.ats-create:disabled{opacity:.5;cursor:not-allowed;}
.ats-create-glyph{display:grid;place-items:center;width:32px;height:32px;border-radius:50%;background:var(--accent);color:#fff;flex-shrink:0;}
.ats-create-body{flex:1;min-width:0;}
.ats-create-h{font-size:13.5px;font-weight:600;color:var(--accent);}
.ats-create-sub{font-size:11.5px;color:var(--t2);margin-top:2px;line-height:1.4;}

.ats-divider{display:flex;align-items:center;gap:8px;margin:14px 20px 4px;}
.ats-divider span{font-size:10.5px;text-transform:uppercase;letter-spacing:.5px;color:var(--t4);font-weight:700;flex-shrink:0;}
.ats-divider::before,.ats-divider::after{content:"";flex:1;height:1px;background:var(--border);}

.ats-search-wrap{position:relative;padding:6px 16px 0;}
.ats-search-icon{position:absolute;left:26px;top:50%;transform:translateY(-50%);color:var(--t4);pointer-events:none;}
.ats-search{width:100%;padding:7px 10px 7px 28px;border:1px solid var(--border);border-radius:7px;background:var(--bg);color:var(--t1);font-family:var(--font);font-size:12.5px;}
.ats-search:focus{outline:none;border-color:var(--accent);background:#fff;}

.ats-list{flex:1;overflow-y:auto;padding:10px 12px 16px;display:flex;flex-direction:column;gap:4px;}
.ats-empty{padding:24px 16px;text-align:center;color:var(--t3);font-size:12.5px;line-height:1.5;}
.ats-empty p{margin:0;}

.ats-row{display:flex;align-items:center;gap:10px;padding:9px 12px;border-radius:8px;background:#fff;border:1px solid transparent;font-family:var(--font);color:var(--t1);text-align:left;cursor:pointer;}
.ats-row:hover:not(:disabled){background:var(--bg);border-color:var(--border);}
.ats-row:disabled{opacity:.5;cursor:not-allowed;}
.ats-row-body{flex:1;min-width:0;}
.ats-row-h{font-size:13px;font-weight:600;color:var(--t1);line-height:1.3;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.ats-row-sub{font-size:11px;color:var(--t3);margin-top:2px;}
.ats-row-overlap{color:var(--t4);}
.ats-row-add{font-size:11.5px;font-weight:700;color:var(--accent);background:var(--accentLL);padding:3px 9px;border-radius:99px;flex-shrink:0;font-variant-numeric:tabular-nums;}
.ats-row:disabled .ats-row-add{color:var(--t4);background:var(--bg2);}
`;
