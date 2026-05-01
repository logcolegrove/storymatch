"use client";

// Right-side slide-in drawer for editing a single asset. Four sections,
// no headers or dividers — just whitespace grouping by topic:
//   1. Basics: Title, Description, Client name + Company, Type
//   2. Filters: Vertical, Geography, Size
//   3. Quotes: Primary quote + additional quotes (with + Add)
//   4. Transcript: editable textarea + "Add selection as quote" affordance
//
// Visibility / approval / cleared status / custom flags all live in the
// row-level cleared popover — this panel is intentionally about the
// story's content + metadata, not its governance state.

import { useEffect, useRef, useState } from "react";

// Local mirror of the asset shape we need. Keeps the panel decoupled
// from StoryMatchApp's full Asset type — only the fields this panel
// edits get listed here.
export interface EditableAsset {
  id: string;
  sourceId?: string | null;
  clientName: string;
  company: string;
  vertical: string;
  geography: string;
  companySize: string;
  // challenge/outcome/videoUrl/status are NOT edited here anymore.
  // They live on the parent Asset and round-trip untouched through this
  // panel's onSave (we spread the original asset back).
  assetType: string;
  status: string;       // unchanged here, but kept on the type so onSave preserves it
  dateCreated: string;
  headline: string;
  pullQuote: string;
  additionalQuotes?: string[];
  transcript: string;
  description: string;
  thumbnail: string;
  // Approval/governance fields are also untouched here — the parent
  // refetches and merges; we only carry them on the type so saves don't
  // accidentally drop them via the spread.
  approvalStatus?: string;
  approvalNote?: string | null;
}

const VERTICALS = ["Logistics", "Healthcare", "Manufacturing", "Financial Services", "Retail", "Education", "Real Estate", "Technology"];
const ASSET_TYPES = ["Video Testimonial", "Written Case Study", "Quote"];

interface Props {
  asset: EditableAsset | null; // null = closed
  onSave: (a: EditableAsset) => void;
  onDelete: (id: string) => void;
  onPreview?: (id: string) => void;
  onClose: () => void;
}

export default function AssetEditPanel({ asset, onSave, onDelete, onPreview, onClose }: Props) {
  const [form, setForm] = useState<EditableAsset | null>(null);
  // Selection state for the transcript textarea — drives whether the
  // "Add selection as quote" button shows. selectionEnd > selectionStart
  // means the admin has highlighted some range.
  const transcriptRef = useRef<HTMLTextAreaElement>(null);
  const [transcriptSel, setTranscriptSel] = useState<{ start: number; end: number }>({ start: 0, end: 0 });

  // Sync form state whenever the target asset changes. Coerce nulls to
  // empty strings so controlled inputs don't crash on the first render.
  useEffect(() => {
    if (!asset) { setForm(null); return; }
    setForm({
      ...asset,
      clientName: asset.clientName || "",
      company: asset.company || "",
      vertical: asset.vertical || "",
      geography: asset.geography || "",
      companySize: asset.companySize || "",
      assetType: asset.assetType || "Video Testimonial",
      status: asset.status || "published",
      headline: asset.headline || "",
      pullQuote: asset.pullQuote || "",
      additionalQuotes: Array.isArray(asset.additionalQuotes) ? [...asset.additionalQuotes] : [],
      transcript: asset.transcript || "",
      description: asset.description || "",
      thumbnail: asset.thumbnail || "",
      dateCreated: asset.dateCreated || new Date().toISOString().split("T")[0],
    });
    setTranscriptSel({ start: 0, end: 0 });
  }, [asset]);

  // Close on Escape
  useEffect(() => {
    if (!asset) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [asset, onClose]);

  if (!asset || !form) return null;

  const set = <K extends keyof EditableAsset>(k: K, v: EditableAsset[K]) =>
    setForm(p => p ? { ...p, [k]: v } : p);
  const save = () => { onSave(form); };
  const del = () => {
    if (confirm(`Delete "${form.headline || form.company || "this asset"}"? This can't be undone.`)) {
      onDelete(form.id);
    }
  };

  // ── Quotes helpers ────────────────────────────────────────────────
  const additional: string[] = form.additionalQuotes || [];

  const addEmptyQuote = () => set("additionalQuotes", [...additional, ""]);
  const updateQuote = (i: number, text: string) => {
    const next = [...additional];
    next[i] = text;
    set("additionalQuotes", next);
  };
  const removeQuote = (i: number) => set("additionalQuotes", additional.filter((_, idx) => idx !== i));
  const addQuoteText = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    set("additionalQuotes", [...additional, trimmed]);
  };

  // ── Transcript selection → quote ─────────────────────────────────
  const captureTranscriptSelection = () => {
    const ta = transcriptRef.current;
    if (!ta) return;
    setTranscriptSel({ start: ta.selectionStart ?? 0, end: ta.selectionEnd ?? 0 });
  };
  const transcriptHasSelection = transcriptSel.end > transcriptSel.start;
  const addSelectionAsQuote = () => {
    if (!transcriptHasSelection) return;
    const text = (form.transcript || "").substring(transcriptSel.start, transcriptSel.end);
    addQuoteText(text);
    // Clear the selection state so the button hides until the next pick.
    setTranscriptSel({ start: 0, end: 0 });
  };

  return (
    <>
      <style>{css}</style>
      <div className="aep-backdrop" onClick={onClose}/>
      <aside className="aep">
        <div className="aep-head">
          <div className="aep-head-title">
            <button className="aep-back" onClick={onClose} title="Close (Esc)">← Back</button>
            <div>
              <div className="aep-title">Edit Asset</div>
              <div className="aep-sub">{form.headline || form.company || "—"}</div>
            </div>
          </div>
          {onPreview && (
            <button className="aep-preview" onClick={() => onPreview(form.id)}>Preview</button>
          )}
        </div>
        <div className="aep-body">
          {/* ── 1. Basics ── */}
          <div className="aep-section">
            <div className="aep-fld">
              <label>Title</label>
              <input className="aep-in aep-title-in" value={form.headline} onChange={e => set("headline", e.target.value)}/>
            </div>
            <div className="aep-fld">
              <label>Description</label>
              <textarea className="aep-tx" style={{ minHeight: 80 }} value={form.description} onChange={e => set("description", e.target.value)}/>
            </div>
            <div className="aep-row">
              <div className="aep-fld"><label>Client name</label><input className="aep-in" value={form.clientName} onChange={e => set("clientName", e.target.value)}/></div>
              <div className="aep-fld"><label>Company</label><input className="aep-in" value={form.company} onChange={e => set("company", e.target.value)}/></div>
            </div>
            <div className="aep-fld">
              <label>Type</label>
              <select className="aep-sel" value={form.assetType} onChange={e => set("assetType", e.target.value)}>
                {ASSET_TYPES.map(v => (<option key={v}>{v}</option>))}
              </select>
            </div>
          </div>

          {/* ── 2. Filters / metadata ── */}
          <div className="aep-section">
            <div className="aep-row">
              <div className="aep-fld">
                <label>Vertical</label>
                <select className="aep-sel" value={form.vertical} onChange={e => set("vertical", e.target.value)}>
                  {VERTICALS.map(v => (<option key={v}>{v}</option>))}
                </select>
              </div>
              <div className="aep-fld"><label>Geography</label><input className="aep-in" value={form.geography} onChange={e => set("geography", e.target.value)}/></div>
            </div>
            <div className="aep-fld"><label>Size</label><input className="aep-in" value={form.companySize} onChange={e => set("companySize", e.target.value)}/></div>
          </div>

          {/* ── 3. Quotes ── */}
          <div className="aep-section">
            <div className="aep-fld">
              <label>Primary quote</label>
              <textarea className="aep-tx" style={{ minHeight: 60 }} value={form.pullQuote} onChange={e => set("pullQuote", e.target.value)}/>
            </div>
            {additional.length > 0 && (
              <div className="aep-quotes-list">
                {additional.map((q, i) => (
                  <div key={i} className="aep-quote-row">
                    <textarea
                      className="aep-tx"
                      style={{ minHeight: 50 }}
                      value={q}
                      onChange={e => updateQuote(i, e.target.value)}
                    />
                    <button
                      type="button"
                      className="aep-quote-remove"
                      onClick={() => removeQuote(i)}
                      title="Remove this quote"
                      aria-label="Remove quote"
                    >×</button>
                  </div>
                ))}
              </div>
            )}
            <button type="button" className="aep-add-quote" onClick={addEmptyQuote}>
              <span className="aep-add-plus">+</span>
              <span>Add quote</span>
            </button>
          </div>

          {/* ── 4. Transcript ── */}
          <div className="aep-section">
            <div className="aep-fld">
              <label>Transcript</label>
              <textarea
                ref={transcriptRef}
                className="aep-tx"
                value={form.transcript}
                onChange={e => set("transcript", e.target.value)}
                onSelect={captureTranscriptSelection}
                onKeyUp={captureTranscriptSelection}
                onMouseUp={captureTranscriptSelection}
              />
              {/* Quote-from-selection — appears only when admin has
                  highlighted a range inside the transcript. Clicking
                  promotes the substring to an entry in the additional-
                  quotes list above and clears the selection state so the
                  button hides itself. */}
              {transcriptHasSelection && (
                <button
                  type="button"
                  className="aep-add-selection"
                  onClick={addSelectionAsQuote}
                >
                  <span className="aep-add-plus">+</span>
                  <span>Add selection as quote</span>
                </button>
              )}
            </div>
          </div>
        </div>
        <div className="aep-foot">
          <button className="aep-save" onClick={save}>Save changes</button>
          <button className="aep-del" onClick={del}>Delete</button>
        </div>
      </aside>
    </>
  );
}

const css = `
.aep-backdrop{position:fixed;inset:0;background:rgba(0,0,0,.32);z-index:90;animation:aepFade .18s ease-out;}
@keyframes aepFade{from{opacity:0;}to{opacity:1;}}
.aep{position:fixed;top:0;right:0;width:520px;max-width:100vw;height:100vh;background:#fff;border-left:1px solid var(--border);box-shadow:-12px 0 36px rgba(0,0,0,.12);z-index:100;display:flex;flex-direction:column;font-family:var(--font);animation:aepSlide .22s cubic-bezier(.4,0,.2,1);}
@keyframes aepSlide{from{transform:translateX(100%);}to{transform:translateX(0);}}

.aep-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;padding:18px 22px 14px;border-bottom:1px solid var(--border);}
.aep-head-title{display:flex;align-items:center;gap:14px;}
.aep-back{padding:6px 12px;border-radius:var(--r3);border:1px solid var(--border);background:#fff;color:var(--t2);font-family:var(--font);font-size:12px;font-weight:600;cursor:pointer;}
.aep-back:hover{border-color:var(--border2);color:var(--t1);}
.aep-title{font-family:var(--serif);font-size:20px;font-weight:600;letter-spacing:-.3px;color:var(--t1);}
.aep-sub{font-size:12px;color:var(--t3);margin-top:2px;}
.aep-preview{padding:6px 14px;border-radius:var(--r3);border:1px solid var(--accent);background:#fff;color:var(--accent);font-family:var(--font);font-size:12px;font-weight:600;cursor:pointer;}
.aep-preview:hover{background:var(--accentLL);}

.aep-body{flex:1;overflow-y:auto;padding:18px 22px;display:flex;flex-direction:column;gap:28px;}
/* Section — group of related fields. No header, no divider, just extra
   whitespace between sections (gap on the .aep-body grid handles it). */
.aep-section{display:flex;flex-direction:column;gap:14px;}
.aep-row{display:grid;grid-template-columns:1fr 1fr;gap:14px;}
.aep-fld{display:flex;flex-direction:column;gap:5px;min-width:0;}
.aep-fld label{font-size:10.5px;text-transform:uppercase;letter-spacing:.6px;color:var(--t3);font-weight:700;display:flex;align-items:center;gap:6px;}
.aep-in,.aep-sel,.aep-tx{font-family:var(--font);font-size:13px;padding:8px 10px;border:1px solid var(--border);border-radius:7px;background:#fff;color:var(--t1);width:100%;}
.aep-title-in{font-family:var(--serif);font-size:16px;font-weight:600;letter-spacing:-.2px;}
.aep-in:focus,.aep-sel:focus,.aep-tx:focus{outline:none;border-color:var(--accent);}
.aep-tx{min-height:120px;resize:vertical;line-height:1.5;}

/* Quotes list — additional pull quotes beyond the primary. Each row is
   a textarea + a small × remove button, stacked vertically. */
.aep-quotes-list{display:flex;flex-direction:column;gap:10px;}
.aep-quote-row{display:flex;align-items:flex-start;gap:8px;}
.aep-quote-row .aep-tx{flex:1;min-height:50px;}
.aep-quote-remove{background:none;border:none;color:var(--t4);cursor:pointer;font-size:18px;line-height:1;padding:6px 8px;border-radius:6px;align-self:flex-start;margin-top:2px;}
.aep-quote-remove:hover{background:var(--bg2);color:var(--t1);}

/* "+ Add quote" button — quietly invites adding more without screaming
   for attention. Same visual language as the rules-panel "+ Add condition"
   button so the two patterns feel like a family. */
.aep-add-quote,.aep-add-selection{display:inline-flex;align-items:center;gap:6px;background:none;border:1px dashed var(--border2);color:var(--t3);padding:7px 12px;border-radius:8px;font-family:var(--font);font-size:12px;font-weight:600;cursor:pointer;align-self:flex-start;transition:all .12s;}
.aep-add-quote:hover,.aep-add-selection:hover{border-color:var(--accent);color:var(--accent);background:var(--accentLL);}
.aep-add-plus{display:inline-grid;place-items:center;width:16px;height:16px;border-radius:50%;background:currentColor;color:#fff;font-size:13px;font-weight:700;line-height:1;}
/* "Add selection as quote" — appears under the transcript only when
   admin has highlighted a substring. Slightly emphasized (solid border,
   accent color) since it's responsive to user action. */
.aep-add-selection{margin-top:8px;border-style:solid;border-color:var(--accent);color:var(--accent);background:var(--accentLL);}
.aep-add-selection:hover{background:var(--accentL);}
.aep-add-selection .aep-add-plus{background:var(--accent);}

.aep-foot{padding:14px 22px;border-top:1px solid var(--border);background:#fff;display:flex;gap:10px;}
.aep-save{flex:1;padding:11px;border-radius:var(--r3);border:none;background:var(--accent);color:#fff;font-family:var(--font);font-size:13px;font-weight:700;cursor:pointer;}
.aep-save:hover{background:var(--accent2);}
.aep-del{padding:11px 18px;border-radius:var(--r3);border:1px solid var(--border);background:#fff;color:var(--red);font-family:var(--font);font-size:13px;font-weight:600;cursor:pointer;}
.aep-del:hover{background:#fef2f2;border-color:var(--red);}

@media (max-width:540px){
  .aep{width:100vw;}
}
`;
