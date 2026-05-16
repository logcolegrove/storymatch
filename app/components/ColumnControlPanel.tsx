"use client";

// ColumnControlPanel — Rippling-style column manager anchored under
// the "+ Add column" header cell in the library ListView.
//
// Two sections:
//   Shown in table   — visible columns in render order. Drag handles
//                      on the left, eye-icon hide on the right.
//                      Title is pinned (no handle, no hide).
//   Available        — built-in columns currently hidden + every
//                      custom field from the org's schema that
//                      isn't already shown. Click to add.
//
// A small "Manage fields →" link at the bottom punts to the Fields
// admin panel for actual field creation. Surfacing it here keeps the
// usage / creation surfaces separate: this panel is "which columns
// do I want visible right now", the Fields panel is "what fields
// exist on the data model at all."

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

type FieldType = "text" | "select" | "multi_select" | "number" | "date";
interface FieldDef {
  id: string;
  key: string;
  label: string;
  type: FieldType;
  options?: string[];
  showInFilters: boolean;
  position: number;
  system: boolean;
  systemColumn?: string;
}

interface BuiltInOption {
  key: string;
  label: string;
}

// Built-in columns admins can show/hide via this panel. "thumb" and
// "title" are pinned and never appear in here. "vis" / "status" /
// "date" can be toggled and reordered.
const BUILT_IN_TOGGLEABLE: BuiltInOption[] = [
  { key: "vis", label: "Visibility" },
  { key: "status", label: "Status" },
  { key: "date", label: "Date" },
];

interface Props {
  anchor: HTMLElement | null;
  fieldDefs: FieldDef[];
  columnOrder: string[];
  hidden: Set<string>;
  onClose: () => void;
  onChange: (nextOrder: string[], nextHidden: Set<string>) => void;
  onOpenFieldsPanel?: () => void;
}

export default function ColumnControlPanel({ anchor, fieldDefs, columnOrder, hidden, onClose, onChange, onOpenFieldsPanel }: Props) {
  // Position the panel under the anchor. Recompute on scroll/resize
  // so the panel stays attached even if the page shifts beneath it.
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  useEffect(() => {
    if (!anchor) return;
    const update = () => {
      const r = anchor.getBoundingClientRect();
      const panelWidth = 320;
      const margin = 8;
      const left = Math.max(margin, r.right - panelWidth);
      setPos({ top: r.bottom + 6, left });
    };
    update();
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [anchor]);

  // Close on Esc + outside-click. Capture phase so the trigger's own
  // click doesn't immediately reopen and re-close.
  const panelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (panelRef.current?.contains(t)) return;
      if (anchor && anchor.contains(t)) return;
      onClose();
    };
    window.addEventListener("keydown", onKey);
    // setTimeout so the click that opened us doesn't immediately
    // bubble to this listener and close the panel.
    const tm = setTimeout(() => document.addEventListener("mousedown", onDoc), 0);
    return () => {
      window.removeEventListener("keydown", onKey);
      clearTimeout(tm);
      document.removeEventListener("mousedown", onDoc);
    };
  }, [anchor, onClose]);

  const [search, setSearch] = useState("");

  // Resolve "Shown" — visible columns in their current display order,
  // including the pinned Title row at the top so admins see it's
  // present (even though it's locked). The pinned thumb row is
  // omitted — it's purely visual scaffolding, not a column anyone
  // thinks of conceptually.
  const builtInLabel = (key: string): string =>
    BUILT_IN_TOGGLEABLE.find(b => b.key === key)?.label
      || (key === "title" ? "Title" : key);
  const labelForKey = (key: string): string => {
    const def = fieldDefs.find(d => d.key === key);
    if (def) return def.label;
    return builtInLabel(key);
  };

  const shown = useMemo(() => {
    const out: { key: string; label: string; pinned: boolean }[] = [
      { key: "title", label: "Title", pinned: true },
    ];
    for (const key of columnOrder) {
      if (hidden.has(key)) continue;
      out.push({ key, label: labelForKey(key), pinned: false });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [columnOrder, hidden, fieldDefs]);

  // "Available" — built-in columns currently hidden OR not in the
  // order, plus every custom field NOT already shown. The available
  // list is search-filtered.
  const available = useMemo(() => {
    const shownKeys = new Set([
      "title",
      ...columnOrder.filter(k => !hidden.has(k)),
    ]);
    const out: { key: string; label: string; sublabel?: string }[] = [];
    // Built-ins not currently shown
    for (const b of BUILT_IN_TOGGLEABLE) {
      if (!shownKeys.has(b.key)) {
        out.push({ key: b.key, label: b.label, sublabel: "Built-in" });
      }
    }
    // Field-defined columns not currently shown
    for (const def of fieldDefs) {
      if (shownKeys.has(def.key)) continue;
      out.push({
        key: def.key,
        label: def.label,
        sublabel: def.system ? "System field" : "Custom field",
      });
    }
    const q = search.trim().toLowerCase();
    if (!q) return out;
    return out.filter(o => o.label.toLowerCase().includes(q));
  }, [columnOrder, hidden, fieldDefs, search]);

  // Show/hide handlers.
  const hideColumn = (key: string) => {
    if (key === "title" || key === "thumb") return; // pinned
    const next = new Set(hidden);
    next.add(key);
    onChange(columnOrder, next);
  };
  const showColumn = (key: string) => {
    const next = new Set(hidden);
    next.delete(key);
    // If the key isn't in columnOrder yet, append it (custom field
    // first time being added as a column).
    const nextOrder = columnOrder.includes(key)
      ? columnOrder
      : [...columnOrder, key];
    onChange(nextOrder, next);
  };

  // Pointer-driven drag-reorder inside the Shown section. Title is
  // pinned (index 0 in `shown` always) so its row gets no handle and
  // is excluded from the drag math.
  const [dragKey, setDragKey] = useState<string | null>(null);
  const [dragY, setDragY] = useState<number | null>(null);
  const rowRectsRef = useRef<Map<string, DOMRect>>(new Map());
  const listRef = useRef<HTMLDivElement>(null);

  const beginDrag = (key: string, e: React.PointerEvent) => {
    if (key === "title") return; // pinned
    e.preventDefault();
    e.stopPropagation();
    // Snapshot the current rects so we can compare pointer Y against
    // each row's midpoint during the drag.
    const map = new Map<string, DOMRect>();
    const rows = listRef.current?.querySelectorAll<HTMLElement>("[data-shown-key]");
    rows?.forEach(el => {
      const k = el.getAttribute("data-shown-key");
      if (k) map.set(k, el.getBoundingClientRect());
    });
    rowRectsRef.current = map;
    setDragKey(key);
    setDragY(e.clientY);
    const onMove = (ev: PointerEvent) => setDragY(ev.clientY);
    const onUp = () => {
      // Compute the drop target from the final pointer position.
      const finalY = (dragY ?? e.clientY);
      const rects = rowRectsRef.current;
      const reorderable = columnOrder.filter(k => !hidden.has(k));
      // Build a flat ordering of currently shown reorderable rows.
      const showing = reorderable;
      let targetIdx = showing.length - 1;
      for (let i = 0; i < showing.length; i++) {
        const r = rects.get(showing[i]);
        if (!r) continue;
        if (finalY < r.top + r.height / 2) { targetIdx = i; break; }
      }
      // Move dragKey to targetIdx within the reorderable subset.
      const fromIdx = showing.indexOf(key);
      if (fromIdx !== -1 && fromIdx !== targetIdx) {
        const next = [...showing];
        const [m] = next.splice(fromIdx, 1);
        next.splice(targetIdx, 0, m);
        // Merge back: keep hidden keys in their original positions,
        // overlay the new reorderable sequence. Simpler approach:
        // replace columnOrder with [next, ...hiddenKeys-from-old-order]
        const hiddenInOrder = columnOrder.filter(k => hidden.has(k));
        onChange([...next, ...hiddenInOrder], hidden);
      }
      setDragKey(null);
      setDragY(null);
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
    };
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
  };

  if (!anchor || !pos || typeof document === "undefined") return null;

  return createPortal(
    <div
      ref={panelRef}
      className="ccp"
      style={{ position: "fixed", top: pos.top, left: pos.left }}
      onClick={e => e.stopPropagation()}
      role="dialog"
      aria-label="Column control"
    >
      <style>{css}</style>

      <div className="ccp-head">
        <h3>Columns</h3>
        <button className="ccp-close" onClick={onClose} aria-label="Close">×</button>
      </div>

      <div className="ccp-search-wrap">
        <svg className="ccp-search-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="11" cy="11" r="8"/>
          <line x1="21" y1="21" x2="16.65" y2="16.65"/>
        </svg>
        <input
          className="ccp-search"
          placeholder="Search columns"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>

      <div className="ccp-section">
        <div className="ccp-section-h">Shown in table</div>
        <div className="ccp-list" ref={listRef}>
          {shown.map(row => {
            const isDragging = dragKey === row.key;
            return (
              <div
                key={row.key}
                data-shown-key={row.key}
                className={`ccp-row${row.pinned ? " pinned" : ""}${isDragging ? " dragging" : ""}`}
              >
                {row.pinned ? (
                  <span className="ccp-row-pin" title="Title is always shown"/>
                ) : (
                  <button
                    type="button"
                    className="ccp-row-grip"
                    onPointerDown={(e) => beginDrag(row.key, e)}
                    title="Drag to reorder"
                  >
                    <svg width="10" height="14" viewBox="0 0 10 14" fill="currentColor" aria-hidden="true">
                      <circle cx="2" cy="2" r="1.4"/><circle cx="2" cy="7" r="1.4"/><circle cx="2" cy="12" r="1.4"/>
                      <circle cx="8" cy="2" r="1.4"/><circle cx="8" cy="7" r="1.4"/><circle cx="8" cy="12" r="1.4"/>
                    </svg>
                  </button>
                )}
                <span className="ccp-row-label">{row.label}</span>
                {row.pinned ? (
                  <span className="ccp-row-locked" title="Always shown">Pinned</span>
                ) : (
                  <button
                    type="button"
                    className="ccp-row-hide"
                    onClick={() => hideColumn(row.key)}
                    title="Hide column"
                    aria-label={`Hide ${row.label}`}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M17.94 17.94A10.94 10.94 0 0 1 12 20c-7 0-10-8-10-8a18.45 18.45 0 0 1 5.06-5.94"/>
                      <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 10 8 10 8a18.5 18.5 0 0 1-2.16 3.19"/>
                      <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24"/>
                      <line x1="2" y1="2" x2="22" y2="22"/>
                    </svg>
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {available.length > 0 && (
        <div className="ccp-section">
          <div className="ccp-section-h">Available</div>
          <div className="ccp-list">
            {available.map(row => (
              <button
                key={row.key}
                type="button"
                className="ccp-row available"
                onClick={() => showColumn(row.key)}
                title={`Show ${row.label}`}
              >
                <span className="ccp-row-add">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="12" y1="5" x2="12" y2="19"/>
                    <line x1="5" y1="12" x2="19" y2="12"/>
                  </svg>
                </span>
                <span className="ccp-row-label">{row.label}</span>
                {row.sublabel && <span className="ccp-row-sub">{row.sublabel}</span>}
              </button>
            ))}
          </div>
        </div>
      )}

      {onOpenFieldsPanel && (
        <div className="ccp-foot">
          <button type="button" className="ccp-foot-link" onClick={() => { onOpenFieldsPanel(); onClose(); }}>
            Manage fields →
          </button>
        </div>
      )}
    </div>,
    document.body,
  );
}

const css = `
.ccp{width:320px;max-height:min(560px, calc(100vh - 80px));background:#fff;border:1px solid var(--border);border-radius:12px;box-shadow:0 20px 50px rgba(0,0,0,.16);z-index:1100;display:flex;flex-direction:column;font-family:var(--font);color:var(--t1);animation:ccpIn .12s ease;}
@keyframes ccpIn{from{opacity:0;transform:translateY(-4px);}to{opacity:1;transform:translateY(0);}}
.ccp-head{display:flex;align-items:center;padding:14px 16px 8px;}
.ccp-head h3{font-size:14px;font-weight:600;color:var(--t1);margin:0;letter-spacing:-.2px;}
.ccp-close{margin-left:auto;background:none;border:none;color:var(--t3);cursor:pointer;width:24px;height:24px;display:grid;place-items:center;font-size:18px;border-radius:4px;}
.ccp-close:hover{background:var(--bg2);color:var(--t1);}

.ccp-search-wrap{position:relative;padding:0 16px 10px;}
.ccp-search-icon{position:absolute;left:24px;top:50%;transform:translateY(calc(-50% - 5px));color:var(--t4);pointer-events:none;}
.ccp-search{width:100%;padding:7px 10px 7px 28px;border:1px solid var(--border);border-radius:7px;background:var(--bg);color:var(--t1);font-family:var(--font);font-size:12.5px;}
.ccp-search:focus{outline:none;border-color:var(--accent);background:#fff;}

.ccp-section{padding:6px 8px;overflow-y:auto;}
.ccp-section + .ccp-section{border-top:1px solid var(--border);}
.ccp-section-h{font-size:10px;text-transform:uppercase;letter-spacing:.5px;color:var(--t3);font-weight:700;padding:8px 10px 6px;}

.ccp-list{display:flex;flex-direction:column;gap:1px;}

.ccp-row{display:flex;align-items:center;gap:8px;padding:7px 10px;border-radius:6px;background:none;border:none;font-family:var(--font);font-size:13px;color:var(--t1);text-align:left;width:100%;cursor:default;}
.ccp-row:hover{background:var(--bg2);}
.ccp-row.dragging{opacity:.5;}
.ccp-row.available{cursor:pointer;}
.ccp-row-grip{width:18px;height:18px;display:grid;place-items:center;background:none;border:none;color:var(--t4);cursor:grab;padding:0;border-radius:3px;}
.ccp-row-grip:hover{color:var(--t1);background:var(--bg);}
.ccp-row-grip:active{cursor:grabbing;}
.ccp-row-pin{width:18px;height:18px;flex-shrink:0;}
.ccp-row-add{display:grid;place-items:center;width:18px;height:18px;border-radius:50%;background:var(--bg2);color:var(--t3);flex-shrink:0;}
.ccp-row.available:hover .ccp-row-add{background:var(--accentL);color:var(--accent);}
.ccp-row-label{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:500;}
.ccp-row-sub{font-size:10.5px;color:var(--t4);font-weight:600;text-transform:uppercase;letter-spacing:.4px;flex-shrink:0;}
.ccp-row-locked{font-size:10px;text-transform:uppercase;letter-spacing:.5px;color:var(--t4);font-weight:700;padding:2px 6px;background:var(--bg2);border-radius:4px;flex-shrink:0;}
.ccp-row-hide{background:none;border:none;color:var(--t4);cursor:pointer;width:24px;height:24px;display:grid;place-items:center;border-radius:5px;padding:0;flex-shrink:0;}
.ccp-row-hide:hover{color:var(--t1);background:var(--bg);}

.ccp-foot{padding:8px 14px 12px;border-top:1px solid var(--border);}
.ccp-foot-link{background:none;border:none;color:var(--accent);cursor:pointer;font-family:var(--font);font-size:12.5px;font-weight:600;padding:6px 8px;border-radius:5px;}
.ccp-foot-link:hover{background:var(--accentLL);}
`;
