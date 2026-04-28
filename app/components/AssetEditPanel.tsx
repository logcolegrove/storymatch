"use client";

// Right-side slide-in drawer for editing a single asset. Replaces the old
// "Assets" panel in the admin rail — admins now click Edit on the 3-dot
// menu of any card or row to open this drawer.

import { useEffect, useState } from "react";

// We import the asset-shape from the parent file via a duplicate interface
// here. Keeps the panel decoupled from StoryMatchApp's full Asset type.
export interface EditableAsset {
  id: string;
  sourceId?: string | null;
  clientName: string;
  company: string;
  vertical: string;
  geography: string;
  companySize: string;
  challenge: string;
  outcome: string;
  assetType: string;
  videoUrl: string;
  status: string;
  dateCreated: string;
  headline: string;
  pullQuote: string;
  transcript: string;
  description: string;
  thumbnail: string;
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

  // Sync form state whenever the target asset changes. Coerce nulls to empty
  // strings so controlled inputs don't crash (Postgres returns null for
  // empty columns).
  useEffect(() => {
    if (!asset) { setForm(null); return; }
    setForm({
      ...asset,
      clientName: asset.clientName || "",
      company: asset.company || "",
      vertical: asset.vertical || "",
      geography: asset.geography || "",
      companySize: asset.companySize || "",
      challenge: asset.challenge || "",
      outcome: asset.outcome || "",
      assetType: asset.assetType || "Video Testimonial",
      videoUrl: asset.videoUrl || "",
      status: asset.status || "published",
      headline: asset.headline || "",
      pullQuote: asset.pullQuote || "",
      transcript: asset.transcript || "",
      description: asset.description || "",
      thumbnail: asset.thumbnail || "",
      dateCreated: asset.dateCreated || new Date().toISOString().split("T")[0],
    });
  }, [asset]);

  // Close on Escape
  useEffect(() => {
    if (!asset) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [asset, onClose]);

  if (!asset || !form) return null;

  const set = (k: keyof EditableAsset, v: string) => setForm(p => p ? { ...p, [k]: v } : p);
  const save = () => { onSave(form); };
  const del = () => { if (confirm(`Delete "${form.headline || form.company || "this asset"}"? This can't be undone.`)) onDelete(form.id); };

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
              <div className="aep-sub">{form.company || "—"}{form.vertical ? ` · ${form.vertical}` : ""}</div>
            </div>
          </div>
          {onPreview && (
            <button className="aep-preview" onClick={() => onPreview(form.id)}>Preview</button>
          )}
        </div>
        <div className="aep-body">
          <div className="aep-row">
            <div className="aep-fld"><label>Client Name *</label><input className="aep-in" value={form.clientName} onChange={e => set("clientName", e.target.value)}/></div>
            <div className="aep-fld"><label>Company *</label><input className="aep-in" value={form.company} onChange={e => set("company", e.target.value)}/></div>
          </div>
          <div className="aep-row">
            <div className="aep-fld"><label>Vertical</label><select className="aep-sel" value={form.vertical} onChange={e => set("vertical", e.target.value)}>{VERTICALS.map(v => (<option key={v}>{v}</option>))}</select></div>
            <div className="aep-fld"><label>Type</label><select className="aep-sel" value={form.assetType} onChange={e => set("assetType", e.target.value)}>{ASSET_TYPES.map(v => (<option key={v}>{v}</option>))}</select></div>
          </div>
          <div className="aep-row">
            <div className="aep-fld"><label>Geography</label><input className="aep-in" value={form.geography} onChange={e => set("geography", e.target.value)}/></div>
            <div className="aep-fld"><label>Size</label><input className="aep-in" value={form.companySize} onChange={e => set("companySize", e.target.value)}/></div>
          </div>
          <div className="aep-row">
            <div className="aep-fld"><label>Status</label><select className="aep-sel" value={form.status} onChange={e => set("status", e.target.value)}><option value="published">Published</option><option value="draft">Draft</option><option value="archived">Archived</option></select></div>
            <div className="aep-fld"><label>Challenge</label><input className="aep-in" value={form.challenge} onChange={e => set("challenge", e.target.value)}/></div>
          </div>
          <div className="aep-fld"><label>Headline</label><input className="aep-in" value={form.headline} onChange={e => set("headline", e.target.value)}/></div>
          <div className="aep-fld"><label>Outcome</label><input className="aep-in" value={form.outcome} onChange={e => set("outcome", e.target.value)}/></div>
          <div className="aep-fld"><label>Pull Quote</label><textarea className="aep-tx" style={{ minHeight: 60 }} value={form.pullQuote} onChange={e => set("pullQuote", e.target.value)}/></div>
          <div className="aep-fld"><label>Video URL</label><input className="aep-in" value={form.videoUrl} onChange={e => set("videoUrl", e.target.value)}/></div>
          <div className="aep-fld"><label>Thumbnail URL</label><input className="aep-in" value={form.thumbnail} onChange={e => set("thumbnail", e.target.value)} placeholder="Auto from Vimeo / YouTube"/></div>
          <div className="aep-fld"><label>Transcript / Content</label><textarea className="aep-tx" value={form.transcript} onChange={e => set("transcript", e.target.value)}/></div>
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

.aep-body{flex:1;overflow-y:auto;padding:18px 22px;display:flex;flex-direction:column;gap:14px;}
.aep-row{display:grid;grid-template-columns:1fr 1fr;gap:14px;}
.aep-fld{display:flex;flex-direction:column;gap:5px;min-width:0;}
.aep-fld label{font-size:10.5px;text-transform:uppercase;letter-spacing:.6px;color:var(--t3);font-weight:700;}
.aep-in,.aep-sel,.aep-tx{font-family:var(--font);font-size:13px;padding:8px 10px;border:1px solid var(--border);border-radius:7px;background:#fff;color:var(--t1);width:100%;}
.aep-in:focus,.aep-sel:focus,.aep-tx:focus{outline:none;border-color:var(--accent);}
.aep-tx{min-height:120px;resize:vertical;line-height:1.5;}

.aep-foot{padding:14px 22px;border-top:1px solid var(--border);background:#fff;display:flex;gap:10px;}
.aep-save{flex:1;padding:11px;border-radius:var(--r3);border:none;background:var(--accent);color:#fff;font-family:var(--font);font-size:13px;font-weight:700;cursor:pointer;}
.aep-save:hover{background:var(--accent2);}
.aep-del{padding:11px 18px;border-radius:var(--r3);border:1px solid var(--border);background:#fff;color:var(--red);font-family:var(--font);font-size:13px;font-weight:600;cursor:pointer;}
.aep-del:hover{background:#fef2f2;border-color:var(--red);}

@media (max-width:540px){
  .aep{width:100vw;}
}
`;
