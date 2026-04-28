"use client";

// Shows what just happened during a source refresh: imports, drift between
// StoryMatch and Vimeo, and orphaned (auto-archived) assets. Each drifted
// item lets the admin pull Vimeo's current values into StoryMatch; each
// archived item lets them restore it.

import { useEffect } from "react";
import { createPortal } from "react-dom";

export interface DriftedItem {
  assetId: string;
  headline: string;
  fields: ("title" | "description")[];
  storyMatch: { headline: string; description: string };
  vimeo: { title: string; description: string; thumbnail: string };
}

export interface ImportedItem {
  assetId: string;
  headline: string;
}

export interface ArchivedItem {
  assetId: string;
  headline: string;
}

interface Props {
  imported: ImportedItem[];
  drifted: DriftedItem[];
  archived: ArchivedItem[];
  inSyncCount: number;
  onPullFromVimeo: (item: DriftedItem) => void;
  onKeepStoryMatch: (assetId: string) => void;
  onRestoreFromArchive: (assetId: string) => void;
  onKeepArchived: (assetId: string) => void;
  onClose: () => void;
}

export default function SyncReportModal({
  imported,
  drifted,
  archived,
  inSyncCount,
  onPullFromVimeo,
  onKeepStoryMatch,
  onRestoreFromArchive,
  onKeepArchived,
  onClose,
}: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (typeof window === "undefined") return null;

  const totalChanges = imported.length + drifted.length + archived.length;
  const hasContent = totalChanges > 0 || inSyncCount > 0;

  return createPortal(
    <>
      <style>{css}</style>
      <div className="sr-backdrop" onClick={onClose}/>
      <div className="sr-modal" onClick={(e) => e.stopPropagation()}>
        <div className="sr-head">
          <div className="sr-title">Sync complete</div>
          <button className="sr-close" onClick={onClose} title="Close (Esc)">✕</button>
        </div>
        <div className="sr-body">
          {!hasContent && (
            <div className="sr-empty">No changes — nothing to sync.</div>
          )}

          {/* Summary line */}
          {hasContent && (
            <div className="sr-summary">
              {inSyncCount > 0 && <span className="sr-pill sr-ok">✓ {inSyncCount} in sync</span>}
              {imported.length > 0 && <span className="sr-pill sr-new">+ {imported.length} imported</span>}
              {drifted.length > 0 && <span className="sr-pill sr-warn">⚠ {drifted.length} drifted</span>}
              {archived.length > 0 && <span className="sr-pill sr-arch">✗ {archived.length} removed from Vimeo</span>}
            </div>
          )}

          {/* Imported */}
          {imported.length > 0 && (
            <section>
              <div className="sr-section-head">
                <span className="sr-section-icon sr-new-bg">+</span>
                Imported from Vimeo ({imported.length})
              </div>
              <div className="sr-section-body">
                {imported.map((i) => (
                  <div key={i.assetId} className="sr-row">
                    <div className="sr-row-title">{i.headline || "Untitled"}</div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Drifted */}
          {drifted.length > 0 && (
            <section>
              <div className="sr-section-head">
                <span className="sr-section-icon sr-warn-bg">⚠</span>
                StoryMatch values differ from Vimeo ({drifted.length})
              </div>
              <div className="sr-section-help">
                Pull from Vimeo to overwrite the StoryMatch values with what&apos;s currently in Vimeo. Keep StoryMatch to leave your edits in place.
              </div>
              <div className="sr-section-body">
                {drifted.map((d) => (
                  <div key={d.assetId} className="sr-row sr-drift">
                    <div>
                      <div className="sr-row-title">{d.headline || "Untitled"}</div>
                      <div className="sr-row-meta">
                        Differs in: {d.fields.map(f => <span key={f} className="sr-field-tag">{f}</span>)}
                      </div>
                      {d.fields.includes("title") && (
                        <div className="sr-row-diff">
                          <div><span className="sr-diff-label">Vimeo:</span> {d.vimeo.title || <em>—</em>}</div>
                          <div><span className="sr-diff-label">StoryMatch:</span> {d.storyMatch.headline || <em>—</em>}</div>
                        </div>
                      )}
                      {d.fields.includes("description") && (
                        <div className="sr-row-diff">
                          <div><span className="sr-diff-label">Vimeo:</span> {truncate(d.vimeo.description, 140) || <em>—</em>}</div>
                          <div><span className="sr-diff-label">StoryMatch:</span> {truncate(d.storyMatch.description, 140) || <em>—</em>}</div>
                        </div>
                      )}
                    </div>
                    <div className="sr-row-actions">
                      <button className="sr-btn primary" onClick={() => onPullFromVimeo(d)}>Pull from Vimeo</button>
                      <button className="sr-btn" onClick={() => onKeepStoryMatch(d.assetId)}>Keep StoryMatch</button>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Archived */}
          {archived.length > 0 && (
            <section>
              <div className="sr-section-head">
                <span className="sr-section-icon sr-arch-bg">✗</span>
                Removed from Vimeo, auto-archived ({archived.length})
              </div>
              <div className="sr-section-help">
                These videos are no longer in your Vimeo showcase. We&apos;ve archived them automatically. Restore if you want them back as published.
              </div>
              <div className="sr-section-body">
                {archived.map((a) => (
                  <div key={a.assetId} className="sr-row">
                    <div className="sr-row-title">{a.headline || "Untitled"}</div>
                    <div className="sr-row-actions">
                      <button className="sr-btn primary" onClick={() => onRestoreFromArchive(a.assetId)}>Restore</button>
                      <button className="sr-btn" onClick={() => onKeepArchived(a.assetId)}>Keep archived</button>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
        <div className="sr-foot">
          <button className="sr-btn primary" onClick={onClose}>Done</button>
        </div>
      </div>
    </>,
    document.body
  );
}

function truncate(s: string | null | undefined, n: number): string {
  if (!s) return "";
  return s.length <= n ? s : s.slice(0, n).trim() + "…";
}

const css = `
.sr-backdrop{position:fixed;inset:0;background:rgba(0,0,0,.36);z-index:300;animation:srFade .18s ease-out;}
@keyframes srFade{from{opacity:0;}to{opacity:1;}}
.sr-modal{position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);width:720px;max-width:calc(100vw - 32px);max-height:calc(100vh - 60px);background:#fff;border-radius:12px;box-shadow:0 24px 60px rgba(0,0,0,.22);z-index:301;display:flex;flex-direction:column;font-family:var(--font);animation:srSlide .22s cubic-bezier(.4,0,.2,1);}
@keyframes srSlide{from{transform:translate(-50%,-46%);opacity:0;}to{transform:translate(-50%,-50%);opacity:1;}}

.sr-head{display:flex;align-items:center;justify-content:space-between;padding:14px 18px;border-bottom:1px solid var(--border);}
.sr-title{font-family:var(--serif);font-size:18px;font-weight:600;letter-spacing:-.3px;color:var(--t1);}
.sr-close{background:none;border:none;color:var(--t3);font-size:14px;cursor:pointer;padding:4px 8px;border-radius:5px;}
.sr-close:hover{background:var(--bg2);color:var(--t1);}

.sr-body{flex:1;overflow-y:auto;padding:14px 18px;}
.sr-empty{padding:32px;text-align:center;color:var(--t3);font-size:13px;}

.sr-summary{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:18px;}
.sr-pill{display:inline-flex;align-items:center;font-size:11.5px;font-weight:600;padding:4px 10px;border-radius:5px;border:1px solid;}
.sr-pill.sr-ok{background:#ecfdf5;color:var(--green);border-color:#a7f3d0;}
.sr-pill.sr-new{background:var(--accentLL);color:var(--accent);border-color:var(--accentL);}
.sr-pill.sr-warn{background:var(--amberL);color:var(--amber);border-color:#fcd34d;}
.sr-pill.sr-arch{background:var(--bg2);color:var(--t2);border-color:var(--border2);}

section{margin-bottom:18px;}
section:last-child{margin-bottom:0;}
.sr-section-head{display:flex;align-items:center;gap:9px;font-size:13px;font-weight:700;color:var(--t1);margin-bottom:6px;}
.sr-section-icon{display:inline-grid;place-items:center;width:22px;height:22px;border-radius:50%;font-size:11px;color:#fff;font-weight:700;}
.sr-new-bg{background:var(--accent);}
.sr-warn-bg{background:var(--amber);}
.sr-arch-bg{background:var(--t3);}
.sr-section-help{font-size:11.5px;color:var(--t3);margin-bottom:8px;line-height:1.5;}
.sr-section-body{display:flex;flex-direction:column;gap:6px;border:1px solid var(--border);border-radius:8px;overflow:hidden;}

.sr-row{display:flex;justify-content:space-between;align-items:center;gap:14px;padding:10px 12px;background:#fff;border-bottom:1px solid var(--border);}
.sr-row:last-child{border-bottom:none;}
.sr-row.sr-drift{flex-direction:column;align-items:stretch;gap:8px;}
.sr-row-title{font-size:13.5px;font-weight:600;color:var(--t1);}
.sr-row-meta{font-size:11.5px;color:var(--t3);margin-top:3px;display:flex;align-items:center;gap:5px;flex-wrap:wrap;}
.sr-field-tag{display:inline-block;padding:1px 7px;border-radius:4px;background:var(--amberL);color:var(--amber);font-weight:600;font-size:10.5px;text-transform:uppercase;letter-spacing:.4px;}
.sr-row-diff{margin-top:7px;font-size:12px;color:var(--t2);background:var(--bg2);border-radius:6px;padding:7px 9px;line-height:1.5;}
.sr-row-diff > div{margin-bottom:3px;}
.sr-row-diff > div:last-child{margin-bottom:0;}
.sr-diff-label{display:inline-block;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.4px;color:var(--t4);min-width:74px;}
.sr-row-actions{display:flex;gap:6px;flex-shrink:0;}

.sr-btn{padding:6px 12px;border:1px solid var(--border);border-radius:6px;background:#fff;color:var(--t2);font-family:var(--font);font-size:12px;font-weight:600;cursor:pointer;}
.sr-btn:hover{background:var(--bg2);color:var(--t1);}
.sr-btn.primary{background:var(--accent);color:#fff;border-color:var(--accent);}
.sr-btn.primary:hover{background:var(--accent2);}

.sr-foot{padding:14px 18px;border-top:1px solid var(--border);display:flex;justify-content:flex-end;}
`;
