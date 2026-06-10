"use client";

// Rippling-style filters modal. Three-column layout:
//   Left rail — clickable list of filterable field categories.
//   Middle    — search box + "N selected / Select all" header + the
//               active field's option checkboxes.
//   Right     — every currently-selected value across all fields,
//               grouped by field, rendered as removable pills.
// Footer is a sticky "Clear all" link + "Done" primary button.
//
// Categories are driven entirely by /api/org/fields — any field with
// showInFilters && (type === "select" || "multi_select") shows up here
// automatically, in position order. No code change needed when admins
// add a new filterable field.
//
// Changes apply live to the parent (no draft state, no Cancel). Done
// just closes. This matches how Rippling's modal actually behaves —
// the underlying list updates as you toggle, so you see the impact
// without committing.

import { useEffect, useMemo, useState } from "react";

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

type Filters = Record<string, string[]>;

interface Props {
  open: boolean;
  fieldDefs: FieldDef[];
  filters: Filters;
  onFiltersChange: (next: Filters) => void;
  onClose: () => void;
  // Optional: pre-focus the modal on this field's category when it
  // opens. Used by the column-header "Filter…" menu item so the
  // admin lands directly on the field they clicked. Ignored when the
  // key isn't filterable (e.g. text fields aren't filterable here).
  initialActiveKey?: string | null;
}

export default function FiltersModal({ open, fieldDefs, filters, onFiltersChange, onClose, initialActiveKey }: Props) {
  // The list of categories shown in the left rail. Only select /
  // multi_select fields with options can be filtered through here.
  const filterable = useMemo(() => {
    return fieldDefs
      .filter(d => d.showInFilters && (d.type === "select" || d.type === "multi_select") && Array.isArray(d.options) && d.options.length > 0)
      .slice()
      .sort((a, b) => a.position - b.position);
  }, [fieldDefs]);

  // Which category is showing its options in the middle column.
  // Initial-active-key seeds this on every open so the column-header
  // entry point lands the admin on the right category. Falls back to
  // the first filterable field when the requested key isn't valid.
  const [activeKey, setActiveKey] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    const seed = initialActiveKey && filterable.find(f => f.key === initialActiveKey)
      ? initialActiveKey
      : null;
    if (seed) {
      setActiveKey(seed);
      return;
    }
    if (!activeKey || !filterable.find(f => f.key === activeKey)) {
      setActiveKey(filterable[0]?.key || null);
    }
  }, [open, filterable, activeKey, initialActiveKey]);

  const [search, setSearch] = useState("");
  useEffect(() => { if (!open) setSearch(""); }, [open]);

  // Close on Escape — common modal affordance.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const activeField = filterable.find(f => f.key === activeKey) || null;
  const activeOptions = activeField?.options || [];
  const activeSelected = activeField ? (filters[activeField.key] || []) : [];

  const filteredOptions = search.trim()
    ? activeOptions.filter(o => o.toLowerCase().includes(search.trim().toLowerCase()))
    : activeOptions;

  const totalFilterCount = Object.values(filters).reduce(
    (acc, v) => acc + (Array.isArray(v) ? v.length : 0),
    0,
  );
  const allSelectedInActive = activeField
    && activeOptions.length > 0
    && filteredOptions.every(o => activeSelected.includes(o));

  const toggleOption = (key: string, option: string) => {
    const cur = filters[key] || [];
    const next = cur.includes(option) ? cur.filter(x => x !== option) : [...cur, option];
    const out = { ...filters };
    if (next.length === 0) delete out[key];
    else out[key] = next;
    onFiltersChange(out);
  };

  const toggleSelectAll = () => {
    if (!activeField) return;
    if (allSelectedInActive) {
      // Deselect everything that matches the current search.
      const cur = filters[activeField.key] || [];
      const next = cur.filter(v => !filteredOptions.includes(v));
      const out = { ...filters };
      if (next.length === 0) delete out[activeField.key];
      else out[activeField.key] = next;
      onFiltersChange(out);
    } else {
      // Select every filtered option that's not already selected.
      const cur = filters[activeField.key] || [];
      const next = Array.from(new Set([...cur, ...filteredOptions]));
      onFiltersChange({ ...filters, [activeField.key]: next });
    }
  };

  const clearAll = () => onFiltersChange({});

  const removePill = (key: string, option: string) => {
    const cur = filters[key] || [];
    const next = cur.filter(x => x !== option);
    const out = { ...filters };
    if (next.length === 0) delete out[key];
    else out[key] = next;
    onFiltersChange(out);
  };

  // Per-field grouping for the right rail.
  const grouped = filterable
    .map(f => ({ field: f, values: filters[f.key] || [] }))
    .filter(g => g.values.length > 0);

  return (
    <div className="fm-backdrop" onClick={onClose}>
      <style>{css}</style>
      <div className="fm-modal" onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="fm-title">
        <div className="fm-head">
          <h2 className="fm-title" id="fm-title">Filters</h2>
          <button className="fm-close" onClick={onClose} aria-label="Close (Esc)">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"/>
              <line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        <div className="fm-body">
          {/* Left rail — categories. */}
          <aside className="fm-rail">
            <div className="fm-rail-h">Field filters</div>
            {filterable.length === 0 ? (
              <div className="fm-rail-empty">
                No filterable fields yet. Toggle &ldquo;Show in filters&rdquo; on a field in Manage Fields.
              </div>
            ) : filterable.map(f => {
              const count = (filters[f.key] || []).length;
              return (
                <button
                  key={f.id}
                  type="button"
                  className={`fm-rail-item${activeKey === f.key ? " active" : ""}`}
                  onClick={() => { setActiveKey(f.key); setSearch(""); }}
                >
                  <span className="fm-rail-label">{f.label}</span>
                  {count > 0 && <span className="fm-rail-count">{count}</span>}
                </button>
              );
            })}
          </aside>

          {/* Middle — search + options for the active category. */}
          <div className="fm-mid">
            {activeField ? (
              <>
                <div className="fm-search-wrap">
                  <svg className="fm-search-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="11" cy="11" r="8"/>
                    <line x1="21" y1="21" x2="16.65" y2="16.65"/>
                  </svg>
                  <input
                    className="fm-search"
                    placeholder="Search"
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                  />
                </div>

                <div className="fm-options-card">
                  <div className="fm-options-head">
                    <span className="fm-options-count">
                      {activeSelected.length > 0 ? `${activeSelected.length} selected` : "None selected"}
                    </span>
                    <button type="button" className="fm-select-all" onClick={toggleSelectAll}>
                      <span>{allSelectedInActive ? "Deselect all" : "Select all"}</span>
                      <span className={`fm-checkbox ${allSelectedInActive ? "all" : ""}`}>
                        {allSelectedInActive && (
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                            <line x1="5" y1="12" x2="19" y2="12"/>
                          </svg>
                        )}
                      </span>
                    </button>
                  </div>
                  <div className="fm-options-list">
                    {filteredOptions.length === 0 ? (
                      <div className="fm-options-empty">No matches.</div>
                    ) : filteredOptions.map(opt => {
                      const on = activeSelected.includes(opt);
                      return (
                        <button
                          key={opt}
                          type="button"
                          className={`fm-option ${on ? "on" : ""}`}
                          onClick={() => toggleOption(activeField.key, opt)}
                        >
                          <span className={`fm-checkbox ${on ? "on" : ""}`}>
                            {on && (
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                                <polyline points="20 6 9 17 4 12"/>
                              </svg>
                            )}
                          </span>
                          <span className="fm-option-label">{opt}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </>
            ) : (
              <div className="fm-mid-empty">Pick a field on the left to start filtering.</div>
            )}
          </div>

          {/* Right — selected pills grouped by field. */}
          <aside className="fm-selected">
            <div className="fm-selected-h">Selected filters</div>
            {grouped.length === 0 ? (
              <div className="fm-selected-empty">Nothing selected yet.</div>
            ) : grouped.map(({ field, values }) => (
              <div key={field.id} className="fm-selected-group">
                <div className="fm-selected-group-label">{field.label}</div>
                <div className="fm-selected-pills">
                  {values.map(v => (
                    <span key={v} className="fm-pill">
                      {v}
                      <button
                        type="button"
                        className="fm-pill-remove"
                        onClick={() => removePill(field.key, v)}
                        aria-label={`Remove ${v}`}
                      >×</button>
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </aside>
        </div>

        <div className="fm-foot">
          {totalFilterCount > 0 && (
            <button className="fm-clear" onClick={clearAll}>Clear all</button>
          )}
          <div style={{ flex: 1 }}/>
          <button className="fm-done" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
}

const css = `
.fm-backdrop{position:fixed;inset:0;background:rgba(20,20,25,.5);backdrop-filter:blur(2px);display:grid;place-items:center;z-index:200;animation:fmFade .15s ease;font-family:var(--font);color:var(--t1);}
@keyframes fmFade{from{opacity:0}to{opacity:1}}
.fm-modal{width:min(1100px, calc(100vw - 48px));height:min(640px, calc(100vh - 48px));background:#fff;border-radius:14px;box-shadow:0 24px 60px rgba(0,0,0,.22), 0 6px 16px rgba(0,0,0,.08);display:flex;flex-direction:column;overflow:hidden;animation:fmScale .18s cubic-bezier(.2,.7,.3,1);}
@keyframes fmScale{from{transform:scale(.98);opacity:0}to{transform:scale(1);opacity:1}}

.fm-head{display:flex;align-items:center;padding:16px 24px;border-bottom:1px solid var(--border);flex-shrink:0;}
.fm-title{font-family:var(--font);font-size:20px;font-weight:600;color:var(--t1);margin:0;letter-spacing:-.2px;}
.fm-close{margin-left:auto;background:none;border:none;color:var(--t3);cursor:pointer;display:grid;place-items:center;width:32px;height:32px;border-radius:6px;}
.fm-close:hover{background:var(--bg2);color:var(--t1);}

.fm-body{flex:1;display:grid;grid-template-columns:240px 1fr 280px;min-height:0;border-bottom:1px solid var(--border);}

/* Left rail — categories */
.fm-rail{border-right:1px solid var(--border);overflow-y:auto;padding:18px 16px;}
.fm-rail-h{font-size:10.5px;text-transform:uppercase;letter-spacing:.6px;color:var(--t3);font-weight:700;margin-bottom:12px;padding:0 8px;}
.fm-rail-empty{font-size:12px;color:var(--t3);padding:8px;line-height:1.5;}
.fm-rail-item{display:flex;align-items:center;width:100%;padding:9px 10px;border-radius:7px;background:none;border:none;cursor:pointer;font-family:var(--font);font-size:13.5px;color:var(--t2);text-align:left;transition:background .12s,color .12s;margin-bottom:2px;}
.fm-rail-item:hover{background:var(--bg2);color:var(--t1);}
.fm-rail-item.active{background:#F2EBF3;color:var(--accent);font-weight:600;}
.fm-rail-label{flex:1;}
.fm-rail-count{font-size:11px;color:var(--accent);background:#fff;border:1px solid var(--accent);border-radius:99px;padding:1px 7px;font-weight:700;font-variant-numeric:tabular-nums;}
.fm-rail-item:not(.active) .fm-rail-count{background:var(--accent);color:#fff;border-color:var(--accent);}

/* Middle column */
.fm-mid{display:flex;flex-direction:column;padding:18px 22px;min-width:0;overflow:hidden;}
.fm-mid-empty{color:var(--t3);font-size:13px;padding:24px;text-align:center;}
.fm-search-wrap{position:relative;margin-bottom:14px;}
.fm-search-icon{position:absolute;left:12px;top:50%;transform:translateY(-50%);color:var(--t4);pointer-events:none;}
.fm-search{width:100%;padding:9px 12px 9px 34px;border:1px solid var(--border);border-radius:8px;background:#fff;color:var(--t1);font-family:var(--font);font-size:13px;}
.fm-search:focus{outline:none;border-color:var(--accent);}

.fm-options-card{flex:1;display:flex;flex-direction:column;border:1px solid var(--border);border-radius:10px;overflow:hidden;min-height:0;}
.fm-options-head{display:flex;align-items:center;justify-content:space-between;padding:10px 14px;border-bottom:1px solid var(--border);background:var(--bg);}
.fm-options-count{font-size:12.5px;font-weight:600;color:var(--t1);}
.fm-select-all{display:inline-flex;align-items:center;gap:7px;background:none;border:none;cursor:pointer;color:var(--accent);font-family:var(--font);font-size:12.5px;font-weight:600;padding:4px;border-radius:5px;}
.fm-select-all:hover{background:var(--accentLL);}
.fm-options-list{flex:1;overflow-y:auto;padding:6px 0;}
.fm-options-empty{padding:24px;color:var(--t3);font-size:13px;text-align:center;}
.fm-option{display:flex;align-items:center;gap:10px;width:100%;padding:9px 14px;background:none;border:none;cursor:pointer;font-family:var(--font);font-size:13px;color:var(--t1);text-align:left;transition:background .1s;}
.fm-option:hover{background:var(--bg);}
.fm-option.on{color:var(--t1);}
.fm-option-label{flex:1;}

.fm-checkbox{display:inline-grid;place-items:center;width:18px;height:18px;border-radius:4px;border:1.5px solid var(--border2);background:#fff;color:#fff;flex-shrink:0;transition:all .12s;}
.fm-checkbox.on,.fm-checkbox.all{background:var(--accent);border-color:var(--accent);}

/* Right column — selected pills */
.fm-selected{border-left:1px solid var(--border);background:var(--bg);overflow-y:auto;padding:18px 18px;}
.fm-selected-h{font-size:13.5px;font-weight:600;color:var(--t1);margin-bottom:14px;}
.fm-selected-empty{font-size:12.5px;color:var(--t3);line-height:1.5;}
.fm-selected-group{margin-bottom:18px;}
.fm-selected-group-label{font-size:11px;text-transform:uppercase;letter-spacing:.5px;color:var(--t3);font-weight:700;margin-bottom:8px;}
.fm-selected-pills{display:flex;flex-direction:column;gap:6px;}
.fm-pill{display:inline-flex;align-items:center;gap:6px;padding:5px 6px 5px 12px;background:#fff;border:1px solid var(--border);border-radius:6px;font-size:12.5px;color:var(--t1);font-weight:500;}
.fm-pill-remove{background:none;border:none;color:var(--t4);cursor:pointer;width:18px;height:18px;display:grid;place-items:center;border-radius:3px;font-size:13px;line-height:1;padding:0;font-family:var(--font);}
.fm-pill-remove:hover{background:var(--bg2);color:var(--t1);}

/* Footer */
.fm-foot{display:flex;align-items:center;gap:10px;padding:14px 24px;background:#fff;flex-shrink:0;}
.fm-clear{background:none;border:none;color:var(--t3);font-family:var(--font);font-size:13px;font-weight:600;cursor:pointer;padding:8px 12px;border-radius:6px;}
.fm-clear:hover{background:var(--bg2);color:var(--t1);}
.fm-done{padding:9px 22px;border:none;border-radius:8px;background:var(--accent);color:#fff;font-family:var(--font);font-size:13.5px;font-weight:600;cursor:pointer;letter-spacing:-.005em;}
.fm-done:hover{background:var(--accent2);}
`;
