"use client";

// Right-side slide-in drawer for editing a single asset. Four sections,
// no headers or dividers — just whitespace grouping by topic:
//   1. Basics: Title, Description, Client name + Company, Type
//   2. Filters: Vertical, Geography, Size
//   3. Highlighted quotes: numbered, reorderable list. "+ Add quote"
//      opens a chooser → From transcript / AI recommend / Manual entry.
//   4. Transcript: editable textarea + "Add selection as quote".
//
// Visibility / approval / cleared status / custom flags all live in the
// row-level cleared popover — this panel is intentionally about the
// story's content + metadata, not its governance state.

import { useEffect, useRef, useState } from "react";

// Local mirror of the asset shape this panel touches. Quotes are
// represented internally as a single ordered array; on save we split
// the array into the existing pullQuote (first item) + additionalQuotes
// (rest) shape so the DB schema doesn't have to change.
export interface EditableAsset {
  id: string;
  sourceId?: string | null;
  clientName: string;
  company: string;
  vertical: string;
  geography: string;
  companySize: string;
  assetType: string;
  status: string;
  dateCreated: string;
  headline: string;
  pullQuote: string;
  additionalQuotes?: string[];
  transcript: string;
  description: string;
  thumbnail: string;
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
  // Auth header function so the AI-recommend call can authenticate.
  // Accepts the parent's authHeaders signature — Promise<HeadersInit>
  // covers Record/Headers/array shapes so we don't have to retype it.
  authHeaders?: () => Promise<HeadersInit> | HeadersInit;
}

type AddMode = "closed" | "chooser" | "transcript" | "ai" | "manual";
type AiState = "idle" | "loading" | "ready" | "error";

export default function AssetEditPanel({ asset, onSave, onDelete, onPreview, onClose, authHeaders }: Props) {
  // ── Form state — unified quotes array is the source of truth in UI.
  const [headline, setHeadline] = useState("");
  const [description, setDescription] = useState("");
  const [clientName, setClientName] = useState("");
  const [company, setCompany] = useState("");
  const [assetType, setAssetType] = useState("Video Testimonial");
  const [vertical, setVertical] = useState("");
  const [geography, setGeography] = useState("");
  const [companySize, setCompanySize] = useState("");
  const [transcript, setTranscript] = useState("");
  const [quotes, setQuotes] = useState<string[]>([]);

  // Add-quote sub-flow state
  const [addMode, setAddMode] = useState<AddMode>("closed");
  const [manualDraft, setManualDraft] = useState("");
  const [transcriptPicked, setTranscriptPicked] = useState<Set<number>>(new Set());
  const [aiState, setAiState] = useState<AiState>("idle");
  const [aiSuggestions, setAiSuggestions] = useState<string[]>([]);
  const [aiPicked, setAiPicked] = useState<Set<number>>(new Set());
  const [aiError, setAiError] = useState<string>("");

  // Drag-and-drop reorder state
  const [dragFrom, setDragFrom] = useState<number | null>(null);

  // Transcript selection → quote affordance
  const transcriptRef = useRef<HTMLTextAreaElement>(null);
  const [transcriptSel, setTranscriptSel] = useState<{ start: number; end: number }>({ start: 0, end: 0 });

  // Sync local state from the incoming asset. Combine pullQuote + additionalQuotes
  // into a single ordered array; first non-empty becomes index 0.
  useEffect(() => {
    if (!asset) return;
    setHeadline(asset.headline || "");
    setDescription(asset.description || "");
    setClientName(asset.clientName || "");
    setCompany(asset.company || "");
    setAssetType(asset.assetType || "Video Testimonial");
    setVertical(asset.vertical || "");
    setGeography(asset.geography || "");
    setCompanySize(asset.companySize || "");
    setTranscript(asset.transcript || "");
    const all = [asset.pullQuote || "", ...(asset.additionalQuotes || [])].filter(q => (q || "").trim().length > 0);
    setQuotes(all);
    // Reset all sub-flow state to a clean baseline whenever the target
    // asset swaps out (so the AI panel doesn't carry suggestions from
    // the previous asset, etc.).
    setAddMode("closed");
    setManualDraft("");
    setTranscriptPicked(new Set());
    setAiState("idle");
    setAiSuggestions([]);
    setAiPicked(new Set());
    setAiError("");
    setTranscriptSel({ start: 0, end: 0 });
    setDragFrom(null);
  }, [asset]);

  // Close on Escape — but only if no add-quote sub-flow is open (those
  // own Escape via their own Cancel buttons, but we still let Esc close
  // the whole panel since admins expect that universally).
  useEffect(() => {
    if (!asset) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [asset, onClose]);

  if (!asset) return null;

  // ── Save / delete ──────────────────────────────────────────────────
  const save = () => {
    // Split unified quotes back into the DB shape: first → pullQuote,
    // rest → additionalQuotes. Trim whitespace; drop fully-empty entries.
    const cleaned = quotes.map(q => (q || "").trim()).filter(q => q.length > 0);
    const pullQuote = cleaned[0] || "";
    const additionalQuotes = cleaned.slice(1);
    onSave({
      ...asset,
      headline,
      description,
      clientName,
      company,
      assetType,
      vertical,
      geography,
      companySize,
      transcript,
      pullQuote,
      additionalQuotes,
    });
  };
  const del = () => {
    if (confirm(`Delete "${headline || company || "this asset"}"? This can't be undone.`)) {
      onDelete(asset.id);
    }
  };

  // ── Quote helpers ─────────────────────────────────────────────────
  const addQuotes = (texts: string[]) => {
    const cleaned = texts.map(t => (t || "").trim()).filter(t => t.length > 0);
    if (cleaned.length === 0) return;
    setQuotes(prev => [...prev, ...cleaned]);
  };
  const updateQuote = (i: number, text: string) => {
    setQuotes(prev => prev.map((q, idx) => (idx === i ? text : q)));
  };
  const removeQuote = (i: number) => {
    setQuotes(prev => prev.filter((_, idx) => idx !== i));
  };

  // Drag-and-drop reorder
  const onDragStartIdx = (i: number) => () => setDragFrom(i);
  const onDragOverIdx = (i: number) => (e: React.DragEvent) => {
    e.preventDefault();
    if (dragFrom === null || dragFrom === i) return;
  };
  const onDropIdx = (i: number) => (e: React.DragEvent) => {
    e.preventDefault();
    if (dragFrom === null || dragFrom === i) {
      setDragFrom(null);
      return;
    }
    setQuotes(prev => {
      const next = [...prev];
      const [moved] = next.splice(dragFrom, 1);
      next.splice(i, 0, moved);
      return next;
    });
    setDragFrom(null);
  };
  const onDragEnd = () => setDragFrom(null);

  // ── Transcript-selection → quote ──────────────────────────────────
  const captureTranscriptSelection = () => {
    const ta = transcriptRef.current;
    if (!ta) return;
    setTranscriptSel({ start: ta.selectionStart ?? 0, end: ta.selectionEnd ?? 0 });
  };
  const transcriptHasSelection = transcriptSel.end > transcriptSel.start;
  const addSelectionAsQuote = () => {
    if (!transcriptHasSelection) return;
    addQuotes([transcript.substring(transcriptSel.start, transcriptSel.end)]);
    setTranscriptSel({ start: 0, end: 0 });
  };

  // ── Sub-flows ─────────────────────────────────────────────────────
  // Transcript sentences — split on terminal punctuation, keep the
  // delimiter so each sentence reads naturally. Filter out empties.
  const sentences = (() => {
    if (!transcript) return [] as string[];
    const parts = transcript
      .replace(/\s+/g, " ")
      .match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [];
    return parts.map(s => s.trim()).filter(s => s.length > 6);
  })();

  const togglePicked = (set: Set<number>, setter: (s: Set<number>) => void, i: number) => {
    const next = new Set(set);
    if (next.has(i)) next.delete(i); else next.add(i);
    setter(next);
  };

  const confirmTranscriptPicks = () => {
    const picks: string[] = [];
    sentences.forEach((s, i) => { if (transcriptPicked.has(i)) picks.push(s); });
    addQuotes(picks);
    setTranscriptPicked(new Set());
    setAddMode("closed");
  };

  const confirmAiPicks = () => {
    const picks: string[] = [];
    aiSuggestions.forEach((s, i) => { if (aiPicked.has(i)) picks.push(s); });
    addQuotes(picks);
    setAiPicked(new Set());
    setAiSuggestions([]);
    setAiState("idle");
    setAddMode("closed");
  };

  const requestAi = async () => {
    if (!transcript || transcript.trim().length < 50) {
      setAiState("error");
      setAiError("This asset doesn't have enough transcript text to suggest quotes from.");
      return;
    }
    setAiState("loading");
    setAiError("");
    try {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (authHeaders) {
        const auth = await authHeaders();
        // HeadersInit can be a plain record, a Headers instance, or an
        // array of [key, value] tuples. Normalize to a record before
        // merging so all three shapes flow through cleanly.
        if (auth instanceof Headers) {
          auth.forEach((value, key) => { headers[key] = value; });
        } else if (Array.isArray(auth)) {
          for (const [key, value] of auth) headers[key] = value;
        } else {
          Object.assign(headers, auth);
        }
      }
      const r = await fetch("/api/suggest-quotes", {
        method: "POST",
        headers,
        body: JSON.stringify({
          transcript,
          existingQuotes: quotes,
        }),
      });
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        throw new Error(body?.error || `Failed (${r.status})`);
      }
      const data = await r.json() as { quotes?: string[] };
      const list = Array.isArray(data.quotes) ? data.quotes : [];
      setAiSuggestions(list);
      setAiPicked(new Set(list.map((_, i) => i))); // pre-select all
      setAiState(list.length > 0 ? "ready" : "error");
      if (list.length === 0) setAiError("No standout quotes found. The transcript may be too short or generic.");
    } catch (e) {
      setAiState("error");
      setAiError((e as Error).message || "Couldn't reach the AI suggestion service.");
    }
  };

  const cancelAdd = () => {
    setAddMode("closed");
    setManualDraft("");
    setTranscriptPicked(new Set());
    setAiSuggestions([]);
    setAiPicked(new Set());
    setAiState("idle");
    setAiError("");
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
              <div className="aep-sub">{headline || company || "—"}</div>
            </div>
          </div>
          {onPreview && (
            <button className="aep-preview" onClick={() => onPreview(asset.id)}>Preview</button>
          )}
        </div>
        <div className="aep-body">
          {/* ── 1. Basics ── */}
          <div className="aep-section">
            <div className="aep-fld">
              <label>Title</label>
              <input className="aep-in aep-title-in" value={headline} onChange={e => setHeadline(e.target.value)}/>
            </div>
            <div className="aep-fld">
              <label>Description</label>
              <textarea className="aep-tx" style={{ minHeight: 80 }} value={description} onChange={e => setDescription(e.target.value)}/>
            </div>
            <div className="aep-row">
              <div className="aep-fld"><label>Client name</label><input className="aep-in" value={clientName} onChange={e => setClientName(e.target.value)}/></div>
              <div className="aep-fld"><label>Company</label><input className="aep-in" value={company} onChange={e => setCompany(e.target.value)}/></div>
            </div>
            <div className="aep-fld">
              <label>Type</label>
              <select className="aep-sel" value={assetType} onChange={e => setAssetType(e.target.value)}>
                {ASSET_TYPES.map(v => (<option key={v}>{v}</option>))}
              </select>
            </div>
          </div>

          {/* ── 2. Filters / metadata ── */}
          <div className="aep-section">
            <div className="aep-row">
              <div className="aep-fld">
                <label>Vertical</label>
                <select className="aep-sel" value={vertical} onChange={e => setVertical(e.target.value)}>
                  {VERTICALS.map(v => (<option key={v}>{v}</option>))}
                </select>
              </div>
              <div className="aep-fld"><label>Geography</label><input className="aep-in" value={geography} onChange={e => setGeography(e.target.value)}/></div>
            </div>
            <div className="aep-fld"><label>Size</label><input className="aep-in" value={companySize} onChange={e => setCompanySize(e.target.value)}/></div>
          </div>

          {/* ── 3. Highlighted quotes ── */}
          <div className="aep-section">
            <div className="aep-section-head">Highlighted quotes</div>

            {quotes.length === 0 && addMode === "closed" && (
              <div className="aep-empty">No quotes yet. Add one to highlight on the asset's page.</div>
            )}

            {quotes.length > 0 && (
              <div className="aep-quotes-list">
                {quotes.map((q, i) => (
                  <div
                    key={i}
                    className={`aep-quote-card${dragFrom === i ? " dragging" : ""}`}
                    draggable
                    onDragStart={onDragStartIdx(i)}
                    onDragOver={onDragOverIdx(i)}
                    onDrop={onDropIdx(i)}
                    onDragEnd={onDragEnd}
                  >
                    <div className="aep-quote-header">
                      <span className="aep-drag-handle" title="Drag to reorder" aria-label="Drag handle">⋮⋮</span>
                      <span className="aep-quote-num">{i + 1}</span>
                      <button
                        type="button"
                        className="aep-quote-remove"
                        onClick={() => removeQuote(i)}
                        title="Remove quote"
                        aria-label="Remove quote"
                      >×</button>
                    </div>
                    <textarea
                      className="aep-tx"
                      value={q}
                      onChange={e => updateQuote(i, e.target.value)}
                      style={{ minHeight: 56 }}
                    />
                  </div>
                ))}
              </div>
            )}

            {/* Add quote chooser + sub-flows. The chooser stays inside the
                Quotes section so admin context (the existing list above)
                is always visible. */}
            {addMode === "closed" && (
              <button
                type="button"
                className="aep-add-quote"
                onClick={() => setAddMode("chooser")}
              >
                <span className="aep-add-plus">+</span>
                <span>Add quote</span>
              </button>
            )}

            {addMode === "chooser" && (
              <div className="aep-chooser">
                <div className="aep-chooser-head">
                  <span>How would you like to add it?</span>
                  <button type="button" className="aep-chooser-cancel" onClick={cancelAdd}>Cancel</button>
                </div>
                <div className="aep-chooser-grid">
                  <button
                    type="button"
                    className="aep-choice"
                    onClick={() => setAddMode("transcript")}
                    disabled={sentences.length === 0}
                    title={sentences.length === 0 ? "No transcript text to pick from" : ""}
                  >
                    <span className="aep-choice-icon">✎</span>
                    <span className="aep-choice-label">From transcript</span>
                    <span className="aep-choice-help">Pick sentences from the transcript</span>
                  </button>
                  <button
                    type="button"
                    className="aep-choice"
                    onClick={() => { setAddMode("ai"); requestAi(); }}
                    disabled={!transcript || transcript.trim().length < 50}
                    title={!transcript ? "Need a transcript to suggest from" : ""}
                  >
                    <span className="aep-choice-icon">✨</span>
                    <span className="aep-choice-label">AI recommend</span>
                    <span className="aep-choice-help">Let AI find standout quotes</span>
                  </button>
                  <button
                    type="button"
                    className="aep-choice"
                    onClick={() => setAddMode("manual")}
                  >
                    <span className="aep-choice-icon">⌨</span>
                    <span className="aep-choice-label">Manual entry</span>
                    <span className="aep-choice-help">Type a quote yourself</span>
                  </button>
                </div>
              </div>
            )}

            {addMode === "transcript" && (
              <div className="aep-subflow">
                <div className="aep-subflow-head">
                  <span>Pick sentences to add as quotes</span>
                  <button type="button" className="aep-chooser-cancel" onClick={cancelAdd}>Cancel</button>
                </div>
                <div className="aep-sentence-list">
                  {sentences.map((s, i) => {
                    const picked = transcriptPicked.has(i);
                    return (
                      <button
                        key={i}
                        type="button"
                        className={`aep-sentence${picked ? " picked" : ""}`}
                        onClick={() => togglePicked(transcriptPicked, setTranscriptPicked, i)}
                      >
                        <span className="aep-sentence-checkbox">{picked ? "✓" : ""}</span>
                        <span className="aep-sentence-text">{s}</span>
                      </button>
                    );
                  })}
                </div>
                <div className="aep-subflow-actions">
                  <button
                    type="button"
                    className="aep-subflow-confirm"
                    onClick={confirmTranscriptPicks}
                    disabled={transcriptPicked.size === 0}
                  >
                    Add {transcriptPicked.size > 0 ? `${transcriptPicked.size} ` : ""}selected
                  </button>
                </div>
              </div>
            )}

            {addMode === "ai" && (
              <div className="aep-subflow">
                <div className="aep-subflow-head">
                  <span>AI-suggested quotes</span>
                  <button type="button" className="aep-chooser-cancel" onClick={cancelAdd}>Cancel</button>
                </div>
                {aiState === "loading" && (
                  <div className="aep-ai-loading">
                    <span className="aep-spinner"/>
                    <span>Picking standout quotes…</span>
                  </div>
                )}
                {aiState === "error" && (
                  <div className="aep-ai-error">
                    <span>{aiError || "Couldn't suggest quotes."}</span>
                    <button type="button" className="aep-ai-retry" onClick={requestAi}>Try again</button>
                  </div>
                )}
                {aiState === "ready" && (
                  <>
                    <div className="aep-sentence-list">
                      {aiSuggestions.map((s, i) => {
                        const picked = aiPicked.has(i);
                        return (
                          <button
                            key={i}
                            type="button"
                            className={`aep-sentence${picked ? " picked" : ""}`}
                            onClick={() => togglePicked(aiPicked, setAiPicked, i)}
                          >
                            <span className="aep-sentence-checkbox">{picked ? "✓" : ""}</span>
                            <span className="aep-sentence-text">{s}</span>
                          </button>
                        );
                      })}
                    </div>
                    <div className="aep-subflow-actions">
                      <button type="button" className="aep-ai-retry" onClick={requestAi}>Regenerate</button>
                      <button
                        type="button"
                        className="aep-subflow-confirm"
                        onClick={confirmAiPicks}
                        disabled={aiPicked.size === 0}
                      >
                        Add {aiPicked.size > 0 ? `${aiPicked.size} ` : ""}selected
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}

            {addMode === "manual" && (
              <div className="aep-subflow">
                <div className="aep-subflow-head">
                  <span>Type a quote</span>
                  <button type="button" className="aep-chooser-cancel" onClick={cancelAdd}>Cancel</button>
                </div>
                <textarea
                  className="aep-tx"
                  style={{ minHeight: 90 }}
                  value={manualDraft}
                  onChange={e => setManualDraft(e.target.value)}
                  placeholder="Paste or type the quote here…"
                  autoFocus
                />
                <div className="aep-subflow-actions">
                  <button
                    type="button"
                    className="aep-subflow-confirm"
                    onClick={() => { addQuotes([manualDraft]); cancelAdd(); }}
                    disabled={manualDraft.trim().length === 0}
                  >Add quote</button>
                </div>
              </div>
            )}
          </div>

          {/* ── 4. Transcript ── */}
          <div className="aep-section">
            <div className="aep-fld">
              <label>Transcript</label>
              <textarea
                ref={transcriptRef}
                className="aep-tx"
                value={transcript}
                onChange={e => setTranscript(e.target.value)}
                onSelect={captureTranscriptSelection}
                onKeyUp={captureTranscriptSelection}
                onMouseUp={captureTranscriptSelection}
              />
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
.aep-section{display:flex;flex-direction:column;gap:14px;}
.aep-section-head{font-size:10.5px;text-transform:uppercase;letter-spacing:.6px;color:var(--t3);font-weight:700;}
.aep-empty{font-size:12px;color:var(--t4);font-style:italic;padding:6px 0;}
.aep-row{display:grid;grid-template-columns:1fr 1fr;gap:14px;}
.aep-fld{display:flex;flex-direction:column;gap:5px;min-width:0;}
.aep-fld label{font-size:10.5px;text-transform:uppercase;letter-spacing:.6px;color:var(--t3);font-weight:700;display:flex;align-items:center;gap:6px;}
.aep-in,.aep-sel,.aep-tx{font-family:var(--font);font-size:13px;padding:8px 10px;border:1px solid var(--border);border-radius:7px;background:#fff;color:var(--t1);width:100%;}
.aep-title-in{font-family:var(--serif);font-size:16px;font-weight:600;letter-spacing:-.2px;}
.aep-in:focus,.aep-sel:focus,.aep-tx:focus{outline:none;border-color:var(--accent);}
.aep-tx{min-height:120px;resize:vertical;line-height:1.5;}

/* ── Quote cards ── numbered, draggable, identical-styled rows. */
.aep-quotes-list{display:flex;flex-direction:column;gap:10px;}
.aep-quote-card{border:1px solid var(--border);border-radius:9px;background:#fff;padding:10px 12px;transition:all .12s;cursor:default;}
.aep-quote-card:hover{border-color:var(--border2);}
.aep-quote-card.dragging{opacity:.4;border-style:dashed;}
.aep-quote-header{display:flex;align-items:center;gap:8px;margin-bottom:8px;}
.aep-drag-handle{cursor:grab;color:var(--t4);font-size:14px;line-height:1;padding:2px 4px;border-radius:4px;letter-spacing:-2px;font-weight:700;user-select:none;}
.aep-drag-handle:hover{background:var(--bg2);color:var(--t2);}
.aep-drag-handle:active{cursor:grabbing;}
.aep-quote-num{display:inline-grid;place-items:center;width:22px;height:22px;border-radius:50%;background:var(--accentLL);color:var(--accent);font-size:11px;font-weight:700;font-family:var(--font);}
.aep-quote-remove{margin-left:auto;background:none;border:none;color:var(--t4);cursor:pointer;font-size:18px;line-height:1;padding:2px 8px;border-radius:6px;}
.aep-quote-remove:hover{background:var(--bg2);color:var(--t1);}
.aep-quote-card .aep-tx{min-height:56px;}

/* ── Add quote button + chooser ── */
.aep-add-quote{display:inline-flex;align-items:center;gap:6px;background:none;border:1px dashed var(--border2);color:var(--t3);padding:8px 14px;border-radius:8px;font-family:var(--font);font-size:12.5px;font-weight:600;cursor:pointer;align-self:flex-start;transition:all .12s;}
.aep-add-quote:hover{border-color:var(--accent);color:var(--accent);background:var(--accentLL);}
.aep-add-plus{display:inline-grid;place-items:center;width:16px;height:16px;border-radius:50%;background:currentColor;color:#fff;font-size:13px;font-weight:700;line-height:1;}

.aep-chooser{border:1px solid var(--border);border-radius:10px;background:var(--bg);padding:12px;display:flex;flex-direction:column;gap:10px;}
.aep-chooser-head{display:flex;align-items:center;justify-content:space-between;font-size:12px;font-weight:600;color:var(--t2);}
.aep-chooser-cancel{background:none;border:none;color:var(--t3);font-family:var(--font);font-size:12px;font-weight:600;cursor:pointer;padding:4px 8px;border-radius:6px;}
.aep-chooser-cancel:hover{background:var(--bg2);color:var(--t1);}
.aep-chooser-grid{display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;}
.aep-choice{display:flex;flex-direction:column;align-items:center;gap:6px;padding:14px 10px;border:1px solid var(--border);border-radius:9px;background:#fff;cursor:pointer;font-family:var(--font);transition:all .12s;text-align:center;}
.aep-choice:hover:not(:disabled){border-color:var(--accent);background:var(--accentLL);}
.aep-choice:disabled{opacity:.4;cursor:not-allowed;}
.aep-choice-icon{font-size:18px;line-height:1;}
.aep-choice-label{font-size:12px;font-weight:600;color:var(--t1);}
.aep-choice-help{font-size:10.5px;color:var(--t3);line-height:1.3;}

/* ── Sub-flow shared (transcript picker, AI list, manual textarea) ── */
.aep-subflow{border:1px solid var(--border);border-radius:10px;background:var(--bg);padding:12px;display:flex;flex-direction:column;gap:10px;}
.aep-subflow-head{display:flex;align-items:center;justify-content:space-between;font-size:12px;font-weight:600;color:var(--t2);}
.aep-sentence-list{display:flex;flex-direction:column;gap:6px;max-height:280px;overflow-y:auto;padding-right:4px;}
.aep-sentence{display:flex;align-items:flex-start;gap:8px;padding:9px 11px;border:1px solid var(--border);border-radius:7px;background:#fff;cursor:pointer;font-family:var(--font);font-size:12.5px;color:var(--t1);text-align:left;line-height:1.5;transition:all .12s;}
.aep-sentence:hover{border-color:var(--border2);background:var(--bg2);}
.aep-sentence.picked{border-color:var(--accent);background:var(--accentLL);}
.aep-sentence-checkbox{flex-shrink:0;width:16px;height:16px;border:1.5px solid var(--border2);border-radius:4px;display:grid;place-items:center;font-size:11px;color:#fff;background:#fff;font-weight:700;margin-top:2px;}
.aep-sentence.picked .aep-sentence-checkbox{background:var(--accent);border-color:var(--accent);}
.aep-sentence-text{flex:1;}
.aep-subflow-actions{display:flex;gap:8px;justify-content:flex-end;}
.aep-subflow-confirm{padding:8px 14px;border-radius:7px;border:none;background:var(--accent);color:#fff;font-family:var(--font);font-size:12.5px;font-weight:700;cursor:pointer;}
.aep-subflow-confirm:hover:not(:disabled){background:var(--accent2);}
.aep-subflow-confirm:disabled{opacity:.4;cursor:not-allowed;}

/* AI states — loading / error / ready. */
.aep-ai-loading{display:flex;align-items:center;gap:10px;padding:18px 12px;color:var(--t3);font-size:12.5px;}
.aep-spinner{width:14px;height:14px;border:2px solid var(--border);border-top-color:var(--accent);border-radius:50%;animation:aepSpin .8s linear infinite;}
@keyframes aepSpin{to{transform:rotate(360deg);}}
.aep-ai-error{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px 12px;border:1px solid var(--border);border-radius:7px;background:#fff;font-size:12px;color:var(--t2);}
.aep-ai-retry{padding:6px 12px;border:1px solid var(--border);border-radius:6px;background:#fff;color:var(--t2);font-family:var(--font);font-size:12px;font-weight:600;cursor:pointer;}
.aep-ai-retry:hover{border-color:var(--accent);color:var(--accent);}

/* "Add selection as quote" — appears under the transcript when admin
   has highlighted a substring. */
.aep-add-selection{display:inline-flex;align-items:center;gap:6px;background:var(--accentLL);border:1px solid var(--accent);color:var(--accent);padding:7px 12px;border-radius:8px;font-family:var(--font);font-size:12px;font-weight:600;cursor:pointer;align-self:flex-start;margin-top:8px;transition:all .12s;}
.aep-add-selection:hover{background:var(--accentL);}
.aep-add-selection .aep-add-plus{background:var(--accent);}

.aep-foot{padding:14px 22px;border-top:1px solid var(--border);background:#fff;display:flex;gap:10px;}
.aep-save{flex:1;padding:11px;border-radius:var(--r3);border:none;background:var(--accent);color:#fff;font-family:var(--font);font-size:13px;font-weight:700;cursor:pointer;}
.aep-save:hover{background:var(--accent2);}
.aep-del{padding:11px 18px;border-radius:var(--r3);border:1px solid var(--border);background:#fff;color:var(--red);font-family:var(--font);font-size:13px;font-weight:600;cursor:pointer;}
.aep-del:hover{background:#fef2f2;border-color:var(--red);}

@media (max-width:540px){
  .aep{width:100vw;}
  .aep-chooser-grid{grid-template-columns:1fr;}
}
`;
