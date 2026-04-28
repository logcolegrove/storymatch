"use client";

// Account/settings menu for the bottom of the admin rail. Rendered as an
// avatar circle that, when clicked, opens a popup with:
//   • the signed-in user's email + workspace + role (read-only header)
//   • Invite teammates  (admin only — opens InviteModal)
//   • Help              (placeholder for now)
//   • Send feedback     (placeholder for now)
//   • Sign out

import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

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
              <button className="am-item" onClick={() => { setOpen(false); setTeamOpen(true); }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>
                  <path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>
                </svg>
                Manage team
              </button>
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

      {teamOpen && <TeamModal authHeaders={authHeaders} onClose={() => setTeamOpen(false)}/>}
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
  invited_email: string | null;
  created_at: string;
  expires_at: string;
  url: string;
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

// Per-role descriptions shown in the Add form so admins know what they're
// granting. Keep these in plain language — they're the user-facing definition
// of what the role can do.
const ROLE_OVERVIEWS: Record<"admin" | "sales", { title: string; desc: string }> = {
  sales: {
    title: "Sales",
    desc: "Can search the library, copy share links for prospects, and see engagement on every share link the team has sent.",
  },
  admin: {
    title: "Admin",
    desc: "Everything sales can do — plus import showcases, edit testimonials, and manage the team.",
  },
};

function TeamModal({ authHeaders, onClose }: { authHeaders: () => Promise<HeadersInit>; onClose: () => void }) {
  const [members, setMembers] = useState<TeamMember[] | null>(null);
  const [pending, setPending] = useState<PendingInvite[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Add-team-member form state
  const [emailInput, setEmailInput] = useState("");
  const [roleInput, setRoleInput] = useState<"admin" | "sales">("sales");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [justAddedId, setJustAddedId] = useState<string | null>(null);
  const [copyToast, setCopyToast] = useState<string | null>(null);

  const fetchTeam = async () => {
    try {
      const r = await fetch("/api/team", { headers: await authHeaders() });
      if (!r.ok) throw new Error("Failed to load team");
      const body = await r.json() as { members: TeamMember[]; pending_invites: PendingInvite[] };
      setMembers(body.members || []);
      setPending(body.pending_invites || []);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  useEffect(() => {
    setLoading(true);
    fetchTeam().finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Generate the invite AND copy the URL to clipboard in one action — that's
  // the actual job-to-be-done. (Calling it "Add team member" misleads users
  // into thinking we send an email automatically; we don't.)
  const generateAndCopy = async () => {
    setFormError(null);
    setSubmitting(true);
    try {
      const r = await fetch("/api/invites", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify({ role: roleInput, email: emailInput.trim() || undefined }),
      });
      if (!r.ok) throw new Error((await r.json()).error || "Failed to create invite");
      const body = await r.json() as { id: string; url: string };
      await navigator.clipboard?.writeText(body.url);
      setCopyToast("Invite link copied — paste into an email or message");
      setTimeout(() => setCopyToast(null), 2800);
      setEmailInput("");
      setJustAddedId(body.id);
      setTimeout(() => setJustAddedId(null), 3000);
      await fetchTeam();
    } catch (e) {
      setFormError((e as Error).message);
    }
    setSubmitting(false);
  };

  const copyInviteLink = async (url: string) => {
    await navigator.clipboard?.writeText(url);
    setCopyToast("Invite link copied");
    setTimeout(() => setCopyToast(null), 1800);
  };

  // ── Member role / removal actions ────────────────────────────────────
  const changeMemberRole = async (userId: string, role: "admin" | "sales") => {
    // Optimistic
    setMembers(prev => prev ? prev.map(m => m.user_id === userId ? { ...m, role } : m) : prev);
    try {
      const r = await fetch(`/api/team/member/${userId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify({ role }),
      });
      if (!r.ok) throw new Error((await r.json()).error || "Failed");
    } catch (e) {
      setError((e as Error).message);
      await fetchTeam(); // revert from server
    }
  };
  const removeMember = async (userId: string, email: string) => {
    if (!confirm(`Remove ${email} from the team? They'll lose access immediately.`)) return;
    setMembers(prev => prev ? prev.filter(m => m.user_id !== userId) : prev);
    try {
      const r = await fetch(`/api/team/member/${userId}`, {
        method: "DELETE",
        headers: await authHeaders(),
      });
      if (!r.ok) throw new Error((await r.json()).error || "Failed");
    } catch (e) {
      setError((e as Error).message);
      await fetchTeam();
    }
  };

  // ── Pending-invite role / revoke actions ─────────────────────────────
  const changeInviteRole = async (id: string, role: "admin" | "sales") => {
    setPending(prev => prev.map(p => p.id === id ? { ...p, role } : p));
    try {
      const r = await fetch(`/api/invites/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify({ role }),
      });
      if (!r.ok) throw new Error((await r.json()).error || "Failed");
    } catch (e) {
      setError((e as Error).message);
      await fetchTeam();
    }
  };
  const revokeInvite = async (id: string, label: string) => {
    if (!confirm(`Revoke the invite for ${label}? The link will stop working.`)) return;
    setPending(prev => prev.filter(p => p.id !== id));
    try {
      const r = await fetch(`/api/invites/${id}`, { method: "DELETE", headers: await authHeaders() });
      if (!r.ok) throw new Error((await r.json()).error || "Failed");
    } catch (e) {
      setError((e as Error).message);
      await fetchTeam();
    }
  };

  const overview = ROLE_OVERVIEWS[roleInput];

  return (
    <SimpleModal title="Team" onClose={onClose}>
      {/* ── Add new team member ── */}
      <div className="am-team-add">
        <div className="am-team-add-head">Add new team member</div>
        <div className="am-team-add-row">
          <div className="am-team-add-fld">
            <label className="am-modal-label">Email address</label>
            <input
              className="am-modal-input"
              type="email"
              placeholder="teammate@company.com"
              value={emailInput}
              onChange={(e) => setEmailInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !submitting) generateAndCopy(); }}
            />
          </div>
          <div className="am-team-add-fld" style={{ maxWidth: 160 }}>
            <label className="am-modal-label">Role</label>
            <select
              className="am-modal-input"
              value={roleInput}
              onChange={(e) => setRoleInput(e.target.value as "admin" | "sales")}
            >
              <option value="sales">Sales</option>
              <option value="admin">Admin</option>
            </select>
          </div>
          <button className="am-modal-btn primary am-team-add-btn" onClick={generateAndCopy} disabled={submitting}>
            {submitting ? "Generating…" : "Copy invite link"}
          </button>
        </div>
        <div className="am-team-overview">
          <span className={`am-team-role ${roleInput}`}>{overview.title}</span>
          <span>{overview.desc}</span>
        </div>
        {formError && <div className="am-modal-error">{formError}</div>}
      </div>

      {loading && <p style={{ marginTop: 14 }}>Loading team…</p>}
      {error && <div className="am-modal-error">{error}</div>}

      {/* ── Members ── */}
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
                <RoleMenu
                  role={m.role as "admin" | "sales"}
                  onChange={(r) => changeMemberRole(m.user_id, r)}
                  onRemove={() => removeMember(m.user_id, m.email)}
                  removeLabel="Remove member"
                />
              </div>
            ))}
          </div>
        </>
      )}

      {/* ── Pending invites ── */}
      {pending.length > 0 && (
        <>
          <div className="am-team-head" style={{ marginTop: 18 }}>Pending invites ({pending.length})</div>
          <div className="am-team-list">
            {pending.map((p) => (
              <div key={p.id} className={`am-team-row pending${justAddedId === p.id ? " just-added" : ""}`}>
                <div className="am-team-cell">
                  <div className="am-team-email">{p.invited_email || "(no email recorded)"}</div>
                  <div className="am-team-meta">
                    Invite link generated {timeAgo(p.created_at)}
                  </div>
                </div>
                <button
                  className="am-modal-btn am-team-copy"
                  onClick={() => copyInviteLink(p.url)}
                  title="Copy invite link"
                >
                  Copy link
                </button>
                <RoleMenu
                  role={p.role as "admin" | "sales"}
                  onChange={(r) => changeInviteRole(p.id, r)}
                  onRemove={() => revokeInvite(p.id, p.invited_email || "this teammate")}
                  removeLabel="Revoke invite"
                />
              </div>
            ))}
          </div>
        </>
      )}

      {copyToast && <div className="am-team-toast">{copyToast}</div>}

      <div className="am-modal-actions">
        <button className="am-modal-btn" onClick={onClose}>Close</button>
      </div>
    </SimpleModal>
  );
}

// ── Per-row role dropdown (Sales / Admin / Remove) ─────────────────────────
// Uses position:fixed for the popup so it escapes the modal-body's overflow:auto
// clipping context. Coords are computed from the trigger's bounding rect on open.
function RoleMenu({
  role,
  onChange,
  onRemove,
  removeLabel,
}: {
  role: "admin" | "sales";
  onChange: (next: "admin" | "sales") => void;
  onRemove: () => void;
  removeLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const [popPos, setPopPos] = useState<{ top: number; left: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);

  const POP_WIDTH = 170;

  const toggle = () => {
    if (!open && triggerRef.current) {
      const r = triggerRef.current.getBoundingClientRect();
      // Place the popup directly below the trigger, left-aligned to it.
      // If that would overflow the right side of the viewport, flip to
      // right-aligned so the menu stays on screen.
      const wouldOverflow = r.left + POP_WIDTH > window.innerWidth - 16;
      setPopPos({
        top: r.bottom + 4,
        left: wouldOverflow ? r.right - POP_WIDTH : r.left,
      });
    }
    setOpen(o => !o);
  };

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (triggerRef.current?.contains(t) || popRef.current?.contains(t)) return;
      setOpen(false);
    };
    const t = setTimeout(() => document.addEventListener("mousedown", onDoc), 0);
    return () => { clearTimeout(t); document.removeEventListener("mousedown", onDoc); };
  }, [open]);

  // Portal to document.body so the popup escapes the modal's transform-based
  // containing block. (Without this, position:fixed coordinates would be
  // interpreted relative to the centered modal, not the viewport.)
  const popup = (open && popPos) ? (
    <div ref={popRef} className="am-rolemenu-pop" style={{ top: popPos.top, left: popPos.left, width: POP_WIDTH }}>
      <button className="am-rolemenu-item" onClick={() => { setOpen(false); if (role !== "sales") onChange("sales"); }}>
        <span>{role === "sales" ? "✓" : ""}</span> Sales
      </button>
      <button className="am-rolemenu-item" onClick={() => { setOpen(false); if (role !== "admin") onChange("admin"); }}>
        <span>{role === "admin" ? "✓" : ""}</span> Admin
      </button>
      <div className="am-rolemenu-divider"/>
      <button className="am-rolemenu-item danger" onClick={() => { setOpen(false); onRemove(); }}>
        <span></span> {removeLabel}
      </button>
    </div>
  ) : null;

  return (
    <>
      <button ref={triggerRef} className={`am-team-role ${role} am-rolemenu-trigger`} onClick={toggle}>
        {role}
        <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="6 9 12 15 18 9"/>
        </svg>
      </button>
      {popup && typeof window !== "undefined" && createPortal(popup, document.body)}
    </>
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
// Rendered via a portal to document.body so the backdrop+modal escape any
// ancestor stacking contexts (e.g. the admin-rail at z:20). Without this,
// even a high z-index on the backdrop wouldn't cover the page header.
function SimpleModal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  if (typeof window === "undefined") return null;
  return createPortal(
    <>
      <div className="am-modal-backdrop" onClick={onClose}/>
      <div className="am-modal" onClick={(e) => e.stopPropagation()}>
        <div className="am-modal-head">
          <div className="am-modal-title">{title}</div>
          <button className="am-modal-close" onClick={onClose} title="Close (Esc)">✕</button>
        </div>
        <div className="am-modal-body">{children}</div>
      </div>
    </>,
    document.body
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
.am-modal{position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);width:680px;max-width:calc(100vw - 32px);max-height:calc(100vh - 60px);background:#fff;border-radius:12px;box-shadow:0 24px 60px rgba(0,0,0,.22);z-index:201;display:flex;flex-direction:column;font-family:var(--font);animation:amSlide .22s cubic-bezier(.4,0,.2,1);}
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

/* Add-new-team-member section at the top of the Team modal */
.am-team-add{padding:14px;background:var(--bg2);border:1px solid var(--border);border-radius:8px;margin-bottom:18px;}
.am-team-add-head{font-size:13px;font-weight:700;color:var(--t1);margin-bottom:10px;}
.am-team-add-row{display:flex;gap:10px;align-items:flex-end;}
.am-team-add-fld{flex:1;display:flex;flex-direction:column;gap:5px;min-width:0;}
.am-team-add-btn{height:34px;align-self:flex-end;padding:0 14px;white-space:nowrap;}
.am-team-add-hint{font-size:11.5px;color:var(--t3);margin-top:8px;line-height:1.5;}
.am-team-overview{display:flex;align-items:flex-start;gap:10px;margin-top:10px;font-size:11.5px;color:var(--t2);line-height:1.55;}
.am-team-overview .am-team-role{flex-shrink:0;margin-top:1px;}

/* Pending invite per-row Copy link button */
.am-team-copy{padding:4px 10px;font-size:11px;font-weight:600;height:auto;}

/* Brief highlight on a just-created invite so the admin notices it appearing */
.am-team-row.just-added{background:var(--accentLL);transition:background 1s ease-out;}

/* ── Role dropdown (per row) ── */
.am-rolemenu-trigger{cursor:pointer;display:inline-flex;align-items:center;gap:5px;font-family:var(--font);}
.am-rolemenu-trigger:hover{filter:brightness(.95);}
/* position:fixed so it escapes the modal body's overflow:auto. Coords set inline. */
.am-rolemenu-pop{position:fixed;background:#fff;border:1px solid var(--border);border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,.14);padding:4px;z-index:250;}
.am-rolemenu-item{display:flex;align-items:center;gap:8px;width:100%;padding:7px 10px;background:none;border:none;border-radius:5px;cursor:pointer;color:var(--t1);font-family:var(--font);font-size:12.5px;text-align:left;}
.am-rolemenu-item span{display:inline-block;width:14px;color:var(--accent);font-weight:700;}
.am-rolemenu-item:hover{background:var(--bg2);}
.am-rolemenu-item.danger{color:var(--red);}
.am-rolemenu-item.danger:hover{background:#fef2f2;}
.am-rolemenu-divider{height:1px;background:var(--border);margin:4px 0;}

/* Floating toast inside the modal for "link copied" feedback */
.am-team-toast{position:absolute;bottom:72px;left:50%;transform:translateX(-50%);background:#1a1a1f;color:#fff;padding:9px 16px;border-radius:8px;font-size:12.5px;font-weight:500;box-shadow:0 8px 24px rgba(0,0,0,.2);z-index:10;animation:amSlide .22s cubic-bezier(.4,0,.2,1);}
`;
