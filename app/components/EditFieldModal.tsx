"use client";

// Per-field edit modal opened from the column header menu in
// ListView. Replaces the previous "navigate to the Fields admin
// panel" flow — admins can rename a field, change its type/options
// (custom fields only), toggle AI auto-fill, and flip showInFilters
// without leaving the table.
//
// Saves go through the same /api/org/fields PUT that the bulk
// FieldsPanel uses. We send the full array with this one field
// patched so server-side invariants stay enforced (system fields
// can't be deleted, key + systemColumn are immutable, etc).
//
// Vimeo-populated fields are read-mostly: only the label can be
// renamed. The schema is locked because the value source is Vimeo;
// any edit would silently revert on the next source sync.
//
// "AI auto-fill" mode: same modal, scrolled to / focused on the
// auto-fill section. Caller passes focus="ai" when opening from
// the dedicated menu item.

import { useEffect, useRef, useState } from "react";

type FieldType = "text" | "select" | "multi_select" | "number" | "date";
type FieldPopulator = "manual" | "vimeo" | "ai";

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
  populator: FieldPopulator;
  aiAutoFill: boolean;
}

interface Props {
  // The field being edited. Null = closed.
  field: FieldDef | null;
  // All fields in the org. Needed because PUT /api/org/fields takes
  // the full array — we patch the target field and send the rest
  // unchanged.
  allFields: FieldDef[];
  authHeaders: () => Promise<HeadersInit>;
  onClose: () => void;
  // Fired with the canonical (server-returned) schema after a
  // successful save so the caller can update its in-memory copy.
  onSaved: (fields: FieldDef[]) => void;
  onToast: (msg: string) => void;
  // Initial visual focus. "ai" scrolls to / outlines the AI
  // auto-fill section. "default" lands at the top of the form.
  focus?: "default" | "ai";
}

export default function EditFieldModal({ field, allFields, authHeaders, onClose, onSaved, onToast, focus = "default" }: Props) {
  // Form state — initialized from the field prop on every open so
  // stale edits don't bleed across asset selections.
  const [label, setLabel] = useState("");
  const [type, setType] = useState<FieldType>("text");
  const [options, setOptions] = useState<string[]>([]);
  const [newOption, setNewOption] = useState("");
  const [showInFilters, setShowInFilters] = useState(false);
  const [aiAutoFill, setAiAutoFill] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const aiSectionRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!field) return;
    setLabel(field.label);
    setType(field.type);
    setOptions(field.options ? [...field.options] : []);
    setShowInFilters(field.showInFilters);
    setAiAutoFill(field.aiAutoFill);
    setNewOption("");
    setError(null);
  }, [field]);

  // Scroll the AI section into view when opened from the dedicated
  // menu item. setTimeout ensures the modal has rendered first.
  useEffect(() => {
    if (!field || focus !== "ai") return;
    const t = setTimeout(() => {
      aiSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 80);
    return () => clearTimeout(t);
  }, [field, focus]);

  // Esc to close.
  useEffect(() => {
    if (!field) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [field, onClose]);

  if (!field) return null;

  const isVimeo = field.populator === "vimeo";
  const isCustom = !field.system;
  // The "type" + "options" sub-form is only editable for non-system
  // fields — system fields are tied to typed columns and can't have
  // their schema changed without a migration.
  const canEditType = isCustom;
  // AI auto-fill makes no sense for vimeo-populated fields. The
  // backend rejects this combination too, but we hide the toggle
  // proactively so admins don't try.
  const canEditAi = !isVimeo;
  const typeHasOptions = type === "select" || type === "multi_select";

  const addOption = () => {
    const next = newOption.trim();
    if (!next) return;
    if (options.some(o => o.toLowerCase() === next.toLowerCase())) {
      setError(`"${next}" is already an option`);
      return;
    }
    setOptions([...options, next]);
    setNewOption("");
    setError(null);
  };
  const removeOption = (idx: number) => {
    setOptions(options.filter((_, i) => i !== idx));
  };

  const handleSave = async () => {
    const trimmedLabel = label.trim();
    if (!trimmedLabel) {
      setError("Label can't be blank");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      // Patch the target field in-place inside the full array so
      // the server gets the canonical schema. Position stays the
      // same — we're not reordering here, that's a separate flow.
      const patched: FieldDef = {
        ...field,
        label: trimmedLabel,
        type: canEditType ? type : field.type,
        // Only carry options when the type supports them; otherwise
        // strip them so server validation doesn't reject a leftover
        // array on a non-select field.
        ...(canEditType && typeHasOptions
          ? { options }
          : canEditType
            ? { options: undefined }
            : {}),
        showInFilters,
        aiAutoFill: canEditAi ? aiAutoFill : field.aiAutoFill,
      };
      const nextFields = allFields.map(f => f.id === field.id ? patched : f);
      const r = await fetch("/api/org/fields", {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify({ fields: nextFields }),
      });
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        throw new Error(body.error || "Couldn't save field");
      }
      const data = await r.json() as { fields: FieldDef[] };
      onSaved(Array.isArray(data.fields) ? data.fields : nextFields);
      onToast("Field updated");
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
      setSaving(false);
    }
  };

  return (
    <div className="efm-backdrop" onClick={onClose}>
      <style>{css}</style>
      <div className="efm-modal" onClick={e => e.stopPropagation()}>
        <header className="efm-head">
          <div>
            <div className="efm-eyebrow">
              {isVimeo ? "Synced field" : field.system ? "System field" : "Custom field"}
            </div>
            <h3 className="efm-title">Edit field</h3>
          </div>
          <button className="efm-close" onClick={onClose} aria-label="Close" title="Close (Esc)">×</button>
        </header>

        <div className="efm-body">
          {/* Vimeo banner — explains why most controls are locked. */}
          {isVimeo && (
            <div className="efm-banner">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M23.97 6.62c-.1 2.18-1.63 5.17-4.58 8.97C16.34 19.55 13.77 21.5 11.7 21.5c-1.28 0-2.37-1.18-3.26-3.54L6.7 11.46c-.66-2.36-1.37-3.54-2.13-3.54-.16 0-.74.34-1.74 1.02L1.78 7.6c1.1-.96 2.18-1.93 3.25-2.9 1.47-1.26 2.57-1.92 3.31-1.99 1.74-.16 2.81 1.02 3.21 3.55.43 2.74.73 4.44.9 5.1.51 2.31 1.07 3.46 1.68 3.46.47 0 1.18-.74 2.13-2.22.94-1.48 1.45-2.6 1.52-3.38.14-1.36-.39-2.05-1.58-2.05-.56 0-1.14.13-1.73.39 1.16-3.79 3.36-5.62 6.61-5.5 2.41.07 3.54 1.62 3.4 4.66z"/>
              </svg>
              <div>
                <strong>Synced from Vimeo.</strong> Values update on every source sync — only the column label can be edited here.
              </div>
            </div>
          )}

          <div className="efm-field">
            <label className="efm-label">Label</label>
            <input
              type="text"
              className="efm-input"
              value={label}
              onChange={e => setLabel(e.target.value)}
              maxLength={60}
              placeholder="What this column shows"
              autoFocus={focus === "default"}
            />
            <p className="efm-hint">Shown in the column header and the filter panel.</p>
          </div>

          {canEditType && (
            <>
              <div className="efm-field">
                <label className="efm-label">Type</label>
                <select
                  className="efm-input"
                  value={type}
                  onChange={e => setType(e.target.value as FieldType)}
                >
                  <option value="text">Text</option>
                  <option value="select">Single select</option>
                  <option value="multi_select">Multi select</option>
                  <option value="number">Number</option>
                  <option value="date">Date</option>
                </select>
                <p className="efm-hint">Changing the type may strip incompatible values from existing assets.</p>
              </div>

              {typeHasOptions && (
                <div className="efm-field">
                  <label className="efm-label">Options</label>
                  <div className="efm-options">
                    {options.map((o, idx) => (
                      <span key={`${o}-${idx}`} className="efm-option">
                        {o}
                        <button
                          type="button"
                          className="efm-option-remove"
                          onClick={() => removeOption(idx)}
                          aria-label={`Remove ${o}`}
                          title="Remove"
                        >×</button>
                      </span>
                    ))}
                  </div>
                  <div className="efm-option-add">
                    <input
                      type="text"
                      className="efm-input"
                      value={newOption}
                      onChange={e => setNewOption(e.target.value)}
                      onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addOption(); } }}
                      placeholder="Add an option…"
                      maxLength={60}
                    />
                    <button type="button" className="efm-add-btn" onClick={addOption} disabled={!newOption.trim()}>Add</button>
                  </div>
                </div>
              )}
            </>
          )}

          <div className="efm-field efm-field-row">
            <div>
              <div className="efm-label">Show in filters</div>
              <p className="efm-hint">Whether this field appears as a filterable category in the Filters modal.</p>
            </div>
            <label className="efm-switch">
              <input
                type="checkbox"
                checked={showInFilters}
                onChange={e => setShowInFilters(e.target.checked)}
              />
              <span className="efm-switch-thumb"/>
            </label>
          </div>

          {canEditAi && (
            <div
              ref={aiSectionRef}
              className={`efm-field efm-field-row efm-ai${focus === "ai" ? " efm-ai-highlight" : ""}`}
            >
              <div>
                <div className="efm-label">
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ marginRight: 4, verticalAlign: "-1px" }}>
                    <path d="M12 2l1.7 5.3L19 9l-5.3 1.7L12 16l-1.7-5.3L5 9l5.3-1.7z"/>
                  </svg>
                  AI auto-fill
                </div>
                <p className="efm-hint">When on, Claude reads each asset’s transcript on import and fills this field if it’s empty. Existing values are never overwritten.</p>
              </div>
              <label className="efm-switch">
                <input
                  type="checkbox"
                  checked={aiAutoFill}
                  onChange={e => setAiAutoFill(e.target.checked)}
                />
                <span className="efm-switch-thumb"/>
              </label>
            </div>
          )}

          {error && <div className="efm-error">{error}</div>}
        </div>

        <footer className="efm-foot">
          <div style={{ flex: 1 }}/>
          <button className="efm-cancel" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="efm-save" onClick={handleSave} disabled={saving}>
            {saving ? "Saving…" : "Save changes"}
          </button>
        </footer>
      </div>
    </div>
  );
}

const css = `
.efm-backdrop{position:fixed;inset:0;background:rgba(20,20,28,.55);backdrop-filter:blur(2px);display:grid;place-items:center;z-index:220;animation:efmFade .15s ease;}
@keyframes efmFade{from{opacity:0}to{opacity:1}}
.efm-modal{width:520px;max-width:calc(100vw - 32px);max-height:calc(100vh - 64px);overflow:hidden;display:flex;flex-direction:column;background:#fff;border-radius:14px;box-shadow:0 20px 48px rgba(0,0,0,.22), 0 6px 16px rgba(0,0,0,.08);font-family:var(--font);color:var(--t1);animation:efmScale .18s cubic-bezier(.2,.7,.3,1);}
@keyframes efmScale{from{transform:scale(.96);opacity:0}to{transform:scale(1);opacity:1}}

.efm-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;padding:18px 20px 14px;border-bottom:1px solid var(--border);background:var(--bg);}
.efm-eyebrow{font-size:10.5px;text-transform:uppercase;letter-spacing:.5px;color:var(--t3);font-weight:700;}
.efm-title{font-family:var(--serif);font-size:18px;font-weight:600;color:var(--t1);margin:2px 0 0;letter-spacing:-.2px;}
.efm-close{background:none;border:none;color:var(--t3);font-size:22px;line-height:1;cursor:pointer;padding:0 4px;width:28px;height:28px;display:grid;place-items:center;border-radius:6px;}
.efm-close:hover{background:var(--bg2);color:var(--t1);}

.efm-body{padding:18px 20px;overflow-y:auto;display:flex;flex-direction:column;gap:16px;}

.efm-banner{display:flex;align-items:flex-start;gap:10px;padding:10px 12px;background:color-mix(in srgb, #1ab7ea 8%, transparent);border:1px solid color-mix(in srgb, #1ab7ea 22%, transparent);border-radius:8px;color:#0d6b8a;font-size:12.5px;line-height:1.45;}
.efm-banner svg{flex-shrink:0;margin-top:2px;color:#1ab7ea;}
.efm-banner strong{color:#0a577a;}

.efm-field{display:flex;flex-direction:column;gap:6px;}
.efm-field-row{flex-direction:row;align-items:center;justify-content:space-between;gap:14px;}
.efm-field-row > div:first-child{flex:1;min-width:0;}
.efm-label{font-size:11.5px;text-transform:uppercase;letter-spacing:.5px;color:var(--t3);font-weight:700;}
.efm-input{width:100%;padding:8px 11px;border:1px solid var(--border);border-radius:7px;background:var(--bg);color:var(--t1);font-family:var(--font);font-size:13px;}
.efm-input:focus{outline:none;border-color:var(--accent);background:#fff;}
.efm-hint{font-size:11.5px;color:var(--t3);margin:0;line-height:1.45;}

.efm-options{display:flex;flex-wrap:wrap;gap:6px;}
.efm-option{display:inline-flex;align-items:center;gap:4px;padding:3px 4px 3px 10px;border:1px solid var(--border);background:var(--bg);border-radius:99px;font-size:12px;color:var(--t1);}
.efm-option-remove{background:none;border:none;color:var(--t3);width:20px;height:20px;border-radius:50%;cursor:pointer;display:grid;place-items:center;font-size:14px;line-height:1;}
.efm-option-remove:hover{background:#fee2e2;color:#b91c1c;}
.efm-option-add{display:flex;gap:8px;margin-top:4px;}
.efm-option-add input{flex:1;}
.efm-add-btn{padding:8px 14px;border:1px solid var(--border);background:#fff;color:var(--t2);font-family:var(--font);font-size:12.5px;font-weight:600;border-radius:7px;cursor:pointer;}
.efm-add-btn:hover:not(:disabled){border-color:var(--border2);color:var(--t1);}
.efm-add-btn:disabled{opacity:.4;cursor:not-allowed;}

.efm-switch{position:relative;width:36px;height:20px;flex-shrink:0;cursor:pointer;}
.efm-switch input{position:absolute;opacity:0;width:0;height:0;}
.efm-switch-thumb{position:absolute;inset:0;background:var(--border2);border-radius:99px;transition:background .15s;}
.efm-switch-thumb::after{content:"";position:absolute;top:2px;left:2px;width:16px;height:16px;background:#fff;border-radius:50%;transition:transform .15s;box-shadow:0 1px 2px rgba(0,0,0,.2);}
.efm-switch input:checked + .efm-switch-thumb{background:var(--accent);}
.efm-switch input:checked + .efm-switch-thumb::after{transform:translateX(16px);}

.efm-ai{padding:12px;border:1px solid var(--border);border-radius:9px;background:var(--bg);transition:border-color .25s, background .25s;}
.efm-ai-highlight{border-color:var(--accent);background:color-mix(in srgb, var(--accent) 5%, transparent);}

.efm-error{font-size:12.5px;color:#b91c1c;background:#fef2f2;border:1px solid #fecaca;padding:8px 10px;border-radius:7px;}

.efm-foot{display:flex;align-items:center;gap:8px;padding:14px 20px;border-top:1px solid var(--border);background:var(--bg);}
.efm-cancel{padding:8px 14px;border:1px solid var(--border);border-radius:7px;background:#fff;color:var(--t2);font-family:var(--font);font-size:12.5px;font-weight:600;cursor:pointer;}
.efm-cancel:hover:not(:disabled){border-color:var(--border2);color:var(--t1);}
.efm-cancel:disabled{opacity:.4;cursor:not-allowed;}
.efm-save{padding:8px 18px;border:none;border-radius:7px;background:var(--accent);color:#fff;font-family:var(--font);font-size:12.5px;font-weight:600;cursor:pointer;}
.efm-save:hover:not(:disabled){filter:brightness(1.06);}
.efm-save:disabled{opacity:.4;cursor:not-allowed;}
`;
