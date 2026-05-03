// FeaturedRotationPanel — admin curation modal for the hero rotator.
//
// Two stacked sections:
//   1. "In rotation" — currently featured quotes, in display order.
//      Each row: monogram, attribution, quote preview, ↑/↓ to
//      reorder, ✕ to remove from rotation.
//   2. "Available" — all the org's other quotes (asset-attached or
//      standalone) the admin could feature. Each row has an "Add to
//      rotation" button.
//
// Cap is 12 featured at a time. Trying to add the 13th surfaces an
// inline error rather than rejecting at the API.
//
// Saves are immediate per-row. The modal doesn't have a "Save"
// button — every action persists right away via PATCH /api/quotes
// /{id}, so the admin can just close the modal when done.

"use client";
import { useEffect, useMemo, useState } from "react";

interface QuoteRow {
  id: string;
  text: string;
  attrName: string | null;
  attrTitle: string | null;
  attrOrg: string | null;
  initialsOverride: string | null;
  kind: "video" | "case" | "static";
  assetId: string | null;
  isFeatured: boolean;
  featuredPosition: number | null;
  washToken: string | null;
}

interface Props {
  authHeaders: () => Promise<HeadersInit> | HeadersInit;
  onClose: () => void;
  onChanged: () => void; // called after any persist so the parent can refresh featured-quotes
}

const FEATURE_CAP = 12;

const WASH_NAMES = ["rose", "sage", "sand", "lavender", "cream", "mist"] as const;
const WASHES: Record<string, string> = {
  rose: "#f3e3d9", sage: "#e7ece1", sand: "#f1e8d2",
  lavender: "#ebe6ef", cream: "#f5efe2", mist: "#e6ecf0",
};

function initialsFor(q: QuoteRow): string {
  if (q.initialsOverride && q.initialsOverride.trim()) return q.initialsOverride.toUpperCase();
  const parts = (q.attrName || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "·";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function washForId(id: string, override: string | null): string {
  if (override && override in WASHES) return WASHES[override];
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return WASHES[WASH_NAMES[Math.abs(h) % WASH_NAMES.length]];
}

export default function FeaturedRotationPanel({ authHeaders, onClose, onChanged }: Props) {
  const [quotes, setQuotes] = useState<QuoteRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null); // quote id currently being persisted
  const [err, setErr] = useState("");

  // Fetch all org quotes on mount.
  useEffect(() => {
    (async () => {
      try {
        const headers = await authHeaders();
        const r = await fetch("/api/quotes", { headers });
        if (!r.ok) throw new Error("Failed to load quotes");
        const data = await r.json() as QuoteRow[];
        setQuotes(Array.isArray(data) ? data : []);
      } catch (e) {
        setErr(e instanceof Error ? e.message : "Failed to load quotes");
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Close on ESC.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const featured = useMemo(() => {
    return quotes
      .filter(q => q.isFeatured)
      .sort((a, b) => {
        const ap = a.featuredPosition ?? Number.MAX_SAFE_INTEGER;
        const bp = b.featuredPosition ?? Number.MAX_SAFE_INTEGER;
        return ap - bp;
      });
  }, [quotes]);

  const available = useMemo(() => {
    return quotes
      .filter(q => !q.isFeatured)
      .sort((a, b) => (a.attrName || "").localeCompare(b.attrName || ""));
  }, [quotes]);

  // Persist a single quote's curation fields.
  const persist = async (id: string, patch: { isFeatured?: boolean; featuredPosition?: number | null }) => {
    setBusy(id);
    setErr("");
    try {
      const headers: HeadersInit = { "Content-Type": "application/json" };
      const auth = await authHeaders();
      Object.assign(headers as Record<string, string>, auth);
      const r = await fetch(`/api/quotes/${id}`, {
        method: "PATCH",
        headers,
        body: JSON.stringify(patch),
      });
      if (!r.ok) {
        const e = await r.json().catch(() => ({}));
        throw new Error(e?.error || `Failed (${r.status})`);
      }
      onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Save failed");
      throw e;
    } finally {
      setBusy(null);
    }
  };

  // Local optimistic patch helper — mutates the quotes array so the
  // UI updates immediately. Caller wraps the persist call.
  const patchLocal = (id: string, patch: Partial<QuoteRow>) => {
    setQuotes(prev => prev.map(q => (q.id === id ? { ...q, ...patch } : q)));
  };

  const moveUp = async (i: number) => {
    if (i <= 0 || i >= featured.length) return;
    const a = featured[i], b = featured[i - 1];
    patchLocal(a.id, { featuredPosition: i - 1 });
    patchLocal(b.id, { featuredPosition: i });
    try {
      await Promise.all([
        persist(a.id, { featuredPosition: i - 1 }),
        persist(b.id, { featuredPosition: i }),
      ]);
    } catch { /* error already surfaced via setErr */ }
  };

  const moveDown = async (i: number) => {
    if (i < 0 || i >= featured.length - 1) return;
    const a = featured[i], b = featured[i + 1];
    patchLocal(a.id, { featuredPosition: i + 1 });
    patchLocal(b.id, { featuredPosition: i });
    try {
      await Promise.all([
        persist(a.id, { featuredPosition: i + 1 }),
        persist(b.id, { featuredPosition: i }),
      ]);
    } catch { /* */ }
  };

  const removeFromRotation = async (id: string) => {
    patchLocal(id, { isFeatured: false, featuredPosition: null });
    try { await persist(id, { isFeatured: false }); } catch { /* */ }
  };

  const addToRotation = async (id: string) => {
    if (featured.length >= FEATURE_CAP) {
      setErr(`Rotation is capped at ${FEATURE_CAP} quotes. Remove one before adding another.`);
      return;
    }
    const nextPos = featured.length;
    patchLocal(id, { isFeatured: true, featuredPosition: nextPos });
    try { await persist(id, { isFeatured: true, featuredPosition: nextPos }); } catch { /* */ }
  };

  return (
    <>
      <style>{css}</style>
      <div className="frp-backdrop" onClick={onClose}/>
      <div className="frp" role="dialog" aria-label="Manage featured rotation">
        <div className="frp-head">
          <div>
            <div className="frp-eyebrow">Featured rotation</div>
            <h3 className="frp-title">Manage which quotes rotate in the library</h3>
            <p className="frp-sub">{featured.length} of {FEATURE_CAP} slots used</p>
          </div>
          <button type="button" className="frp-close" onClick={onClose} title="Close (Esc)" aria-label="Close">×</button>
        </div>

        {err && <div className="frp-error">{err}</div>}

        <div className="frp-body">
          <div className="frp-section-title">In rotation ({featured.length})</div>
          {loading ? (
            <div className="frp-empty">Loading…</div>
          ) : featured.length === 0 ? (
            <div className="frp-empty">No quotes featured yet. Pick from "Available" below to start the rotation.</div>
          ) : (
            <ul className="frp-list">
              {featured.map((q, i) => (
                <li key={q.id} className={`frp-row${busy === q.id ? " frp-busy" : ""}`}>
                  <div className="frp-monogram" style={{ background: washForId(q.id, q.washToken) }}>
                    {initialsFor(q)}
                  </div>
                  <div className="frp-meta">
                    <div className="frp-name">{q.attrName || "—"}</div>
                    <div className="frp-org">{q.attrTitle ? `${q.attrTitle} · ` : ""}{q.attrOrg || ""}</div>
                    <div className="frp-text">"{q.text}"</div>
                  </div>
                  <div className="frp-actions">
                    <button type="button" className="frp-icon" onClick={() => moveUp(i)} disabled={i === 0 || busy != null} title="Move up">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><polyline points="18 15 12 9 6 15"/></svg>
                    </button>
                    <button type="button" className="frp-icon" onClick={() => moveDown(i)} disabled={i === featured.length - 1 || busy != null} title="Move down">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
                    </button>
                    <button type="button" className="frp-remove" onClick={() => removeFromRotation(q.id)} disabled={busy != null}>
                      Remove
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}

          <div className="frp-section-title frp-section-title-spaced">Available ({available.length})</div>
          {loading ? null : available.length === 0 ? (
            <div className="frp-empty">No more quotes to feature.</div>
          ) : (
            <ul className="frp-list">
              {available.map(q => (
                <li key={q.id} className={`frp-row${busy === q.id ? " frp-busy" : ""}`}>
                  <div className="frp-monogram frp-monogram-muted" style={{ background: washForId(q.id, q.washToken) }}>
                    {initialsFor(q)}
                  </div>
                  <div className="frp-meta">
                    <div className="frp-name">{q.attrName || "—"}</div>
                    <div className="frp-org">{q.attrTitle ? `${q.attrTitle} · ` : ""}{q.attrOrg || ""}</div>
                    <div className="frp-text">"{q.text}"</div>
                  </div>
                  <div className="frp-actions">
                    <button type="button" className="frp-add" onClick={() => addToRotation(q.id)} disabled={busy != null || featured.length >= FEATURE_CAP}>
                      Add to rotation
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="frp-foot">
          <button type="button" className="frp-btn primary" onClick={onClose}>Done</button>
        </div>
      </div>
    </>
  );
}

const css = `
.frp-backdrop{position:fixed;inset:0;background:rgba(0,0,0,.4);z-index:200;animation:frpFade .15s ease-out;}
@keyframes frpFade{from{opacity:0;}to{opacity:1;}}
.frp{position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);width:720px;max-width:calc(100vw - 32px);max-height:calc(100vh - 64px);background:#fff;border-radius:14px;box-shadow:0 20px 60px rgba(0,0,0,.2);z-index:201;display:flex;flex-direction:column;font-family:var(--font);animation:frpIn .2s cubic-bezier(.4,0,.2,1);}
@keyframes frpIn{from{opacity:0;transform:translate(-50%,-46%);}to{opacity:1;transform:translate(-50%,-50%);}}
.frp-head{display:flex;align-items:flex-start;justify-content:space-between;padding:22px 26px 14px;border-bottom:1px solid var(--border);}
.frp-eyebrow{font-size:10.5px;letter-spacing:.08em;text-transform:uppercase;color:var(--t3);font-weight:600;margin-bottom:4px;}
.frp-title{font-family:var(--serif);font-style:italic;font-size:22px;font-weight:400;letter-spacing:-.01em;color:var(--t1);margin:0 0 4px;}
.frp-sub{font-size:12.5px;color:var(--t3);margin:0;}
.frp-close{background:none;border:none;font-size:22px;color:var(--t3);cursor:pointer;line-height:1;padding:2px 8px;border-radius:6px;}
.frp-close:hover{background:var(--bg2);color:var(--t1);}

.frp-error{margin:0 26px 0;padding:10px 12px;background:#fef2f2;border:1px solid #fecaca;border-radius:8px;color:var(--red);font-size:13px;}

.frp-body{flex:1;overflow-y:auto;padding:14px 26px 8px;}

.frp-section-title{font-size:11px;font-weight:600;color:var(--t3);text-transform:uppercase;letter-spacing:.5px;margin:8px 0 10px;}
.frp-section-title-spaced{margin-top:24px;border-top:1px solid var(--border);padding-top:18px;}

.frp-empty{padding:18px 16px;text-align:center;color:var(--t3);font-size:13px;background:var(--bg);border:1px dashed var(--border2);border-radius:10px;}

.frp-list{list-style:none;padding:0;margin:0;display:flex;flex-direction:column;gap:6px;}
.frp-row{display:grid;grid-template-columns:42px 1fr auto;gap:12px;align-items:center;padding:10px 12px;border:1px solid var(--border);border-radius:10px;background:#fff;transition:border-color .12s,background .12s;}
.frp-row:hover{border-color:var(--border2);background:var(--bg);}
.frp-row.frp-busy{opacity:.6;}

.frp-monogram{width:42px;height:42px;border-radius:999px;display:grid;place-items:center;font-family:var(--serif);font-style:italic;font-weight:500;font-size:14px;color:var(--t1);}
.frp-monogram-muted{opacity:.7;}

.frp-meta{min-width:0;}
.frp-name{font-size:13px;font-weight:600;color:var(--t1);}
.frp-org{font-size:11.5px;color:var(--t3);margin-top:1px;}
.frp-text{font-family:var(--serif);font-style:italic;font-size:13px;color:var(--t2);margin-top:4px;line-height:1.45;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;}

.frp-actions{display:flex;align-items:center;gap:6px;}
.frp-icon{width:28px;height:28px;border:1px solid var(--border);border-radius:6px;background:#fff;color:var(--t2);cursor:pointer;display:grid;place-items:center;transition:all .12s;}
.frp-icon:hover:not(:disabled){border-color:var(--accent);color:var(--accent);}
.frp-icon:disabled{opacity:.3;cursor:not-allowed;}
.frp-remove{height:28px;padding:0 10px;border:1px solid var(--border);border-radius:6px;background:#fff;color:var(--t2);font-size:11.5px;font-weight:500;cursor:pointer;font-family:var(--font);transition:all .12s;}
.frp-remove:hover:not(:disabled){border-color:var(--red);color:var(--red);}
.frp-remove:disabled{opacity:.5;cursor:not-allowed;}
.frp-add{height:28px;padding:0 12px;border:1px solid var(--accent);border-radius:6px;background:var(--accent);color:#fff;font-size:11.5px;font-weight:500;cursor:pointer;font-family:var(--font);transition:all .12s;}
.frp-add:hover:not(:disabled){background:var(--accent2);border-color:var(--accent2);}
.frp-add:disabled{opacity:.5;cursor:not-allowed;}

.frp-foot{display:flex;justify-content:flex-end;gap:8px;padding:14px 26px 18px;border-top:1px solid var(--border);}
.frp-btn{height:34px;padding:0 14px;border:1px solid var(--border);border-radius:8px;background:#fff;color:var(--t1);font-family:var(--font);font-size:13px;font-weight:500;cursor:pointer;transition:all .12s;}
.frp-btn:hover{border-color:var(--border2);}
.frp-btn.primary{background:var(--accent);color:#fff;border-color:var(--accent);}
.frp-btn.primary:hover{background:var(--accent2);border-color:var(--accent2);}
`;
