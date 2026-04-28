"use client";

// Account/settings menu for the bottom of the admin rail. Rendered as an
// avatar circle that, when clicked, opens a popup with:
//   • the signed-in user's email + workspace + role (read-only header)
//   • Invite teammates  (admin only — opens InviteModal)
//   • Help              (placeholder for now)
//   • Send feedback     (placeholder for now)
//   • Sign out

import React, { useEffect, useRef, useState } from "react";

interface Props {
  userEmail: string;
  workspaceName: string;
  role: string;
  isAdmin: boolean;
  onSignOut: () => void;
  authHeaders: () => Promise<HeadersInit>;
}

// Build a 1-2 character avatar label from the user's email. "logan.colegrove@..."
// becomes "L"; "ada@..." becomes "A". Keep it deterministic and small.
function initialsFromEmail(email: string): string {
  if (!email) return "?";
  const local = email.split("@")[0] || email;
  const parts = local.split(/[._-]/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return (local[0] || "?").toUpperCase();
}

// Stable color per email so the same user always gets the same avatar color.
function colorFromEmail(email: string): string {
  // Tiny string hash → hue
  let h = 0;
  for (let i = 0; i < email.length; i++) h = (h * 31 + email.charCodeAt(i)) | 0;
  const hue = Math.abs(h) % 360;
  return `hsl(${hue}, 55%, 48%)`;
}

export default function AccountMenu({ userEmail, workspaceName, role, isAdmin, onSignOut, authHeaders }: Props) {
  const [open, setOpen] = useState(false);
  const [popPos, setPopPos] = useState<{ left: number; bottom: number } | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [teamOpen, setTeamOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);

  // Toggle the popup; on open, compute the fixed-position coordinates from the
  // trigger's bounding rect. This is required because the admin rail uses
  // overflow:auto, which would otherwise clip an absolutely-positioned child.
  const toggleOpen = () => {
    if (!open && triggerRef.current) {
      const r = triggerRef.current.getBoundingClientRect();
      setPopPos({
        left: r.left,
        bottom: window.innerHeight - r.top + 8, // 8px gap above the avatar
      });
    }
    setOpen(o => !o);
  };

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const target = e.target as Node;
      // Don't close on clicks inside the trigger OR the popup (both live in
      // different DOM trees because the popup is fixed-positioned).
      if (ref.current?.contains(target) || popRef.current?.contains(target)) return;
      setOpen(false);
    };
    const t = setTimeout(() => document.addEventListener("mousedown", onDoc), 0);
    return () => { clearTimeout(t); document.removeEventListener("mousedown", onDoc); };
  }, [open]);

  const initials = initialsFromEmail(userEmail);
  const color = colorFromEmail(userEmail);

  return (
    <>
      <style>{css}</style>
      <div className="am-wrap" ref={ref}>
        <button
          ref={triggerRef}
          className={`am-trigger${open ? " open" : ""}`}
          onClick={toggleOpen}
          title={`${userEmail} — Account & settings`}
        >
          <span className="am-avatar" style={{ background: color }}>{initials}</span>
        </button>
        {open && popPos && (
          <div className="am-pop" ref={popRef} style={{ left: popPos.left, bottom: popPos.bottom }}>
            <div className="am-pop-head">
              <span className="am-avatar lg" style={{ background: color }}>{initials}</span>
              <div className="am-pop-head-text">
                <div className="am-pop-email">{userEmail}</div>
                <div className="am-pop-meta">{workspaceName}{role ? ` · ${role}` : ""}</div>
              </div>
            </div>
            <div className="am-divider"/>
            {isAdmin && (
              <>
                <button className="am-item" onClick={() => { setOpen(false); setTeamOpen(true); }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>
                    <path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>
                  </svg>
                  Manage team
                </button>
                <button className="am-item" onClick={() => { setOpen(false); setInviteOpen(true); }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/>
                    <line x1="20" y1="8" x2="20" y2="14"/><line x1="23" y1="11" x2="17" y2="11"/>
                  </svg>
                  Invite teammates
                </button>
              </>
            )}
            <button className="am-item" onClick={() => { setOpen(false); setHelpOpen(true); }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/>
              </svg>
              Help & docs
            </button>
            <button className="am-item" onClick={() => { setOpen(false); setFeedbackOpen(true); }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
              </svg>
              Send feedback
            </button>
            <div className="am-divider"/>
            <button className="am-item danger" onClick={() => { setOpen(false); onSignOut(); }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>
              </svg>
              Sign out
            </button>
          </div>
        )}
      </div>

      {inviteOpen && <InviteModal authHeaders={authHeaders} onClose={() => setInviteOpen(false)}/>}
      {teamOpen && <TeamModal authHeaders={authHeaders} onClose={() => setTeamOpen(false)} onInvite={() => { setTeamOpen(false); setInviteOpen(true); }}/>}
      {helpOpen && <SimpleModal title="Help & docs" onClose={() => setHelpOpen(false)}>
        <p>Documentation isn&apos;t built out yet — for now, message Logan directly with questions or feature requests.</p>
        <p style={{ marginTop: 12 }}>Quick tips:</p>
        <ul style={{ marginTop: 6, paddingLeft: 18, lineHeight: 1.7 }}>
          <li>Use the <strong>StoryMatch</strong> button to find proof-points by describing a scenario.</li>
          <li>Click the chain-link icon on any card to copy a trackable share link.</li>
          <li>Open <strong>My shares</strong> in the header to see who watched what.</li>
        </ul>
      </SimpleModal>}
      {feedbackOpen && <FeedbackModal onClose={() => setFeedbackOpen(false)}/>}
    </>
  );
}

// ─── INVITE MODAL ──────────────────────────────────────────────────────────
function InviteModal({ authHeaders, onClose }: { authHeaders: () => Promise<HeadersInit>; onClose: () => void }) {
  const [role, setRole] = useState<"admin" | "sales">("sales");
  const [generating, setGenerating] = useState(false);
  const [link, setLink] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const generate = async () => {
    setGenerating(true);
    setError(null);
    try {
      const r = await fetch("/api/invites", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify({ role }),
      });
      if (!r.ok) throw new Error((await r.json()).error || "Failed to create invite");
      const body = await r.json() as { url: string; expires_at: string };
      setLink(body.url);
      setExpiresAt(body.expires_at);
    } catch (e) {
      setError((e as Error).message);
    }
    setGenerating(false);
  };

  const copy = async () => {
    if (!link) return;
    await navigator.clipboard?.writeText(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  const expiresLabel = expiresAt ? new Date(expiresAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "";

  return (
    <SimpleModal title="Invite teammates" onClose={onClose}>
      {!link ? (
        <>
          <p>Generate a link your teammate can use to sign up. The link is single-use and expires in 7 days.</p>
          <div style={{ marginTop: 16 }}>
            <label className="am-modal-label">Role</label>
            <select className="am-modal-input" value={role} onChange={(e) => setRole(e.target.value as "admin" | "sales")}>
              <option value="sales">Sales — can search & share testimonials</option>
              <option value="admin">Admin — can also import & manage</option>
            </select>
          </div>
          {error && <div className="am-modal-error">{error}</div>}
          <div className="am-modal-actions">
            <button className="am-modal-btn" onClick={onClose}>Cancel</button>
            <button className="am-modal-btn primary" onClick={generate} disabled={generating}>
              {generating ? "Generating…" : "Generate invite link"}
            </button>
          </div>
        </>
      ) : (
        <>
          <p>Share this link with your teammate. Expires {expiresLabel}.</p>
          <div className="am-modal-link">
            <input className="am-modal-input mono" value={link} readOnly onFocus={(e) => e.currentTarget.select()}/>
            <button className="am-modal-btn primary" onClick={copy}>{copied ? "Copied!" : "Copy"}</button>
          </div>
          <div className="am-modal-actions">
            <button className="am-modal-btn" onClick={() => { setLink(null); setExpiresAt(null); }}>Generate another</button>
            <button className="am-modal-btn primary" onClick={onClose}>Done</button>
          </div>
        </>
      )}
    </SimpleModal>
  );
}

// ─── TEAM MODAL ────────────────────────────────────────────────────────────
interface TeamMember {
  user_id: string;
  email: string;
  role: string;
  joined_at: string;
  last_sign_in_at: string | null;
  is_self: boolean;
}
interface PendingInvite {
  id: string;
  role: string;
  created_at: string;
  expires_at: string;
}

function timeAgo(iso: string | null): string {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.round(ms / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d}d ago`;
  const mo = Math.round(d / 30);
  if (mo < 12) return `${mo}mo ago`;
  return `${Math.round(mo / 12)}y ago`;
}

function TeamModal({ authHeaders, onClose, onInvite }: { authHeaders: () => Promise<HeadersInit>; onClose: () => void; onInvite: () => void }) {
  const [members, setMembers] = useState<TeamMember[] | null>(null);
  const [pending, setPending] = useState<PendingInvite[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const r = await fetch("/api/team", { headers: await authHeaders() });
        if (!r.ok) throw new Error("Failed to load team");
        const body = await r.json() as { members: TeamMember[]; pending_invites: PendingInvite[] };
        if (!cancelled) {
          setMembers(body.members || []);
          setPending(body.pending_invites || []);
        }
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [authHeaders]);

  return (
    <SimpleModal title="Manage team" onClose={onClose}>
      {loading && <p>Loading team…</p>}
      {error && <div className="am-modal-error">{error}</div>}

      {members && members.length > 0 && (
        <>
          <div className="am-team-head">Members ({members.length})</div>
          <div className="am-team-list">
            {members.map((m) => (
              <div key={m.user_id} className="am-team-row">
                <div className="am-team-cell">
                  <div className="am-team-email">
                    {m.email}
                    {m.is_self && <span className="am-team-you">  ·  you</span>}
                  </div>
                  <div className="am-team-meta">
                    Joined {timeAgo(m.joined_at)}
                    {m.last_sign_in_at ? `  ·  last login ${timeAgo(m.last_sign_in_at)}` : `  ·  has not signed in yet`}
                  </div>
                </div>
                <div className={`am-team-role ${m.role}`}>{m.role}</div>
              </div>
            ))}
          </div>
        </>
      )}

      {pending.length > 0 && (
        <>
          <div className="am-team-head" style={{ marginTop: 18 }}>Pending invites ({pending.length})</div>
          <div className="am-team-list">
            {pending.map((p) => (
              <div key={p.id} className="am-team-row pending">
                <div className="am-team-cell">
                  <div className="am-team-email">Pending invite</div>
                  <div className="am-team-meta">
                    Sent {timeAgo(p.created_at)}  ·  expires {timeAgo(p.expires_at).replace(" ago", "")} from now
                  </div>
                </div>
                <div className={`am-team-role ${p.role}`}>{p.role}</div>
              </div>
            ))}
          </div>
        </>
      )}

      <div className="am-modal-actions">
        <button className="am-modal-btn" onClick={onClose}>Close</button>
        <button className="am-modal-btn primary" onClick={onInvite}>+ Invite teammate</button>
      </div>
    </SimpleModal>
  );
}

// ─── FEEDBACK MODAL ────────────────────────────────────────────────────────
// Placeholder — currently logs to console. Wire to a real endpoint or email
// when you decide where you want feedback to land.
function FeedbackModal({ onClose }: { onClose: () => void }) {
  const [text, setText] = useState("");
  const [sent, setSent] = useState(false);

  const send = () => {
    console.log("[feedback]", text);
    setSent(true);
    setTimeout(onClose, 1400);
  };

  return (
    <SimpleModal title="Send feedback" onClose={onClose}>
      {sent ? (
        <p>Thanks — your note was recorded. (Currently logged to the browser console; we&apos;ll wire this to a real destination soon.)</p>
      ) : (
        <>
          <p>Anything that would make StoryMatch better? Bugs, ideas, frustrations — they all help.</p>
          <textarea
            className="am-modal-input"
            style={{ minHeight: 110, marginTop: 12, resize: "vertical" }}
            placeholder="Type your feedback…"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <div className="am-modal-actions">
            <button className="am-modal-btn" onClick={onClose}>Cancel</button>
            <button className="am-modal-btn primary" onClick={send} disabled={!text.trim()}>Send</button>
          </div>
        </>
      )}
    </SimpleModal>
  );
}

// ─── REUSABLE MODAL CHROME ─────────────────────────────────────────────────
function SimpleModal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <>
      <div className="am-modal-backdrop" onClick={onClose}/>
      <div className="am-modal" onClick={(e) => e.stopPropagation()}>
        <div className="am-modal-head">
          <div className="am-modal-title">{title}</div>
          <button className="am-modal-close" onClick={onClose} title="Close (Esc)">✕</button>
        </div>
        <div className="am-modal-body">{children}</div>
      </div>
    </>
  );
}

const css = `
.am-wrap{position:relative;font-family:var(--font);}
.am-trigger{padding:0;background:none;border:none;border-radius:50%;cursor:pointer;display:grid;place-items:center;width:36px;height:36px;transition:transform .12s;}
.am-trigger:hover{transform:scale(1.08);}
.am-trigger.open .am-avatar{box-shadow:0 0 0 2px var(--accent);}
.am-avatar{width:32px;height:32px;border-radius:50%;flex-shrink:0;color:#fff;font-size:12px;font-weight:700;display:grid;place-items:center;letter-spacing:.4px;}
.am-avatar.lg{width:40px;height:40px;font-size:14px;}

/* position:fixed escapes the rail's overflow:auto clipping context. The
   exact left/bottom coordinates are set inline from the trigger's rect. */
.am-pop{position:fixed;width:260px;background:#fff;border:1px solid var(--border);border-radius:10px;box-shadow:0 14px 36px rgba(0,0,0,.16);padding:6px;z-index:150;}
.am-pop-head{display:flex;align-items:center;gap:11px;padding:10px 8px 8px;}
.am-pop-head-text{min-width:0;flex:1;}
.am-pop-email{font-size:13px;font-weight:600;color:var(--t1);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.am-pop-meta{font-size:11.5px;color:var(--t3);}
.am-divider{height:1px;background:var(--border);margin:4px 0;}
.am-item{display:flex;align-items:center;gap:10px;width:100%;padding:8px 10px;background:none;border:none;border-radius:6px;cursor:pointer;color:var(--t1);font-family:var(--font);font-size:12.5px;text-align:left;}
.am-item:hover{background:var(--bg2);}
.am-item.danger{color:var(--red);}
.am-item.danger:hover{background:#fef2f2;}
.am-item svg{flex-shrink:0;color:var(--t3);}
.am-item.danger svg{color:var(--red);}

/* ── MODAL CHROME ── */
.am-modal-backdrop{position:fixed;inset:0;background:rgba(0,0,0,.32);z-index:200;animation:amFade .18s ease-out;}
@keyframes amFade{from{opacity:0;}to{opacity:1;}}
.am-modal{position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);width:480px;max-width:calc(100vw - 32px);max-height:calc(100vh - 60px);background:#fff;border-radius:12px;box-shadow:0 24px 60px rgba(0,0,0,.22);z-index:201;display:flex;flex-direction:column;font-family:var(--font);animation:amSlide .22s cubic-bezier(.4,0,.2,1);}
@keyframes amSlide{from{transform:translate(-50%,-46%);opacity:0;}to{transform:translate(-50%,-50%);opacity:1;}}
.am-modal-head{display:flex;align-items:center;justify-content:space-between;padding:14px 18px;border-bottom:1px solid var(--border);}
.am-modal-title{font-family:var(--serif);font-size:18px;font-weight:600;letter-spacing:-.3px;color:var(--t1);}
.am-modal-close{background:none;border:none;color:var(--t3);font-size:14px;cursor:pointer;padding:4px 8px;border-radius:5px;}
.am-modal-close:hover{background:var(--bg2);color:var(--t1);}
.am-modal-body{padding:18px;font-size:13.5px;line-height:1.55;color:var(--t2);overflow-y:auto;}
.am-modal-body p{margin-bottom:6px;}
.am-modal-label{display:block;font-size:10.5px;text-transform:uppercase;letter-spacing:.5px;color:var(--t3);font-weight:700;margin-bottom:5px;}
.am-modal-input{font-family:var(--font);font-size:13px;padding:8px 10px;border:1px solid var(--border);border-radius:7px;background:#fff;color:var(--t1);width:100%;box-sizing:border-box;}
.am-modal-input.mono{font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;font-size:11.5px;}
.am-modal-input:focus{outline:none;border-color:var(--accent);}
.am-modal-link{display:flex;gap:8px;margin-top:16px;}
.am-modal-error{margin-top:12px;padding:8px 10px;background:#fef2f2;border:1px solid #fecaca;border-radius:6px;color:var(--red);font-size:12px;}
.am-modal-actions{display:flex;gap:8px;justify-content:flex-end;margin-top:18px;}
.am-modal-btn{padding:8px 16px;border:1px solid var(--border);border-radius:7px;background:#fff;color:var(--t2);font-family:var(--font);font-size:12.5px;font-weight:600;cursor:pointer;}
.am-modal-btn:hover{background:var(--bg2);color:var(--t1);}
.am-modal-btn.primary{background:var(--accent);color:#fff;border-color:var(--accent);}
.am-modal-btn.primary:hover{background:var(--accent2);}
.am-modal-btn.primary:disabled{background:var(--accentL);cursor:not-allowed;}

/* ── TEAM LIST inside Manage team modal ── */
.am-team-head{font-size:10.5px;text-transform:uppercase;letter-spacing:.5px;color:var(--t3);font-weight:700;margin-bottom:8px;}
.am-team-list{display:flex;flex-direction:column;gap:1px;border:1px solid var(--border);border-radius:8px;overflow:hidden;}
.am-team-row{display:flex;align-items:center;gap:12px;padding:10px 12px;background:#fff;border-bottom:1px solid var(--border);}
.am-team-row:last-child{border-bottom:none;}
.am-team-row.pending{background:var(--bg2);}
.am-team-cell{flex:1;min-width:0;}
.am-team-email{font-size:13px;font-weight:600;color:var(--t1);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.am-team-you{font-size:10.5px;font-weight:600;color:var(--accent);text-transform:uppercase;letter-spacing:.5px;}
.am-team-meta{font-size:11.5px;color:var(--t3);margin-top:2px;}
.am-team-role{font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;padding:3px 8px;border-radius:5px;}
.am-team-role.admin{background:var(--accentLL);color:var(--accent);border:1px solid var(--accentL);}
.am-team-role.sales{background:var(--bg2);color:var(--t2);border:1px solid var(--border);}
`;
