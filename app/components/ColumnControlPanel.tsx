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

// (Drag-reorder + hide controls moved into the table itself — admins
// click & drag column headers to reorder, and use each column
// header's dropdown menu to hide. This panel is now a focused
// "Add column" picker.)

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
  // Feedback is opt-in — admins add it when they want to see
  // 👍/👎 counts in the table. Clicking the cell opens the
  // comments modal. Not in the default layout.
  { key: "feedback", label: "Feedback" },
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

  // Show handler — adds the chosen column to the visible set. If the
  // key isn't in columnOrder yet (first time adding a custom field
  // as a column), it gets appended.
  const showColumn = (key: string) => {
    const next = new Set(hidden);
    next.delete(key);
    const nextOrder = columnOrder.includes(key)
      ? columnOrder
      : [...columnOrder, key];
    onChange(nextOrder, next);
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

      {/* "Shown in table" section was removed — reordering + hiding
          now happens in the table itself (drag column headers,
          dropdown menu's Hide option). This panel is just "add a
          column" — a flat list of everything that COULD be added. */}
      <div className="ccp-section">
        <div className="ccp-list">
          {available.length === 0 ? (
            <div className="ccp-empty">
              Every column is already in the table. To create new fields, click <span style={{whiteSpace:"nowrap"}}>Manage fields →</span>
            </div>
          ) : available.map(row => (
            <button
              key={row.key}
              type="button"
              className="ccp-row available"
              onClick={() => showColumn(row.key)}
              title={`Add ${row.label} column`}
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

      {onOpenFieldsPanel && (
        <div className="ccp-foot">
          <button type="button" className="ccp-foot-link" onClick={() => { onOpenFieldsPanel(); onClose(); }}>
            Manage all fields…
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

.ccp-section{padding:6px 8px;overflow-y:auto;flex:1;min-height:0;}
.ccp-list{display:flex;flex-direction:column;gap:1px;}
.ccp-empty{padding:18px 14px;font-size:12px;color:var(--t3);line-height:1.5;text-align:center;}

.ccp-row{display:flex;align-items:center;gap:8px;padding:7px 10px;border-radius:6px;background:none;border:none;font-family:var(--font);font-size:13px;color:var(--t1);text-align:left;width:100%;cursor:default;}
.ccp-row:hover{background:var(--bg2);}
.ccp-row.available{cursor:pointer;}
.ccp-row-add{display:grid;place-items:center;width:18px;height:18px;border-radius:50%;background:var(--bg2);color:var(--t3);flex-shrink:0;}
.ccp-row.available:hover .ccp-row-add{background:var(--accentL);color:var(--accent);}
.ccp-row-label{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:500;}
.ccp-row-sub{font-size:10.5px;color:var(--t4);font-weight:600;text-transform:uppercase;letter-spacing:.4px;flex-shrink:0;}

.ccp-foot{padding:8px 14px 12px;border-top:1px solid var(--border);}
.ccp-foot-link{background:none;border:none;color:var(--accent);cursor:pointer;font-family:var(--font);font-size:12.5px;font-weight:600;padding:6px 8px;border-radius:5px;}
.ccp-foot-link:hover{background:var(--accentLL);}
`;
