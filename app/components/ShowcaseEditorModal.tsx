"use client";

// ShowcaseEditorModal — full-screen modal for creating + editing a
// showcase. Two-pane layout:
//
//   Left  ("In this showcase")  — selected assets in render order
//                                 with reorder + remove controls.
//   Right ("Add assets")        — searchable list of every Public
//                                 asset in the org; click to add.
//
// Order is preserved via simple up/down arrows for v1. Drag-reorder
// is a polish pass — the existing ListView drag patterns can be
// adapted later. For now, the priority is "ship a working editor."
//
// Save persists via /api/showcases (POST for create, PUT for edit)
// through the onSave callback the parent passes in.

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import type { ShowcaseAssetRef } from "./ShowcasesView";

export interface ShowcaseDraft {
  id?: string;
  name: string;
  description: string | null;
  assetIds: string[];
}

interface SavedShowcase {
  id: string;
  orgId: string;
  ownerUserId: string;
  name: string;
  description: string | null;
  assetIds: string[];
  createdAt: string;
  updatedAt: string;
}

interface Props {
  // null = create new. Otherwise the existing showcase to edit.
  initial: ShowcaseDraft | null;
  // All assets in the org that the admin could include. Only
  // status=published are presentable on the public page, but we
  // show the full set here so admins can see what they're working
  // with (and we'll surface a "won't show publicly" warning for
  // non-Public ones).
  assets: ShowcaseAssetRef[];
  onSave: (draft: ShowcaseDraft) => Promise<{ ok: true; showcase: SavedShowcase } | { ok: false; error: string }>;
  onClose: () => void;
  onToast: (msg: string) => void;
  onCopyLink: (id: string) => void;
}

export default function ShowcaseEditorModal({ initial, assets, onSave, onClose, onToast, onCopyLink }: Props) {
  const [name, setName] = useState(initial?.name || "");
  const [description, setDescription] = useState(initial?.description || "");
  // Ordered list of asset IDs currently in the showcase. Drives
  // both the left pane render and what gets sent to the API.
  const [assetIds, setAssetIds] = useState<string[]>(initial?.assetIds || []);
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState(false);
  // savedId is set after the initial create — flips the modal from
  // "Create" to "Edit" mode so the admin can keep tweaking without
  // re-opening, and surfaces the share link.
  const [savedId, setSavedId] = useState<string | null>(initial?.id || null);

  // Esc-to-close — bound while the modal is open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Map for O(1) asset lookups by id when rendering the selected
  // pane. The IDs are the source of truth; we resolve to full
  // ShowcaseAssetRef rows at render time.
  const assetMap = useMemo(() => {
    const m = new Map<string, ShowcaseAssetRef>();
    for (const a of assets) m.set(a.id, a);
    return m;
  }, [assets]);

  const selectedAssets = useMemo(() => {
    const out: (ShowcaseAssetRef & { _missing: boolean })[] = [];
    for (const id of assetIds) {
      const a = assetMap.get(id);
      if (a) out.push({ ...a, _missing: false });
      else out.push({ id, headline: "(asset unavailable)", company: "", clientName: "", thumbnail: "", status: "", assetType: "", _missing: true });
    }
    return out;
  }, [assetIds, assetMap]);

  // Available list — everything NOT already in the showcase,
  // filtered by search. Only published assets are surfaced for
  // adding; an admin who wants to include a draft has to publish
  // it first (otherwise the public render would silently drop it).
  const availableAssets = useMemo(() => {
    const includedSet = new Set(assetIds);
    const q = search.trim().toLowerCase();
    return assets.filter(a => {
      if (includedSet.has(a.id)) return false;
      if (a.status !== "published") return false;
      if (!q) return true;
      return (
        a.headline.toLowerCase().includes(q) ||
        a.company.toLowerCase().includes(q) ||
        a.clientName.toLowerCase().includes(q)
      );
    });
  }, [assets, assetIds, search]);

  const addAsset = (id: string) => setAssetIds(prev => prev.includes(id) ? prev : [...prev, id]);
  const removeAsset = (id: string) => setAssetIds(prev => prev.filter(x => x !== id));
  const moveAsset = (id: string, dir: -1 | 1) => {
    setAssetIds(prev => {
      const idx = prev.indexOf(id);
      if (idx === -1) return prev;
      const target = idx + dir;
      if (target < 0 || target >= prev.length) return prev;
      const next = prev.slice();
      const [item] = next.splice(idx, 1);
      next.splice(target, 0, item);
      return next;
    });
  };

  const handleSave = async () => {
    if (!name.trim()) {
      onToast("Showcase name is required");
      return;
    }
    setSaving(true);
    const result = await onSave({
      id: savedId || undefined,
      name: name.trim(),
      description: description.trim() || null,
      assetIds,
    });
    setSaving(false);
    if (result.ok) {
      setSavedId(result.showcase.id);
      onToast(savedId ? "Showcase updated" : "Showcase created");
    } else {
      onToast(result.error);
    }
  };

  if (typeof document === "undefined") return null;

  return createPortal(
    <div className="sem-scrim" onClick={onClose}>
      <style>{css}</style>
      <div className="sem" role="dialog" aria-label="Showcase editor" onClick={e => e.stopPropagation()}>
        <header className="sem-head">
          <div className="sem-head-l">
            <h2>{savedId ? "Edit showcase" : "New showcase"}</h2>
            {savedId && (
              <button
                type="button"
                className="sem-copy-link"
                onClick={() => onCopyLink(savedId)}
                title="Copy the public URL for this showcase"
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
                  <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
                </svg>
                Copy link
              </button>
            )}
          </div>
          <button className="sem-close" onClick={onClose} aria-label="Close">×</button>
        </header>

        <div className="sem-meta">
          <label className="sem-field">
            <span>Name</span>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. Healthcare customer stories"
              autoFocus={!initial}
            />
          </label>
          <label className="sem-field">
            <span>Description <em className="sem-optional">(optional)</em></span>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="A short intro shown at the top of the public page."
              rows={2}
            />
          </label>
        </div>

        <div className="sem-panes">
          <section className="sem-pane">
            <header className="sem-pane-head">
              <h3>In this showcase</h3>
              <span className="sem-count">{assetIds.length}</span>
            </header>
            {selectedAssets.length === 0 ? (
              <div className="sem-pane-empty">
                <p>Pick assets from the right pane to add them to this showcase. Order matters — viewers see them in this order.</p>
              </div>
            ) : (
              <div className="sem-list">
                {selectedAssets.map((a, i) => (
                  <div key={a.id} className={`sem-row${a._missing ? " missing" : ""}`}>
                    <span className="sem-row-pos">{i + 1}</span>
                    {a.thumbnail
                      ? <img src={a.thumbnail} alt="" className="sem-row-thumb"/>
                      : <div className="sem-row-thumb sem-row-thumb-empty"/>}
                    <div className="sem-row-body">
                      <div className="sem-row-headline">{a.headline || (a._missing ? "Asset unavailable" : "Untitled")}</div>
                      <div className="sem-row-sub">
                        {a.company || a.clientName || (a._missing ? "This asset no longer exists or isn't Public" : "")}
                      </div>
                    </div>
                    <div className="sem-row-actions">
                      <button type="button" disabled={i === 0} onClick={() => moveAsset(a.id, -1)} title="Move up" aria-label="Move up">
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="18 15 12 9 6 15"/>
                        </svg>
                      </button>
                      <button type="button" disabled={i === selectedAssets.length - 1} onClick={() => moveAsset(a.id, 1)} title="Move down" aria-label="Move down">
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="6 9 12 15 18 9"/>
                        </svg>
                      </button>
                      <button type="button" onClick={() => removeAsset(a.id)} title="Remove from showcase" aria-label="Remove" className="sem-row-remove">
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                          <line x1="18" y1="6" x2="6" y2="18"/>
                          <line x1="6" y1="6" x2="18" y2="18"/>
                        </svg>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="sem-pane">
            <header className="sem-pane-head">
              <h3>Add assets</h3>
              <span className="sem-count">{availableAssets.length}</span>
            </header>
            <div className="sem-search-wrap">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="sem-search-icon">
                <circle cx="11" cy="11" r="8"/>
                <line x1="21" y1="21" x2="16.65" y2="16.65"/>
              </svg>
              <input
                type="text"
                className="sem-search"
                placeholder="Search by title, company, or client name"
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
            </div>
            {availableAssets.length === 0 ? (
              <div className="sem-pane-empty">
                <p>{search ? "Nothing matches that search." : "Every Public asset is already in this showcase."}</p>
              </div>
            ) : (
              <div className="sem-list">
                {availableAssets.map(a => (
                  <button key={a.id} type="button" className="sem-row sem-row-add" onClick={() => addAsset(a.id)}>
                    {a.thumbnail
                      ? <img src={a.thumbnail} alt="" className="sem-row-thumb"/>
                      : <div className="sem-row-thumb sem-row-thumb-empty"/>}
                    <div className="sem-row-body">
                      <div className="sem-row-headline">{a.headline || "Untitled"}</div>
                      <div className="sem-row-sub">{a.company || a.clientName || ""}</div>
                    </div>
                    <span className="sem-row-add-glyph">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="12" y1="5" x2="12" y2="19"/>
                        <line x1="5" y1="12" x2="19" y2="12"/>
                      </svg>
                    </span>
                  </button>
                ))}
              </div>
            )}
          </section>
        </div>

        <footer className="sem-foot">
          <button type="button" className="sem-cancel" onClick={onClose}>Cancel</button>
          <button type="button" className="sem-save" onClick={handleSave} disabled={saving || !name.trim()}>
            {saving ? "Saving…" : savedId ? "Save changes" : "Create showcase"}
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}

const css = `
.sem-scrim{position:fixed;inset:0;background:rgba(20,20,30,.5);display:grid;place-items:center;z-index:1200;animation:semFade .12s ease;}
@keyframes semFade{from{opacity:0;}to{opacity:1;}}
.sem{width:min(960px, calc(100vw - 32px));height:min(720px, calc(100vh - 32px));background:#fff;border-radius:14px;box-shadow:0 24px 60px rgba(0,0,0,.25);display:flex;flex-direction:column;font-family:var(--font);color:var(--t1);overflow:hidden;}

.sem-head{display:flex;align-items:center;gap:12px;padding:18px 24px 14px;border-bottom:1px solid var(--border);}
.sem-head-l{display:flex;align-items:center;gap:14px;flex:1;min-width:0;}
.sem-head h2{font-family:var(--serif);font-size:20px;font-weight:600;letter-spacing:-.3px;color:var(--t1);margin:0;}
.sem-copy-link{display:inline-flex;align-items:center;gap:5px;padding:5px 10px;border:1px solid var(--border);border-radius:6px;background:#fff;color:var(--accent);font-size:11.5px;font-weight:600;cursor:pointer;}
.sem-copy-link:hover{background:var(--accentLL);}
.sem-close{margin-left:auto;background:none;border:none;color:var(--t3);cursor:pointer;width:28px;height:28px;display:grid;place-items:center;font-size:22px;border-radius:5px;}
.sem-close:hover{background:var(--bg2);color:var(--t1);}

.sem-meta{padding:14px 24px;border-bottom:1px solid var(--border);display:grid;grid-template-columns:1fr 1.4fr;gap:16px;background:var(--bg);}
.sem-field{display:flex;flex-direction:column;gap:5px;}
.sem-field span{font-size:11px;font-weight:700;color:var(--t3);text-transform:uppercase;letter-spacing:.4px;}
.sem-field em.sem-optional{font-style:normal;text-transform:none;letter-spacing:0;color:var(--t4);font-weight:500;margin-left:4px;}
.sem-field input,.sem-field textarea{padding:7px 10px;border:1px solid var(--border);border-radius:7px;background:#fff;font-family:var(--font);font-size:13px;color:var(--t1);resize:vertical;line-height:1.45;}
.sem-field input:focus,.sem-field textarea:focus{outline:none;border-color:var(--accent);}

.sem-panes{flex:1;display:grid;grid-template-columns:1fr 1fr;gap:1px;background:var(--border);min-height:0;}
.sem-pane{background:#fff;display:flex;flex-direction:column;min-height:0;}
.sem-pane-head{display:flex;align-items:center;justify-content:space-between;padding:12px 18px 10px;}
.sem-pane-head h3{font-family:var(--serif);font-size:14px;font-weight:600;color:var(--t1);margin:0;}
.sem-count{font-size:11px;font-weight:700;color:var(--t3);background:var(--bg2);padding:2px 8px;border-radius:99px;}

.sem-search-wrap{position:relative;padding:0 18px 10px;}
.sem-search-icon{position:absolute;left:28px;top:50%;transform:translateY(calc(-50% - 5px));color:var(--t4);pointer-events:none;}
.sem-search{width:100%;padding:7px 10px 7px 28px;border:1px solid var(--border);border-radius:7px;background:var(--bg);color:var(--t1);font-family:var(--font);font-size:12.5px;}
.sem-search:focus{outline:none;border-color:var(--accent);background:#fff;}

.sem-pane-empty{padding:36px 24px;text-align:center;color:var(--t3);font-size:12.5px;line-height:1.55;}
.sem-pane-empty p{margin:0;}

.sem-list{flex:1;overflow-y:auto;padding:0 12px 12px;display:flex;flex-direction:column;gap:4px;}

.sem-row{display:flex;align-items:center;gap:10px;padding:7px 10px;border-radius:8px;background:#fff;border:1px solid transparent;font-family:var(--font);color:var(--t1);font-size:12.5px;text-align:left;width:100%;}
.sem-row:hover{background:var(--bg);border-color:var(--border);}
.sem-row.missing{background:#fff7e6;border-color:#fde68a;}
.sem-row-add{cursor:pointer;}
.sem-row-add:hover{background:var(--accentLL);border-color:var(--accent);}

.sem-row-pos{width:18px;text-align:center;font-size:11px;font-weight:700;color:var(--t4);font-variant-numeric:tabular-nums;flex-shrink:0;}
.sem-row-thumb{width:48px;height:28px;object-fit:cover;border-radius:4px;flex-shrink:0;}
.sem-row-thumb-empty{background:var(--bg2);}
.sem-row-body{flex:1;min-width:0;}
.sem-row-headline{font-size:12.5px;font-weight:600;color:var(--t1);line-height:1.3;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.sem-row.missing .sem-row-headline{color:#92400e;}
.sem-row-sub{font-size:11px;color:var(--t3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-top:1px;}

.sem-row-actions{display:flex;gap:1px;flex-shrink:0;}
.sem-row-actions button{width:22px;height:22px;display:grid;place-items:center;border:none;background:none;color:var(--t3);border-radius:4px;cursor:pointer;}
.sem-row-actions button:hover:not(:disabled){background:var(--bg2);color:var(--t1);}
.sem-row-actions button:disabled{opacity:.3;cursor:default;}
.sem-row-actions .sem-row-remove:hover{background:#fef2f2;color:#b91c1c;}

.sem-row-add-glyph{display:grid;place-items:center;width:22px;height:22px;border-radius:50%;background:var(--bg2);color:var(--t3);flex-shrink:0;}
.sem-row-add:hover .sem-row-add-glyph{background:var(--accent);color:#fff;}

.sem-foot{display:flex;justify-content:flex-end;gap:8px;padding:14px 24px;border-top:1px solid var(--border);background:var(--bg);}
.sem-cancel{padding:8px 16px;border:1px solid var(--border);border-radius:7px;background:#fff;color:var(--t2);font-family:var(--font);font-size:12.5px;font-weight:600;cursor:pointer;}
.sem-cancel:hover{background:var(--bg2);}
.sem-save{padding:8px 18px;border:none;border-radius:7px;background:var(--accent);color:#fff;font-family:var(--font);font-size:12.5px;font-weight:600;cursor:pointer;transition:filter .12s;}
.sem-save:hover:not(:disabled){filter:brightness(1.08);}
.sem-save:disabled{opacity:.5;cursor:not-allowed;}

@media (max-width: 768px) {
  .sem{height:100vh;border-radius:0;}
  .sem-meta{grid-template-columns:1fr;}
  .sem-panes{grid-template-columns:1fr;grid-template-rows:1fr 1fr;}
}
`;
