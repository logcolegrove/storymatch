// StandaloneQuoteModal — admin-only modal to create a quote that
// isn't attached to a video or case study. Used for Trustpilot / G2
// / Google Reviews / LinkedIn / Capterra one-offs and manually-typed
// quotes that don't belong to any asset.
//
// On submit, POSTs to /api/quotes with kind='static'. On success the
// caller refreshes the featured-quotes list (in case the admin
// flipped Feature on while creating).

"use client";
import { useEffect, useRef, useState } from "react";

const STATIC_SOURCES = [
  { value: "manual", label: "Manual entry / no source" },
  { value: "trustpilot", label: "Trustpilot" },
  { value: "g2", label: "G2" },
  { value: "google", label: "Google Reviews" },
  { value: "capterra", label: "Capterra" },
  { value: "linkedin", label: "LinkedIn" },
  { value: "other", label: "Other" },
] as const;

type StaticSourceValue = typeof STATIC_SOURCES[number]["value"];

// Sources that meaningfully use a star rating. "manual" / "linkedin"
// / "other" don't, so we hide the star picker for those.
const RATED_SOURCES: ReadonlySet<StaticSourceValue> = new Set([
  "trustpilot", "g2", "google", "capterra",
]);

interface Props {
  authHeaders: () => Promise<HeadersInit> | HeadersInit;
  onClose: () => void;
  onCreated: () => void;
}

export default function StandaloneQuoteModal({ authHeaders, onClose, onCreated }: Props) {
  const [text, setText] = useState("");
  const [attrName, setAttrName] = useState("");
  const [attrTitle, setAttrTitle] = useState("");
  const [attrOrg, setAttrOrg] = useState("");
  const [staticSource, setStaticSource] = useState<StaticSourceValue>("manual");
  const [stars, setStars] = useState<number>(5);
  const [staticUrl, setStaticUrl] = useState("");
  const [featureNow, setFeatureNow] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState("");
  const textRef = useRef<HTMLTextAreaElement>(null);

  // Auto-grow the quote textarea so longer pastes don't get cramped.
  useEffect(() => {
    const el = textRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = el.scrollHeight + "px";
  }, [text]);

  // Close on ESC.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const showStars = RATED_SOURCES.has(staticSource);

  const submit = async () => {
    if (submitting) return;
    if (!text.trim()) { setErr("Quote text is required."); return; }
    setErr("");
    setSubmitting(true);
    try {
      const headers: HeadersInit = { "Content-Type": "application/json" };
      const auth = await authHeaders();
      Object.assign(headers as Record<string, string>, auth);
      const body = {
        text: text.trim(),
        attrName: attrName.trim() || undefined,
        attrTitle: attrTitle.trim() || undefined,
        attrOrg: attrOrg.trim() || undefined,
        staticSource,
        staticUrl: staticUrl.trim() || undefined,
        stars: showStars ? stars : undefined,
        isFeatured: featureNow,
      };
      const r = await fetch("/api/quotes", { method: "POST", headers, body: JSON.stringify(body) });
      if (!r.ok) {
        const e = await r.json().catch(() => ({}));
        throw new Error(e?.error || `Failed (${r.status})`);
      }
      onCreated();
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to save quote");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <style>{css}</style>
      <div className="sqm-backdrop" onClick={onClose}/>
      <div className="sqm" role="dialog" aria-label="Add standalone quote">
        <div className="sqm-head">
          <div>
            <div className="sqm-eyebrow">Standalone quote</div>
            <h3 className="sqm-title">Add a quote</h3>
          </div>
          <button type="button" className="sqm-close" onClick={onClose} title="Close (Esc)" aria-label="Close">×</button>
        </div>

        <div className="sqm-body">
          <label className="sqm-field">
            <span className="sqm-label">Quote</span>
            <textarea
              ref={textRef}
              className="sqm-textarea"
              value={text}
              onChange={e => setText(e.target.value)}
              placeholder="Paste or type the quote…"
              rows={3}
              autoFocus
            />
          </label>

          <div className="sqm-grid">
            <label className="sqm-field">
              <span className="sqm-label">Attribution name</span>
              <input className="sqm-input" value={attrName} onChange={e => setAttrName(e.target.value)} placeholder="e.g. Marcus Bell"/>
            </label>
            <label className="sqm-field">
              <span className="sqm-label">Title / role</span>
              <input className="sqm-input" value={attrTitle} onChange={e => setAttrTitle(e.target.value)} placeholder="e.g. Executive Director"/>
            </label>
            <label className="sqm-field sqm-field-wide">
              <span className="sqm-label">Organisation</span>
              <input className="sqm-input" value={attrOrg} onChange={e => setAttrOrg(e.target.value)} placeholder="e.g. Lakeside Community Foundation"/>
            </label>
          </div>

          <div className="sqm-grid">
            <label className="sqm-field">
              <span className="sqm-label">Source</span>
              <select className="sqm-input" value={staticSource} onChange={e => setStaticSource(e.target.value as StaticSourceValue)}>
                {STATIC_SOURCES.map(s => (
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
              </select>
            </label>
            {showStars && (
              <label className="sqm-field">
                <span className="sqm-label">Stars</span>
                <div className="sqm-stars" role="radiogroup" aria-label="Star rating">
                  {[1,2,3,4,5].map(n => (
                    <button
                      key={n}
                      type="button"
                      role="radio"
                      aria-checked={n === stars}
                      className={`sqm-star${n <= stars ? " on" : ""}`}
                      onClick={() => setStars(n)}
                      title={`${n} star${n > 1 ? "s" : ""}`}
                    >★</button>
                  ))}
                </div>
              </label>
            )}
            <label className="sqm-field sqm-field-wide">
              <span className="sqm-label">Source URL <span className="sqm-optional">(optional)</span></span>
              <input className="sqm-input" value={staticUrl} onChange={e => setStaticUrl(e.target.value)} placeholder="https://…"/>
            </label>
          </div>

          <label className="sqm-toggle">
            <input type="checkbox" checked={featureNow} onChange={e => setFeatureNow(e.target.checked)}/>
            <span>Feature in library rotation right away</span>
          </label>

          {err && <div className="sqm-error">{err}</div>}
        </div>

        <div className="sqm-foot">
          <button type="button" className="sqm-btn" onClick={onClose}>Cancel</button>
          <button type="button" className="sqm-btn primary" onClick={submit} disabled={submitting || !text.trim()}>
            {submitting ? "Saving…" : "Add quote"}
          </button>
        </div>
      </div>
    </>
  );
}

const css = `
.sqm-backdrop{position:fixed;inset:0;background:rgba(0,0,0,.4);z-index:200;animation:sqmFade .15s ease-out;}
@keyframes sqmFade{from{opacity:0;}to{opacity:1;}}
.sqm{position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);width:560px;max-width:calc(100vw - 32px);max-height:calc(100vh - 64px);overflow:auto;background:#fff;border-radius:14px;box-shadow:0 20px 60px rgba(0,0,0,.2);z-index:201;display:flex;flex-direction:column;font-family:var(--font);animation:sqmIn .2s cubic-bezier(.4,0,.2,1);}
@keyframes sqmIn{from{opacity:0;transform:translate(-50%,-46%);}to{opacity:1;transform:translate(-50%,-50%);}}
.sqm-head{display:flex;align-items:flex-start;justify-content:space-between;padding:22px 26px 14px;border-bottom:1px solid var(--border);}
.sqm-eyebrow{font-size:10.5px;letter-spacing:.08em;text-transform:uppercase;color:var(--t3);font-weight:600;margin-bottom:4px;}
.sqm-title{font-family:var(--serif);font-style:italic;font-size:24px;font-weight:400;letter-spacing:-.01em;color:var(--t1);margin:0;}
.sqm-close{background:none;border:none;font-size:22px;color:var(--t3);cursor:pointer;line-height:1;padding:2px 8px;border-radius:6px;}
.sqm-close:hover{background:var(--bg2);color:var(--t1);}

.sqm-body{padding:18px 26px;display:flex;flex-direction:column;gap:14px;}
.sqm-field{display:flex;flex-direction:column;gap:6px;}
.sqm-label{font-size:11px;font-weight:600;color:var(--t3);text-transform:uppercase;letter-spacing:.5px;}
.sqm-optional{font-weight:400;color:var(--t4);text-transform:none;letter-spacing:0;font-size:11px;}
.sqm-input{height:36px;padding:0 12px;border:1px solid var(--border);border-radius:8px;background:#fff;font-family:var(--font);font-size:13px;color:var(--t1);outline:none;transition:border-color .12s;}
.sqm-input:focus{border-color:var(--accent);}
select.sqm-input{cursor:pointer;}
.sqm-textarea{padding:10px 12px;border:1px solid var(--border);border-radius:8px;background:#fff;font-family:var(--serif);font-style:italic;font-size:15px;line-height:1.5;color:var(--t1);outline:none;resize:none;min-height:80px;transition:border-color .12s;}
.sqm-textarea:focus{border-color:var(--accent);}

.sqm-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;}
.sqm-field-wide{grid-column:1 / -1;}

.sqm-stars{display:flex;gap:2px;height:36px;align-items:center;}
.sqm-star{background:none;border:none;cursor:pointer;font-size:22px;color:var(--border2);padding:2px 4px;line-height:1;transition:color .12s;}
.sqm-star.on{color:#f59e0b;}
.sqm-star:hover{color:#d97706;}

.sqm-toggle{display:flex;align-items:center;gap:8px;font-size:13px;color:var(--t2);cursor:pointer;user-select:none;padding:6px 0;}
.sqm-toggle input{accent-color:var(--accent);width:16px;height:16px;}

.sqm-error{padding:10px 12px;background:#fef2f2;border:1px solid #fecaca;border-radius:8px;color:var(--red);font-size:13px;}

.sqm-foot{display:flex;justify-content:flex-end;gap:8px;padding:14px 26px 18px;border-top:1px solid var(--border);}
.sqm-btn{height:34px;padding:0 14px;border:1px solid var(--border);border-radius:8px;background:#fff;color:var(--t1);font-family:var(--font);font-size:13px;font-weight:500;cursor:pointer;transition:all .12s;}
.sqm-btn:hover:not(:disabled){border-color:var(--border2);}
.sqm-btn.primary{background:var(--accent);color:#fff;border-color:var(--accent);}
.sqm-btn.primary:hover:not(:disabled){background:var(--accent2);border-color:var(--accent2);}
.sqm-btn:disabled{opacity:.5;cursor:not-allowed;}
`;
