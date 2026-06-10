"use client";

// Rippling-style filters modal. Three-column layout:
//   Left rail — clickable list of filterable categories.
//   Middle    — the active category's filter UI (checkbox list,
//               text input, or date range, depending on category).
//   Right     — every currently-applied filter, grouped by category,
//               rendered as removable pills.
// Footer is a sticky "Clear all" link + "Done" primary button.
//
// Categories come from three sources, in this order:
//   1. Built-in: Visibility, Status, Date — bound to the same
//      quick-filter state the column-header menus edit, so both
//      surfaces stay in lockstep.
//   2. Filterable FieldDefs of type select / multi_select — checkbox
//      list of the field's options.
//   3. Filterable FieldDefs of type text — "contains" search input
//      that does case-insensitive substring matching against the
//      asset's value.
//
// Changes apply live to the parent (no draft state, no Cancel).
// "Done" just closes — matches Rippling's behavior so the list view
// updates as you toggle.

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

// Field-driven filter state. For select/multi_select: array of
// selected option values. For text: single-element array with the
// search string. Empty array / missing key = no filter on that field.
type Filters = Record<string, string[]>;

// Built-in column-header quick-filter shapes — kept in sync with
// StoryMatchApp's types so both surfaces share state.
type VisibilityQuickValue = "published" | "draft" | "archived";
type StatusQuickValue = "cleared" | "attention" | "blocked" | "expired";
interface DateRangeFilter {
  from: string | null;
  to: string | null;
}

// Synthetic keys for the built-in categories so they share the same
// rail/active-key shape as the field categories. Leading underscores
// keep them out of any namespace collision with real field keys.
const VIS_KEY = "__vis__";
const STATUS_KEY = "__status__";
const DATE_KEY = "__date__";

const VIS_OPTIONS: { v: VisibilityQuickValue; label: string }[] = [
  { v: "published", label: "Public" },
  { v: "draft", label: "Private" },
  { v: "archived", label: "Archived" },
];
const STATUS_OPTIONS: { v: StatusQuickValue; label: string }[] = [
  { v: "cleared", label: "Cleared" },
  { v: "attention", label: "Needs attention" },
  { v: "blocked", label: "Blocked" },
  { v: "expired", label: "Expired" },
];

// Union of category shapes. Drives the middle-pane render branch and
// pill aggregation. "options" covers vis/status/select/multi_select
// (anything backed by a discrete option set); "text" is contains-
// matching; "daterange" is from/to inputs.
type Category =
  | { kind: "options"; key: string; label: string; options: string[]; source: "vis" | "status" | "field"; fieldDef?: FieldDef }
  | { kind: "text"; key: string; label: string; fieldDef: FieldDef }
  | { kind: "daterange"; key: string; label: string };

interface Props {
  open: boolean;
  fieldDefs: FieldDef[];
  filters: Filters;
  onFiltersChange: (next: Filters) => void;
  onClose: () => void;
  // Optional: pre-focus the modal on this category when it opens.
  // Accepts a field key OR one of the built-in keys (__vis__, etc.).
  initialActiveKey?: string | null;
  // Built-in filters mirrored from StoryMatchApp. These edit the same
  // state the per-column header inline menus edit so toggling here
  // and clicking the header chevron stay in lockstep.
  visibilityQuickFilter?: VisibilityQuickValue[];
  onVisibilityQuickFilter?: (next: VisibilityQuickValue[]) => void;
  statusQuickFilter?: StatusQuickValue[];
  onStatusQuickFilter?: (next: StatusQuickValue[]) => void;
  dateRangeFilter?: DateRangeFilter | null;
  onDateRangeFilter?: (next: DateRangeFilter | null) => void;
}

export default function FiltersModal({
  open,
  fieldDefs,
  filters,
  onFiltersChange,
  onClose,
  initialActiveKey,
  visibilityQuickFilter = [],
  onVisibilityQuickFilter,
  statusQuickFilter = [],
  onStatusQuickFilter,
  dateRangeFilter = null,
  onDateRangeFilter,
}: Props) {
  // Build the unified category list. Built-ins first (so they
  // always sit at the top of the rail), then field-defined ones in
  // FieldDef.position order.
  const categories = useMemo<Category[]>(() => {
    const out: Category[] = [];
    if (onVisibilityQuickFilter) out.push({ kind: "options", key: VIS_KEY, label: "Visibility", options: VIS_OPTIONS.map(o => o.label), source: "vis" });
    if (onStatusQuickFilter)     out.push({ kind: "options", key: STATUS_KEY, label: "Status", options: STATUS_OPTIONS.map(o => o.label), source: "status" });
    if (onDateRangeFilter)       out.push({ kind: "daterange", key: DATE_KEY, label: "Date" });
    const sorted = fieldDefs.filter(d => d.showInFilters).slice().sort((a, b) => a.position - b.position);
    for (const d of sorted) {
      if (d.type === "select" || d.type === "multi_select") {
        if (Array.isArray(d.options) && d.options.length > 0) {
          out.push({ kind: "options", key: d.key, label: d.label, options: d.options, source: "field", fieldDef: d });
        }
      } else if (d.type === "text") {
        out.push({ kind: "text", key: d.key, label: d.label, fieldDef: d });
      }
    }
    return out;
  }, [fieldDefs, onVisibilityQuickFilter, onStatusQuickFilter, onDateRangeFilter]);

  // Which category is showing in the middle column. Seeded from
  // initialActiveKey on every open so the column-header entry point
  // lands the admin on the right category. Falls back to the first
  // available category when the requested key isn't valid.
  const [activeKey, setActiveKey] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    const seed = initialActiveKey && categories.find(c => c.key === initialActiveKey)
      ? initialActiveKey
      : null;
    if (seed) {
      setActiveKey(seed);
      return;
    }
    if (!activeKey || !categories.find(c => c.key === activeKey)) {
      setActiveKey(categories[0]?.key || null);
    }
  }, [open, categories, activeKey, initialActiveKey]);

  // Search within the active "options" category's list (e.g. typing
  // "fin" to filter the options down to ones with "fin" in them).
  // Cleared on close + on category switch.
  const [search, setSearch] = useState("");
  useEffect(() => { if (!open) setSearch(""); }, [open]);

  // Esc to close.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const active = categories.find(c => c.key === activeKey) || null;

  // ── Selection helpers (per category source) ────────────────────
  // Reads + writes selection for a category, abstracting over the
  // different state buckets (built-in arrays vs. filters record).
  const getSelected = (c: Category): string[] => {
    if (c.kind === "options") {
      if (c.source === "vis") return visibilityQuickFilter.map(v => VIS_OPTIONS.find(o => o.v === v)?.label || v);
      if (c.source === "status") return statusQuickFilter.map(v => STATUS_OPTIONS.find(o => o.v === v)?.label || v);
      return filters[c.key] || [];
    }
    if (c.kind === "text") {
      const arr = filters[c.key] || [];
      return arr.length > 0 && arr[0] ? [arr[0]] : [];
    }
    if (c.kind === "daterange") {
      if (!dateRangeFilter) return [];
      const parts: string[] = [];
      if (dateRangeFilter.from) parts.push(`From ${dateRangeFilter.from}`);
      if (dateRangeFilter.to)   parts.push(`To ${dateRangeFilter.to}`);
      return parts;
    }
    return [];
  };

  const setOptions = (c: Category, nextLabels: string[]) => {
    if (c.kind !== "options") return;
    if (c.source === "vis" && onVisibilityQuickFilter) {
      const nextVals = nextLabels
        .map(lab => VIS_OPTIONS.find(o => o.label === lab)?.v)
        .filter((v): v is VisibilityQuickValue => !!v);
      onVisibilityQuickFilter(nextVals);
      return;
    }
    if (c.source === "status" && onStatusQuickFilter) {
      const nextVals = nextLabels
        .map(lab => STATUS_OPTIONS.find(o => o.label === lab)?.v)
        .filter((v): v is StatusQuickValue => !!v);
      onStatusQuickFilter(nextVals);
      return;
    }
    const out = { ...filters };
    if (nextLabels.length === 0) delete out[c.key];
    else out[c.key] = nextLabels;
    onFiltersChange(out);
  };

  const setText = (c: Category, value: string) => {
    if (c.kind !== "text") return;
    const out = { ...filters };
    const trimmed = value.trim();
    if (!trimmed) delete out[c.key];
    else out[c.key] = [trimmed];
    onFiltersChange(out);
  };

  const setRange = (next: DateRangeFilter | null) => {
    if (!onDateRangeFilter) return;
    if (next && !next.from && !next.to) onDateRangeFilter(null);
    else onDateRangeFilter(next);
  };

  // ── Active-category derived state ──────────────────────────────
  const activeSelected = active ? getSelected(active) : [];
  const activeOptionsList = active?.kind === "options" ? active.options : [];
  const filteredOptions = search.trim()
    ? activeOptionsList.filter(o => o.toLowerCase().includes(search.trim().toLowerCase()))
    : activeOptionsList;
  const allSelectedInActive = active?.kind === "options"
    && activeOptionsList.length > 0
    && filteredOptions.every(o => activeSelected.includes(o));

  const toggleOption = (c: Category, option: string) => {
    if (c.kind !== "options") return;
    const cur = getSelected(c);
    const next = cur.includes(option) ? cur.filter(x => x !== option) : [...cur, option];
    setOptions(c, next);
  };

  const toggleSelectAll = () => {
    if (!active || active.kind !== "options") return;
    if (allSelectedInActive) {
      const cur = getSelected(active);
      setOptions(active, cur.filter(v => !filteredOptions.includes(v)));
    } else {
      const cur = getSelected(active);
      setOptions(active, Array.from(new Set([...cur, ...filteredOptions])));
    }
  };

  const clearAll = () => {
    if (onVisibilityQuickFilter) onVisibilityQuickFilter([]);
    if (onStatusQuickFilter) onStatusQuickFilter([]);
    if (onDateRangeFilter) onDateRangeFilter(null);
    onFiltersChange({});
  };

  const removePill = (c: Category, value: string) => {
    if (c.kind === "options") {
      setOptions(c, getSelected(c).filter(v => v !== value));
      return;
    }
    if (c.kind === "text") {
      setText(c, "");
      return;
    }
    if (c.kind === "daterange" && dateRangeFilter) {
      // The value param is "From X" or "To Y"; we use it to know which
      // side to clear. Comparing against the rendered label keeps the
      // logic in one place.
      if (value.startsWith("From ")) setRange({ from: null, to: dateRangeFilter.to });
      else if (value.startsWith("To ")) setRange({ from: dateRangeFilter.from, to: null });
    }
  };

  // Total active filter count across all categories. Counts each
  // selected option, plus 1 per active text filter, plus 1 if a
  // date range is set. Drives the footer pill counter and the
  // global library-bar badge.
  const totalFilterCount = (() => {
    let n = 0;
    for (const c of categories) n += getSelected(c).length;
    return n;
  })();

  // Per-category grouping for the right rail.
  const grouped = categories
    .map(c => ({ category: c, values: getSelected(c) }))
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
            {categories.length === 0 ? (
              <div className="fm-rail-empty">
                No filterable fields yet. Toggle &ldquo;Show in filters&rdquo; on a field in Manage Fields.
              </div>
            ) : categories.map(c => {
              const count = getSelected(c).length;
              return (
                <button
                  key={c.key}
                  type="button"
                  className={`fm-rail-item${activeKey === c.key ? " active" : ""}`}
                  onClick={() => { setActiveKey(c.key); setSearch(""); }}
                >
                  <span className="fm-rail-label">{c.label}</span>
                  {count > 0 && <span className="fm-rail-count">{count}</span>}
                </button>
              );
            })}
          </aside>

          {/* Middle — UI for the active category. Branches on kind:
              options = checkbox list (with search + select-all),
              text = contains input, daterange = from/to inputs. */}
          <div className="fm-mid">
            {!active ? (
              <div className="fm-mid-empty">Pick a category on the left to start filtering.</div>
            ) : active.kind === "options" ? (
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
                          onClick={() => toggleOption(active, opt)}
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
            ) : active.kind === "text" ? (
              <div className="fm-text-card">
                <div className="fm-text-label">Contains</div>
                <input
                  type="text"
                  className="fm-text-input"
                  placeholder={`Search ${active.label.toLowerCase()}…`}
                  value={(filters[active.key] || [])[0] || ""}
                  onChange={e => setText(active, e.target.value)}
                  autoFocus
                />
                <p className="fm-text-hint">Case-insensitive substring match. An asset passes when its {active.label.toLowerCase()} contains this text anywhere.</p>
              </div>
            ) : (
              <div className="fm-date-card">
                <div className="fm-text-label">Custom range</div>
                <div className="fm-date-row">
                  <label>
                    <span>From</span>
                    <input
                      type="date"
                      value={dateRangeFilter?.from || ""}
                      onChange={e => setRange({ from: e.target.value || null, to: dateRangeFilter?.to || null })}
                    />
                  </label>
                  <label>
                    <span>To</span>
                    <input
                      type="date"
                      value={dateRangeFilter?.to || ""}
                      onChange={e => setRange({ from: dateRangeFilter?.from || null, to: e.target.value || null })}
                    />
                  </label>
                </div>
                <p className="fm-text-hint">Inclusive on both ends. Assets with no publish date are excluded when any range is active.</p>
              </div>
            )}
          </div>

          {/* Right — selected pills grouped by category. */}
          <aside className="fm-selected">
            <div className="fm-selected-h">Applied filters</div>
            {grouped.length === 0 ? (
              <div className="fm-selected-empty">Nothing selected yet.</div>
            ) : grouped.map(({ category, values }) => (
              <div key={category.key} className="fm-selected-group">
                <div className="fm-selected-group-label">{category.label}</div>
                <div className="fm-selected-pills">
                  {values.map((v, i) => (
                    <span key={`${category.key}-${v}-${i}`} className="fm-pill">
                      {category.kind === "text" ? `“${v}”` : v}
                      <button
                        type="button"
                        className="fm-pill-remove"
                        onClick={() => removePill(category, v)}
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

/* Text-filter card (contains-match) + date-range card. Both share
   the same visual chrome — a labeled card with the input(s) and a
   hint underneath explaining the match semantics. */
.fm-text-card,.fm-date-card{padding:18px 20px;border:1px solid var(--border);border-radius:10px;background:#fff;display:flex;flex-direction:column;gap:10px;}
.fm-text-label{font-size:11px;text-transform:uppercase;letter-spacing:.5px;color:var(--t3);font-weight:700;}
.fm-text-input{width:100%;padding:10px 12px;border:1px solid var(--border);border-radius:7px;background:var(--bg);color:var(--t1);font-family:var(--font);font-size:13.5px;}
.fm-text-input:focus{outline:none;border-color:var(--accent);background:#fff;}
.fm-text-hint{font-size:12px;color:var(--t3);margin:0;line-height:1.5;}
.fm-date-row{display:grid;grid-template-columns:1fr 1fr;gap:12px;}
.fm-date-row label{display:flex;flex-direction:column;gap:4px;font-size:11.5px;color:var(--t3);font-weight:600;}
.fm-date-row input[type=date]{padding:9px 11px;border:1px solid var(--border);border-radius:7px;background:var(--bg);color:var(--t1);font-family:var(--font);font-size:13px;}
.fm-date-row input[type=date]:focus{outline:none;border-color:var(--accent);background:#fff;}

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
.fm-foot{display:flex;align-items:center;padding:14px 20px;background:#fff;}
.fm-clear{background:none;border:none;color:var(--t3);font-family:var(--font);font-size:13px;font-weight:600;cursor:pointer;padding:6px 10px;border-radius:6px;}
.fm-clear:hover{background:var(--bg2);color:var(--t1);}
.fm-done{padding:9px 22px;border:none;border-radius:7px;background:var(--accent);color:#fff;font-family:var(--font);font-size:13px;font-weight:600;cursor:pointer;}
.fm-done:hover{filter:brightness(1.06);}
`;
