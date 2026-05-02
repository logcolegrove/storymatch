"use client";

// Right-side slide-in drawer for editing a single asset. Four sections,
// no headers or dividers — just whitespace grouping by topic:
//   1. Basics: Title, Description, Client name + Company, Type
//   2. Filters: Vertical, Geography, Size
//   3. Pull quotes: numbered, reorderable callouts. "+ Add quote"
//      opens a chooser → From transcript / AI recommend / Manual entry.
//      "From transcript" doesn't show its own UI — it scrolls down to
//      the actual transcript and turns on a hand-holdy "highlight text
//      below" cue, leveraging the existing selection→quote mechanism.
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
  additionalClients?: { clientName: string; company: string }[];
  transcript: string;
  transcriptSegments?: { startSeconds: number; text: string }[];
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

type AddMode = "closed" | "chooser" | "ai" | "manual";
type AiState = "idle" | "loading" | "ready" | "error";

// Pointer-driven reorder state. Held in a single object on the drag
// state so updates batch cleanly via a single setDrag call.
type DragState = {
  fromIdx: number;
  pointerY: number;     // current viewport Y of pointer
  pointerX: number;     // current viewport X of pointer
  initialY: number;     // pointer Y when drag began
  initialX: number;     // pointer X when drag began
  rects: DOMRect[];     // captured at drag start, in original index order
  gap: number;          // px gap between items (read from .aep-quotes-list)
  width: number;        // floating clone width matches the original
};

// ── TranscriptExpandModal ───────────────────────────────────────────
// Near-fullscreen reader/editor for the transcript. Two view modes:
//   • Read mode (default when segments exist) — renders timestamped
//     segments as a vertical list, clickable to copy. Comfortable
//     prose typography, plenty of whitespace.
//   • Edit mode — a big resizable textarea with the same prose styling
//     so admins can fix typos. No segments here (timestamps are derived
//     from the source VTT and re-captured on next sync).
// Download button writes the plain transcript out as a .txt file.
function formatTimestamp(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${m}:${ss}`;
}

interface TranscriptExpandProps {
  transcript: string;
  segments: { startSeconds: number; text: string }[];
  headline: string;
  onChange: (next: string) => void;
  onAddQuote: (text: string) => void;
  onClose: () => void;
}
function TranscriptExpandModal({ transcript, segments, headline, onChange, onAddQuote, onClose }: TranscriptExpandProps) {
  const [mode, setMode] = useState<"read" | "edit">(segments.length > 0 ? "read" : "edit");
  // Selection state for the floating "Add selection as quote" button.
  // Read mode tracks DOM selection (window.getSelection on the segments
  // div); edit mode tracks the textarea's selectionStart/End. Both
  // resolve to a string in `selectedText`.
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const segmentsRef = useRef<HTMLDivElement>(null);
  const [selectedText, setSelectedText] = useState("");

  // Listen for selection changes globally; resolve based on current mode.
  useEffect(() => {
    const update = () => {
      if (mode === "read") {
        const sel = window.getSelection?.();
        if (!sel || sel.isCollapsed) { setSelectedText(""); return; }
        const text = sel.toString().trim();
        // Only count if selection is fully inside the segments view.
        const root = segmentsRef.current;
        if (!root) { setSelectedText(""); return; }
        // Anchor or focus must descend from segments root.
        const a = sel.anchorNode;
        const f = sel.focusNode;
        const inside = (n: Node | null) => n != null && root.contains(n);
        setSelectedText(inside(a) && inside(f) ? text : "");
      } else {
        const ta = editorRef.current;
        if (!ta) { setSelectedText(""); return; }
        const start = ta.selectionStart ?? 0;
        const end = ta.selectionEnd ?? 0;
        if (end > start) {
          setSelectedText(transcript.substring(start, end).trim());
        } else {
          setSelectedText("");
        }
      }
    };
    document.addEventListener("selectionchange", update);
    return () => document.removeEventListener("selectionchange", update);
  }, [mode, transcript]);
  // Reset selection when mode flips so the previous mode's selection
  // doesn't carry over to the new view.
  useEffect(() => { setSelectedText(""); }, [mode]);

  // Close on Escape
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const handleAddSelection = () => {
    if (!selectedText) return;
    onAddQuote(selectedText);
    // Clear native selection so the button hides cleanly after add.
    try { window.getSelection?.()?.removeAllRanges(); } catch {}
    setSelectedText("");
  };

  const downloadAsTxt = () => {
    const blob = new Blob([transcript], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const safe = (headline || "transcript").replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "-").slice(0, 60) || "transcript";
    a.href = url;
    a.download = `${safe}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <>
      <div className="aep-tx-modal-backdrop" onClick={onClose}/>
      <div className="aep-tx-modal" role="dialog" aria-label="Transcript">
        <div className="aep-tx-modal-head">
          <div className="aep-tx-modal-title">
            <div className="aep-tx-modal-eyebrow">Transcript</div>
            <div className="aep-tx-modal-headline">{headline || "Untitled"}</div>
          </div>
          <div className="aep-tx-modal-actions">
            {/* Mode toggle — read vs. edit. Read mode is segments view
                when available; edit mode is a big editable textarea. */}
            {segments.length > 0 && (
              <div className="aep-tx-mode-switch">
                <button
                  type="button"
                  className={`aep-tx-mode${mode === "read" ? " on" : ""}`}
                  onClick={() => setMode("read")}
                >Read</button>
                <button
                  type="button"
                  className={`aep-tx-mode${mode === "edit" ? " on" : ""}`}
                  onClick={() => setMode("edit")}
                >Edit</button>
              </div>
            )}
            <button type="button" className="aep-tx-modal-btn" onClick={downloadAsTxt} title="Download as plain text (.txt)">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                <polyline points="7 10 12 15 17 10"/>
                <line x1="12" y1="15" x2="12" y2="3"/>
              </svg>
              <span>Download .txt</span>
            </button>
            <button type="button" className="aep-tx-modal-close" onClick={onClose} title="Close (Esc)" aria-label="Close">×</button>
          </div>
        </div>
        <div className="aep-tx-modal-body">
          {mode === "read" && segments.length > 0 ? (
            <div className="aep-tx-segments" ref={segmentsRef}>
              {segments.map((seg, i) => (
                <div key={i} className="aep-tx-segment">
                  <div className="aep-tx-segment-time">{formatTimestamp(seg.startSeconds)}</div>
                  <div className="aep-tx-segment-text">{seg.text}</div>
                </div>
              ))}
            </div>
          ) : (
            <textarea
              ref={editorRef}
              className="aep-tx-modal-editor"
              value={transcript}
              onChange={e => onChange(e.target.value)}
              placeholder="Transcript text…"
              autoFocus
            />
          )}
          {/* Floating "Add selection as quote" — shows whenever admin
              has highlighted any text in the modal. Anchored to the
              bottom-right of the body so it doesn't fight with the
              user's selection or the scroll. */}
          {selectedText && (
            <button
              type="button"
              className="aep-tx-modal-add-selection"
              onMouseDown={(e) => e.preventDefault()}
              onClick={handleAddSelection}
            >
              <span className="aep-add-plus">+</span>
              <span>Add selection as quote</span>
            </button>
          )}
        </div>
      </div>
    </>
  );
}

// ── ClientList ──────────────────────────────────────────────────────
// List of {clientName, company} rows. First entry is the "primary"; drag
// to promote a different row. Pointer-driven reorder mirrors the quotes
// section so the two list patterns feel like the same component family.
// Visually flat — no per-row card chrome, just a small meta line above
// the inputs and whitespace between rows.
interface ClientRow { clientName: string; company: string }
type ClientDragState = {
  fromIdx: number;
  pointerY: number;
  pointerX: number;
  initialY: number;
  initialX: number;
  rects: DOMRect[];
  gap: number;
  width: number;
};
function ClientList({ clients, onChange }: { clients: ClientRow[]; onChange: (next: ClientRow[]) => void }) {
  const [drag, setDrag] = useState<ClientDragState | null>(null);
  const dragRef = useRef<ClientDragState | null>(null);
  useEffect(() => { dragRef.current = drag; }, [drag]);
  const itemRefs = useRef<(HTMLDivElement | null)[]>([]);
  const listRef = useRef<HTMLDivElement>(null);

  const computeInsertIdx = (state: ClientDragState): number => {
    const others = state.rects
      .map((r, i) => ({ i, mid: r.top + r.height / 2 }))
      .filter(o => o.i !== state.fromIdx);
    let slot = others.length;
    for (let k = 0; k < others.length; k++) {
      if (state.pointerY < others[k].mid) { slot = k; break; }
    }
    return slot;
  };

  // Keep the insert calculation memo-stable per render.
  const insertIdx = drag ? computeInsertIdx(drag) : null;

  // Mirror the quote-list pointer event wiring.
  useEffect(() => {
    if (!drag) return;
    const onMove = (e: PointerEvent) => {
      const cur = dragRef.current;
      if (!cur) return;
      setDrag({ ...cur, pointerY: e.clientY, pointerX: e.clientX });
    };
    const onUp = () => {
      const cur = dragRef.current;
      setDrag(null);
      if (!cur) return;
      const target = computeInsertIdx(cur);
      if (target !== cur.fromIdx) {
        const next = [...clients];
        const [moved] = next.splice(cur.fromIdx, 1);
        next.splice(target, 0, moved);
        onChange(next);
      }
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drag?.fromIdx, clients]);

  const itemOffsetY = (i: number): number => {
    if (!drag || insertIdx === null) return 0;
    if (i === drag.fromIdx) return 0;
    const draggedHeight = drag.rects[drag.fromIdx]?.height || 0;
    const shift = draggedHeight + drag.gap;
    if (insertIdx > drag.fromIdx) {
      if (i > drag.fromIdx && i <= insertIdx) return -shift;
    } else if (insertIdx < drag.fromIdx) {
      if (i >= insertIdx && i < drag.fromIdx) return shift;
    }
    return 0;
  };

  const cloneStyle = (): React.CSSProperties | undefined => {
    if (!drag) return undefined;
    const fromRect = drag.rects[drag.fromIdx];
    if (!fromRect) return undefined;
    const dx = drag.pointerX - drag.initialX;
    const dy = drag.pointerY - drag.initialY;
    return {
      position: "fixed",
      left: fromRect.left + dx,
      top: fromRect.top + dy,
      width: drag.width,
      pointerEvents: "none",
      zIndex: 200,
    };
  };

  const onPointerDownHandle = (i: number) => (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const list = listRef.current;
    if (!list) return;
    const rects = itemRefs.current.map(el => el?.getBoundingClientRect() || new DOMRect());
    const fromRect = rects[i];
    if (!fromRect) return;
    const gapStr = window.getComputedStyle(list).rowGap || "0";
    const gap = parseFloat(gapStr) || 0;
    setDrag({
      fromIdx: i,
      pointerY: e.clientY,
      pointerX: e.clientX,
      initialY: e.clientY,
      initialX: e.clientX,
      rects,
      gap,
      width: fromRect.width,
    });
  };

  const updateRow = (i: number, patch: Partial<ClientRow>) => {
    onChange(clients.map((c, idx) => idx === i ? { ...c, ...patch } : c));
  };
  const removeRow = (i: number) => {
    const next = clients.filter((_, idx) => idx !== i);
    // Always keep at least one row so admins have a place to type.
    onChange(next.length === 0 ? [{ clientName: "", company: "" }] : next);
  };
  const addRow = () => onChange([...clients, { clientName: "", company: "" }]);

  const showMeta = clients.length > 1;

  return (
    <>
      <div className="aep-client-list" ref={listRef}>
        {clients.map((c, i) => {
          const isDragging = drag?.fromIdx === i;
          const offset = itemOffsetY(i);
          return (
            <div
              key={i}
              ref={el => { itemRefs.current[i] = el; }}
              className={`aep-client-row${isDragging ? " dragging" : ""}`}
              style={{
                transform: offset !== 0 ? `translateY(${offset}px)` : undefined,
                transition: isDragging ? "none" : "transform .22s cubic-bezier(.2,.7,.2,1)",
                visibility: isDragging ? "hidden" : undefined,
              }}
            >
              {showMeta && (
                <div className="aep-client-meta">
                  <span
                    className="aep-drag-handle"
                    onPointerDown={onPointerDownHandle(i)}
                    title="Drag to reorder"
                    aria-label="Drag handle"
                  >⋮⋮</span>
                  <span className="aep-client-num">
                    {i === 0 ? "Primary" : `Client ${i + 1}`}
                  </span>
                  <button
                    type="button"
                    className="aep-quote-remove"
                    onClick={() => removeRow(i)}
                    title="Remove client"
                    aria-label="Remove client"
                  >×</button>
                </div>
              )}
              <div className="aep-client-fields">
                <div className="aep-fld"><label>Client name</label><input className="aep-in" value={c.clientName} onChange={e => updateRow(i, { clientName: e.target.value })}/></div>
                <div className="aep-fld"><label>Company</label><input className="aep-in" value={c.company} onChange={e => updateRow(i, { company: e.target.value })}/></div>
              </div>
            </div>
          );
        })}
        <button
          type="button"
          className="aep-add-quote"
          onClick={addRow}
        >
          <span className="aep-add-plus">+</span>
          <span>Add client</span>
        </button>
      </div>
      {/* Floating clone — same lifted-card visual as the quotes drag. */}
      {drag && clients[drag.fromIdx] && (
        <div className="aep-quote-clone" style={cloneStyle()}>
          <div className="aep-client-row aep-client-row-clone">
            <div className="aep-client-meta">
              <span className="aep-drag-handle">⋮⋮</span>
              <span className="aep-client-num">{drag.fromIdx === 0 ? "Primary" : `Client ${drag.fromIdx + 1}`}</span>
            </div>
            <div className="aep-client-fields">
              <div className="aep-fld"><label>Client name</label><div className="aep-in aep-client-clone-input">{clients[drag.fromIdx].clientName || "—"}</div></div>
              <div className="aep-fld"><label>Company</label><div className="aep-in aep-client-clone-input">{clients[drag.fromIdx].company || "—"}</div></div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export default function AssetEditPanel({ asset, onSave, onDelete, onPreview, onClose, authHeaders }: Props) {
  // ── Form state — unified quotes array is the source of truth in UI.
  const [headline, setHeadline] = useState("");
  const [description, setDescription] = useState("");
  // Client list — unified array (primary first, additional after).
  // Same UI pattern as quotes; on save we split index 0 → clientName +
  // company, rest → additionalClients. UI always operates on the array.
  const [clientList, setClientList] = useState<{ clientName: string; company: string }[]>([{ clientName: "", company: "" }]);
  const [assetType, setAssetType] = useState("Video Testimonial");
  const [vertical, setVertical] = useState("");
  const [geography, setGeography] = useState("");
  const [companySize, setCompanySize] = useState("");
  const [transcript, setTranscript] = useState("");
  const [transcriptSegments, setTranscriptSegments] = useState<{ startSeconds: number; text: string }[]>([]);
  const [transcriptExpanded, setTranscriptExpanded] = useState(false);
  const [quotes, setQuotes] = useState<string[]>([]);

  // Add-quote sub-flow state
  const [addMode, setAddMode] = useState<AddMode>("closed");
  const [manualDraft, setManualDraft] = useState("");
  const [aiState, setAiState] = useState<AiState>("idle");
  const [aiSuggestions, setAiSuggestions] = useState<string[]>([]);
  const [aiPicked, setAiPicked] = useState<Set<number>>(new Set());
  const [aiError, setAiError] = useState<string>("");

  // Pointer-driven reorder. We capture the dragged item's rect + all item
  // rects at drag start, render a floating clone that follows the pointer,
  // and visually shift the other items via CSS transform to indicate the
  // drop target. dragRef mirrors the drag state for event handlers that
  // need the latest value without going through setState's updater (which
  // would be a setState-in-setState anti-pattern).
  const [drag, setDrag] = useState<DragState | null>(null);
  const dragRef = useRef<DragState | null>(null);
  useEffect(() => { dragRef.current = drag; }, [drag]);
  const itemRefs = useRef<(HTMLDivElement | null)[]>([]);
  const listRef = useRef<HTMLDivElement>(null);

  // Pull-quotes section collapse state. When collapsed, the list +
  // chooser hide; the "Pull quotes" header still shows the count badge.
  const [quotesCollapsed, setQuotesCollapsed] = useState(false);

  // Auto-grow refs for each pull quote textarea so the block always
  // expands to fit the entire quote (no manual resize, no scroll inside
  // the block). Re-measure on quotes/value change.
  const quoteTextareas = useRef<(HTMLTextAreaElement | null)[]>([]);
  useEffect(() => {
    for (const ta of quoteTextareas.current) {
      if (!ta) continue;
      ta.style.height = "auto";
      ta.style.height = ta.scrollHeight + "px";
    }
  }, [quotes, quotesCollapsed]);

  // Transcript selection → quote affordance
  const transcriptRef = useRef<HTMLTextAreaElement>(null);
  const transcriptSectionRef = useRef<HTMLDivElement>(null);
  const [transcriptSel, setTranscriptSel] = useState<{ start: number; end: number }>({ start: 0, end: 0 });
  // "From transcript" mode — doesn't have its own UI block; instead we
  // scroll to the transcript section, light up a hand-holdy cue banner,
  // and pulse the textarea so admins instantly understand the move
  // (highlight text → click button). Stays on until admin dismisses.
  const [transcriptCue, setTranscriptCue] = useState(false);

  // Sync local state from the incoming asset. Combine pullQuote + additionalQuotes
  // into a single ordered array; first non-empty becomes index 0.
  useEffect(() => {
    if (!asset) return;
    setHeadline(asset.headline || "");
    setDescription(asset.description || "");
    // Combine primary + additional into one array. Always render at
    // least one row so the form has somewhere to type into when admin
    // opens an empty asset.
    const primary = { clientName: asset.clientName || "", company: asset.company || "" };
    const extras = Array.isArray(asset.additionalClients) ? asset.additionalClients.map(c => ({
      clientName: c.clientName || "",
      company: c.company || "",
    })) : [];
    setClientList([primary, ...extras]);
    setAssetType(asset.assetType || "Video Testimonial");
    setVertical(asset.vertical || "");
    setGeography(asset.geography || "");
    setCompanySize(asset.companySize || "");
    setTranscript(asset.transcript || "");
    setTranscriptSegments(Array.isArray(asset.transcriptSegments) ? asset.transcriptSegments : []);
    setTranscriptExpanded(false);
    const all = [asset.pullQuote || "", ...(asset.additionalQuotes || [])].filter(q => (q || "").trim().length > 0);
    setQuotes(all);
    // Reset all sub-flow state to a clean baseline whenever the target
    // asset swaps out (so the AI panel doesn't carry suggestions from
    // the previous asset, etc.).
    setAddMode("closed");
    setManualDraft("");
    setAiState("idle");
    setAiSuggestions([]);
    setAiPicked(new Set());
    setAiError("");
    setTranscriptSel({ start: 0, end: 0 });
    setDrag(null);
    setTranscriptCue(false);
    setQuotesCollapsed(false);
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

  // Compute the destination index given the pointer's current Y. Iterates
  // non-dragged items and finds the slot whose midpoint the pointer is
  // above. Defined as a function so the pointer-event effect (declared
  // here for hook-order safety, before the early return) can call it.
  const computeInsertIdxForDrag = (state: DragState): number => {
    const others = state.rects
      .map((r, i) => ({ i, mid: r.top + r.height / 2 }))
      .filter(o => o.i !== state.fromIdx);
    let slot = others.length;
    for (let k = 0; k < others.length; k++) {
      if (state.pointerY < others[k].mid) {
        slot = k;
        break;
      }
    }
    return slot;
  };

  // Wire window pointermove/up listeners while dragging. MUST be declared
  // before any conditional return — React's rule-of-hooks requires a
  // fixed hook count per render, so this hook can't sit below the
  // `if (!asset) return null` guard below.
  useEffect(() => {
    if (!drag) return;
    const onMove = (e: PointerEvent) => {
      const cur = dragRef.current;
      if (!cur) return;
      setDrag({ ...cur, pointerY: e.clientY, pointerX: e.clientX });
    };
    const onUp = () => {
      const current = dragRef.current;
      setDrag(null);
      if (!current) return;
      const target = computeInsertIdxForDrag(current);
      if (target !== current.fromIdx) {
        setQuotes(curr => {
          const next = [...curr];
          const [moved] = next.splice(current.fromIdx, 1);
          next.splice(target, 0, moved);
          return next;
        });
      }
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drag?.fromIdx]);

  if (!asset) return null;

  // ── Save / delete ──────────────────────────────────────────────────
  const save = () => {
    // Split unified quotes back into the DB shape: first → pullQuote,
    // rest → additionalQuotes. Trim whitespace; drop fully-empty entries.
    const cleaned = quotes.map(q => (q || "").trim()).filter(q => q.length > 0);
    const pullQuote = cleaned[0] || "";
    const additionalQuotes = cleaned.slice(1);
    // Same split for clients: first → primary clientName/company, rest
    // → additionalClients. Drop fully-empty rows so admin can leave a
    // half-typed row behind without persisting noise.
    const cleanClients = clientList
      .map(c => ({ clientName: (c.clientName || "").trim(), company: (c.company || "").trim() }))
      .filter(c => c.clientName.length > 0 || c.company.length > 0);
    const primaryClient = cleanClients[0] || { clientName: "", company: "" };
    const additionalClients = cleanClients.slice(1);
    onSave({
      ...asset,
      headline,
      description,
      clientName: primaryClient.clientName,
      company: primaryClient.company,
      additionalClients,
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
    const primaryName = (clientList[0]?.company || clientList[0]?.clientName || "");
    if (confirm(`Delete "${headline || primaryName || "this asset"}"? This can't be undone.`)) {
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

  const insertIdx = drag ? computeInsertIdxForDrag(drag) : null;

  const onPointerDownHandle = (i: number) => (e: React.PointerEvent) => {
    // Only start drag on primary button; don't preventDefault so text
    // selection elsewhere still works if pointer wasn't on the handle.
    if (e.button !== 0) return;
    e.preventDefault();
    const list = listRef.current;
    if (!list) return;
    const rects = itemRefs.current.map(el => el?.getBoundingClientRect() || new DOMRect());
    const fromRect = rects[i];
    if (!fromRect) return;
    // Read the gap from the computed style of the list — keeps the math
    // synced with whatever CSS gap value we use.
    const gapStr = window.getComputedStyle(list).rowGap || "0";
    const gap = parseFloat(gapStr) || 0;
    setDrag({
      fromIdx: i,
      pointerY: e.clientY,
      pointerX: e.clientX,
      initialY: e.clientY,
      initialX: e.clientX,
      rects,
      gap,
      width: fromRect.width,
    });
  };

  // Compute per-item Y offset to visually shift other items out of the
  // dragged item's way. Other items between the original and target
  // index slide up or down by (draggedHeight + gap).
  const itemOffsetY = (i: number): number => {
    if (!drag || insertIdx === null) return 0;
    if (i === drag.fromIdx) return 0;
    const draggedHeight = drag.rects[drag.fromIdx]?.height || 0;
    const shift = draggedHeight + drag.gap;
    if (insertIdx > drag.fromIdx) {
      // moving down — items between original (excl) and target (incl) shift up
      if (i > drag.fromIdx && i <= insertIdx) return -shift;
    } else if (insertIdx < drag.fromIdx) {
      // moving up — items between target (incl) and original (excl) shift down
      if (i >= insertIdx && i < drag.fromIdx) return shift;
    }
    return 0;
  };

  // Floating clone position — track the pointer relative to where the
  // drag began so the clone stays "stuck" to the spot the user grabbed.
  const cloneStyle = (): React.CSSProperties | undefined => {
    if (!drag) return undefined;
    const fromRect = drag.rects[drag.fromIdx];
    if (!fromRect) return undefined;
    const dx = drag.pointerX - drag.initialX;
    const dy = drag.pointerY - drag.initialY;
    return {
      position: "fixed",
      left: fromRect.left + dx,
      top: fromRect.top + dy,
      width: drag.width,
      pointerEvents: "none",
      zIndex: 200,
    };
  };

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
  const togglePicked = (set: Set<number>, setter: (s: Set<number>) => void, i: number) => {
    const next = new Set(set);
    if (next.has(i)) next.delete(i); else next.add(i);
    setter(next);
  };

  // "From transcript" — no separate panel; we just scroll the admin to
  // the transcript section and light up the hand-holdy cue. The existing
  // selection→quote button continues doing the actual work.
  const startTranscriptCue = () => {
    setAddMode("closed");
    setTranscriptCue(true);
    // Defer scroll one frame so the chooser collapse renders before the
    // page jumps — feels more natural than an instant snap.
    requestAnimationFrame(() => {
      transcriptSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      transcriptRef.current?.focus();
    });
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
              <div className="aep-sub">{headline || clientList[0]?.company || clientList[0]?.clientName || "—"}</div>
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
            <div className="aep-fld">
              <label>Asset type</label>
              <select className="aep-sel" value={assetType} onChange={e => setAssetType(e.target.value)}>
                {ASSET_TYPES.map(v => (<option key={v}>{v}</option>))}
              </select>
            </div>
            {/* Client/company multi-entry — primary by default; admins can
                add more for compilation videos and reorder so any entry
                can become primary. */}
            <ClientList
              clients={clientList}
              onChange={setClientList}
            />
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

          {/* ── 3. Pull quotes ── blog-style callouts (no nested cards). */}
          <div className="aep-section">
            <div className="aep-section-head-row">
              <button
                type="button"
                className="aep-section-toggle"
                onClick={() => setQuotesCollapsed(c => !c)}
                aria-expanded={!quotesCollapsed}
              >
                <span className={`aep-caret${quotesCollapsed ? " collapsed" : ""}`}>▾</span>
                <span className="aep-section-head">Pull quotes</span>
                {quotes.length > 0 && (
                  <span className="aep-section-count">{quotes.length}</span>
                )}
              </button>
            </div>

            {!quotesCollapsed && (
              <>
                {quotes.length === 0 && addMode === "closed" && (
                  <div className="aep-empty">No quotes yet. Add one to highlight on the asset's page.</div>
                )}

                {quotes.length > 0 && (
                  <div className="aep-quotes-list" ref={listRef}>
                    {quotes.map((q, i) => {
                      const isDragging = drag?.fromIdx === i;
                      const offset = itemOffsetY(i);
                      return (
                        <div
                          key={i}
                          ref={el => { itemRefs.current[i] = el; }}
                          className={`aep-quote-callout${isDragging ? " dragging" : ""}`}
                          style={{
                            transform: offset !== 0 ? `translateY(${offset}px)` : undefined,
                            // Items in motion get a smooth transition; the
                            // dragged item itself stays static (the floating
                            // clone handles the visual movement).
                            transition: isDragging ? "none" : "transform .22s cubic-bezier(.2,.7,.2,1)",
                            visibility: isDragging ? "hidden" : undefined,
                          }}
                        >
                          <div className="aep-quote-meta">
                            <span
                              className="aep-drag-handle"
                              onPointerDown={onPointerDownHandle(i)}
                              title="Drag to reorder"
                              aria-label="Drag handle"
                            >⋮⋮</span>
                            <span className="aep-quote-num">Quote {i + 1}</span>
                            <button
                              type="button"
                              className="aep-quote-remove"
                              onClick={() => removeQuote(i)}
                              title="Remove quote"
                              aria-label="Remove quote"
                            >×</button>
                          </div>
                          <textarea
                            ref={el => { quoteTextareas.current[i] = el; }}
                            className="aep-quote-text"
                            value={q}
                            onChange={e => updateQuote(i, e.target.value)}
                            placeholder="Type or paste a quote…"
                            rows={1}
                          />
                        </div>
                      );
                    })}
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
                    onClick={startTranscriptCue}
                    disabled={!transcript || transcript.trim().length === 0}
                    title={!transcript ? "No transcript to pick from" : ""}
                  >
                    <span className="aep-choice-icon">✎</span>
                    <span className="aep-choice-label">From transcript</span>
                    <span className="aep-choice-help">Highlight text below</span>
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
              </>
            )}
          </div>

          {/* ── 4. Transcript ── */}
          <div className="aep-section" ref={transcriptSectionRef}>
            <div className="aep-fld">
              <div className="aep-transcript-label-row">
                <label>Transcript</label>
                <button
                  type="button"
                  className="aep-transcript-expand"
                  onClick={() => setTranscriptExpanded(true)}
                  title="Open transcript in a larger reader"
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M15 3h6v6"/>
                    <path d="M9 21H3v-6"/>
                    <path d="M21 3l-7 7"/>
                    <path d="M3 21l7-7"/>
                  </svg>
                  <span>Expand</span>
                </button>
              </div>
              {/* Cue banner — appears when admin chose "From transcript"
                  in the quotes chooser. Pulses an animated highlight
                  inside a sample word so admins instantly understand:
                  use cursor to select text. Dismiss × on the right. */}
              {transcriptCue && (
                <div className="aep-cue">
                  <div className="aep-cue-msg">
                    <strong>Highlight any text below</strong> with your cursor —
                    your selection becomes a pull quote, like
                    {" "}<span className="aep-cue-demo">this</span>.
                  </div>
                  <button
                    type="button"
                    className="aep-cue-dismiss"
                    onClick={() => setTranscriptCue(false)}
                    aria-label="Dismiss"
                    title="Dismiss"
                  >×</button>
                </div>
              )}
              <textarea
                ref={transcriptRef}
                className={`aep-tx aep-transcript${transcriptCue ? " aep-tx-pulse" : ""}`}
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
        {/* Floating drag clone — rendered above everything via position
            fixed. Mirrors the dragged callout but with a subtle lift
            (shadow + slight scale + slight rotate) so it visually
            "detaches" from the list. Pointer-events: none so the real
            content beneath still receives the pointer events that drive
            the reorder math. */}
        {drag && quotes[drag.fromIdx] !== undefined && (
          <div className="aep-quote-clone" style={cloneStyle()}>
            <div className="aep-quote-callout aep-quote-callout-clone">
              <div className="aep-quote-meta">
                <span className="aep-drag-handle">⋮⋮</span>
                <span className="aep-quote-num">Quote {drag.fromIdx + 1}</span>
              </div>
              <div className="aep-quote-text aep-quote-text-clone">{quotes[drag.fromIdx]}</div>
            </div>
          </div>
        )}
        <div className="aep-foot">
          <button className="aep-save" onClick={save}>Save changes</button>
          <button className="aep-del" onClick={del}>Delete</button>
        </div>
      </aside>
      {/* Transcript expand-view — near-fullscreen reader/editor with
          larger typography, optional timestamped segments, and a
          download-as-plain-text button. Edits flow back to the
          transcript field on the panel. Segments are read-only since
          they're captured server-side from the source VTT. */}
      {transcriptExpanded && (
        <TranscriptExpandModal
          transcript={transcript}
          segments={transcriptSegments}
          headline={headline}
          onChange={setTranscript}
          onAddQuote={(text) => addQuotes([text])}
          onClose={() => setTranscriptExpanded(false)}
        />
      )}
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
/* Section header row with collapse caret. The whole row is a button so
   admins can click the header text or caret indifferently. */
.aep-section-head-row{display:flex;align-items:center;}
.aep-section-toggle{display:inline-flex;align-items:center;gap:8px;background:none;border:none;padding:2px 4px;margin-left:-4px;cursor:pointer;font-family:var(--font);border-radius:6px;}
.aep-section-toggle:hover{background:var(--bg2);}
.aep-caret{display:inline-block;color:var(--t3);font-size:11px;line-height:1;transition:transform .18s cubic-bezier(.2,.7,.2,1);}
.aep-caret.collapsed{transform:rotate(-90deg);}
.aep-section-count{display:inline-grid;place-items:center;min-width:20px;height:20px;padding:0 6px;border-radius:999px;background:var(--bg2);color:var(--t3);font-size:10.5px;font-weight:700;font-family:var(--font);}
.aep-empty{font-size:12px;color:var(--t4);font-style:italic;padding:6px 0;}
.aep-row{display:grid;grid-template-columns:1fr 1fr;gap:14px;}
.aep-fld{display:flex;flex-direction:column;gap:5px;min-width:0;}
.aep-fld label{font-size:10.5px;text-transform:uppercase;letter-spacing:.6px;color:var(--t3);font-weight:700;display:flex;align-items:center;gap:6px;}
.aep-in,.aep-sel,.aep-tx{font-family:var(--font);font-size:13px;padding:8px 10px;border:1px solid var(--border);border-radius:7px;background:#fff;color:var(--t1);width:100%;}
.aep-title-in{font-family:var(--serif);font-size:16px;font-weight:600;letter-spacing:-.2px;}
.aep-in:focus,.aep-sel:focus,.aep-tx:focus{outline:none;border-color:var(--accent);}
.aep-tx{min-height:120px;resize:vertical;line-height:1.5;}
/* Transcript label row — label on the left, expand button on the right. */
.aep-transcript-label-row{display:flex;align-items:center;justify-content:space-between;gap:10px;}
.aep-transcript-expand{display:inline-flex;align-items:center;gap:6px;background:none;border:1px solid var(--border);color:var(--t2);padding:5px 10px;border-radius:6px;font-family:var(--font);font-size:11.5px;font-weight:600;cursor:pointer;transition:all .12s;}
.aep-transcript-expand:hover{border-color:var(--accent);color:var(--accent);background:var(--accentLL);}

/* Transcript expand modal — near-fullscreen reader/editor. Sits above
   the panel via portal-like z-index. Read mode shows timestamped
   segments; edit mode replaces the segments with a big textarea. */
.aep-tx-modal-backdrop{position:fixed;inset:0;background:rgba(15,15,20,.55);backdrop-filter:blur(2px);z-index:200;animation:aepFade .2s ease-out;}
.aep-tx-modal{position:fixed;top:5vh;left:50%;transform:translateX(-50%);width:min(880px,92vw);height:90vh;background:#fff;border-radius:14px;box-shadow:0 32px 80px rgba(0,0,0,.3);z-index:201;display:flex;flex-direction:column;overflow:hidden;animation:aepTxModalIn .22s cubic-bezier(.2,.7,.2,1);font-family:var(--font);}
@keyframes aepTxModalIn{from{opacity:0;transform:translate(-50%,12px) scale(.985);}to{opacity:1;transform:translate(-50%,0) scale(1);}}
.aep-tx-modal-head{display:flex;align-items:center;justify-content:space-between;gap:14px;padding:18px 24px;border-bottom:1px solid var(--border);}
.aep-tx-modal-title{min-width:0;}
.aep-tx-modal-eyebrow{font-size:10.5px;text-transform:uppercase;letter-spacing:.6px;color:var(--t3);font-weight:700;}
.aep-tx-modal-headline{font-family:var(--serif);font-size:18px;font-weight:600;color:var(--t1);letter-spacing:-.2px;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.aep-tx-modal-actions{display:flex;align-items:center;gap:10px;flex-shrink:0;}
.aep-tx-mode-switch{display:inline-flex;border:1px solid var(--border);border-radius:7px;overflow:hidden;background:var(--bg);}
.aep-tx-mode{background:none;border:none;padding:6px 12px;font-family:var(--font);font-size:12px;font-weight:600;color:var(--t3);cursor:pointer;}
.aep-tx-mode:hover{color:var(--t1);}
.aep-tx-mode.on{background:#fff;color:var(--accent);box-shadow:inset 0 0 0 1px var(--accent);}
.aep-tx-modal-btn{display:inline-flex;align-items:center;gap:6px;border:1px solid var(--border);background:#fff;color:var(--t2);padding:6px 12px;border-radius:7px;font-family:var(--font);font-size:12px;font-weight:600;cursor:pointer;}
.aep-tx-modal-btn:hover{border-color:var(--accent);color:var(--accent);}
.aep-tx-modal-close{background:none;border:none;color:var(--t3);font-size:24px;line-height:1;padding:0 8px;cursor:pointer;border-radius:6px;}
.aep-tx-modal-close:hover{background:var(--bg2);color:var(--t1);}
.aep-tx-modal-body{flex:1;overflow-y:auto;background:#fbfaf6;position:relative;}
/* Floating "Add selection as quote" button inside the expand modal —
   docks to the bottom-right when admin has any text selected. Sticky
   feel without literally being position:sticky (modal scroll is on
   the body, not this button). */
.aep-tx-modal-add-selection{position:sticky;bottom:18px;left:auto;right:18px;float:right;display:inline-flex;align-items:center;gap:8px;background:var(--accent);color:#fff;border:none;padding:10px 16px;border-radius:999px;font-family:var(--font);font-size:13px;font-weight:600;cursor:pointer;box-shadow:0 8px 24px rgba(99,102,241,.32),0 2px 4px rgba(0,0,0,.08);transition:transform .12s,box-shadow .12s;margin:18px;}
.aep-tx-modal-add-selection:hover{transform:translateY(-1px);box-shadow:0 12px 28px rgba(99,102,241,.38),0 4px 6px rgba(0,0,0,.1);}
.aep-tx-modal-add-selection .aep-add-plus{background:#fff;color:var(--accent);}
/* Segments view — each entry has a sticky-feeling timestamp on the left
   and the cue text on the right. Generous line-height; serif body. */
.aep-tx-segments{max-width:760px;margin:0 auto;padding:36px 40px;display:flex;flex-direction:column;gap:18px;}
.aep-tx-segment{display:grid;grid-template-columns:72px 1fr;gap:18px;align-items:baseline;}
.aep-tx-segment-time{font-family:var(--font);font-variant-numeric:tabular-nums;font-size:12px;font-weight:600;color:var(--t4);letter-spacing:.02em;padding-top:5px;}
.aep-tx-segment-text{font-family:var(--serif);font-size:18px;line-height:1.7;color:var(--t1);user-select:text;}
.aep-tx-segment-text::selection{background:rgba(99,102,241,.22);}
/* Edit view — full-bleed textarea matching the segments typography. */
.aep-tx-modal-editor{width:100%;height:100%;border:none;background:#fbfaf6;font-family:var(--serif);font-size:17px;line-height:1.75;padding:36px 40px;color:var(--t1);resize:none;outline:none;}
.aep-tx-modal-editor::selection{background:rgba(99,102,241,.22);}

/* Transcript textarea — tuned for long-form reading. Serif typography,
   generous line-height, comfortable padding, off-white background to
   evoke a printed-page feel. No resize handle — the panel itself
   scrolls, so the textarea stays a fixed-height window into the prose. */
.aep-transcript{font-family:var(--serif);font-size:15px;line-height:1.75;padding:18px 22px;background:#fbfaf6;color:var(--t1);min-height:280px;resize:none;letter-spacing:.01em;}
.aep-transcript:focus{background:#fffefb;}
.aep-transcript::selection{background:rgba(99,102,241,.22);}

/* ── Pull-quote callouts ── blog-style. No nested cards: a soft accent
   bar on the left, italic serif text, and a quiet meta row that only
   shows on hover. The textarea is borderless and inherits the callout's
   look so the field reads like an actual pull quote, not a form input. */
/* padding-top reserves space for the floating opening-quote glyph
   above the first callout — without it, the list's overflow:auto
   clips the glyph since it floats above its parent. */
.aep-quotes-list{display:flex;flex-direction:column;gap:18px;max-height:50vh;overflow-y:auto;padding-right:6px;padding-top:10px;}
.aep-quote-callout{position:relative;border-left:3px solid var(--accent);padding:6px 8px 6px 18px;transition:opacity .12s,border-color .12s;}
.aep-quote-callout::before{content:"“";position:absolute;left:-2px;top:-12px;font-family:Georgia,"Times New Roman",serif;font-size:34px;line-height:1;color:var(--accent);opacity:.4;font-weight:700;pointer-events:none;}
.aep-quote-callout.dragging{opacity:.4;border-left-style:dashed;}
.aep-quote-meta{display:flex;align-items:center;gap:10px;font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--t4);margin-bottom:4px;opacity:.55;transition:opacity .15s;}
.aep-quote-callout:hover .aep-quote-meta,.aep-quote-callout:focus-within .aep-quote-meta{opacity:1;}
.aep-drag-handle{cursor:grab;color:var(--t4);font-size:13px;line-height:1;padding:2px 4px;border-radius:4px;letter-spacing:-2px;font-weight:700;user-select:none;}
.aep-drag-handle:hover{background:var(--bg2);color:var(--t2);}
.aep-drag-handle:active{cursor:grabbing;}
.aep-quote-num{color:var(--t3);}
.aep-quote-remove{margin-left:auto;background:none;border:none;color:var(--t4);cursor:pointer;font-size:18px;line-height:1;padding:2px 8px;border-radius:6px;}
.aep-quote-remove:hover{background:var(--bg2);color:var(--red);}
/* The actual quote textarea — no border, no bg, italic serif. Looks
   like a typeset pull quote; clicking inside reveals a subtle focus
   outline so admins know it's editable without the input chrome. */
/* Pull-quote text — distinct, readable editorial serif. Not italic
   (italic at this size hurts scannability for longer quotes). Slight
   letter-spacing tightening + comfortable line-height give it the
   typeset feel without hitting the wall of decorative italic.
   System-wide so chips/cards/etc. that show pull-quote text inherit
   this voice via the .aep-quote-text class. */
.aep-quote-text{width:100%;border:none;background:transparent;padding:6px 0;font-family:Georgia,Charter,"Source Serif Pro",Cambria,"Times New Roman",serif;font-weight:500;font-style:normal;font-size:18px;line-height:1.55;letter-spacing:-.005em;color:var(--t1);resize:none;overflow:hidden;min-height:32px;outline:none;}
.aep-quote-text:focus{background:var(--bg2);border-radius:5px;padding:6px 8px;}
.aep-quote-text::placeholder{color:var(--t4);font-style:normal;}

/* Client/company multi-row list. Visually flat — no per-row card,
   just whitespace between rows. The drag-handle/number/× meta row
   appears only when there are 2+ rows (single-client case is just two
   inputs, no chrome). */
.aep-client-list{display:flex;flex-direction:column;gap:18px;}
.aep-client-row{display:flex;flex-direction:column;gap:6px;}
.aep-client-meta{display:flex;align-items:center;gap:10px;font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--t4);opacity:.65;transition:opacity .15s;}
.aep-client-row:hover .aep-client-meta,.aep-client-row:focus-within .aep-client-meta{opacity:1;}
.aep-client-num{color:var(--t3);}
.aep-client-fields{display:grid;grid-template-columns:1fr 1fr;gap:14px;}
/* Drag-clone of a client row — boxed (since the original is unboxed)
   so the lifted-card metaphor still reads. */
.aep-client-row-clone{padding:10px 12px;border:1px solid var(--border);border-radius:9px;background:#fff;}
.aep-client-clone-input{display:flex;align-items:center;background:var(--bg);color:var(--t1);min-height:34px;}

/* Floating drag clone — appears at the cursor while dragging. The
   tilt + shadow give the "lifted card" feel. Pointer-events:none lets
   real items underneath still receive pointer events for the math. */
.aep-quote-clone{transform:rotate(-1.5deg) scale(1.02);transition:transform .12s cubic-bezier(.2,.7,.2,1);filter:drop-shadow(0 12px 24px rgba(0,0,0,.18)) drop-shadow(0 4px 8px rgba(0,0,0,.08));}
.aep-quote-callout-clone{background:#fff;border:1px solid var(--border);border-left:3px solid var(--accent);border-radius:9px;padding:10px 14px 10px 18px;}
.aep-quote-text-clone{font-family:Georgia,Charter,"Source Serif Pro",Cambria,"Times New Roman",serif;font-weight:500;font-size:18px;line-height:1.55;letter-spacing:-.005em;color:var(--t1);white-space:pre-wrap;}

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

/* Hand-holdy cue banner — appears above the transcript textarea when
   admin entered "From transcript" mode. Pulses an animated highlight on
   the demo word ("this") to teach the cursor-select gesture. */
.aep-cue{display:flex;align-items:flex-start;justify-content:space-between;gap:10px;padding:10px 12px;border:1px solid var(--accent);border-radius:8px;background:var(--accentLL);font-size:12.5px;line-height:1.5;color:var(--t1);margin-bottom:6px;}
.aep-cue strong{color:var(--accent);font-weight:700;}
.aep-cue-msg{flex:1;min-width:0;}
.aep-cue-demo{display:inline-block;padding:0 4px;border-radius:3px;font-family:var(--serif);font-style:italic;font-weight:600;color:var(--accent);animation:aepCueDemo 1.6s ease-in-out infinite;}
@keyframes aepCueDemo{
  0%,100%{background:rgba(99,102,241,.08);box-shadow:0 0 0 0 rgba(99,102,241,0);}
  50%{background:rgba(99,102,241,.32);box-shadow:0 0 0 2px rgba(99,102,241,.18);}
}
.aep-cue-dismiss{background:none;border:none;color:var(--accent);cursor:pointer;font-size:18px;line-height:1;padding:0 6px;border-radius:6px;flex-shrink:0;opacity:.7;transition:opacity .12s;}
.aep-cue-dismiss:hover{opacity:1;background:rgba(99,102,241,.12);}

/* Pulsing transcript textarea while cue is on — the second visual hook
   so admins know exactly where to act. Stops when cue is dismissed. */
.aep-tx.aep-tx-pulse{animation:aepTxPulse 1.8s ease-in-out infinite;}
@keyframes aepTxPulse{
  0%,100%{box-shadow:0 0 0 0 rgba(99,102,241,0);border-color:var(--border);}
  50%{box-shadow:0 0 0 4px rgba(99,102,241,.18);border-color:var(--accent);}
}

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
