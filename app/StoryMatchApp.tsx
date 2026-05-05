"use client";

import React, { useState, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { useAuth } from "@/lib/auth-context";
import AssetDetail from "./components/AssetDetail";
import MySharesView from "./components/MySharesView";
import AssetEditPanel from "./components/AssetEditPanel";
import AccountMenu from "./components/AccountMenu";
import FeaturedQuoteRotator, { type FeaturedQuote } from "./components/FeaturedQuoteRotator";
import StandaloneQuoteModal from "./components/StandaloneQuoteModal";
import FeaturedRotationPanel from "./components/FeaturedRotationPanel";

// Helper: build auth header for API requests.
// IMPORTANT: we deliberately avoid supabaseBrowser.auth.getSession() here because
// it acquires an internal lock that can deadlock under React Strict Mode, causing
// fetch helpers to hang forever. Instead, we read the token directly from localStorage
// where Supabase persists it. If no token exists, we fall through gracefully.
async function authHeaders(): Promise<HeadersInit> {
  try {
    if (typeof window === "undefined") return {};
    // Scan localStorage for any key matching supabase auth token pattern
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith("sb-") && key.endsWith("-auth-token")) {
        const raw = localStorage.getItem(key);
        if (!raw) continue;
        try {
          const parsed = JSON.parse(raw);
          // Supabase stores either as {access_token, ...} or as an array-like structure
          const token = parsed?.access_token || parsed?.currentSession?.access_token;
          if (token) return { "Authorization": `Bearer ${token}` };
        } catch {}
      }
    }
  } catch (e) {
    console.warn("authHeaders: unable to read token", e);
  }
  return {};
}

// Fire-and-forget: ask the backend to (re)compute the embedding for an asset.
// We don't await this — the user shouldn't wait. Embeddings catch up in the background.
function reembedAsset(assetId: string) {
  (async () => {
    try {
      const headers = await authHeaders();
      await fetch("/api/embeddings", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify({ assetId }),
      });
    } catch (e) {
      console.warn("reembedAsset failed", e);
    }
  })();
}

// ─── TYPES ───────────────────────────────────────────────────────────────────
type AssetType = "Video Testimonial" | "Written Case Study" | "Quote";
type AssetStatus = "published" | "archived" | "draft";
type ClientStatus = "current" | "former" | "unknown";
type ClientStatusSource = "manual" | "crm" | "system" | "unset";
type ApprovalStatus = "approved" | "pending" | "needs_edits" | "denied" | "unset";

interface Asset {
  id: string;
  sourceId?: string | null;
  clientName: string;
  company: string;
  vertical: string;
  geography: string;
  companySize: string;
  challenge: string;
  outcome: string;
  assetType: AssetType | string;
  videoUrl: string;
  status: AssetStatus | string;
  dateCreated: string;
  headline: string;
  pullQuote: string;
  transcript: string;
  description: string;
  thumbnail: string;
  // Governance / lifecycle (added in testimonial-governance migration)
  archivedAt?: string | null;
  archivedReason?: string | null;
  clientStatus?: ClientStatus | string;
  clientStatusSource?: ClientStatusSource | string;
  clientStatusUpdatedAt?: string | null;
  crmAccountId?: string | null;
  lastVerifiedAt?: string | null;
  // Approval (one of three signals feeding the "Cleared" indicator)
  approvalStatus?: ApprovalStatus | string;
  approvalNote?: string | null;
  approvalRecordedAt?: string | null;
  // Vimeo conflict-detection snapshot — last value pulled from Vimeo. The
  // sync engine compares headline/description/transcript against these to
  // tell "user hasn't edited locally" apart from "user has overridden".
  // Not exposed in the UI; only set by sync + Pull-from-Vimeo handlers.
  lastSyncedTitle?: string | null;
  lastSyncedDescription?: string | null;
  lastSyncedTranscript?: string | null;
  // Vimeo's actual publish date (created_time). Drives the freshness Rule.
  publishedAt?: string | null;
  // Per-asset freshness exception — when set, this asset bypasses the org
  // freshness rule until the until date (if set) or always (if until is in
  // the far future). set_by_email + set_at are server-stamped from auth.
  freshnessExceptionUntil?: string | null;
  freshnessExceptionSetByEmail?: string | null;
  freshnessExceptionSetAt?: string | null;
  // Custom flags — admin-defined free-form review flags for things that
  // don't fit approval/client/freshness (e.g. "comments must be disabled,"
  // "logo update pending"). Each contributes to the cleared signal.
  customFlags?: CustomFlag[];
  // Additional pull quotes beyond the primary `pullQuote`. Each carries
  // its own favorite flag. Old data may contain plain strings — server
  // coerces to {text, favorite} on read. After the quotes-as-entity
  // refactor, GET also injects per-quote curation fields (id,
  // isFeatured, washToken) sourced from the new quotes table.
  additionalQuotes?: { id?: string; text: string; favorite?: boolean; isFeatured?: boolean; washToken?: string | null }[];
  // Primary quote curation — same source as additionalQuotes' fields
  // but for the index-0 quote which lives in pullQuote.
  pullQuoteId?: string;
  pullQuoteIsFeatured?: boolean;
  pullQuoteWashToken?: string | null;
  // Additional client/company entries beyond the primary, each with its
  // own role + filter metadata (vertical/geography/size). Used for
  // compilation videos featuring multiple speakers/companies.
  additionalClients?: { clientName: string; company: string; role?: string; vertical?: string; geography?: string; companySize?: string }[];
  // Primary client's job title / role.
  clientRole?: string;
  // Star/favorite for the primary pull quote.
  pullQuoteFavorite?: boolean;
  // Read-only timestamped transcript segments. Populated by source-sync
  // from the captured VTT. Empty when the asset was synced before
  // segment capture was added — admin can manual-sync to backfill.
  transcriptSegments?: { startSeconds: number; text: string }[];
  // Manual sort order — admin sets via drag-reorder. Null until
  // ordered for the first time.
  displayOrder?: number | null;
}

interface CustomFlag {
  id: string;            // client-generated uuid; primary key within the array
  label: string;         // short title — surfaces inline next to severity dot
  // Color: preset name ("yellow" | "red" | "green") OR a hex string ("#ff6b9b").
  // Yellow/red drag the cleared signal. Green is informational/positive and
  // does not affect the cleared signal. Hex colors are also informational.
  color: string;
  note: string;          // long-form description / instructions
  setByEmail: string;
  setAt: string;
}

// Helper: is this color value a hex string vs a preset name?
function isHexColor(c: string): boolean {
  return /^#[0-9A-Fa-f]{3,8}$/.test(c);
}

// Yellow and red are severity colors — they fold into the cleared trigger
// pill rather than rendering as their own chip on the row. Green and any
// custom hex color are informational and render as standalone chips.
function isSeverityColor(c: string): boolean {
  return c === "yellow" || c === "red";
}

// Org-level configuration that drives Rules behavior. Loaded once at app
// boot via /api/org/settings and refreshed when admin saves changes in the
// Rules panel. Freshness has two mutually-exclusive modes:
//   • freshnessWarnAfterMonths — rolling, "flag if older than X months"
//   • freshnessWarnBeforeDate  — fixed cutoff (YYYY-MM-DD), "flag if before X"
// At most one is non-null at any time (server enforces).
interface PublicationRule {
  action: "none" | "draft" | "archive";
  auto_revert: boolean;
}
interface OrgSettings {
  freshnessWarnAfterMonths: number | null;
  freshnessWarnBeforeDate: string | null;
  // Default approval status for NEW imports (existing assets unchanged).
  defaultApprovalStatus: string;
  // Trigger → action map for publication state automation.
  publicationRules: Record<string, PublicationRule>;
}

interface Source {
  id: string;
  name: string;
  url: string;
  type: string;
  status: string;
  lastSync: string | null;
  videoCount: number;
  assetIds: string[];
  // Auto-sync settings + persistent inbox (set/managed server-side)
  autoSyncEnabled?: boolean;
  autoSyncFrequency?: string; // 'hourly' | 'daily' | 'weekly'
  autoSyncTime?: string;       // 'HH:MM' UTC
  autoSyncDay?: string;        // weekday for weekly
  lastAutoSyncAt?: string | null;
  pendingSyncReport?: SyncReport | null;
}

type UrlKind = "yt-video" | "yt-playlist" | "vm-video" | "vm-showcase" | "unknown";

interface UrlInfo {
  kind: UrlKind;
  url: string;
  id?: string | null;
}

interface VidInfo {
  p: "yt" | "vm";
  id: string;
}

interface OEmbedData {
  title?: string;
  description?: string;
  thumbnail_url?: string;
  author_name?: string;
  html?: string;
}

interface OEmbedResult {
  data: OEmbedData | null;
  error: string | null;
}

interface Enrichment {
  company?: string;
  clientName?: string;
  vertical?: string;
  challenge?: string;
  outcome?: string;
  headline?: string;
  pullQuote?: string;
}

interface AIMatchResult {
  id: string;
  reasoning: string;
  quotes: string[];
  relevanceScore?: number;
  rank: number;
}

interface Filters {
  vertical: string[];
  assetType: string[];
}

interface Route {
  page: "home" | "detail" | "shares";
  id: string | null;
}

// ─── DATA ────────────────────────────────────────────────────────────────────
// (SEED data now lives in Supabase — see prisma/seed-assets.sql)

const VERTICALS: string[] = ["All","Logistics","Healthcare","Manufacturing","Financial Services","Retail","Education","Real Estate","Technology"];
const ASSET_TYPES: string[] = ["All","Video Testimonial","Written Case Study","Quote"];
const VERT_CLR: Record<string, string> = {Logistics:"#2563eb",Healthcare:"#059669",Manufacturing:"#d97706","Financial Services":"#7c3aed",Retail:"#db2777",Education:"#0891b2","Real Estate":"#65a30d",Technology:"#4f46e5"};
const CTA_MAP: Record<string, string> = {"Video Testimonial":"watch","Written Case Study":"read","Quote":"quote"};

function extractVid(url: string | null | undefined): VidInfo | null {
  if(!url)return null;
  let m=url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([^&?#]+)/);
  if(m)return{p:"yt",id:m[1]};
  m=url.match(/vimeo\.com\/(?:video\/)?(\d+)/);
  if(m)return{p:"vm",id:m[1]};
  return null;
}
function ytThumb(id: string): string { return `https://img.youtube.com/vi/${id}/hqdefault.jpg`; }

const css = `
@import url('https://fonts.googleapis.com/css2?family=Instrument+Sans:wght@400;500;600;700&family=Newsreader:ital,opsz,wght@0,6..72,400;0,6..72,500;0,6..72,600;1,6..72,400;1,6..72,500&display=swap');
*{margin:0;padding:0;box-sizing:border-box;}
:root{
  --bg:#fafafa;--bg2:#f4f4f6;--bg3:#ededf0;
  --border:#e2e2e6;--border2:#d0d0d6;
  --t1:#111118;--t2:#55556a;--t3:#8888a0;--t4:#aaaabb;
  --accent:#6d28d9;--accent2:#7c3aed;--accentL:#ede9fe;--accentLL:#f5f3ff;--accent-bg:#f5f3ff;
  --green:#059669;--red:#dc2626;--amber:#d97706;--amberL:#fef3c7;
  --font:'Instrument Sans',-apple-system,sans-serif;
  --serif:'Newsreader',Georgia,serif;
  --r:14px;--r2:10px;--r3:7px;
}
body,#root{font-family:var(--font);background:var(--bg);color:var(--t1);min-height:100vh;-webkit-font-smoothing:antialiased;}

.hdr{display:flex;align-items:center;justify-content:space-between;padding:0 32px;height:56px;background:#fff;border-bottom:1px solid var(--border);position:sticky;top:0;z-index:50;}
.logo{display:flex;align-items:center;gap:9px;font-weight:700;font-size:17px;letter-spacing:-.4px;cursor:pointer;user-select:none;}
.logo i{width:26px;height:26px;background:var(--accent);border-radius:7px;display:grid;place-items:center;font-style:normal;font-size:12px;color:#fff;}
.logo span{color:var(--accent2);}
.hdr-r{display:flex;align-items:center;gap:6px;}
.gear-btn{width:34px;height:34px;border-radius:8px;border:1px solid var(--border);background:#fff;color:var(--t3);cursor:pointer;display:grid;place-items:center;font-size:16px;transition:all .12s;}
.gear-btn:hover{border-color:var(--border2);color:var(--t1);}

/* Mode toggle in header */
.mode-toggle{display:flex;gap:2px;background:var(--bg2);padding:2px;border-radius:8px;border:1px solid var(--border);}
.mode-btn{padding:5px 12px;border-radius:6px;border:none;background:none;color:var(--t3);font-family:var(--font);font-size:11px;font-weight:600;cursor:pointer;transition:all .12s;}
.mode-btn.on{background:#fff;color:var(--t1);box-shadow:0 1px 2px rgba(0,0,0,.06);}

/* ── ADMIN LEFT RAIL + PANEL ── */
.layout{display:flex;min-height:calc(100vh - 56px);}
.admin-rail{width:64px;background:#fff;border-right:1px solid var(--border);display:flex;flex-direction:column;align-items:center;padding:12px 0;flex-shrink:0;position:sticky;top:56px;height:calc(100vh - 56px);align-self:flex-start;overflow-y:auto;z-index:20;}
.rail-spacer{flex:1;}
.rail-foot{width:100%;padding:12px 0 4px;border-top:1px solid var(--border);display:flex;justify-content:center;}
.rail-btn{width:44px;height:44px;border-radius:10px;border:none;background:none;color:var(--t3);cursor:pointer;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;font-family:var(--font);font-size:9px;font-weight:600;transition:all .12s;margin-bottom:4px;position:relative;}
.rail-btn:hover{background:var(--bg2);color:var(--t1);}
.rail-btn.on{background:var(--accentL);color:var(--accent);}
.rail-btn.on::before{content:'';position:absolute;left:-12px;top:50%;transform:translateY(-50%);width:3px;height:24px;background:var(--accent);border-radius:0 3px 3px 0;}
.rail-btn svg{flex-shrink:0;}
.rail-btn.disabled{opacity:.35;cursor:not-allowed;}
.rail-btn.disabled:hover{background:none;color:var(--t3);}
.rail-btn .rail-soon{position:absolute;top:2px;right:2px;background:var(--t4);color:#fff;font-size:7px;font-weight:700;padding:1px 3px;border-radius:3px;letter-spacing:.3px;}
.rail-spacer{flex:1;}

.admin-panel{width:340px;background:#fff;border-right:1px solid var(--border);display:flex;flex-direction:column;flex-shrink:0;overflow:hidden;animation:fadeIn .2s ease;position:sticky;top:56px;height:calc(100vh - 56px);align-self:flex-start;z-index:15;}
.ap-head{padding:18px 20px 14px;border-bottom:1px solid var(--border);}
.ap-title{font-family:var(--serif);font-size:18px;font-weight:600;letter-spacing:-.3px;}
.ap-sub{font-size:11.5px;color:var(--t3);margin-top:3px;line-height:1.4;}
.ap-body{flex:1;overflow-y:auto;padding:16px 20px;}

/* Rules panel — Defaults block + Automations block. Defaults are stacked
   labeled rows; Automations are trigger→action cards that read as
   sentences. Both blocks scale by adding more children. */
.rules-panel{padding:0;display:flex;flex-direction:column;height:100%;overflow-y:auto;}
.rules-panel .ap-head{padding:18px 20px 14px;border-bottom:1px solid var(--border);}
.rules-panel .ap-head h3{font-family:var(--serif);font-size:18px;font-weight:600;letter-spacing:-.3px;color:var(--t1);margin:0;}

/* Block — wraps each top-level grouping (Defaults, Automations). */
.rules-block{padding:18px 20px;border-bottom:1px solid var(--border);display:flex;flex-direction:column;gap:14px;}
.rules-block-head{display:flex;flex-direction:column;gap:4px;}
.rules-block-title{font-family:var(--serif);font-size:14px;font-weight:600;color:var(--t1);}
.rules-block-sub{font-size:11.5px;color:var(--t3);line-height:1.5;}

/* Default rows — stacked controls with their label inline above. */
.rules-default-row{display:flex;flex-direction:column;gap:6px;}
.rules-default-label{font-size:11px;text-transform:uppercase;letter-spacing:.6px;color:var(--t3);font-weight:700;}

/* Rule card — header strip + collapsible body. Soft border, subtle
   background. When off, the card mutes (.off applies on the wrapper).
   Header has icon + title on the left, on/off toggle on the right. */
.rule-card{border:1px solid var(--border);border-radius:10px;background:#fff;overflow:hidden;transition:all .15s;}
.rule-card.off{background:var(--bg);border-color:var(--border);opacity:.7;}
.rule-card.on{box-shadow:0 1px 2px rgba(0,0,0,.04);}
.rule-card-head{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:12px 14px;}
.rule-card.on .rule-card-head{border-bottom:1px solid var(--border);}
.rule-card-title{display:flex;align-items:center;gap:8px;font-size:13px;font-weight:600;color:var(--t1);}
.rule-card-icon{display:inline-grid;place-items:center;width:22px;height:22px;border-radius:6px;background:var(--bg2);color:var(--t2);}
.rule-card.on .rule-card-icon{background:var(--accentLL);color:var(--accent);}
.rule-card-body{padding:14px;display:flex;flex-direction:column;gap:8px;background:var(--bg);}

/* On/off toggle — pill switch with sliding thumb. Off is muted; on is
   accent-colored. Standard role=switch for a11y. */
.rule-toggle{position:relative;width:34px;height:20px;border-radius:999px;border:none;background:var(--border2);cursor:pointer;padding:0;flex-shrink:0;transition:background .12s;}
.rule-toggle.on{background:var(--accent);}
.rule-toggle-thumb{position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;background:#fff;box-shadow:0 1px 2px rgba(0,0,0,.2);transition:transform .12s;}
.rule-toggle.on .rule-toggle-thumb{transform:translateX(14px);}

/* Sentence-style rule body — inline dropdowns + plain text reading
   left-to-right. Inline selects sized to content rather than 100%. */
.rule-sentence{display:flex;flex-wrap:wrap;align-items:center;gap:8px;font-size:13px;color:var(--t1);line-height:1.5;}
.rule-inline-select{font-family:var(--font);font-size:13px;padding:6px 28px 6px 10px;border:1px solid var(--border);border-radius:6px;background:#fff;color:var(--t1);width:auto;cursor:pointer;}
.rule-inline-select:focus{outline:none;border-color:var(--accent);}
.rule-inline-date{font-family:var(--font);font-size:13px;padding:6px 10px;border:1px solid var(--border);border-radius:6px;background:#fff;color:var(--t1);width:auto;}

/* "↓ then" connector — small, color-neutral, centered. The visual
   gesture that makes the trigger→action flow legible without a full
   canvas. */
.rule-then{font-size:11px;color:var(--t3);font-weight:600;letter-spacing:.4px;text-transform:uppercase;padding:2px 0;}

/* Branch — one trigger→action pair inside a multi-branch rule card.
   Wraps the WHEN + THEN sentences so multiple branches stack cleanly
   with their own internal grouping (vs. one long flat list). */
.rule-branch{display:flex;flex-direction:column;gap:8px;}

/* "AND" divider between branches — a thin centered horizontal line
   with the word AND in the middle. Communicates "additional condition"
   without weight. */
.rule-and{display:flex;align-items:center;gap:10px;color:var(--t4);font-size:10.5px;font-weight:700;letter-spacing:.6px;text-transform:uppercase;margin:4px 0;}
.rule-and::before,.rule-and::after{content:"";flex:1;height:1px;background:var(--border);}

/* Per-branch remove button — small × that appears only when more than
   one branch exists (admin can't remove the last branch via this; they
   use the card's on/off toggle to clear everything). */
.rule-branch-remove{background:none;border:none;color:var(--t4);cursor:pointer;font-size:18px;line-height:1;padding:0 4px;border-radius:4px;width:24px;height:24px;display:grid;place-items:center;}
.rule-branch-remove:hover{background:var(--bg2);color:var(--t1);}

/* "+ Add condition" button — quietly invites stacking another branch.
   Subdued styling so it doesn't compete with the active sentences;
   admin doesn't need to think about it unless they want it. */
.rule-add-condition{display:inline-flex;align-items:center;gap:6px;background:none;border:1px dashed var(--border2);color:var(--t3);padding:7px 12px;border-radius:8px;font-family:var(--font);font-size:12px;font-weight:600;cursor:pointer;align-self:flex-start;margin-top:4px;transition:all .12s;}
.rule-add-condition:hover{border-color:var(--accent);color:var(--accent);background:var(--accentLL);}
.rule-add-plus{display:inline-grid;place-items:center;width:16px;height:16px;border-radius:50%;background:currentColor;color:#fff;font-size:13px;font-weight:700;line-height:1;}
.rule-add-condition:hover .rule-add-plus{background:var(--accent);}

/* Shared inline controls — reused by Default rows + rule sentences. */
.rules-select{font-family:var(--font);font-size:13px;padding:8px 10px;border:1px solid var(--border);border-radius:7px;background:#fff;color:var(--t1);width:100%;cursor:pointer;}
.rules-select:focus{outline:none;border-color:var(--accent);}
.rules-input{font-family:var(--font);font-size:13px;padding:8px 10px;border:1px solid var(--border);border-radius:7px;background:#fff;color:var(--t1);width:100%;}
.rules-input:focus{outline:none;border-color:var(--accent);}
.rules-actions{display:flex;gap:8px;margin-top:8px;}
.rules-save{padding:7px 14px;border:none;border-radius:6px;background:var(--accent);color:#fff;font-family:var(--font);font-size:12px;font-weight:600;cursor:pointer;}
.rules-save:hover{background:var(--accent2);}
.rules-cancel{padding:7px 14px;border:1px solid var(--border);border-radius:6px;background:#fff;color:var(--t2);font-family:var(--font);font-size:12px;font-weight:600;cursor:pointer;}
.rules-cancel:hover{border-color:var(--border2);color:var(--t1);}
.rules-save:disabled{opacity:.4;cursor:not-allowed;}

/* Assets list */
.asset-list{display:flex;flex-direction:column;gap:6px;}
.asset-row{display:flex;align-items:center;gap:10px;padding:8px;border-radius:8px;cursor:pointer;transition:all .12s;border:1px solid transparent;}
.asset-row:hover{background:var(--bg2);}
.asset-row.active{background:var(--accentL);border-color:var(--accent);}
.asset-row-thumb{width:44px;height:30px;border-radius:5px;background:var(--bg3);overflow:hidden;flex-shrink:0;position:relative;}
.asset-row-thumb img{width:100%;height:100%;object-fit:cover;}
.asset-row-quote{width:100%;height:100%;display:grid;place-items:center;font-family:var(--serif);font-size:20px;color:#fff;}
.asset-row-info{flex:1;min-width:0;}
.asset-row-co{font-size:12.5px;font-weight:600;color:var(--t1);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.asset-row-meta{font-size:10.5px;color:var(--t3);}
.asset-row-status{width:6px;height:6px;border-radius:50%;flex-shrink:0;}
.asset-row-status.active{background:var(--green);}
.asset-row-status.inactive{background:var(--red);}
.asset-search{width:100%;padding:7px 10px;border-radius:7px;border:1px solid var(--border);background:var(--bg);color:var(--t1);font-family:var(--font);font-size:12px;margin-bottom:12px;}
.asset-search:focus{outline:none;border-color:var(--accent);}

/* Edit view */
.ap-edit-head{display:flex;align-items:center;gap:8px;margin-bottom:6px;}
.ap-back{padding:4px 8px;border-radius:5px;border:1px solid var(--border);background:#fff;color:var(--t3);font-size:11px;font-weight:600;cursor:pointer;font-family:var(--font);}
.ap-back:hover{color:var(--t1);border-color:var(--border2);}
.ap-preview-btn{margin-left:auto;padding:5px 12px;border-radius:6px;border:1px solid var(--accent);background:var(--accentL);color:var(--accent);font-family:var(--font);font-size:11px;font-weight:700;cursor:pointer;}
.ap-preview-btn:hover{background:var(--accent);color:#fff;}
.edit-form .fgrp{margin-bottom:12px;}
.edit-form label{font-size:10px;text-transform:uppercase;letter-spacing:1px;color:var(--t4);font-weight:700;margin-bottom:4px;display:block;}
.edit-form .fin,.edit-form .ftxt,.edit-form .fss{width:100%;padding:7px 10px;border-radius:6px;border:1px solid var(--border);background:#fff;color:var(--t1);font-family:var(--font);font-size:12.5px;}
.edit-form .fin:focus,.edit-form .ftxt:focus,.edit-form .fss:focus{outline:none;border-color:var(--accent);box-shadow:0 0 0 2px var(--accentL);}
.edit-form .ftxt{min-height:100px;resize:vertical;line-height:1.55;}
.edit-form .fss{appearance:none;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 24 24' fill='none' stroke='%238888a0' stroke-width='2.5'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right 8px center;cursor:pointer;}
.edit-form .frow{display:grid;grid-template-columns:1fr 1fr;gap:10px;}
.edit-save{position:sticky;bottom:0;background:#fff;padding:14px 0 4px;border-top:1px solid var(--border);margin-top:14px;display:flex;gap:6px;}
.edit-save button{flex:1;padding:9px;border-radius:7px;border:none;font-family:var(--font);font-size:12px;font-weight:700;cursor:pointer;}
.save-btn{background:var(--accent);color:#fff;}.save-btn:hover{background:var(--accent2);}
.del-btn{background:var(--bg2);color:var(--red);border:1px solid var(--border);max-width:80px;}.del-btn:hover{background:var(--red);color:#fff;border-color:var(--red);}

/* Import */
.imp-textarea{width:100%;min-height:100px;padding:12px 14px;border-radius:10px;border:1.5px solid var(--border);background:#fff;color:var(--t1);font-family:var(--font);font-size:12.5px;line-height:1.55;resize:vertical;transition:all .12s;}
.imp-textarea:focus{outline:none;border-color:var(--accent);box-shadow:0 0 0 3px var(--accentL);}
.imp-textarea::placeholder{color:var(--t4);}
.imp-hint{font-size:11px;color:var(--t3);line-height:1.5;margin:8px 0 14px;padding:10px 12px;background:var(--bg2);border-radius:7px;border-left:2px solid var(--accent);}
.imp-hint strong{color:var(--t1);font-weight:600;}
.imp-preview{margin:12px 0;}
.imp-preview-head{font-size:10px;text-transform:uppercase;letter-spacing:1px;color:var(--t4);font-weight:700;margin-bottom:8px;}
.imp-item{display:flex;align-items:center;gap:10px;padding:10px 12px;background:#fff;border:1px solid var(--border);border-radius:8px;margin-bottom:6px;font-size:12px;}
.imp-item-type{padding:2px 7px;border-radius:10px;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;flex-shrink:0;}
.imp-item-type.yt{background:#ffe5e5;color:#c81515;}
.imp-item-type.vm{background:#e5f3ff;color:#1580b8;}
.imp-item-type.unk{background:var(--bg2);color:var(--t4);}
.imp-item-url{flex:1;color:var(--t2);font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:10.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.imp-item-status{font-size:10px;font-weight:600;flex-shrink:0;}
.imp-item-status.pending{color:var(--t4);}
.imp-item-status.fetching{color:var(--accent);}
.imp-item-status.enriching{color:#d97706;}
.imp-item-status.done{color:var(--green);}
.imp-item-status.partial{color:#d97706;}
.imp-item-status.error{color:var(--red);}
.imp-go-btn{width:100%;padding:10px;border-radius:8px;border:none;background:var(--accent);color:#fff;font-family:var(--font);font-size:13px;font-weight:700;cursor:pointer;transition:all .12s;}
.imp-go-btn:hover{background:var(--accent2);}
.imp-go-btn:disabled{opacity:.4;cursor:not-allowed;}
.imp-res{margin-top:10px;padding:10px 12px;background:var(--accentLL);border:1px solid var(--accentL);border-radius:7px;font-size:11.5px;color:var(--accent);font-weight:600;}
.imp-res.err{background:#fff5f5;border-color:#ffdddd;color:var(--red);}
.imp-spin{display:inline-block;width:10px;height:10px;border:1.5px solid currentColor;border-top-color:transparent;border-radius:50%;animation:sp .7s linear infinite;margin-right:4px;vertical-align:-1px;}

/* Sources manager */
.src-tabs{display:flex;gap:4px;margin-bottom:18px;padding-bottom:12px;border-bottom:1px solid var(--border);}
.src-tab{padding:6px 14px;border-radius:16px;border:1px solid var(--border);background:#fff;color:var(--t3);font-size:11.5px;font-weight:600;cursor:pointer;font-family:var(--font);transition:all .12s;}
.src-tab.on{background:var(--accentL);border-color:var(--accent);color:var(--accent);}
.src-add-new{width:100%;padding:12px;border-radius:8px;border:1.5px dashed var(--border2);background:var(--bg);color:var(--t2);font-family:var(--font);font-size:12.5px;font-weight:600;cursor:pointer;transition:all .12s;margin-bottom:14px;}
.src-add-new:hover{border-color:var(--accent);color:var(--accent);background:var(--accentLL);}
.src-empty{text-align:center;padding:40px 20px;color:var(--t4);}
.src-empty svg{width:36px;height:36px;color:var(--border2);margin-bottom:10px;}
.src-empty h4{font-family:var(--serif);font-size:15px;color:var(--t3);margin-bottom:4px;font-weight:600;}
.src-empty p{font-size:11.5px;color:var(--t4);line-height:1.5;}
.src-list{display:flex;flex-direction:column;gap:8px;}
.src-card{border:1px solid var(--border);border-radius:10px;background:#fff;padding:12px 14px;transition:all .12s;}
.src-card:hover{border-color:var(--border2);}
/* Compact variant for single-video sources — sits below showcases as a
   thinner row. Keeps full functionality but trims visual weight. */
.src-card.mini{padding:8px 12px;border-radius:8px;background:var(--bg);}
.src-card.mini .src-card-icon{width:22px;height:22px;font-size:10px;}
.src-card.mini .src-card-name{font-size:12px;}
.src-card.mini .src-card-sub{font-size:10px;}
.src-card.mini .src-card-top{margin-bottom:0;}
.src-card.mini .src-card-url{display:none;}
.src-card.mini .src-auto-btn{font-size:10px;padding:1px 3px;}
.src-card-top{display:flex;align-items:center;gap:8px;margin-bottom:8px;}
.src-card-icon{width:28px;height:28px;border-radius:7px;display:grid;place-items:center;flex-shrink:0;font-weight:700;font-size:11px;}
.src-card-icon.vm{background:#e5f3ff;color:#1580b8;}
.src-card-icon.yt{background:#ffe5e5;color:#c81515;}
.src-card-info{flex:1;min-width:0;}
.src-card-name{font-size:13px;font-weight:600;color:var(--t1);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.src-card-sub{font-size:10.5px;color:var(--t3);display:flex;align-items:center;gap:5px;margin-top:1px;}
.src-card-actions{display:flex;gap:4px;flex-shrink:0;}
.src-act-btn{width:26px;height:26px;border-radius:6px;border:1px solid var(--border);background:#fff;color:var(--t3);cursor:pointer;display:grid;place-items:center;transition:all .12s;}
.src-act-btn:hover{border-color:var(--accent);color:var(--accent);background:var(--accentLL);}
.src-act-btn.danger:hover{border-color:var(--red);color:var(--red);background:#fff5f5;}
.src-act-btn:disabled{opacity:.4;cursor:not-allowed;}
.src-card-url{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:10px;color:var(--t4);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;padding:5px 8px;background:var(--bg2);border-radius:5px;}
.src-sync-dot{width:6px;height:6px;border-radius:50%;display:inline-block;}
.src-sync-dot.synced{background:var(--green);}
.src-sync-dot.never{background:var(--t4);}
.src-sync-dot.syncing{background:var(--accent);animation:pulse 1s infinite;}
.src-sync-dot.error{background:var(--red);}

/* Per-source auto-sync row + popover */
.src-auto-row{position:relative;margin-top:4px;}
.src-auto-btn{display:inline-flex;align-items:center;gap:5px;background:none;border:none;padding:2px 4px;border-radius:5px;color:var(--t3);font-family:var(--font);font-size:10.5px;font-weight:500;cursor:pointer;}
.src-auto-btn:hover{background:var(--bg2);color:var(--t1);}
.src-auto-btn.on{color:var(--accent);}
.src-auto-btn.on svg{color:var(--accent);}
.src-auto-pop{position:absolute;top:calc(100% + 4px);left:0;width:240px;background:#fff;border:1px solid var(--border);border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,.12);padding:6px;z-index:30;}
.src-auto-pop-head{font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--t3);padding:5px 7px 7px;}
.src-auto-opt{display:flex;align-items:center;gap:8px;width:100%;padding:7px 9px;background:none;border:none;border-radius:5px;cursor:pointer;color:var(--t1);font-family:var(--font);font-size:12px;text-align:left;}
.src-auto-opt:hover{background:var(--bg2);}
.src-auto-opt.on{color:var(--accent);}
.src-auto-opt-radio{display:inline-block;width:14px;color:var(--accent);font-size:14px;line-height:1;}
.src-auto-pop-meta{font-size:10.5px;color:var(--t3);padding:7px 9px 4px;border-top:1px dashed var(--border);margin-top:4px;line-height:1.4;}

/* ── INLINE SYNC REPORT under each source row ── */
.src-sync-report{margin-top:8px;border-top:1px dashed var(--border);padding-top:6px;}
.src-sync-report-toggle{display:flex;align-items:center;justify-content:space-between;width:100%;background:none;border:none;padding:5px 2px;cursor:pointer;font-family:var(--font);font-size:11px;font-weight:500;color:var(--t3);text-align:left;}
.src-sync-report-toggle:hover{color:var(--t1);}
.src-sync-report.open .src-sync-report-toggle{color:var(--t1);}
.src-sync-report-summary{flex:1;line-height:1.4;}
.src-sync-report-chev{font-size:10px;color:var(--t4);margin-left:8px;}
.src-sync-report-body{margin-top:8px;display:flex;flex-direction:column;gap:10px;}
.ssr-section{background:var(--bg2);border-radius:7px;padding:8px 9px;}
.ssr-section-head{font-size:11.5px;font-weight:600;color:var(--t1);margin-bottom:3px;letter-spacing:.1px;display:flex;align-items:center;gap:6px;}
.ssr-count{font-size:11.5px;font-weight:700;color:var(--t1);}
.ssr-icon{flex-shrink:0;color:var(--t3);display:inline-flex;align-items:center;justify-content:center;}
.ssr-section-help{font-size:10.5px;color:var(--t3);margin-bottom:7px;line-height:1.4;}
.ssr-row{padding:6px 0;border-top:1px solid var(--border);}
.ssr-row:first-of-type{border-top:none;padding-top:2px;}
.ssr-row.compact{padding:4px 0;}
.ssr-row-title{font-size:12px;font-weight:600;color:var(--t1);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.ssr-row-meta{font-size:10.5px;color:var(--t3);margin-top:1px;}
.ssr-row-when{font-size:10.5px;color:var(--t3);margin-top:1px;}
.ssr-row-meta .ssr-when-sep{margin:0 5px;color:var(--border);}
.ssr-row-actions{display:flex;gap:5px;margin-top:5px;flex-wrap:wrap;}
.ssr-btn{padding:3px 9px;border:1px solid var(--border);border-radius:5px;background:#fff;color:var(--t2);font-family:var(--font);font-size:10.5px;font-weight:600;cursor:pointer;}
.ssr-btn:hover{background:var(--bg2);color:var(--t1);}
/* Subtle outlined accent — purple text on white, light purple fill on hover.
   Avoids the heavy solid-purple "marketing CTA" look in this admin context. */
.ssr-btn.primary{background:#fff;color:var(--accent);border-color:var(--accentL);}
.ssr-btn.primary:hover{background:var(--accentLL);border-color:var(--accent);}
/* Bottom row: Mark all reviewed (left) + Resync all Vimeo properties (right). */
.ssr-foot-row{display:flex;align-items:center;justify-content:space-between;gap:10px;padding-top:4px;}
.ssr-mark-reviewed-link,.ssr-pull-all-link{background:none;border:none;font-family:var(--font);font-size:10.5px;font-weight:500;cursor:pointer;text-decoration:underline;padding:4px 0;}
.ssr-mark-reviewed-link{color:var(--t3);text-decoration-color:var(--border2);}
.ssr-mark-reviewed-link:hover{color:var(--accent);text-decoration-color:var(--accent);}
/* Pull-all is intentionally subtle and turns red on hover — overwrites manual edits. */
.ssr-pull-all-link{color:var(--t3);text-decoration-color:var(--border2);margin-left:auto;}
.ssr-pull-all-link:hover{color:var(--red);text-decoration-color:var(--red);}
.src-progress{margin-top:10px;padding:10px 12px;background:var(--accentLL);border-radius:7px;border-left:2px solid var(--accent);font-size:11.5px;color:var(--accent);line-height:1.55;}
.src-progress-step{display:flex;align-items:center;gap:6px;}
.src-add-form{padding:14px;background:var(--bg);border-radius:10px;border:1px solid var(--border);margin-bottom:14px;}
.src-add-form label{font-size:10px;text-transform:uppercase;letter-spacing:1px;color:var(--t4);font-weight:700;display:block;margin-bottom:4px;}
.src-add-form input{width:100%;padding:8px 11px;border-radius:7px;border:1px solid var(--border);background:#fff;color:var(--t1);font-family:var(--font);font-size:12.5px;margin-bottom:10px;}
.src-add-form input:focus{outline:none;border-color:var(--accent);box-shadow:0 0 0 3px var(--accentL);}
.src-detect{margin:-4px 0 10px;font-size:10.5px;color:var(--t3);display:flex;align-items:center;gap:5px;}
.src-form-btns{display:flex;gap:6px;}
.src-form-btns button{flex:1;padding:8px;border-radius:7px;border:none;font-family:var(--font);font-size:12px;font-weight:700;cursor:pointer;}
.src-form-btns .cancel{background:var(--bg2);color:var(--t2);}
.src-form-btns .add{background:var(--accent);color:#fff;}
.src-form-btns .add:disabled{opacity:.4;cursor:not-allowed;}

/* Main area takes remaining space */
.main-area{flex:1;min-width:0;display:flex;flex-direction:column;overflow-x:hidden;}
.main-area.preview-mode{overflow-y:auto;}

/* Full-page preview takeover */
.preview-banner{background:var(--accentL);border-bottom:1px solid var(--accent);padding:10px 32px;display:flex;align-items:center;gap:10px;}
.preview-banner-text{font-size:12px;color:var(--accent);font-weight:600;}
.preview-exit{margin-left:auto;padding:5px 12px;border-radius:6px;border:1px solid var(--accent);background:#fff;color:var(--accent);font-family:var(--font);font-size:11px;font-weight:700;cursor:pointer;}
.preview-exit:hover{background:var(--accent);color:#fff;}
.badge{font-size:11px;color:var(--t3);padding:4px 11px;background:var(--bg2);border-radius:14px;font-weight:600;}

/* ── SEARCH AREA ── */
.search-area{display:flex;flex-direction:column;align-items:center;padding:20px 32px 0;position:relative;z-index:40;}
.search-bar{display:flex;align-items:center;gap:10px;max-width:740px;width:100%;padding:10px 10px 10px 18px;background:#fff;border:1.5px solid var(--border);border-radius:50px;transition:all .2s;box-shadow:0 1px 3px rgba(0,0,0,.04);}
.search-bar.sm-active{border-color:var(--accent);border-radius:16px 16px 0 0;box-shadow:0 0 0 4px var(--accentL);}
.search-bar svg{flex-shrink:0;color:var(--t4);}
.search-input{flex:1;border:none;background:none;font-family:var(--font);font-size:14px;color:var(--t1);outline:none;}
.search-input::placeholder{color:var(--t4);}
.sm-btn{display:flex;align-items:center;gap:6px;padding:7px 16px;border-radius:50px;border:1.5px solid var(--accentL);background:var(--accentLL);color:var(--accent);font-family:var(--font);font-size:12.5px;font-weight:600;cursor:pointer;transition:all .15s;white-space:nowrap;}
.sm-btn:hover{background:var(--accentL);border-color:var(--accent);}
.sm-btn.active{background:var(--accent);color:#fff;border-color:var(--accent);}

/* ── STORYMATCH DROPDOWN (overlay, spacious) ── */
.sm-dropdown-wrap{position:absolute;top:100%;left:50%;transform:translateX(-50%);max-width:740px;width:100%;z-index:45;padding-top:0;}
.sm-dropdown{width:100%;background:#fff;border:1.5px solid var(--accent);border-top:none;border-radius:0 0 20px 20px;box-shadow:0 20px 60px rgba(109,40,217,.12),0 4px 16px rgba(0,0,0,.06);overflow:hidden;animation:smDrop .3s cubic-bezier(.4,0,.2,1);}
@keyframes smDrop{from{opacity:0;transform:translateY(-12px)}to{opacity:1;transform:translateY(0)}}
.sm-inner{padding:36px 40px 40px;}
.sm-hero-text{text-align:center;margin-bottom:24px;}
.sm-hero-text h3{font-family:var(--serif);font-size:22px;font-weight:600;letter-spacing:-.3px;margin-bottom:8px;}
.sm-hero-text p{font-size:14px;color:var(--t3);line-height:1.6;max-width:500px;margin:0 auto;}
.sm-modes{display:flex;justify-content:center;gap:6px;margin-bottom:22px;}
.sm-mode{padding:7px 18px;border-radius:20px;border:1px solid var(--border);background:#fff;color:var(--t3);font-size:12.5px;font-weight:600;cursor:pointer;font-family:var(--font);transition:all .12s;}
.sm-mode.on{background:var(--accentL);border-color:var(--accent);color:var(--accent);}
.sm-qbox{position:relative;margin-bottom:22px;}
.sm-qinput{width:100%;padding:16px 100px 16px 20px;border-radius:14px;border:1.5px solid var(--border2);background:var(--bg);color:var(--t1);font-family:var(--font);font-size:15px;transition:all .15s;}
.sm-qinput::placeholder{color:var(--t4);}
.sm-qinput:focus{outline:none;border-color:var(--accent);box-shadow:0 0 0 3px var(--accentL);}
.sm-go{position:absolute;right:6px;top:50%;transform:translateY(-50%);padding:10px 24px;border-radius:10px;border:none;background:var(--accent);color:#fff;font-family:var(--font);font-size:13.5px;font-weight:700;cursor:pointer;transition:all .12s;}
.sm-go:hover{background:var(--accent2);}
.sm-go:disabled{opacity:.4;cursor:not-allowed;}
.sm-chips{display:flex;flex-wrap:wrap;gap:7px;justify-content:center;}
.sm-chip{padding:6px 15px;border-radius:18px;border:1px solid var(--border);background:#fff;color:var(--t3);font-size:11.5px;cursor:pointer;font-weight:500;font-family:var(--font);transition:all .12s;line-height:1.35;text-align:left;}
.sm-chip:hover{border-color:var(--accent);color:var(--accent2);}
.sm-hint{text-align:center;font-size:11.5px;color:var(--t4);margin-top:12px;}
.sm-loading-inline{text-align:center;padding:28px 0 12px;font-size:14px;color:var(--accent);font-weight:600;display:flex;align-items:center;justify-content:center;gap:8px;}
.sm-scrim{position:fixed;inset:0;z-index:39;background:rgba(0,0,0,.08);animation:fadeIn .2s;}

/* ── FILTERS (multi-select dropdowns) ── */
.filters-wrap{max-width:1360px;margin:0 auto;padding:16px 32px 0;width:100%;display:flex;gap:12px;flex-wrap:wrap;align-items:flex-end;}
.filter-group{display:flex;flex-direction:column;gap:4px;position:relative;}
.filter-label{font-size:10px;text-transform:uppercase;letter-spacing:1.2px;color:var(--t4);font-weight:700;}
.filter-trigger{display:flex;align-items:center;gap:6px;padding:6px 30px 6px 12px;border-radius:var(--r3);border:1px solid var(--border);background:#fff;color:var(--t1);font-family:var(--font);font-size:12px;font-weight:500;cursor:pointer;transition:all .12s;position:relative;min-width:120px;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 24 24' fill='none' stroke='%238888a0' stroke-width='2.5'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right 9px center;user-select:none;}
.filter-trigger:hover{border-color:var(--border2);}
.filter-trigger.open{border-color:var(--accent);box-shadow:0 0 0 3px var(--accentL);}
.filter-trigger .f-count{background:var(--accent);color:#fff;font-size:10px;font-weight:700;padding:1px 6px;border-radius:10px;margin-left:2px;}
.filter-dd{position:absolute;top:100%;left:0;margin-top:4px;min-width:180px;background:#fff;border:1px solid var(--border);border-radius:var(--r2);box-shadow:0 8px 30px rgba(0,0,0,.1);z-index:30;padding:6px;animation:fadeIn .15s;}
.filter-dd-item{display:flex;align-items:center;gap:8px;padding:7px 10px;border-radius:6px;font-size:12px;font-weight:500;color:var(--t2);cursor:pointer;transition:all .1s;user-select:none;}
.filter-dd-item:hover{background:var(--bg2);color:var(--t1);}
.filter-dd-item .f-check{width:16px;height:16px;border-radius:4px;border:1.5px solid var(--border2);display:grid;place-items:center;transition:all .12s;flex-shrink:0;}
.filter-dd-item.on .f-check{background:var(--accent);border-color:var(--accent);}
.filter-dd-item.on .f-check::after{content:'✓';color:#fff;font-size:10px;font-weight:700;}
.filter-dd-item.on{color:var(--t1);font-weight:600;}
.fclear{padding:6px 12px;border-radius:var(--r3);border:1px solid var(--border);background:none;color:var(--t4);font-size:11px;font-weight:600;cursor:pointer;font-family:var(--font);align-self:flex-end;}
.fclear:hover{border-color:var(--red);color:var(--red);}

/* ── SM STATUS BAR ── */
.sm-status{max-width:1360px;margin:0 auto;padding:14px 32px 0;display:flex;align-items:center;gap:10px;width:100%;}
.sm-status-dot{width:8px;height:8px;border-radius:50%;background:var(--accent);animation:pulse 1.5s infinite;}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
.sm-status-text{font-size:12px;color:var(--accent);font-weight:600;}
.sm-status-clear{font-size:11px;color:var(--t4);font-weight:600;cursor:pointer;margin-left:auto;padding:4px 10px;border-radius:12px;border:1px solid var(--border);background:#fff;font-family:var(--font);transition:all .12s;}
.sm-status-clear:hover{border-color:var(--red);color:var(--red);}

/* ── GRID ── */
.lib-wrap{max-width:1360px;margin:0 auto;padding:20px 32px 60px;width:100%;}
/* Grid is 3-up at desktop, collapses to 2-up then 1-up. Multiples of 6
   align cleanly at every breakpoint (lcm of 2 and 3). */
.grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:38px 22px;}
@media (max-width:1100px){.grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:32px 18px;}}
@media (max-width:680px){.grid{grid-template-columns:1fr;gap:28px;}}

/* ── THUMBNAIL CARD — disconnected thumbnail + title.
   No card chrome wraps the pair; the thumbnail is the visual element
   and gets the shadow lift on hover. Title sits below on the page bg. */
.card{position:relative;background:transparent;cursor:pointer;}
.card-thumb{position:relative;width:100%;aspect-ratio:16/9;overflow:hidden;background:var(--bg3);border-radius:var(--r);box-shadow:0 1px 2px rgba(0,0,0,.04);transition:box-shadow .4s cubic-bezier(.4,0,.2,1);}
.card:hover .card-thumb{box-shadow:0 18px 44px rgba(0,0,0,.13),0 6px 14px rgba(0,0,0,.06);}
.card-thumb img{width:100%;height:100%;object-fit:cover;transition:transform .7s cubic-bezier(.2,.8,.2,1),filter .35s ease;filter:brightness(.97);}
.card:hover .card-thumb img{transform:scale(1.045);filter:brightness(1.03);}

/* Watch / Read corner badge — frosted glass, sits on the thumbnail,
   doubles as duration / read-time. The only visible cue distinguishing
   a video asset from a written case study at grid-glance scale. */
.card-badge{position:absolute;bottom:8px;right:8px;background:rgba(20,20,28,.55);color:rgba(255,255,255,.94);font-size:10.5px;padding:3px 7px;border-radius:4px;font-weight:500;display:inline-flex;align-items:center;gap:4px;letter-spacing:.01em;backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);font-family:var(--font);}
/* .play-over / .play-circle / .card-overlay rules removed — overlays were
   misleading (clicking opens the landing page, not the video) and the CTA
   is now reached via the "watch →" affordance in the card body below. */
/* Title only — no client name, no "watch →" arrow, no governance dots
   in grid view. Bigger editorial headline; status / cleared dots live
   in list view where management actually happens. */
.card-body{padding:14px 4px 0;}
.card-headline{font-size:17px;font-weight:600;color:var(--t1);line-height:1.38;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;letter-spacing:-.012em;margin:0;}
.card-co{display:none;}
.card-co-name{display:flex;align-items:center;gap:7px;}
.vdot{width:6px;height:6px;border-radius:50%;flex-shrink:0;}
/* Cleared-status colors for the in-card dot — match the list-view cl-circle
   palette so admins see consistent governance status across both views. */
.vdot.cl-green{background:var(--green);}
.vdot.cl-yellow{background:var(--amber);}
.vdot.cl-red{background:var(--red);}
/* Custom-color flag dots use inline style.background, but we still need
   .cl-custom to register so the tooling/cascade doesn't treat the class
   as missing. Empty rule is intentional. */
.vdot.cl-custom{}
/* Custom-status dots on grid cards — sit inline with the cleared
   indicator. Same size; no chip wrapper. Small left margin so they
   read as a row of dots, not bunched together. */
.card-flag-dot{margin-left:4px;}
/* Button form of the dot — clickable to open the Cleared popover. Slightly
   larger hit area than the visual would suggest, and a hover bump for affordance. */
.vdot.vdot-btn{border:none;padding:0;cursor:pointer;width:9px;height:9px;transition:transform .12s;}
.vdot.vdot-btn:hover{transform:scale(1.3);}
.vdot.vdot-btn:focus{outline:2px solid var(--accent);outline-offset:1px;}
.card-vert{font-size:11px;color:var(--t4);font-weight:500;}

/* ── AI ENRICHMENT on card ── */
.card-ai{padding:0 14px 14px;}
.card-ai-reason{font-size:11.5px;color:var(--t2);line-height:1.5;padding:10px 12px;background:var(--accentLL);border-radius:var(--r3);margin-bottom:8px;border-left:2px solid var(--accent);}
.card-ai-q{font-size:11.5px;color:var(--t2);font-style:italic;font-family:var(--serif);line-height:1.45;padding:6px 10px;background:var(--bg2);border-radius:var(--r3);margin-bottom:4px;cursor:pointer;transition:all .1s;position:relative;}
.card-ai-q:hover{background:var(--bg3);}
.card-ai-q::after{content:'copy';position:absolute;right:8px;top:50%;transform:translateY(-50%);font-size:9px;font-family:var(--font);font-style:normal;color:var(--t4);font-weight:600;text-transform:uppercase;letter-spacing:.5px;opacity:0;transition:opacity .15s;}
.card-ai-q:hover::after{opacity:1;}
.card-rank{position:absolute;top:12px;left:12px;width:28px;height:28px;border-radius:8px;background:var(--accent);color:#fff;font-size:12px;font-weight:700;display:grid;place-items:center;z-index:2;box-shadow:0 2px 8px rgba(109,40,217,.3);}

/* ── NON-PUBLISHED ASSET TREATMENT (archived + draft) ── */
.card.archived,.qcard.archived,.card.draft,.qcard.draft{opacity:.55;}
.card.archived:hover,.qcard.archived:hover,.card.draft:hover,.qcard.draft:hover{opacity:.8;}
.card.archived .card-thumb img,.qcard.archived .qcard-bg,.card.draft .card-thumb img,.qcard.draft .qcard-bg{filter:grayscale(.9);}
.status-badge{position:absolute;top:10px;right:10px;font-size:9.5px;font-weight:700;letter-spacing:.5px;text-transform:uppercase;padding:4px 7px;border-radius:5px;z-index:3;border:1px solid;}
.status-badge.archived{background:var(--amberL);color:var(--amber);border-color:var(--amber);}
.status-badge.draft{background:var(--bg2);color:var(--t2);border-color:var(--border2);}
.archived-restore{position:absolute;bottom:10px;right:10px;background:#fff;color:var(--accent);font-size:11px;font-weight:600;padding:5px 9px;border-radius:6px;border:1px solid var(--accent);cursor:pointer;z-index:3;font-family:var(--font);opacity:0;transition:opacity .2s;}
.card.archived:hover .archived-restore,.qcard.archived:hover .archived-restore{opacity:1;}
.archived-restore:hover{background:var(--accent);color:#fff;}

/* ── LIFECYCLE PILLS — used in both list view and detail/edit ── */
.lc-pill{display:inline-flex;align-items:center;gap:5px;font-size:10.5px;font-weight:600;letter-spacing:.3px;text-transform:uppercase;padding:3px 8px;border-radius:4px;border:1px solid;white-space:nowrap;}
.lc-pill.published,.lc-pill.active{background:#ecfdf5;color:var(--green);border-color:#a7f3d0;}
.lc-pill.archived{background:var(--amberL);color:var(--amber);border-color:#fcd34d;}
.lc-pill.draft{background:var(--bg2);color:var(--t3);border-color:var(--border2);}
.lc-pill.current{background:#ecfdf5;color:var(--green);border-color:#a7f3d0;}
.lc-pill.former{background:#fef2f2;color:var(--red);border-color:#fecaca;}
.lc-pill.unknown{background:var(--bg2);color:var(--t3);border-color:var(--border2);}

/* ── VIEW MODE TOGGLE (admin only) ── */
.view-toggle{display:flex;height:32px;border:1px solid var(--border);border-radius:8px;overflow:hidden;background:#fff;}
.view-toggle-btn{height:100%;padding:0 10px;background:none;border:none;cursor:pointer;color:var(--t3);display:grid;place-items:center;}
.view-toggle-btn.on{background:var(--accentLL);color:var(--accent);}
.view-toggle-btn:hover:not(.on){background:var(--bg2);}
.view-toggle-btn+.view-toggle-btn{border-left:1px solid var(--border);}

/* ── LIBRARY CONTROL BAR ── select-all + count + view toggle, sits above the content.
    Matches .lib-wrap's max-width and horizontal padding so it aligns with the grid. */
.lib-bar{max-width:1360px;width:100%;margin:0 auto;padding:18px 32px 8px;display:flex;align-items:center;justify-content:space-between;gap:14px;}
.lib-bar-l{display:flex;align-items:center;gap:14px;}
.lib-selectall{display:inline-flex;align-items:center;gap:8px;font-family:var(--font);font-size:12.5px;font-weight:600;color:var(--t2);cursor:pointer;user-select:none;}
.lib-selectall input{width:16px;height:16px;accent-color:var(--accent);cursor:pointer;}
.lib-selectall:hover{color:var(--t1);}
.lib-count{font-family:var(--font);font-size:12.5px;color:var(--t3);padding-left:14px;border-left:1px solid var(--border);}

/* Right side of the lib bar: Filter / Sort / view toggle / + Add. */
.lib-bar-r{display:flex;align-items:center;gap:10px;}
.lib-btn{display:inline-flex;align-items:center;gap:6px;height:32px;padding:0 12px;border:1px solid var(--border);border-radius:8px;background:#fff;color:var(--t1);font-family:var(--font);font-size:12.5px;font-weight:500;cursor:pointer;transition:border-color .12s,background .12s;}
.lib-btn:hover{border-color:var(--border2);}
.lib-btn.on{border-color:var(--accent);color:var(--accent);background:var(--accentLL);}
.lib-btn.primary{background:var(--accent);color:#fff;border-color:var(--accent);}
.lib-btn.primary:hover{background:var(--accent2);border-color:var(--accent2);}
.lib-btn .lib-btn-count{display:inline-flex;align-items:center;justify-content:center;min-width:16px;height:16px;padding:0 5px;border-radius:8px;background:var(--accent);color:#fff;font-size:10px;font-weight:700;margin-left:4px;}

/* Popovers anchored under the lib-bar buttons. Position via .lib-btn-wrap
   parent (relative). Opens with a quick fade. */
.lib-btn-wrap{position:relative;}
.lib-menu{position:absolute;top:calc(100% + 6px);right:0;background:#fff;border:1px solid var(--border);border-radius:10px;box-shadow:0 12px 32px rgba(0,0,0,.1);min-width:200px;z-index:40;padding:6px;animation:libMenuIn .14s cubic-bezier(.4,0,.2,1);}
@keyframes libMenuIn{from{opacity:0;transform:translateY(-4px);}to{opacity:1;transform:translateY(0);}}
.lib-menu-section{padding:6px 8px 4px;font-size:10.5px;font-weight:700;color:var(--t3);text-transform:uppercase;letter-spacing:.5px;}
.lib-menu-item{display:flex;align-items:center;gap:8px;padding:8px 10px;border-radius:6px;cursor:pointer;font-size:13px;color:var(--t1);user-select:none;}
.lib-menu-item:hover{background:var(--bg2);}
.lib-menu-item.on{background:var(--accentLL);color:var(--accent);font-weight:600;}
.lib-menu-item.disabled{color:var(--t4);cursor:not-allowed;}
.lib-menu-item.disabled:hover{background:transparent;}
.lib-menu-item .lib-menu-check{width:14px;height:14px;flex-shrink:0;color:var(--accent);visibility:hidden;}
.lib-menu-item.on .lib-menu-check{visibility:visible;}
.lib-menu-divider{height:1px;background:var(--border);margin:4px -6px;}
.lib-menu-clear{padding:6px 10px;color:var(--t3);font-size:12px;cursor:pointer;border-top:1px solid var(--border);margin-top:4px;}
.lib-menu-clear:hover{color:var(--accent);}

/* ── LIST VIEW ── */
/* Allow horizontal scroll instead of squishing rows when the viewport gets
   narrow. Rows have a min-width below so columns stay readable. */
.lv{width:100%;border:1px solid var(--border);border-radius:var(--r2);background:#fff;overflow-x:auto;}
/* Five columns: thumb | title | vertical | merged-status | actions.
   The merged-status column groups Publication + Cleared into one block.
   min-width on both head + row prevents horizontal squish — when the
   container is too narrow, the parent .lv scrolls instead of crushing. */
/* Six grid tracks: thumb | title | vertical | visibility | status | actions.
   Visibility is content-sized (just the dropdown), Status takes the remaining
   space so the cleared trigger has room to breathe. */
.lv-head{display:grid;grid-template-columns:72px minmax(200px,2fr) minmax(110px,1fr) 110px minmax(150px,1fr) 90px;gap:14px;padding:11px 14px;background:var(--bg2);border-bottom:1px solid var(--border);font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--t3);border-radius:var(--r2) var(--r2) 0 0;min-width:920px;}
.lv-row{display:grid;grid-template-columns:72px minmax(200px,2fr) minmax(110px,1fr) 110px minmax(150px,1fr) 90px;gap:14px;padding:10px 14px;align-items:center;border-bottom:1px solid var(--border);font-size:13px;cursor:pointer;transition:background .15s;position:relative;min-width:920px;}
/* Merged status cell — Publication on the left (content-sized, only as
   wide as its longest option), Cleared dot/text on the right (takes
   remaining space). Both content-sized prevents inconsistent dropdown
   widths between rows. */
/* Visibility cell — just the publication dropdown, content-sized. */
.lv-visibility{display:flex;align-items:center;}
/* Status cell — cleared indicator trigger, plus any custom-status chips
   stacked below. flex-wrap lets the chips fall to a second line when the
   cell is narrow. */
.lv-statuscell{display:flex;flex-wrap:wrap;align-items:center;gap:6px;min-width:0;}
.lv-head > div:nth-child(4){padding-left:0;}
.lv-row:last-child{border-bottom:none;border-radius:0 0 var(--r2) var(--r2);}
.lv-row:hover{background:var(--bg2);}
.lv-row.archived,.lv-row.draft{opacity:.65;}
.lv-thumb{width:72px;height:48px;border-radius:6px;overflow:hidden;background:var(--bg3);position:relative;}
.lv-thumb img{width:100%;height:100%;object-fit:cover;}
.lv-row.archived .lv-thumb img,.lv-row.draft .lv-thumb img{filter:grayscale(.9);}
.lv-title{display:flex;flex-direction:column;gap:2px;min-width:0;}
.lv-title-h{font-weight:600;color:var(--t1);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.lv-title-c{font-size:11.5px;color:var(--t3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.lv-vert{font-size:12px;color:var(--t2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.lv-pub-select{font-family:var(--font);font-size:12px;padding:5px 7px;border:1px solid var(--border);border-radius:5px;background:#fff;color:var(--t1);cursor:pointer;width:auto;}
.lv-pub-select:hover{background:var(--bg2);}
.lv-actions{display:flex;gap:5px;justify-content:flex-end;}
.lv-act-btn{font-family:var(--font);font-size:11px;padding:4px 8px;border:1px solid var(--border);border-radius:5px;background:#fff;color:var(--t2);cursor:pointer;font-weight:600;}
.lv-act-btn:hover{background:var(--bg2);color:var(--t1);}
.lv-act-btn.accent{color:var(--accent);border-color:var(--accent);}
.lv-empty{padding:40px;text-align:center;color:var(--t3);}

/* ── CLEARED INDICATOR + POPOVER ── */
.cl-cell{position:relative;}
/* Cleared trigger pill — colored background matches the level so it
   visually pairs with the custom-status chips next to it. The chip
   styling and the trigger styling intentionally share a vocabulary. */
.cl-trigger{display:inline-flex;align-items:center;gap:7px;cursor:pointer;border:1px solid var(--border);padding:3px 9px;border-radius:999px;font-size:11.5px;color:var(--t1);background:#f9fafb;font-weight:600;}
.cl-trigger:hover{filter:brightness(0.97);}
.cl-trigger.open{outline:2px solid var(--accent);outline-offset:1px;}
.cl-trigger.green{background:#f0fdf4;border-color:#bbf7d0;color:#166534;}
.cl-trigger.yellow{background:#fef9e7;border-color:#fde68a;color:#92400e;}
.cl-trigger.red{background:#fdf2f2;border-color:#f5d5d5;color:#b91c1c;}
.cl-circle{width:11px;height:11px;border-radius:50%;flex-shrink:0;border:1px solid rgba(0,0,0,.08);}
.cl-circle.green{background:var(--green);}
.cl-circle.yellow{background:var(--amber);}
.cl-circle.red{background:var(--red);}
/* Cleared popover — anchored next to a row's cleared-indicator trigger.
   Visually mirrors the BulkStatusModal: flat stack of selects with no
   per-row labels, just placeholder text in each select. */
.cl-pop{position:absolute;top:calc(100% + 6px);left:0;width:340px;background:#fff;border:1px solid var(--border);border-radius:9px;box-shadow:0 14px 36px rgba(0,0,0,.14);padding:14px;z-index:60;cursor:default;display:flex;flex-direction:column;gap:10px;box-sizing:border-box;}
.cl-pop-portal{z-index:200;opacity:1 !important;}
/* Body just stacks its kids — padding is owned by .cl-pop now so the
   bottom button doesn't need its own margin (which previously made it
   overflow the right edge). */
.cl-pop-body{display:flex;flex-direction:column;gap:10px;}
/* Custom flag chips — compact display of existing per-asset flags with
   inline remove. Backgrounds use very low-opacity tints so the chip stays
   subtle and the dot does the signaling. Inline color (for hex flags)
   gets applied via style attr in JSX. */
/* Approval notes textarea — sits directly under the Approval select in the
   popover when an approval status is set. Min height keeps the field
   visible enough to invite a paragraph; resizable for longer threads. */
.cl-approval-note{min-height:64px;resize:vertical;font-size:12px;line-height:1.4;margin-top:0;}
/* Custom flag chips — visually identical to the .cl-trigger pill so the
   cleared trigger and any custom-status chips read as one row of pills.
   Same border-radius (full pill), same padding, same font size, same
   tinted backgrounds + text colors per level. The X close button only
   renders inside the popover; at list/grid level the chip is read-only. */
.cl-flag-chips{display:flex;flex-wrap:wrap;gap:6px;align-items:center;}
.cl-flag-chips.clickable{cursor:pointer;}
.cl-flag-chip{display:inline-flex;align-items:center;gap:7px;padding:3px 9px;border-radius:999px;border:1px solid var(--border);background:#f9fafb;font-size:11.5px;font-weight:600;color:var(--t1);max-width:100%;white-space:nowrap;}
.cl-flag-chip.yellow{background:#fef9e7;border-color:#fde68a;color:#92400e;}
.cl-flag-chip.red{background:#fdf2f2;border-color:#f5d5d5;color:#b91c1c;}
.cl-flag-chip.green{background:#f0fdf4;border-color:#bbf7d0;color:#166534;}
.cl-flag-chip-label{max-width:160px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
/* The X close button keeps the chip slightly more padded on the right. */
.cl-flag-chip:has(.cl-flag-chip-x){padding-right:4px;}
.cl-flag-chip-x{background:none;border:none;cursor:pointer;color:currentColor;opacity:0.6;font-size:14px;line-height:1;padding:0 4px;border-radius:999px;}
.cl-flag-chip-x:hover{opacity:1;}
/* Custom-color dot rendered via inline style.color — keeps the same
   sizing/shape as preset circles. */
.cl-circle.custom{background:transparent;}
.cl-freshness-line{font-size:12px;color:var(--t1);margin-top:6px;}
.cl-freshness-rel{color:var(--t3);font-weight:400;}
.cl-freshness-note{font-size:11px;color:var(--t3);margin-top:6px;font-style:italic;}
.cl-fresh-select{margin-top:6px;}
/* Trigger pill + form share one bordered container so they read as a
   single control. When the form is open, the trigger's bottom border is
   removed so the box looks unified. */
.cl-fresh-pill{margin-top:6px;border:1px solid var(--border);border-radius:7px;background:#fff;overflow:hidden;}
.cl-fresh-trigger{width:100%;display:flex;align-items:center;justify-content:space-between;gap:8px;background:#fff;border:none;padding:8px 10px;font-family:var(--font);font-size:13px;color:var(--t1);cursor:pointer;text-align:left;}
.cl-fresh-trigger:hover{background:var(--bg2);}
.cl-fresh-pill.open .cl-fresh-trigger{border-bottom:1px solid var(--border);}
.cl-fresh-chevron{color:var(--t3);font-size:11px;flex-shrink:0;}
/* Form body inside the pill — drop its own border + radius so it merges
   with the trigger above visually. */
.cl-fresh-pill .cl-exception-form{margin-top:0;border:none;border-radius:0;background:#fff;padding:10px;}
/* Yellow warning row that embeds the Make-exception button on the right
   when library rule flags the asset. Keeps action next to its problem. */
.cl-freshness-warn-row{display:flex;align-items:flex-start;justify-content:space-between;gap:8px;flex-wrap:wrap;}
.cl-freshness-warn-row > span{flex:1;min-width:0;}
.cl-freshness-warn-row .cl-mini-btn{flex-shrink:0;}
/* Subtle inline link for proactive exception-setting when library rule is
   on but the asset isn't currently flagged. */
.cl-make-exception-link{display:inline-block;margin-top:6px;background:none;border:none;padding:2px 0;color:var(--accent);font-family:var(--font);font-size:11.5px;font-weight:600;cursor:pointer;}
.cl-make-exception-link:hover{text-decoration:underline;}
/* Grey info box used in state C — "Set to expire on [date]" + Make exception
   button. Unassuming, doesn't shout for attention. */
.cl-freshness-info-row{display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;margin-top:8px;padding:8px 10px;background:var(--bg2);border:1px solid var(--border);border-radius:6px;font-size:11.5px;color:var(--t2);}
.cl-freshness-info-row > span{flex:1;min-width:0;}
.cl-freshness-info-row .cl-mini-btn{flex-shrink:0;}
/* Radio rows in the Make exception form (library-rule mode). */
.cl-radio{display:flex;align-items:center;gap:7px;font-size:12px;color:var(--t1);padding:5px 0;cursor:pointer;}
.cl-radio input{cursor:pointer;}
/* Per-asset expiration form — appears below the dropdown when "Set
   expiration" is selected. Contains date picker, quick presets, save/cancel,
   and audit/expired notes. */
.cl-exception-form{margin-top:6px;padding:8px 10px;background:var(--bg);border:1px solid var(--border);border-radius:7px;}
.cl-exception-until-row{display:flex;flex-direction:column;gap:6px;}
.cl-exception-date{font-family:var(--font);font-size:12px;padding:6px 8px;border:1px solid var(--border);border-radius:5px;background:#fff;color:var(--t1);}
.cl-exception-date:focus{outline:none;border-color:var(--accent);}
.cl-exception-quick{display:flex;gap:5px;}
.cl-quick-btn{font-family:var(--font);font-size:10.5px;padding:3px 8px;border:1px solid var(--border);border-radius:4px;background:#fff;color:var(--t2);cursor:pointer;font-weight:600;}
.cl-quick-btn:hover{border-color:var(--accent);color:var(--accent);}
.cl-exception-meta{font-size:11px;color:var(--t3);margin-top:6px;}
.cl-exception-expired{font-size:11px;color:var(--amber);margin-top:6px;padding:5px 8px;background:var(--amberL);border-radius:5px;}
.cl-exception-actions{display:flex;gap:6px;margin-top:8px;}
.cl-freshness-warn{font-size:11px;color:var(--amber);margin-top:4px;background:var(--amberL);padding:5px 8px;border-radius:5px;}
.cl-rules-link{display:inline-block;margin-top:8px;font-size:11px;color:var(--accent);text-decoration:none;font-weight:600;}
.cl-rules-link:hover{text-decoration:underline;}
.cl-input,.cl-select,.cl-textarea{font-family:var(--font);font-size:12px;padding:6px 8px;border:1px solid var(--border);border-radius:5px;background:#fff;color:var(--t1);width:100%;margin-top:5px;box-sizing:border-box;}
/* Custom chevron applied uniformly to all admin selects across the app
   (cleared popover, list view publication, rules panel, asset edit panel)
   so the dropdown affordance is visually consistent everywhere. */
.cl-select,.lv-pub-select,.rules-select,.aep-sel{appearance:none;-webkit-appearance:none;-moz-appearance:none;background-image:url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6' fill='none' stroke='%23888' stroke-width='1.6' stroke-linecap='round' stroke-linejoin='round'><polyline points='1 1 5 5 9 1'/></svg>");background-repeat:no-repeat;background-position:right 9px center;padding-right:26px;}
/* Lighter color when select is showing its default placeholder option.
   Force option list back to normal color so users can read all choices
   when the dropdown is open (browsers inherit the select color into
   options by default). */
.cl-select.placeholder{color:var(--t4);}
.cl-select.placeholder option,.cl-select option,.lv-pub-select option,.rules-select option,.aep-sel option{color:var(--t1);}
/* Section title styling — same weight/size across all sections so the
   popover reads as a list of equally-weighted concerns. The visual
   hierarchy comes from approval being expanded by default + having a
   slightly larger select; secondary sections still use the smaller select. */
.cl-section-title{font-size:13.5px;font-weight:700;color:var(--t1);}
.cl-section-primary .cl-select-primary{font-size:13px;padding:8px 10px;}
.cl-section-secondary{padding-top:10px;}
.cl-section-secondary .cl-select{font-size:11.5px;padding:5px 7px;}
.cl-section-secondary .cl-section{padding-top:0;}
/* Hollow circle for "unset" cleared state — clearer "clickable" affordance
   than the previous em-dash. */
.cl-circle-empty{background:transparent !important;border:1.5px solid var(--border2);}
/* Disclosure toggle in the popover — collapses Client + Freshness behind
   "advanced" so the default popover surfaces only Approval. */
.cl-advanced-toggle{display:flex;align-items:center;justify-content:space-between;gap:8px;width:100%;background:none;border:none;padding:8px 0 6px;margin-top:4px;border-top:1px solid var(--border);color:var(--t3);font-family:var(--font);font-size:11px;font-weight:600;cursor:pointer;text-transform:uppercase;letter-spacing:.4px;}
.cl-advanced-toggle:hover{color:var(--t1);}
.cl-advanced-chevron{font-size:9px;}

/* Custom flags section */
.cf-empty{font-size:11px;color:var(--t4);font-style:italic;margin:6px 0 8px;}
.cf-row{display:flex;align-items:flex-start;gap:8px;padding:8px 0;border-top:1px solid var(--border);}
.cf-row:first-of-type{border-top:none;}
.cf-row > .cl-circle{margin-top:3px;flex-shrink:0;}
.cf-row-body{flex:1;min-width:0;}
.cf-row-label{font-size:12px;font-weight:600;color:var(--t1);}
.cf-row-note{font-size:11px;color:var(--t3);line-height:1.4;margin-top:2px;}
.cf-row-meta{font-size:10.5px;color:var(--t4);margin-top:3px;}
.cf-row-actions{display:flex;gap:4px;flex-shrink:0;}
.cf-form{margin-top:8px;padding:10px;background:var(--bg);border:1px solid var(--border);border-radius:7px;display:flex;flex-direction:column;gap:8px;}
.cf-severity-row{display:flex;flex-direction:row;flex-wrap:wrap;gap:8px 14px;align-items:center;}
.cf-severity-row .cl-radio{align-items:center;font-size:11.5px;}
.cf-severity-row .cl-circle{width:9px;height:9px;}
/* Subtle native color input next to "Other" — small swatch instead of the
   default chunky color box. Hides browser chrome (border/padding) so it
   reads as a tiny chip. */
.cl-color-input{appearance:none;-webkit-appearance:none;-moz-appearance:none;width:18px;height:18px;border:1px solid var(--border);border-radius:4px;padding:0;background:none;cursor:pointer;margin-left:4px;overflow:hidden;}
.cl-color-input::-webkit-color-swatch-wrapper{padding:0;}
.cl-color-input::-webkit-color-swatch{border:none;border-radius:3px;}
.cl-color-input::-moz-color-swatch{border:none;border-radius:3px;}
/* Custom-color circle used in chips/dots where the color comes from a
   hex value. Sized identically to preset circles. */
.cl-circle.custom{background:transparent;border:1px solid currentColor;}

/* "Reuse a previous tag" row — appears inside Add custom status forms
   below the color picker. Each chip is a button; click populates the
   form's color + label so admin can reuse a consistent tag without
   re-picking the color or retyping the label. */
.known-tags-row{display:flex;flex-direction:column;gap:6px;margin-top:8px;padding-top:8px;border-top:1px dashed var(--border);}
.known-tags-label{font-size:10.5px;text-transform:uppercase;letter-spacing:.5px;color:var(--t4);font-weight:700;}
.known-tags-chips{display:flex;flex-wrap:wrap;gap:6px;}
.known-tag-chip{font-family:var(--font);cursor:pointer;}
.known-tag-chip:hover{filter:brightness(0.97);}
.cf-form-actions{display:flex;gap:6px;}
.cl-cf-add{margin-top:6px;}
.cl-textarea{min-height:64px;resize:vertical;font-family:var(--font);}
.cl-row-actions{display:flex;gap:6px;margin-top:6px;}
.cl-mini-btn{font-family:var(--font);font-size:11px;padding:4px 9px;border:1px solid var(--border);border-radius:5px;background:#fff;color:var(--t2);cursor:pointer;font-weight:600;}
.cl-mini-btn:hover{background:var(--bg2);color:var(--t1);}
.cl-mini-btn.primary{background:var(--accent);color:#fff;border-color:var(--accent);}
.cl-mini-btn.primary:hover{background:var(--accent2);}

/* Empty Cleared state — no admin engagement yet */
.cl-trigger.unset{background:transparent;border-color:transparent;color:var(--t4);padding:4px 8px;}
.cl-trigger.unset:hover{background:var(--bg2);color:var(--t2);}
/* Collapsed — when the row has only custom tags and no real cleared
   signals. The trigger renders empty + zero-size so the chip strip
   reads as the only visual on the row. The DOM element stays for
   popover anchoring. */
.cl-trigger.collapsed{padding:0;width:0;height:0;border:none;overflow:hidden;}
.cl-trigger.collapsed:hover{background:transparent;}
.cl-trigger-text{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:11.5px;}

/* ── MULTI-SELECT (checkboxes + bulk action bar) ── */
.lv-row{padding-left:38px;}
.lv-head{padding-left:38px;}
.lv-check{position:absolute;left:14px;top:50%;transform:translateY(-50%);width:16px;height:16px;cursor:pointer;accent-color:var(--accent);}
.lv-row.selected{background:var(--accentLL);}
.lv-row.selected:hover{background:var(--accentL);}

/* Grid card checkbox — appears on hover or when card is selected */
.card-check,.qcard-check{position:absolute;top:10px;left:10px;width:20px;height:20px;cursor:pointer;accent-color:var(--accent);z-index:5;background:#fff;border-radius:4px;opacity:0;transition:opacity .15s;}
.card:hover .card-check,.qcard:hover .qcard-check,.card.selected .card-check,.qcard.selected .qcard-check{opacity:1;}
/* Outline (offset:0) draws OUTSIDE the card border, so the thumbnail image
   inside .card-thumb can't paint over it — and modern browsers follow
   border-radius for outlines, so the selection ring keeps the rounded corners. */
.card.selected,.qcard.selected{outline:2px solid var(--accent);outline-offset:0;}
/* Keep the 3-dot menu visible on selected cards too, so admin can act on them */
.card.selected .card-dots,.qcard.selected .qcard-dots{opacity:1;}

/* Bulk action bar — fixed at bottom, slides up when ≥1 selected */
.bulk-bar{position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#1a1a1f;color:#fff;border-radius:11px;padding:10px 14px;display:flex;align-items:center;gap:8px;box-shadow:0 12px 36px rgba(0,0,0,.25);z-index:100;font-family:var(--font);font-size:13px;animation:bulkbarUp .2s ease-out;}
@keyframes bulkbarUp{from{transform:translate(-50%,12px);opacity:0;}to{transform:translate(-50%,0);opacity:1;}}
.bulk-count{padding:0 10px 0 4px;font-weight:600;color:#fff;border-right:1px solid #444;margin-right:4px;}
.bulk-btn{background:none;border:none;color:#e2e2e6;font-size:13px;font-weight:500;padding:7px 11px;border-radius:6px;cursor:pointer;font-family:var(--font);display:flex;align-items:center;gap:6px;}
.bulk-btn:hover{background:rgba(255,255,255,.1);color:#fff;}
.bulk-btn.danger{color:#fca5a5;}
.bulk-btn.danger:hover{background:rgba(220,38,38,.2);color:#fca5a5;}
.bulk-close{background:none;border:none;color:#8888a0;cursor:pointer;padding:6px 8px;margin-left:4px;font-size:14px;border-radius:6px;}
.bulk-close:hover{background:rgba(255,255,255,.1);color:#fff;}

/* Bulk modals — shared styles for both BulkVisibilityModal and BulkStatusModal.
   Same shell so the two feel like siblings. Each modal owns one focused
   concept (visibility OR status indicators) — visibility never appears in
   the status modal and vice versa. */
.bsm-backdrop{position:fixed;inset:0;background:rgba(0,0,0,.4);z-index:200;animation:aepFade .15s ease-out;}
.bsm-modal{position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:#fff;border-radius:12px;box-shadow:0 24px 64px rgba(0,0,0,.25);z-index:201;width:420px;max-width:calc(100vw - 32px);max-height:calc(100vh - 64px);display:flex;flex-direction:column;font-family:var(--font);}
.bsm-head{padding:18px 20px 12px;border-bottom:1px solid var(--border);}
.bsm-title{font-family:var(--serif);font-size:18px;font-weight:600;color:var(--t1);}
.bsm-sub{font-size:11.5px;color:var(--t3);margin-top:3px;line-height:1.4;}
.bsm-body{flex:1;overflow-y:auto;padding:16px 20px;display:flex;flex-direction:column;gap:12px;}
/* Status fields — flat stack of selects, no per-row labels. Each select
   carries a "Field — leave unchanged" placeholder option so the meaning
   stays clear without taking vertical space for headers. */
.bsm-status-fields{display:flex;flex-direction:column;gap:10px;}
.bsm-fld-stack{display:flex;flex-direction:column;gap:8px;}
.bsm-flag-toggle{display:flex;align-items:center;gap:8px;font-size:12.5px;color:var(--t1);cursor:pointer;padding:7px 0;}
.bsm-flag-form{padding:10px 12px;background:var(--bg);border:1px solid var(--border);border-radius:7px;display:flex;flex-direction:column;gap:8px;}
.bsm-foot{padding:14px 20px;border-top:1px solid var(--border);display:flex;gap:8px;align-items:center;}
/* Visibility-modal choice list — radio cards instead of a dropdown so the
   help text for each option is visible at-a-glance. Active choice gets a
   subtle ring; whole row is the click target. */
.bsm-choice-list{display:flex;flex-direction:column;gap:8px;}
.bsm-choice{display:flex;align-items:flex-start;gap:10px;padding:11px 13px;border:1px solid var(--border);border-radius:8px;cursor:pointer;transition:border-color .12s,background .12s;}
.bsm-choice:hover{background:var(--bg2);}
.bsm-choice.selected{border-color:var(--accent);background:var(--accentLL);}
.bsm-choice input[type="radio"]{margin-top:2px;accent-color:var(--accent);}
.bsm-choice-text{display:flex;flex-direction:column;gap:2px;}
.bsm-choice-label{font-size:13px;font-weight:600;color:var(--t1);}
.bsm-choice-help{font-size:11.5px;color:var(--t3);line-height:1.35;}
/* Visibility-override modal — list of every blocking rule + how the
   override neutralizes each one. Renders as a stack so multiple rules
   stay legible. */
.vom-list{list-style:none;padding:0;margin:0;display:flex;flex-direction:column;gap:10px;}
.vom-list-item{padding:10px 12px;background:var(--bg);border:1px solid var(--border);border-radius:7px;}
.vom-list-what{font-size:12.5px;color:var(--t1);}
.vom-list-fix{margin-top:4px;font-size:11.5px;color:var(--t3);}
/* Reset button — neutral grey. Reset isn't dangerous in the way a delete
   is (it just clears flags / approval status / etc., all of which can be
   re-applied), so a destructive-red treatment was overkill. Used in both
   the bulk modal and the per-asset popover. */
.bsm-clear-all-btn,.cl-clear-all{
  width:100%;
  padding:8px 14px;
  border-radius:6px;
  border:1px solid var(--border);
  background:#fff;
  color:var(--t2);
  font-family:var(--font);
  font-size:12px;
  font-weight:600;
  cursor:pointer;
  margin-top:8px;
  transition:all .12s;
}
.bsm-clear-all-btn:hover,.cl-clear-all:hover{
  background:var(--bg2);
  color:var(--t1);
  border-color:var(--border2);
}

/* ── 3-DOT MENU ── */
.dots-btn{background:none;border:none;color:var(--t3);cursor:pointer;padding:5px 7px;border-radius:5px;display:grid;place-items:center;}
.dots-btn:hover{background:var(--bg2);color:var(--t1);}
.dots-pop{position:absolute;top:calc(100% + 4px);right:0;background:#fff;border:1px solid var(--border);border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,.12);padding:4px;z-index:55;min-width:160px;}
.dots-item{display:flex;align-items:center;gap:8px;width:100%;padding:7px 10px;background:none;border:none;color:var(--t1);font-size:12.5px;font-family:var(--font);cursor:pointer;border-radius:5px;text-align:left;}
.dots-item:hover{background:var(--bg2);}
.dots-item.danger{color:var(--red);}
.dots-item.danger:hover{background:#fef2f2;}
.dots-divider{height:1px;background:var(--border);margin:4px 0;}
.lv-actions{position:relative;}

/* Grid card 3-dot menu and share-link button (stacked top-right) */
.card-dots,.qcard-dots{position:absolute;top:8px;right:8px;background:rgba(255,255,255,.95);border-radius:5px;z-index:5;opacity:0;transition:opacity .15s;}
.card:hover .card-dots,.qcard:hover .qcard-dots{opacity:1;}
/* Standalone Copy-share-link icon — appears on hover/selected, sits below
   the 3-dot dots button. The dropdown menu is portal-rendered to body so
   its higher root-level stacking context naturally covers this button when
   open; no special z-index gymnastics needed here. */
.card-share,.qcard-share{position:absolute;top:42px;right:8px;background:rgba(255,255,255,.95);border:none;width:30px;height:30px;border-radius:5px;cursor:pointer;color:var(--t2);display:grid;place-items:center;z-index:5;opacity:0;transition:opacity .15s,color .15s;}
.card:hover .card-share,.qcard:hover .qcard-share,.card.selected .card-share,.qcard.selected .qcard-share{opacity:1;}
.card-share:hover,.qcard-share:hover{color:var(--accent);background:#fff;}

/* ── QUOTE CARD ── */
.qcard{border-radius:var(--r);cursor:pointer;transition:all .35s cubic-bezier(.4,0,.2,1);position:relative;overflow:hidden;min-height:340px;display:flex;flex-direction:column;justify-content:flex-end;}
.qcard:hover{transform:translateY(-4px);box-shadow:0 20px 50px rgba(0,0,0,.12);}
.qcard-bg{position:absolute;inset:0;z-index:0;}
.qcard-bg::before{content:'';position:absolute;inset:0;background:var(--qgrad);opacity:.92;}
.qcard-bg::after{content:'"';position:absolute;top:-24px;right:16px;font-family:var(--serif);font-size:240px;font-weight:700;color:rgba(255,255,255,.06);line-height:1;pointer-events:none;}
.qcard-content{position:relative;z-index:1;padding:36px 32px 28px;display:flex;flex-direction:column;justify-content:flex-end;flex:1;}
.qcard-quote-text{font-family:var(--serif);font-size:20px;font-style:italic;line-height:1.6;color:#fff;margin-bottom:28px;flex:1;display:flex;align-items:flex-end;letter-spacing:-.2px;}
.qcard-divider{width:32px;height:2px;background:rgba(255,255,255,.3);margin-bottom:16px;}
/* Flag chip strip on quote cards — appears between the quote and the
   divider. White-tinted backgrounds since the card itself is gradient-color. */
.qcard-chips{margin-bottom:16px;}
.qcard-chips .cl-flag-chip{background:rgba(255,255,255,.85);border-color:rgba(255,255,255,.95);color:#1f2937;}
.qcard-attr{display:flex;justify-content:space-between;align-items:flex-end;}
.qcard-who .qcard-name{font-size:14px;font-weight:700;color:#fff;}
.qcard-who .qcard-co{font-size:12px;color:rgba(255,255,255,.6);margin-top:3px;}
.qcard-cta{font-size:11px;color:rgba(255,255,255,.5);font-weight:600;transition:color .2s;}
.qcard:hover .qcard-cta{color:rgba(255,255,255,.8);}
.qcard .card-ai{padding:0 28px 24px;position:relative;z-index:1;}
.qcard .card-ai-reason{background:rgba(255,255,255,.12);border-left-color:rgba(255,255,255,.4);color:rgba(255,255,255,.85);}
.qcard .card-ai-q{background:rgba(255,255,255,.08);color:rgba(255,255,255,.8);}
.qcard .card-ai-q:hover{background:rgba(255,255,255,.15);}
.qcard .card-ai-q::after{color:rgba(255,255,255,.5);}
.qcard .card-rank{background:rgba(255,255,255,.2);backdrop-filter:blur(8px);box-shadow:none;}

/* ── SETTINGS ── */
.settings-overlay{position:fixed;inset:0;background:rgba(0,0,0,.3);backdrop-filter:blur(6px);z-index:200;animation:fadeIn .2s;}
@keyframes fadeIn{from{opacity:0}to{opacity:1}}
.settings-panel{position:fixed;top:0;right:0;bottom:0;width:min(520px,100vw);background:#fff;z-index:201;box-shadow:-8px 0 40px rgba(0,0,0,.12);display:flex;flex-direction:column;animation:slideIn .3s cubic-bezier(.4,0,.2,1);}
@keyframes slideIn{from{transform:translateX(100%)}to{transform:translateX(0)}}
.sp-head{display:flex;align-items:center;justify-content:space-between;padding:16px 24px;border-bottom:1px solid var(--border);}
.sp-title{font-size:15px;font-weight:700;color:var(--t1);display:flex;align-items:center;gap:6px;}
.sp-close{width:30px;height:30px;border-radius:8px;border:1px solid var(--border);background:#fff;color:var(--t3);cursor:pointer;display:grid;place-items:center;font-size:14px;}
.sp-close:hover{border-color:var(--red);color:var(--red);}
.sp-body{flex:1;overflow-y:auto;padding:24px;}
.sp-tabs{display:flex;gap:4px;margin-bottom:20px;}
.sp-tab{padding:6px 14px;border-radius:16px;border:1px solid var(--border);background:#fff;color:var(--t3);font-size:12px;font-weight:600;cursor:pointer;font-family:var(--font);transition:all .12s;}
.sp-tab.on{background:var(--accentL);border-color:var(--accent);color:var(--accent);}
.sp-sec h3{font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:var(--t3);margin-bottom:14px;}
.fgrid{display:grid;grid-template-columns:1fr 1fr;gap:12px;}
.fgrp{display:flex;flex-direction:column;gap:3px;}.fgrp.full{grid-column:1/-1;}
.fgrp label{font-size:10px;text-transform:uppercase;letter-spacing:1px;color:var(--t4);font-weight:700;}
.fin,.ftxt,.fss{padding:8px 12px;border-radius:var(--r3);border:1px solid var(--border);background:#fff;color:var(--t1);font-family:var(--font);font-size:13px;}
.fin:focus,.ftxt:focus,.fss:focus{outline:none;border-color:var(--accent);box-shadow:0 0 0 3px var(--accentL);}
.ftxt{min-height:100px;resize:vertical;line-height:1.6;}
.fss{appearance:none;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 24 24' fill='none' stroke='%238888a0' stroke-width='2.5'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right 7px center;cursor:pointer;}
.sbtn{padding:9px 22px;border-radius:var(--r3);border:none;background:var(--accent);color:#fff;font-family:var(--font);font-size:12px;font-weight:700;cursor:pointer;}
.sbtn:disabled{opacity:.4;cursor:not-allowed;}
.imp-area{padding:16px;border:2px dashed var(--border);border-radius:var(--r2);text-align:center;margin-bottom:12px;}
.imp-area input{width:100%;padding:8px 12px;border-radius:var(--r3);border:1px solid var(--border);background:#fff;color:var(--t1);font-family:var(--font);font-size:12px;margin-top:8px;}
.imp-area p{font-size:12px;color:var(--t3);}.imp-area .hl{color:var(--accent2);font-weight:600;}
.imp-res{margin-top:8px;padding:10px;background:var(--bg2);border-radius:var(--r3);font-size:11px;color:var(--t2);border:1px solid var(--border);}

/* ── DETAIL PAGE ── */
.dp{max-width:1100px;margin:0 auto;width:100%;padding:24px 32px 60px;}
.dp-back{display:inline-flex;align-items:center;gap:6px;padding:6px 14px;border-radius:var(--r3);border:1px solid var(--border);background:#fff;color:var(--t2);font-family:var(--font);font-size:12px;font-weight:600;cursor:pointer;margin-bottom:20px;}
.dp-back:hover{border-color:var(--border2);color:var(--t1);}
.dp-hero{position:relative;width:100%;min-height:400px;border-radius:20px;overflow:hidden;display:flex;align-items:flex-end;}
.dp-hero-img{position:absolute;inset:0;}.dp-hero-img img{width:100%;height:100%;object-fit:cover;}
.dp-hero-img::after{content:'';position:absolute;inset:0;background:linear-gradient(to top,rgba(0,0,0,.72) 0%,rgba(0,0,0,.25) 50%,rgba(0,0,0,.12) 100%);}
.dp-hero-content{position:relative;z-index:2;padding:36px 44px;max-width:680px;}
.dp-hero-eyebrow{display:flex;align-items:center;gap:10px;margin-bottom:12px;}
.dp-hero-co{font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:1.2px;color:rgba(255,255,255,.7);}
.dp-hero-vbadge{padding:3px 10px;border-radius:12px;font-size:10px;font-weight:700;background:rgba(255,255,255,.15);color:rgba(255,255,255,.8);}
.dp-hero h1{font-family:var(--serif);font-size:30px;font-weight:600;letter-spacing:-.4px;line-height:1.2;color:#fff;margin-bottom:10px;}
.dp-hero-sub{font-size:14.5px;line-height:1.6;color:rgba(255,255,255,.75);}
.dp-summary-bar{display:grid;grid-template-columns:1fr 280px;border:1px solid var(--border);border-radius:0 0 20px 20px;background:#fff;margin-bottom:28px;}
.dp-summary{padding:24px 32px;border-right:1px solid var(--border);}
.dp-summary h3,.dp-about h3{font-size:10px;text-transform:uppercase;letter-spacing:1.2px;color:var(--t4);font-weight:700;margin-bottom:6px;}
.dp-summary p{font-size:13.5px;line-height:1.65;color:var(--t2);}
.dp-about{padding:24px 28px;}
.dp-about p{font-size:12.5px;line-height:1.55;color:var(--t2);}
.dp-about-tags{display:flex;flex-wrap:wrap;gap:5px;margin-top:10px;}
.pill{padding:3px 9px;border-radius:14px;font-size:10px;font-weight:600;border:1px solid var(--border);color:var(--t3);}
.dp-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));border:1px solid var(--border);border-radius:14px;overflow:hidden;background:#fff;margin-bottom:32px;}
.dp-stat{padding:24px 20px;text-align:center;border-right:1px solid var(--border);}.dp-stat:last-child{border-right:none;}
.dp-stat-num{font-family:var(--serif);font-size:36px;font-weight:600;letter-spacing:-1px;color:var(--accent);line-height:1;}
.dp-stat-unit{font-size:15px;font-weight:600;color:var(--accent);margin-left:2px;}
.dp-stat-label{font-size:12px;color:var(--t3);margin-top:5px;}
.dp-video-embed{width:100%;aspect-ratio:16/9;border-radius:var(--r);overflow:hidden;background:var(--bg3);margin-bottom:24px;}.dp-video-embed iframe{width:100%;height:100%;display:block;}
.dp-body{display:grid;grid-template-columns:180px 1fr;gap:36px;max-width:900px;margin:0 auto;align-items:start;}
.dp-chapters-nav{position:sticky;top:72px;display:flex;flex-direction:column;gap:3px;}
.dp-ch-link{padding:7px 12px;border-radius:var(--r3);font-size:12px;font-weight:600;color:var(--t3);cursor:pointer;border:none;background:none;text-align:left;font-family:var(--font);line-height:1.4;transition:all .12s;}
.dp-ch-link:hover{color:var(--t1);background:var(--bg2);}.dp-ch-link.active{color:var(--accent);background:var(--accentL);}
.dp-content{max-width:640px;}
.dp-chapter{margin-bottom:36px;}
.dp-chapter-label{font-size:10px;text-transform:uppercase;letter-spacing:1.5px;color:var(--accent);font-weight:700;margin-bottom:5px;}
.dp-chapter h2{font-family:var(--serif);font-size:20px;font-weight:600;margin-bottom:14px;line-height:1.3;}
.dp-chapter p{font-size:14px;line-height:1.75;color:var(--t2);margin-bottom:12px;}
.dp-bq{padding:24px 28px;margin:20px 0;background:var(--bg2);border-radius:var(--r);position:relative;}
.dp-bq::before{content:'"';position:absolute;top:8px;left:16px;font-family:var(--serif);font-size:52px;color:var(--accent);opacity:.12;line-height:1;}
.dp-bq blockquote{font-family:var(--serif);font-size:16px;font-style:italic;line-height:1.65;color:var(--t1);margin-bottom:12px;padding-left:6px;}
.dp-bq-name{font-size:12.5px;font-weight:700;color:var(--t1);padding-left:6px;}
.dp-bq-role{font-size:11.5px;color:var(--t3);padding-left:6px;}
.dp-related{margin-top:40px;padding-top:28px;border-top:1px solid var(--border);}
.dp-related h3{font-family:var(--serif);font-size:18px;font-weight:600;margin-bottom:16px;}
.dp-related-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:14px;}
.dp-rel-card{border-radius:var(--r2);overflow:hidden;border:1px solid var(--border);cursor:pointer;transition:all .2s;background:#fff;}
.dp-rel-card:hover{transform:translateY(-2px);box-shadow:0 6px 20px rgba(0,0,0,.05);}
.dp-rel-thumb{width:100%;aspect-ratio:16/9;overflow:hidden;background:var(--bg3);}.dp-rel-thumb img{width:100%;height:100%;object-fit:cover;}
.dp-rel-body{padding:12px 14px;}
.dp-rel-label{font-size:10px;text-transform:uppercase;letter-spacing:.8px;color:var(--t4);font-weight:700;margin-bottom:3px;}
.dp-rel-title{font-family:var(--serif);font-size:14px;font-weight:500;line-height:1.35;}

.empty{text-align:center;padding:60px 40px;color:var(--t4);}.empty h3{font-family:var(--serif);font-size:17px;color:var(--t3);margin-bottom:4px;}
.toast{position:fixed;bottom:20px;left:50%;transform:translateX(-50%);padding:9px 22px;background:var(--accent);color:#fff;border-radius:var(--r3);font-size:12px;font-weight:600;z-index:300;box-shadow:0 4px 20px rgba(0,0,0,.15);animation:fadeIn .2s;}
.spin-inline{display:inline-block;width:14px;height:14px;border:2px solid var(--accentL);border-top-color:var(--accent);border-radius:50%;animation:sp .7s linear infinite;margin-right:6px;vertical-align:middle;}
@keyframes sp{to{transform:rotate(360deg)}}

::-webkit-scrollbar{width:5px;}::-webkit-scrollbar-track{background:transparent;}::-webkit-scrollbar-thumb{background:var(--border);border-radius:3px;}
@media(max-width:860px){.dp-summary-bar{grid-template-columns:1fr;}.dp-summary{border-right:none;border-bottom:1px solid var(--border);}.dp-body{grid-template-columns:1fr;}.dp-chapters-nav{position:static;flex-direction:row;flex-wrap:wrap;}.dp-hero{min-height:300px;}.dp-hero h1{font-size:22px;}}
@media(max-width:640px){.lib-wrap{padding:16px;}.grid{grid-template-columns:1fr;}.dp{padding:16px;}.search-area{padding:16px 16px 0;}}
`;

// ─── CARD COMPONENTS ─────────────────────────────────────────────────────────
interface CardProps {
  asset: Asset;
  onClick: (a: Asset) => void;
  aiData?: AIMatchResult | null;
  onCopyQuote: (q: string) => void;
  onRestore?: (asset: Asset) => void; // admin-only — present means show restore button on archived
  // Multi-select + dots menu (admin only — pass undefined for sales/public preview)
  isSelected?: boolean;
  onToggleSelect?: (id: string, shiftKey?: boolean) => void;
  menuItems?: MenuItem[];
  // Copy-link is available to any signed-in user (sales reps share too)
  onCopyShareLink?: (a: Asset) => void;
  // Cleared signal + handlers — only set for admin-in-admin-mode (matches
  // list view's status dot). When set, the dot is rendered AND clickable
  // to open the same popover as the list view. Hidden for sales reps and
  // the public preview because the dot is admin governance UI.
  cleared?: {
    level: ClearedLevel;
    reasons: ClearedReason[];
    libraryFreshnessRuleActive: boolean;
    isInMultiSelection: boolean;
    onSetClientStatus: (a: Asset, next: "current" | "former" | "unknown") => void;
    onSetApproval: (a: Asset, patch: { status?: ApprovalStatus; note?: string }) => void;
    onMarkVerified: (a: Asset) => void;
    onSetFreshnessException: (a: Asset, untilIso: string | null) => void;
    onSetCustomFlags: (a: Asset, flags: CustomFlag[]) => void;
    onResetStatusIndicators: (a: Asset) => void;
    knownCustomTags?: { color: string; label: string }[];
  };
}

function TCard({asset,onClick,aiData,onCopyQuote,onRestore,isSelected,onToggleSelect,menuItems,onCopyShareLink,cleared}: CardProps) {
  // VERT_CLR no longer drives the body dot — cleared.level does. Vertical
  // color may come back as a thumbnail accent later; for now just elide.
  const isV=asset.assetType==="Video Testimonial";
  // Cleared popover state for the grid dot — same UX as list view but
  // anchored to the dot button inside the card.
  const [clearedOpen, setClearedOpen] = useState(false);
  const dotRef = React.useRef<HTMLButtonElement>(null);
  const vid=extractVid(asset.videoUrl);
  let thumb=asset.thumbnail;if(!thumb&&vid?.p==="yt")thumb=ytThumb(vid.id);if(!thumb)thumb="https://images.unsplash.com/photo-1557804506-669a67965ba0?w=640&h=360&fit=crop";
  const cta=CTA_MAP[asset.assetType]||"read";
  const isArchived=asset.status==="archived";
  const isDraft=asset.status==="draft";
  const statusClass=isArchived?" archived":isDraft?" draft":"";
  return(
    <div className={`card${statusClass}${isSelected?" selected":""}`} onClick={()=>onClick(asset)}>
      {onToggleSelect && (
        <input
          type="checkbox"
          className={`card-check${isSelected?" checked":""}`}
          checked={!!isSelected}
          onChange={()=>{ /* handled by onClick to capture shift key */ }}
          onClick={e=>{e.stopPropagation();onToggleSelect(asset.id,e.shiftKey);}}
          title="Shift-click to select a range"
        />
      )}
      {menuItems && (
        <div className="card-dots"><DotsMenu items={menuItems}/></div>
      )}
      {onCopyShareLink && (
        <button
          className="card-share"
          onClick={e=>{e.stopPropagation();onCopyShareLink(asset);}}
          title="Copy share link"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
            <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
          </svg>
        </button>
      )}
      {isArchived&&<div className="status-badge archived" title={asset.archivedReason||""}>Archive</div>}
      {isDraft&&<div className="status-badge draft" title="Private — not visible to sales reps or in StoryMatch search">Private</div>}
      {isArchived&&onRestore&&!menuItems&&(
        <button className="archived-restore" onClick={e=>{e.stopPropagation();onRestore(asset);}}>↶ Restore</button>
      )}
      <div className="card-thumb">
        {aiData&&<div className="card-rank">{aiData.rank}</div>}
        <img src={thumb} alt={asset.company} loading="lazy"/>
        {/* Watch / Read badge — the only visible signal distinguishing
            video from written case study at grid-glance scale. Frosted
            glass over the thumbnail's bottom-right. */}
        <div className="card-badge">
          {isV ? (
            <>
              <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><polygon points="6 4 20 12 6 20"/></svg>
              <span>Watch</span>
            </>
          ) : (
            <>
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
              <span>Read</span>
            </>
          )}
        </div>
      </div>
      <div className="card-body">
        <div className="card-headline" title={asset.headline||"Untitled"}>{asset.headline||"Untitled"}</div>
        <div className="card-co">
          <span className="card-co-name">
            {/* Dot reflects Cleared signal for admins (matches list view).
                Hidden entirely for sales/public — cleared is undefined
                in those contexts. "unset" means admin hasn't engaged AND
                no auto-flag, so we still hide rather than render a neutral dot.
                The button opens the same Cleared popover the list view uses. */}
            {cleared && cleared.level !== "unset" && (
              <button
                ref={dotRef}
                type="button"
                className={`vdot vdot-btn cl-${cleared.level}`}
                onClick={(e) => { e.stopPropagation(); setClearedOpen(o => !o); }}
                title={clearedTooltip(cleared.level, cleared.reasons)}
              />
            )}
            {/* Custom-status dots — only the *informational* (green / custom-
                hex) flags render here. Severity flags (yellow/red) are folded
                into the cleared trigger above. Each dot is the same size as
                the cleared indicator, plain colored circle (no chip wrapper,
                no border, no background) and click-opens the same popover. */}
            {Array.isArray(asset.customFlags) && (asset.customFlags as CustomFlag[])
              .filter(f => f && !isSeverityColor(f.color))
              .map(f => {
                const isHex = isHexColor(f.color);
                const colorClass = !isHex ? f.color : "custom";
                const dotStyle: React.CSSProperties = isHex
                  ? { background: f.color, borderColor: f.color }
                  : {};
                return (
                  <button
                    key={f.id}
                    type="button"
                    className={`vdot vdot-btn cl-${colorClass} card-flag-dot`}
                    style={dotStyle}
                    onClick={cleared ? (e) => { e.stopPropagation(); setClearedOpen(o => !o); } : undefined}
                    title={f.label || ""}
                  />
                );
              })}
            {asset.company||"—"}
          </span>
          <span className="card-vert">{cta} →</span>
        </div>
      </div>
      {aiData&&(
        <div className="card-ai" onClick={e=>e.stopPropagation()}>
          <div className="card-ai-reason">{aiData.reasoning}</div>
          {aiData.quotes?.slice(0,2).map((q,i)=>(
            <div key={i} className="card-ai-q" onClick={e=>{e.stopPropagation();onCopyQuote(q);}}>"{q}"</div>
          ))}
        </div>
      )}
      {clearedOpen && cleared && (
        <ClearedPopover
          asset={asset}
          reasons={cleared.reasons}
          onClose={() => setClearedOpen(false)}
          libraryFreshnessRuleActive={cleared.libraryFreshnessRuleActive}
          isInMultiSelection={cleared.isInMultiSelection}
          onSetFreshnessException={cleared.onSetFreshnessException}
          onSetCustomFlags={cleared.onSetCustomFlags}
          onResetStatusIndicators={cleared.onResetStatusIndicators}
          onSetClientStatus={cleared.onSetClientStatus}
          onSetApproval={cleared.onSetApproval}
          onMarkVerified={cleared.onMarkVerified}
          anchor={dotRef.current}
          knownCustomTags={cleared.knownCustomTags}
        />
      )}
    </div>
  );
}

function QCard({asset,onClick,aiData,onCopyQuote,onRestore,isSelected,onToggleSelect,menuItems,onCopyShareLink}: CardProps) {
  const c=VERT_CLR[asset.vertical]||"#4f46e5";
  const grad=`linear-gradient(135deg, ${c} 0%, ${c}dd 40%, ${c}99 100%)`;
  const isArchived=asset.status==="archived";
  const isDraft=asset.status==="draft";
  const statusClass=isArchived?" archived":isDraft?" draft":"";
  return(
    <div className={`qcard${statusClass}${isSelected?" selected":""}`} onClick={()=>onClick(asset)}>
      {onToggleSelect && (
        <input
          type="checkbox"
          className={`qcard-check${isSelected?" checked":""}`}
          checked={!!isSelected}
          onChange={()=>{ /* handled by onClick to capture shift key */ }}
          onClick={e=>{e.stopPropagation();onToggleSelect(asset.id,e.shiftKey);}}
          title="Shift-click to select a range"
        />
      )}
      {menuItems && (
        <div className="qcard-dots"><DotsMenu items={menuItems}/></div>
      )}
      {onCopyShareLink && (
        <button
          className="qcard-share"
          onClick={e=>{e.stopPropagation();onCopyShareLink(asset);}}
          title="Copy share link"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
            <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
          </svg>
        </button>
      )}
      {isArchived&&<div className="status-badge archived" title={asset.archivedReason||""}>Archive</div>}
      {isDraft&&<div className="status-badge draft" title="Private — not visible to sales reps or in StoryMatch search">Private</div>}
      {isArchived&&onRestore&&!menuItems&&(
        <button className="archived-restore" onClick={e=>{e.stopPropagation();onRestore(asset);}}>↶ Restore</button>
      )}
      {aiData&&<div className="card-rank" style={{position:"absolute",top:12,left:12,zIndex:3}}>{aiData.rank}</div>}
      <div className="qcard-bg" style={{["--qgrad" as string]:grad} as React.CSSProperties}/>
      <div className="qcard-content">
        <div className="qcard-quote-text">"{asset.pullQuote}"</div>
        {Array.isArray(asset.customFlags) && asset.customFlags.length > 0 && (
          <div className="qcard-chips">
            <FlagChips flags={asset.customFlags as CustomFlag[]} dense/>
          </div>
        )}
        <div className="qcard-divider"/>
        <div className="qcard-attr">
          <div className="qcard-who"><div className="qcard-name">{asset.clientName}</div><div className="qcard-co">{asset.company}</div></div>
          <div className="qcard-cta">quote →</div>
        </div>
      </div>
      {aiData&&(
        <div className="card-ai" onClick={e=>e.stopPropagation()}>
          <div className="card-ai-reason">{aiData.reasoning}</div>
          {aiData.quotes?.slice(0,2).map((q,i)=>(
            <div key={i} className="card-ai-q" onClick={e=>{e.stopPropagation();onCopyQuote(q);}}>"{q}"</div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── LIST VIEW (admin governance) ───────────────────────────────────────────
//
// Compact row-based view for admin testimonial management. Surfaces lifecycle
// state (status, client_status, last_verified) inline and lets admins act on
// each row without leaving the page. Sales reps and the public preview never
// see this view — it's strictly an admin governance tool.

// ─── DOTS MENU (per-row, per-card actions) ─────────────────────────────────
type MenuItem = { label: string; onClick: () => void; danger?: boolean } | { divider: true };
function DotsMenu({ items }: { items: MenuItem[] }) {
  const [open, setOpen] = useState(false);
  // Popup is portal-rendered to document.body with computed fixed coords so
  // it can escape the card's overflow:hidden (and any transformed ancestor's
  // containing block). Without this, the dropdown gets clipped at the card edge.
  const [coords, setCoords] = useState<{ top?: number; bottom?: number; right: number } | null>(null);
  const btnRef = React.useRef<HTMLButtonElement>(null);
  const popRef = React.useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (btnRef.current?.contains(t)) return;
      if (popRef.current?.contains(t)) return;
      setOpen(false);
    };
    // Compute coords + flip up if not enough room below.
    const POP_HEIGHT_ESTIMATE = 220; // ~6 menu items, roomy guess
    const reposition = () => {
      if (!btnRef.current) return;
      const r = btnRef.current.getBoundingClientRect();
      const right = window.innerWidth - r.right;
      const spaceBelow = window.innerHeight - r.bottom;
      const spaceAbove = r.top;
      const flipUp = spaceBelow < POP_HEIGHT_ESTIMATE && spaceAbove > spaceBelow;
      if (flipUp) setCoords({ bottom: window.innerHeight - r.top + 4, right });
      else        setCoords({ top: r.bottom + 4, right });
    };
    reposition();
    const dt = setTimeout(() => document.addEventListener("mousedown", onDoc), 0);
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
    return () => {
      clearTimeout(dt);
      document.removeEventListener("mousedown", onDoc);
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition);
    };
  }, [open]);

  const handleToggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!open && btnRef.current) {
      // Compute coords synchronously on open so the popup paints in one
      // pass instead of flashing at coords=null first.
      const r = btnRef.current.getBoundingClientRect();
      const right = window.innerWidth - r.right;
      const POP_HEIGHT_ESTIMATE = 220;
      const spaceBelow = window.innerHeight - r.bottom;
      const flipUp = spaceBelow < POP_HEIGHT_ESTIMATE && r.top > spaceBelow;
      if (flipUp) setCoords({ bottom: window.innerHeight - r.top + 4, right });
      else        setCoords({ top: r.bottom + 4, right });
    }
    setOpen(o => !o);
  };

  return (
    <>
      <button ref={btnRef} className="dots-btn" onClick={handleToggle} title="Actions">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>
      </button>
      {open && coords && typeof document !== "undefined" && createPortal(
        <div
          ref={popRef}
          className="dots-pop dots-pop-portal"
          style={{
            position: "fixed",
            right: coords.right,
            // Explicit auto on unused axis so legacy class top doesn't leak.
            top: coords.top !== undefined ? coords.top : "auto",
            bottom: coords.bottom !== undefined ? coords.bottom : "auto",
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {items.map((it, i) => "divider" in it
            ? <div key={`d${i}`} className="dots-divider"/>
            : <button key={i} className={`dots-item${it.danger ? " danger" : ""}`} onClick={() => { setOpen(false); it.onClick(); }}>{it.label}</button>
          )}
        </div>,
        document.body
      )}
    </>
  );
}

// ─── BULK ACTION BAR (floating, appears when any rows are selected) ──────────
// "Set status…" opens a modal containing all the status indicator dropdowns
// + publication dropdown so admins can edit any subset of fields across
// the whole selection in one motion. Each field defaults to "Leave
// unchanged" — only edited fields get applied to the selected assets.
interface BulkStatusPatch {
  publication?: "published" | "draft" | "archived";
  approval?: ApprovalStatus;
  client?: "current" | "former" | "unknown";
  // Freshness expiration: undefined = leave unchanged.
  //   string ISO    = set to that date.
  //   "never"       = set sentinel (never-flag, overrides org rule).
  //   null          = remove per-asset rule (asset falls back to org rule).
  freshnessExpiration?: "never" | "leave" | string | null;
  // New custom flag to APPEND to every selected asset (additive, not replace).
  addFlag?: { color: string; label: string };
  // Clear-all action: resets all status indicator fields to default state.
  clearAll?: boolean;
}

// Compact chip strip showing the asset's *informational* custom flags.
// Yellow and red flags are intentionally excluded here — those are
// severity flags and already show up inside the cleared trigger's
// "Approved but [label]" text, so duplicating them as chips creates a
// double-dot/double-label effect. Green and custom-hex flags pass
// through. The popover keeps showing all flags for management.
// Optional onClick makes the whole strip a click target — callers wire
// it to the same toggle that opens the cleared popover so chips behave
// like a second affordance for the same control.
function FlagChips({
  flags,
  dense,
  onClick,
}: {
  flags: CustomFlag[];
  dense?: boolean;
  onClick?: (e: React.MouseEvent) => void;
}) {
  // Filter out severity flags — they live in the cleared trigger.
  const visible = (flags || []).filter(f => f && !isSeverityColor(f.color));
  if (visible.length === 0) return null;
  return (
    <div
      className={`cl-flag-chips${dense ? " dense" : ""}${onClick ? " clickable" : ""}`}
      onClick={onClick}
      role={onClick ? "button" : undefined}
    >
      {visible.map(f => {
        const isHex = isHexColor(f.color);
        const presetClass = !isHex ? f.color : "custom";
        const styleProps: React.CSSProperties = isHex
          ? { background: `${f.color}1a`, borderColor: `${f.color}66`, color: "#1f2937" }
          : {};
        return (
          <span
            key={f.id}
            className={`cl-flag-chip ${presetClass}`}
            style={styleProps}
            title={f.label || (presetClass === "red" ? "Red flag" : presetClass === "yellow" ? "Yellow flag" : presetClass === "green" ? "Green flag" : "Custom flag")}
          >
            <span
              className={`cl-circle ${presetClass}`}
              style={isHex ? { background: f.color, borderColor: f.color } : undefined}
            />
            {f.label && <span className="cl-flag-chip-label">{f.label}</span>}
          </span>
        );
      })}
    </div>
  );
}

// Reusable row of "previously-used custom tags" rendered below the
// FlagColorPicker in any Add custom status form. Clicking a chip
// populates the parent's color + label state. Hidden when there's
// nothing to suggest. Lets admins maintain consistency in their custom
// taxonomies without re-picking color or re-typing label every time.
interface KnownTagsRowProps {
  tags: { color: string; label: string }[];
  // Skip tags whose (color, label) combo is already in this list — used
  // by the per-asset popover to hide tags the asset already has applied
  // (they'd be no-ops to re-apply).
  excludeKeys?: Set<string>;
  onPick: (tag: { color: string; label: string }) => void;
}
function KnownTagsRow({ tags, excludeKeys, onPick }: KnownTagsRowProps) {
  const filtered = tags.filter(t => {
    const k = `${t.color}|${t.label}`;
    return !excludeKeys || !excludeKeys.has(k);
  });
  if (filtered.length === 0) return null;
  return (
    <div className="known-tags-row">
      <div className="known-tags-label">Reuse a previous tag</div>
      <div className="known-tags-chips">
        {filtered.map(t => {
          const isHex = isHexColor(t.color);
          const presetClass = !isHex ? t.color : "custom";
          const chipStyle: React.CSSProperties = isHex
            ? { background: `${t.color}1a`, borderColor: `${t.color}66`, color: "#1f2937" }
            : {};
          const dotStyle: React.CSSProperties | undefined = isHex
            ? { background: t.color, borderColor: t.color }
            : undefined;
          return (
            <button
              key={`${t.color}|${t.label}`}
              type="button"
              className={`known-tag-chip cl-flag-chip ${presetClass}`}
              style={chipStyle}
              onClick={() => onPick(t)}
              title={`Reuse: ${t.label || (presetClass === "red" ? "Red" : presetClass === "yellow" ? "Yellow" : presetClass === "green" ? "Green" : "Custom")}`}
            >
              <span className={`cl-circle ${presetClass}`} style={dotStyle}/>
              {t.label && <span className="cl-flag-chip-label">{t.label}</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// Shared color picker for "Add custom status" forms in both the popover
// and the bulk modal. Three presets (yellow/red/green) + an "Other…" radio
// that reveals a native color input. Storing the actual picked color in
// state means the consumer doesn't have to track preset-vs-hex separately.
interface FlagColorPickerProps {
  value: string;            // current color — preset name or hex
  onChange: (v: string) => void;
  // Unique name used on the radios so multiple instances on the page don't
  // conflict (modal + popover can both be open conceptually).
  name: string;
}
function FlagColorPicker({ value, onChange, name }: FlagColorPickerProps) {
  // Determine which radio is active. "Other" is active when value isn't
  // one of the presets (assumed to be a hex string).
  const isHex = isHexColor(value);
  const activePreset = !isHex ? value : "other";
  // Track the most recent custom color the user set, so flipping back to
  // "Other" without re-picking still shows their last choice.
  const [hexDraft, setHexDraft] = useState<string>(isHex ? value : "#0ea5e9");
  return (
    <div className="cf-severity-row">
      <label className="cl-radio">
        <input type="radio" name={name} checked={activePreset === "yellow"} onChange={() => onChange("yellow")}/>
        <span className="cl-circle yellow"/> Yellow
      </label>
      <label className="cl-radio">
        <input type="radio" name={name} checked={activePreset === "red"} onChange={() => onChange("red")}/>
        <span className="cl-circle red"/> Red
      </label>
      <label className="cl-radio">
        <input type="radio" name={name} checked={activePreset === "green"} onChange={() => onChange("green")}/>
        <span className="cl-circle green"/> Green
      </label>
      <label className="cl-radio">
        <input
          type="radio"
          name={name}
          checked={activePreset === "other"}
          onChange={() => onChange(hexDraft)}
        />
        <span
          className="cl-circle custom"
          style={{ background: hexDraft, borderColor: hexDraft }}
        />
        Other
        <input
          type="color"
          className="cl-color-input"
          value={hexDraft}
          onChange={(e) => {
            setHexDraft(e.target.value);
            onChange(e.target.value);
          }}
          aria-label="Pick a custom color"
        />
      </label>
    </div>
  );
}

interface BulkBarProps {
  count: number;
  onPublish: () => void;
  onDraft: () => void;
  onArchive: () => void;
  onMarkVerified: () => void;
  onDelete: () => void;
  onClear: () => void;
  onApplyStatus: (patch: BulkStatusPatch) => void | Promise<void>;
  // Distinct (color, label) tags previously used across the org's assets,
  // surfaced inside the bulk Set status modal as quick-pick chips.
  knownCustomTags?: { color: string; label: string }[];
}
function BulkBar({ count, onPublish, onDraft, onArchive, onMarkVerified, onDelete, onClear, onApplyStatus, knownCustomTags }: BulkBarProps) {
  const [visibilityOpen, setVisibilityOpen] = useState(false);
  const [statusOpen, setStatusOpen] = useState(false);
  // Wire the dedicated visibility modal back through onPublish/onDraft/onArchive
  // so we don't have to pipe a new handler through ListView. Same network
  // result either way.
  void onMarkVerified; // (legacy hook; kept on props for parent compat)
  const setVisibility = (next: "published" | "draft" | "archived") => {
    if (next === "published") onPublish();
    else if (next === "draft") onDraft();
    else onArchive();
  };
  return (
    <>
      <div className="bulk-bar">
        <span className="bulk-count">{count} selected</span>
        <button className="bulk-btn" onClick={() => setVisibilityOpen(true)}>Set visibility…</button>
        <button className="bulk-btn" onClick={() => setStatusOpen(true)}>Set status…</button>
        <button className="bulk-btn danger" onClick={onDelete}>Delete</button>
        <button className="bulk-close" onClick={onClear} title="Clear selection">✕</button>
      </div>
      {visibilityOpen && (
        <BulkVisibilityModal
          count={count}
          onClose={() => setVisibilityOpen(false)}
          onApply={(next) => {
            setVisibility(next);
            setVisibilityOpen(false);
          }}
        />
      )}
      {statusOpen && (
        <BulkStatusModal
          count={count}
          onClose={() => setStatusOpen(false)}
          onApply={async (patch) => {
            await onApplyStatus(patch);
            setStatusOpen(false);
          }}
          knownCustomTags={knownCustomTags}
        />
      )}
    </>
  );
}

// ─── BULK VISIBILITY MODAL ────────────────────────────────────────────────
// Single-purpose modal for the "Set visibility…" bulk action. Three radio-
// style options + Apply. Keeps visibility control completely separate from
// the status (cleared) controls so neither modal has to handle both concepts.
interface BulkVisibilityModalProps {
  count: number;
  onClose: () => void;
  onApply: (next: "published" | "draft" | "archived") => void;
}
function BulkVisibilityModal({ count, onClose, onApply }: BulkVisibilityModalProps) {
  const [choice, setChoice] = useState<"published" | "draft" | "archived">("published");
  return createPortal(
    <>
      <div className="bsm-backdrop" onClick={onClose}/>
      <div className="bsm-modal" onClick={(e) => e.stopPropagation()}>
        <div className="bsm-head">
          <div className="bsm-title">Set visibility</div>
          <div className="bsm-sub">Apply to {count} selected {count === 1 ? "asset" : "assets"}.</div>
        </div>
        <div className="bsm-body">
          <div className="bsm-choice-list">
            {([
              { value: "published", label: "Public", help: "Visible to sales reps and StoryMatch search" },
              { value: "draft",     label: "Private", help: "Hidden from sales reps and search" },
              { value: "archived",  label: "Archive", help: "Removed from active library" },
            ] as { value: "published" | "draft" | "archived"; label: string; help: string }[]).map((opt) => (
              <label key={opt.value} className={`bsm-choice${choice === opt.value ? " selected" : ""}`}>
                <input
                  type="radio"
                  name="bsm-vis"
                  checked={choice === opt.value}
                  onChange={() => setChoice(opt.value)}
                />
                <div className="bsm-choice-text">
                  <div className="bsm-choice-label">{opt.label}</div>
                  <div className="bsm-choice-help">{opt.help}</div>
                </div>
              </label>
            ))}
          </div>
        </div>
        <div className="bsm-foot">
          <button className="cl-mini-btn" onClick={onClose}>Cancel</button>
          <button className="cl-mini-btn primary" onClick={() => onApply(choice)}>Apply to {count}</button>
        </div>
      </div>
    </>,
    document.body
  );
}

// ─── VISIBILITY OVERRIDE MODAL ────────────────────────────────────────────
// Shown when admin tries to set an asset to Public but one or more rules
// would immediately reverse the change (e.g., expiration → Make private,
// approval_denied → Make private). Without this, admin watches their click
// silently re-flip and assumes it's broken. We intercept, explain which
// rules are in the way, and offer a single Override button that clears
// EVERY firing rule's trigger atomically. Single-rule and multi-rule cases
// share one button so admin never has to override-then-override-again.
interface VisibilityOverrideModalProps {
  asset: Asset;
  ruleKeys: string[];           // every rule currently firing on this asset
  onClose: () => void;
  onOverride: () => void;       // applies all overrides atomically
}
// Per-rule description of what's blocking + what overriding does. Used to
// build the modal copy regardless of how many rules are firing.
function describeBlockingRule(ruleKey: string): { what: string; fix: string } {
  switch (ruleKey) {
    case "expiration":
      return {
        what: "This story is flagged as expired (older than your freshness threshold).",
        fix: "Mark this asset as never-expiring.",
      };
    case "approval_denied":
      return {
        what: "This story's approval is set to Denied.",
        fix: "Set approval back to Approved.",
      };
    default:
      return {
        what: `An org rule (${ruleKey}) is keeping this asset out of Public.`,
        fix: "Clear the rule's trigger.",
      };
  }
}
function VisibilityOverrideModal({ asset, ruleKeys, onClose, onOverride }: VisibilityOverrideModalProps) {
  void asset;
  const blockers = ruleKeys.map(describeBlockingRule);
  const isMulti = ruleKeys.length > 1;
  const overrideLabel = isMulti ? "Override all" : "Override";
  return createPortal(
    <>
      <div className="bsm-backdrop" onClick={onClose}/>
      <div className="bsm-modal" onClick={(e) => e.stopPropagation()}>
        <div className="bsm-head">
          <div className="bsm-title">
            {isMulti ? "Visibility blocked by rules" : "Visibility blocked by rule"}
          </div>
          <div className="bsm-sub">
            {isMulti
              ? `${ruleKeys.length} org rules are keeping this story out of Public.`
              : blockers[0]?.what || "An org rule is keeping this story out of Public."}
          </div>
        </div>
        <div className="bsm-body">
          <ul className="vom-list">
            {blockers.map((b, i) => (
              <li key={ruleKeys[i]} className="vom-list-item">
                <div className="vom-list-what">{b.what}</div>
                <div className="vom-list-fix">→ {b.fix}</div>
              </li>
            ))}
          </ul>
        </div>
        <div className="bsm-foot">
          <button className="cl-mini-btn" onClick={onClose}>Cancel</button>
          <button className="cl-mini-btn primary" onClick={onOverride}>
            {overrideLabel} &amp; make Public
          </button>
        </div>
      </div>
    </>,
    document.body
  );
}

// ─── BULK STATUS MODAL ────────────────────────────────────────────────────
// One modal that lets admins edit publication + status indicator fields
// across N selected assets at once. Each field has a "Leave unchanged"
// option so admins only apply what they actually want to change.
interface BulkStatusModalProps {
  count: number;
  onClose: () => void;
  onApply: (patch: BulkStatusPatch) => void | Promise<void>;
  knownCustomTags?: { color: string; label: string }[];
}
function BulkStatusModal({ count, onClose, onApply, knownCustomTags }: BulkStatusModalProps) {
  // Each field: "" means leave unchanged. Specific value = apply.
  // Visibility lives in its own dedicated modal (BulkVisibilityModal) — this
  // one is purely for the cleared/approval indicator controls.
  const [approval, setApproval] = useState<"" | ApprovalStatus>("");
  const [client, setClient] = useState<"" | "current" | "former" | "unknown">("");
  // Expiration: "leave" / "never" / "set"
  // "never" → far-future sentinel that overrides any org rule (admins
  // bulk-setting "no expiration" expect the asset to never be flagged,
  // even when the library has an active expiration rule).
  const [expMode, setExpMode] = useState<"leave" | "never" | "set">("leave");
  const [expDate, setExpDate] = useState<string>(() => {
    const d = new Date();
    d.setFullYear(d.getFullYear() + 1);
    return d.toISOString().split("T")[0];
  });
  // Custom flag to add (additive). "" label = don't add. Color is one of
  // the three presets OR a custom hex string when "Other…" is picked.
  const [flagColor, setFlagColor] = useState<string>("yellow");
  const [flagLabel, setFlagLabel] = useState<string>("");
  const [addFlagToggle, setAddFlagToggle] = useState(false);

  const buildNeverExpiryIso = (): string => {
    const d = new Date();
    d.setFullYear(d.getFullYear() + 100);
    return d.toISOString();
  };

  const handleApply = () => {
    const patch: BulkStatusPatch = {};
    if (approval) patch.approval = approval as ApprovalStatus;
    if (client) patch.client = client as "current" | "former" | "unknown";
    if (expMode === "never") patch.freshnessExpiration = buildNeverExpiryIso();
    else if (expMode === "set") patch.freshnessExpiration = new Date(expDate).toISOString();
    if (addFlagToggle) patch.addFlag = { color: flagColor, label: flagLabel.trim() };
    if (Object.keys(patch).length === 0) {
      onClose();
      return;
    }
    onApply(patch);
  };

  const handleClearAll = () => {
    if (!confirm(`Reset status indicators on ${count} ${count === 1 ? "asset" : "assets"}? This resets approval, client status, expiration, and custom flags to default. Visibility is unchanged.`)) return;
    onApply({ clearAll: true });
  };

  const dirty = !!approval || !!client || expMode !== "leave" || addFlagToggle;

  return createPortal(
    <>
      <div className="bsm-backdrop" onClick={onClose}/>
      <div className="bsm-modal" onClick={(e) => e.stopPropagation()}>
        <div className="bsm-head">
          <div className="bsm-title">Set status</div>
          <div className="bsm-sub">Apply to {count} selected {count === 1 ? "asset" : "assets"}.</div>
        </div>
        {/* Body — flat list of status indicator controls. No labels, no
            descriptive text, no expand/collapse. Each select uses a
            placeholder option to communicate "leave unchanged" so we
            don't need a header above each row. */}
        <div className="bsm-body">
          <div className="bsm-status-fields">
            <select
              className="cl-select"
              value={approval}
              onChange={(e) => setApproval(e.target.value as "" | ApprovalStatus)}
            >
              <option value="">Approval — leave unchanged</option>
              <option value="approved">Approved</option>
              <option value="pending">Pending</option>
              <option value="denied">Denied</option>
              <option value="needs_edits">Needs edits</option>
              <option value="unset">Blank</option>
            </select>

            <select
              className="cl-select"
              value={client}
              onChange={(e) => setClient(e.target.value as "" | "current" | "former" | "unknown")}
            >
              <option value="">Client — leave unchanged</option>
              <option value="current">Active client</option>
              <option value="former">Former client</option>
              <option value="unknown">Blank</option>
            </select>

            <div className="bsm-fld-stack">
              <select
                className="cl-select"
                value={expMode}
                onChange={(e) => setExpMode(e.target.value as "leave" | "never" | "set")}
              >
                <option value="leave">Expiration — leave unchanged</option>
                <option value="never">Never expire</option>
                <option value="set">Expire on…</option>
              </select>
              {expMode === "set" && (
                <input
                  className="cl-exception-date"
                  type="date"
                  value={expDate}
                  onChange={(e) => setExpDate(e.target.value)}
                />
              )}
            </div>

            <div className="bsm-fld-stack">
              <label className="bsm-flag-toggle">
                <input
                  type="checkbox"
                  checked={addFlagToggle}
                  onChange={(e) => setAddFlagToggle(e.target.checked)}
                />
                Add custom status
              </label>
              {addFlagToggle && (
                <div className="bsm-flag-form">
                  <FlagColorPicker name="bsm-color" value={flagColor} onChange={setFlagColor}/>
                  <input
                    className="cl-input"
                    placeholder="Optional label"
                    value={flagLabel}
                    onChange={(e) => setFlagLabel(e.target.value)}
                  />
                  <KnownTagsRow
                    tags={knownCustomTags || []}
                    onPick={(t) => { setFlagColor(t.color); setFlagLabel(t.label); }}
                  />
                </div>
              )}
            </div>
          </div>
          <button className="bsm-clear-all-btn" onClick={handleClearAll}>Reset</button>
        </div>
        <div className="bsm-foot">
          <button className="cl-mini-btn" onClick={onClose}>Cancel</button>
          <button className="cl-mini-btn primary" onClick={handleApply} disabled={!dirty}>Apply to {count}</button>
        </div>
      </div>
    </>,
    document.body
  );
}

interface ListViewProps {
  assets: Asset[];
  selectedIds: Set<string>;
  onToggleSelect: (id: string, shiftKey?: boolean) => void;
  onClick: (a: Asset) => void;
  onEdit: (a: Asset) => void;
  onSetPublicationStatus: (a: Asset, next: "published" | "draft" | "archived") => void;
  onSetClientStatus: (a: Asset, next: "current" | "former" | "unknown") => void;
  onSetApproval: (a: Asset, patch: { status?: ApprovalStatus; note?: string }) => void;
  onMarkVerified: (a: Asset) => void;
  onSetFreshnessException: (a: Asset, untilIso: string | null) => void;
  onSetCustomFlags: (a: Asset, flags: CustomFlag[]) => void;
  onResetStatusIndicators: (a: Asset) => void;
  onDelete: (id: string) => void;
  onCopyShareLink: (a: Asset) => void;
  // Org-level Rules that drive the freshness signal in the Cleared popover.
  orgSettings: OrgSettings;
  // Distinct (color, label) tags used elsewhere in the org — surfaced in
  // the per-row Add custom status form for quick reuse.
  knownCustomTags?: { color: string; label: string }[];
}

// Compute the "Cleared for use" composite signal from approval, client status,
// and freshness. Worst-of-three logic. Returns the level (green / yellow / red)
// and a per-signal breakdown for the popover.
//
// Default state when no admin has engaged: `unset` — no dot, no nag. The dot
// only appears once an admin records approval or actively sets client status,
// because that's when the lifecycle data is meaningful enough to display.
type ClearedLevel = "green" | "yellow" | "red" | "unset";
// Build the patch that resets all status indicators on an asset back to
// their default state. Used by both the per-asset Reset button and the
// bulk modal's "Reset status indicators" action — single source of truth
// so the two paths stay consistent.
function buildResetStatusPatch(
  orgSettings: { freshnessWarnAfterMonths: number | null; freshnessWarnBeforeDate: string | null },
  userEmail: string,
): Partial<Asset> {
  const hasOrgFreshnessRule = !!(orgSettings.freshnessWarnAfterMonths || orgSettings.freshnessWarnBeforeDate);
  const neverIso = (() => {
    const d = new Date();
    d.setFullYear(d.getFullYear() + 100);
    return d.toISOString();
  })();
  const nowIso = new Date().toISOString();
  return {
    approvalStatus: "unset",
    approvalRecordedAt: null,
    approvalNote: null,
    clientStatus: "current",
    clientStatusSource: "unset",
    clientStatusUpdatedAt: null,
    // Freshness: when org rule is on, set never-flag sentinel so reset
    // doesn't immediately re-fire yellow. When off, just clear.
    freshnessExceptionUntil: hasOrgFreshnessRule ? neverIso : null,
    freshnessExceptionSetByEmail: hasOrgFreshnessRule ? (userEmail || null) : null,
    freshnessExceptionSetAt: hasOrgFreshnessRule ? nowIso : null,
    customFlags: [],
  };
}

// Hook: makes a <select> propagate to multi-selection even when admin picks
// the same value (native onChange doesn't fire in that case). Tracks
// mousedown to distinguish "user actually clicked the select" from
// "tab-navigation blur" — only fires on blur when the user actively
// interacted AND multi-select is active. Returns props to spread onto the
// <select> element.
function useSameValueAwareSelect(
  isInMultiSelection: boolean,
  onApply: (value: string) => void,
) {
  const interactedRef = React.useRef(false);
  return {
    onMouseDown: () => { interactedRef.current = true; },
    onChange: (e: React.ChangeEvent<HTMLSelectElement>) => {
      // onChange always handles the value-changed case. Mark consumed so
      // the trailing blur doesn't re-fire (would duplicate the apply).
      interactedRef.current = false;
      onApply(e.target.value);
    },
    onBlur: (e: React.FocusEvent<HTMLSelectElement>) => {
      // Same-value pick path: user clicked, picker opened, picked same option,
      // picker closed → onChange didn't fire but interaction did. Propagate
      // when in multi-select mode so the same value applies to the selection.
      if (interactedRef.current && isInMultiSelection) {
        onApply(e.target.value);
      }
      interactedRef.current = false;
    },
  };
}

// Shared helper: build the hover/title message for the Cleared signal so
// list view and grid view show the same wording.
//   • unset  → "Click to set status"
//   • green  → "Green flag: cleared for use"
//   • yellow → "Flagged for review: <reasons>"
//   • red    → "Red flag: <reasons>"
//
// When approval is the positive "Approved" state but there are still yellow/
// red flags from other signals, prefix the reason text with "Approved but"
// so admins understand the asset is approved AND has a separate concern,
// instead of being confused by a yellow/red dot after picking Approved.
function clearedTooltip(level: ClearedLevel, reasons: ClearedReason[]): string {
  if (level === "unset") return "Click to set status";
  if (level === "green") return "Green flag: cleared for use";
  const items = reasons
    .filter(r => r.level === level)
    .map(r => r.shortLabel || r.label);
  let joined = "";
  if (items.length === 1) joined = items[0];
  else if (items.length === 2) joined = `${items[0]} and ${items[1]}`;
  else if (items.length > 2) joined = `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
  // Approved-but prefix
  const isApproved = reasons.some(r => r.signal === "approval" && r.level === "green" && !r.hideDot);
  const reasonText = joined ? (isApproved ? `Approved but ${joined.charAt(0).toLowerCase() + joined.slice(1)}` : joined) : "";
  if (level === "yellow") return reasonText ? `Flagged for review: ${reasonText}` : "Flagged for review";
  return reasonText ? `Red flag: ${reasonText}` : "Red flag";
}

interface ClearedReason {
  signal: "approval" | "client" | "freshness" | "custom";
  level: "green" | "yellow" | "red";
  label: string;
  // Optional: short version of the label suitable for the list view's
  // tooltip / inline text. Falls back to label if absent.
  shortLabel?: string;
  // Optional: just the threshold/violation portion of the message, used by
  // the popover to render a short warning under the main info line. Only
  // set on freshness yellow today; could expand to other signals later.
  flagDetail?: string;
  // Hide the colored dot in the popover for this signal. Used when the
  // signal has no rule defined at all (neither org-wide nor per-asset) —
  // a green dot would imply a "passing" judgment when there's nothing to
  // judge against. List/grid views still show the aggregate dot.
  hideDot?: boolean;
  // For freshness only — the date when the org rule will flag this asset.
  // Set when a rolling org rule is active and the asset has a publish date.
  // Null/undefined for absolute-date org rules or when no rule is active.
  // Drives the "Set to expire on …" grey box in the popover.
  effectiveExpiration?: string;
}

// Client-side mirror of lib/publication-rules.ts findActiveRule. Lets the
// FE predict whether setting visibility to Public would be undone by an
// org rule, so we can intercept and offer an override instead of writing
// a change that gets immediately reversed. Must stay in sync with the
// server's rule-firing logic — the allowed-key set + isExpired math are
// duplicated intentionally to avoid a network round-trip.
const FE_ALLOWED_APPROVAL_RULE_KEYS = new Set(["approval_denied", "approval_pending", "approval_needs_edits"]);

function isAssetExpiredFE(asset: Asset, org: OrgSettings): boolean {
  // Active per-asset exception suppresses the org rule.
  const exUntil = asset.freshnessExceptionUntil
    ? new Date(asset.freshnessExceptionUntil)
    : null;
  const exceptionActive =
    exUntil !== null && !Number.isNaN(exUntil.getTime()) && exUntil.getTime() > Date.now();
  if (exceptionActive) return false;

  if (org.freshnessWarnBeforeDate) {
    const cutoff = new Date(org.freshnessWarnBeforeDate);
    const pub = asset.publishedAt ? new Date(asset.publishedAt) : null;
    return !!pub && !Number.isNaN(cutoff.getTime()) && pub < cutoff;
  }
  if (org.freshnessWarnAfterMonths !== null) {
    const pub = asset.publishedAt ? new Date(asset.publishedAt) : null;
    if (!pub || Number.isNaN(pub.getTime())) return false;
    const ageMonths = (Date.now() - pub.getTime()) / (1000 * 60 * 60 * 24 * 30);
    return ageMonths > org.freshnessWarnAfterMonths;
  }
  return false;
}

// Returns every rule key that would fire on this asset right now.
// Server-side findActiveRule short-circuits on the first match because it
// only needs to know which rule to apply, but the FE needs the full set
// to override every blocking trigger atomically. Without this, admin
// overrides one rule, the next one re-flips the asset, admin has to
// override again — a confusing loop.
function findActiveRulesFE(asset: Asset, org: OrgSettings): string[] {
  const out: string[] = [];
  const approval = asset.approvalStatus || "unset";
  const approvalKey = `approval_${approval}`;
  if (FE_ALLOWED_APPROVAL_RULE_KEYS.has(approvalKey)) {
    const rule = org.publicationRules[approvalKey];
    if (rule && rule.action !== "none") out.push(approvalKey);
  }
  const expRule = org.publicationRules["expiration"];
  if (expRule && expRule.action !== "none" && isAssetExpiredFE(asset, org)) {
    out.push("expiration");
  }
  return out;
}

function isClearedEngaged(asset: Asset): boolean {
  const approvalEngaged = !!asset.approvalStatus && asset.approvalStatus !== "unset";
  const clientEngaged = asset.clientStatusSource === "manual" || asset.clientStatusSource === "crm";
  return approvalEngaged || clientEngaged;
}

function computeCleared(asset: Asset, orgSettings: OrgSettings): { level: ClearedLevel; reasons: ClearedReason[] } {
  // Always compute the per-signal reasons so the popover can render them
  // regardless of engagement state. Only the *overall* level is gated by
  // engagement — when the admin hasn't touched anything, we return level:
  // "unset" so the row shows no dot.
  const reasons: ClearedReason[] = [];

  // Approval — default ("unset") contributes no dot and no aggregate impact
  // (treated as green so it doesn't drag the cleared signal yellow). When
  // admin picks any actual status, the appropriate dot color shows.
  const approval = (asset.approvalStatus || "unset") as ApprovalStatus;
  if (approval === "approved") reasons.push({ signal: "approval", level: "green", label: "Approval received", shortLabel: "Approved" });
  else if (approval === "denied") reasons.push({ signal: "approval", level: "red", label: "Approval denied", shortLabel: "Denied" });
  else if (approval === "pending") reasons.push({ signal: "approval", level: "yellow", label: "Pending approval", shortLabel: "Pending" });
  else if (approval === "needs_edits") reasons.push({ signal: "approval", level: "yellow", label: "Needs edits", shortLabel: "Needs edits" });
  else reasons.push({ signal: "approval", level: "green", label: "Approval not recorded", hideDot: true });

  // Client relationship — treat unset/auto-default as "unknown" (Unspecified).
  // The DB column defaults to "current" so we explicitly check
  // clientStatusSource to distinguish "admin actively picked Yes" from
  // "we just defaulted to current because the column required something."
  const clientManuallySet = asset.clientStatusSource === "manual" || asset.clientStatusSource === "crm";
  const cs = (clientManuallySet ? (asset.clientStatus || "unknown") : "unknown") as ClientStatus;
  if (cs === "current") reasons.push({ signal: "client", level: "green", label: "Current client", shortLabel: "Active client" });
  else if (cs === "former") reasons.push({ signal: "client", level: "yellow", label: "No longer a client", shortLabel: "Former client" });
  else reasons.push({ signal: "client", level: "green", label: "Client status unspecified", hideDot: true });

  // Freshness — driven by Vimeo publish date + org-level Rule.
  // Two mutually-exclusive rule modes:
  //   • freshnessWarnAfterMonths (rolling): flag if (now - published_at) > N months
  //   • freshnessWarnBeforeDate (fixed):     flag if published_at < date
  //   • neither set:                          freshness always green
  const pub = asset.publishedAt ? new Date(asset.publishedAt) : null;
  if (!pub || Number.isNaN(pub.getTime())) {
    reasons.push({ signal: "freshness", level: "green", label: "Publish date not recorded" });
  } else {
    // Build a verbose age label: "Published Apr 15, 2023 (2y ago)" — the
    // exact date removes the ambiguity that pure "2y ago" rounding caused.
    const dateLabel = pub.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
    const relLabel = timeAgoShort(asset.publishedAt!);
    const ageLabel = `Published ${dateLabel} (${relLabel})`;

    let flagged = false;
    let thresholdLabel = "";
    // Compute the date when the rolling rule will flag this asset (if active).
    // For absolute-date rules there's no future "expiration date" — a video
    // is either before or after the cutoff, so effectiveExpiration is null.
    let effectiveExpiration: string | undefined;
    if (orgSettings.freshnessWarnBeforeDate) {
      const cutoff = new Date(orgSettings.freshnessWarnBeforeDate);
      if (!Number.isNaN(cutoff.getTime()) && pub < cutoff) {
        flagged = true;
        thresholdLabel = `before ${cutoff.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })} cutoff`;
      }
    } else if (orgSettings.freshnessWarnAfterMonths !== null) {
      const ageMonths = (Date.now() - pub.getTime()) / (1000 * 60 * 60 * 24 * 30);
      if (ageMonths > orgSettings.freshnessWarnAfterMonths) {
        flagged = true;
        const months = orgSettings.freshnessWarnAfterMonths;
        thresholdLabel = months >= 12 && months % 12 === 0
          ? `over ${months / 12}-year threshold`
          : `over ${months}-month threshold`;
      }
      // Effective expiration = publish + threshold months
      const exp = new Date(pub);
      exp.setMonth(exp.getMonth() + orgSettings.freshnessWarnAfterMonths);
      effectiveExpiration = exp.toISOString();
    }

    // Per-asset freshness exception silences the org-level flag while active.
    // Active = until date is in the future (NULL means no exception is set).
    const exceptionUntil = asset.freshnessExceptionUntil ? new Date(asset.freshnessExceptionUntil) : null;
    const exceptionActive = exceptionUntil !== null && !Number.isNaN(exceptionUntil.getTime()) && exceptionUntil.getTime() > Date.now();

    // No-rule case: no org freshness rule AND no per-asset expiration.
    // Don't show a colored dot — there's nothing to judge against, so
    // green/yellow/red would all be misleading.
    const noRuleApplied =
      !orgSettings.freshnessWarnAfterMonths &&
      !orgSettings.freshnessWarnBeforeDate &&
      !exceptionActive;

    if (flagged && exceptionActive) {
      reasons.push({
        signal: "freshness",
        level: "green",
        label: `${ageLabel} — exception active`,
        flagDetail: `Org rule says: ${thresholdLabel}`,
        effectiveExpiration,
      });
    } else if (flagged) {
      reasons.push({
        signal: "freshness",
        level: "yellow",
        label: `${ageLabel} — ${thresholdLabel}`,
        shortLabel: "Expired",
        flagDetail: `Flagged: ${thresholdLabel}`,
        effectiveExpiration,
      });
    } else if (noRuleApplied) {
      reasons.push({ signal: "freshness", level: "green", label: ageLabel, hideDot: true });
    } else {
      reasons.push({ signal: "freshness", level: "green", label: ageLabel, effectiveExpiration });
    }
  }

  // Custom flags split by purpose:
  //   • Yellow/red (severity) → fold into the cleared signal so they
  //     show up in the trigger pill text ("Approved but [label]").
  //     Their chips are suppressed at list/grid level to avoid a double
  //     indicator (the trigger already conveys the dot + label).
  //   • Green and custom hex (informational) → don't affect the cleared
  //     signal. Render as standalone chips.
  // The popover always shows all custom flags as chips for management.
  const customFlags = Array.isArray(asset.customFlags) ? asset.customFlags : [];
  for (const f of customFlags) {
    if (!f || !isSeverityColor(f.color)) continue;
    const text = f.label || "Custom flag";
    reasons.push({
      signal: "custom",
      level: f.color as "yellow" | "red",
      label: text,
      shortLabel: text,
    });
  }

  // Show the dot when admin has engaged (approval/client) OR when freshness
  // is automatically flagged (over org threshold). Other signals' yellow
  // states ("approval not recorded", "client status unknown") are silenced
  // until admin engages — the dot would be permanently nagging otherwise.
  // Freshness is different: it's a real condition the admin needs to see
  // even before they've touched the other governance fields.
  const freshness = reasons.find(r => r.signal === "freshness");
  const freshnessFlagged = freshness?.level === "yellow" || freshness?.level === "red";
  const hasCustomFlag = reasons.some(r => r.signal === "custom");
  if (!isClearedEngaged(asset) && !freshnessFlagged && !hasCustomFlag) {
    return { level: "unset", reasons };
  }

  let level: "green" | "yellow" | "red" = "green";
  for (const r of reasons) {
    if (r.level === "red") { level = "red"; break; }
    if (r.level === "yellow") level = "yellow";
  }
  return { level, reasons };
}

interface ClearedPopoverProps {
  asset: Asset;
  reasons: ClearedReason[];
  onClose: () => void;
  // Whether the org-wide freshness rule is active. Drives the FreshnessSection
  // between two distinct UX modes: standalone dropdown (rule off) vs.
  // exception-button-on-warning (rule on).
  libraryFreshnessRuleActive: boolean;
  // True when this asset is part of an active multi-selection. Used to
  // force-fire dropdown handlers on blur so picking the same value still
  // propagates to the selection (native onChange doesn't fire on same-value
  // picks, which broke "set 5 mixed assets to Blank if I click on a Blank one").
  isInMultiSelection: boolean;
  // Set or clear the per-asset freshness exception. untilIso null = clear.
  onSetFreshnessException: (a: Asset, untilIso: string | null) => void;
  // Replace the asset's custom flags array. Caller stamps setBy/setAt
  // server-side; client passes the desired final array.
  onSetCustomFlags: (a: Asset, flags: CustomFlag[]) => void;
  // Reset all status indicators (approval/client/freshness/custom flags) to
  // default. Handles org-rule-aware freshness exception so reset doesn't
  // immediately re-fire yellow.
  onResetStatusIndicators: (a: Asset) => void;
  onSetClientStatus: (a: Asset, next: "current" | "former" | "unknown") => void;
  onSetApproval: (a: Asset, patch: { status?: ApprovalStatus; note?: string }) => void;
  onMarkVerified: (a: Asset) => void;
  // Org-wide previously-used custom tags — surfaced in the Add custom
  // status form for quick reuse. Optional; absent or empty means just
  // show Yellow/Red/Green/Other in the picker.
  knownCustomTags?: { color: string; label: string }[];
}

interface ClearedPopoverPropsFull extends ClearedPopoverProps {
  // Anchor element from the parent — we use its bounding rect to position the
  // portal-rendered popover. Portaling escapes the row's opacity:.65
  // grey-out so the popover renders at full readable contrast over
  // archived/draft rows.
  anchor?: HTMLElement | null;
}

// Wrapper that owns the trigger DOM node and feeds it as anchor to the
// portal-rendered popover. Keeps the row markup compact + portals the
// popover so opacity/grey-out from row state doesn't leak into it.
interface ClearedCellProps {
  asset: Asset;
  cleared: { level: ClearedLevel; reasons: ClearedReason[] };
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
  libraryFreshnessRuleActive: boolean;
  isInMultiSelection: boolean;
  onSetFreshnessException: (a: Asset, untilIso: string | null) => void;
  onSetCustomFlags: (a: Asset, flags: CustomFlag[]) => void;
  onResetStatusIndicators: (a: Asset) => void;
  onSetClientStatus: (a: Asset, next: "current" | "former" | "unknown") => void;
  onSetApproval: (a: Asset, patch: { status?: ApprovalStatus; note?: string }) => void;
  onMarkVerified: (a: Asset) => void;
  knownCustomTags?: { color: string; label: string }[];
}
function ClearedCell({ asset, cleared, open, onToggle, onClose, libraryFreshnessRuleActive, isInMultiSelection, onSetFreshnessException, onSetCustomFlags, onResetStatusIndicators, onSetClientStatus, onSetApproval, onMarkVerified, knownCustomTags }: ClearedCellProps) {
  const triggerRef = React.useRef<HTMLDivElement>(null);

  // Visible inline text next to the dot — just the joined reasons (no
  // "Flagged for review:" prefix, since the dot color already conveys severity).
  // Prefixes with "Approved but…" when approval is positive so admins
  // understand the asset is approved AND has a separate concern. Custom
  // yellow/red flags are included here (and suppressed from the row-level
  // chip strip) so each flag shows up exactly once.
  const flaggedReasons = cleared.reasons
    .filter(r => r.level === cleared.level && (r.level === "yellow" || r.level === "red"))
    .map(r => r.shortLabel || r.label);
  const isApproved = cleared.reasons.some(r => r.signal === "approval" && r.level === "green" && !r.hideDot);
  const joined = flaggedReasons.length === 0 ? ""
    : flaggedReasons.length === 1 ? flaggedReasons[0]
    : flaggedReasons.length === 2 ? `${flaggedReasons[0]} and ${flaggedReasons[1]}`
    : `${flaggedReasons.slice(0, -1).join(", ")}, and ${flaggedReasons[flaggedReasons.length - 1]}`;
  const flaggedText = joined && isApproved
    ? `Approved but ${joined.charAt(0).toLowerCase() + joined.slice(1)}`
    : joined;

  const title = clearedTooltip(cleared.level, cleared.reasons);
  // When the cleared signal has nothing to say (level === unset) but the
  // asset has custom tags, suppress the empty hollow circle so the row
  // isn't cluttered. The trigger element still renders (zero-sized) so
  // it can anchor the popover; clicks come from the chip strip in this
  // case.
  const hasCustomTagsOnAsset = Array.isArray(asset.customFlags) && asset.customFlags.length > 0;
  const triggerCollapsed = cleared.level === "unset" && hasCustomTagsOnAsset;

  return (
    <div className="cl-cell" onClick={(e) => e.stopPropagation()}>
      <div
        ref={triggerRef}
        className={`cl-trigger${open ? " open" : ""}${cleared.level !== "unset" ? " " + cleared.level : " unset"}${triggerCollapsed ? " collapsed" : ""}`}
        onClick={onToggle}
        title={title}
      >
        {triggerCollapsed ? null : cleared.level === "unset" ? (
          <span className="cl-circle cl-circle-empty"/>
        ) : cleared.level === "green" ? (
          <>
            <span className="cl-circle green"/>
            <span className="cl-trigger-text">Approved</span>
          </>
        ) : (
          <>
            <span className={`cl-circle ${cleared.level}`}/>
            <span className="cl-trigger-text">{flaggedText}</span>
          </>
        )}
      </div>
      {open && (
        <ClearedPopover
          asset={asset}
          reasons={cleared.reasons}
          onClose={onClose}
          libraryFreshnessRuleActive={libraryFreshnessRuleActive}
          isInMultiSelection={isInMultiSelection}
          onSetFreshnessException={onSetFreshnessException}
          onSetCustomFlags={onSetCustomFlags}
          onResetStatusIndicators={onResetStatusIndicators}
          onSetClientStatus={onSetClientStatus}
          onSetApproval={onSetApproval}
          onMarkVerified={onMarkVerified}
          anchor={triggerRef.current}
          knownCustomTags={knownCustomTags}
        />
      )}
    </div>
  );
}

function ClearedPopover({ asset, reasons, onClose, libraryFreshnessRuleActive, isInMultiSelection, onSetFreshnessException, onSetCustomFlags, onResetStatusIndicators, onSetClientStatus, onSetApproval, onMarkVerified, anchor, knownCustomTags }: ClearedPopoverPropsFull) {
  void onMarkVerified; void reasons; void libraryFreshnessRuleActive; // legacy props, kept for API compat
  const popRef = React.useRef<HTMLDivElement>(null);
  const approvalSelectRef = React.useRef<HTMLSelectElement>(null);

  // Multi-select-aware handlers for the popover's status dropdowns. The
  // hook tracks user interaction (mousedown) so onBlur only fires the apply
  // when admin actually opened the picker — not on tab-away or focus loss.
  const approvalSelectHandlers = useSameValueAwareSelect(
    isInMultiSelection,
    (v) => onSetApproval(asset, { status: v as ApprovalStatus }),
  );
  const clientSelectHandlers = useSameValueAwareSelect(
    isInMultiSelection,
    (v) => onSetClientStatus(asset, v as "current" | "former" | "unknown"),
  );

  // Auto-open the approval dropdown ONLY when the asset is genuinely fresh
  // — nothing set, no flags. Avoids opening a picker on top of an already-
  // flagged asset (reads as buggy).
  const approvalUnset = !asset.approvalStatus || asset.approvalStatus === "unset";
  const clientUnset = !asset.clientStatusSource || asset.clientStatusSource === "unset";
  const freshnessExceptionUnset = !asset.freshnessExceptionUntil;
  const noCustomFlags = !Array.isArray(asset.customFlags) || asset.customFlags.length === 0;
  const noFlagsFiring = !reasons.some(r => r.level === "yellow" || r.level === "red");
  const trulyFresh = approvalUnset && clientUnset && freshnessExceptionUnset && noCustomFlags && noFlagsFiring;
  useEffect(() => {
    if (!trulyFresh) return;
    const t = setTimeout(() => {
      const sel = approvalSelectRef.current;
      if (!sel) return;
      try {
        if (typeof sel.showPicker === "function") sel.showPicker();
        else sel.focus();
      } catch {/* picker blocked / not supported */}
    }, 80);
    return () => clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Position the popover relative to the anchor + reposition on scroll/resize.
  // Either `top` or `bottom` is set depending on space above/below the trigger.
  const [coords, setCoords] = useState<{ top?: number; bottom?: number; left: number } | null>(null);
  useEffect(() => {
    const compute = () => {
      if (!anchor) return;
      const r = anchor.getBoundingClientRect();
      const POP_HEIGHT_ESTIMATE = 380;
      const spaceBelow = window.innerHeight - r.bottom;
      const spaceAbove = r.top;
      const flipUp = spaceBelow < POP_HEIGHT_ESTIMATE && spaceAbove > spaceBelow;
      const POP_WIDTH = 340;
      const left = Math.max(8, Math.min(r.left, window.innerWidth - POP_WIDTH - 8));
      if (flipUp) {
        setCoords({ bottom: window.innerHeight - r.top + 6, left });
      } else {
        setCoords({ top: r.bottom + 6, left });
      }
    };
    compute();
    window.addEventListener("scroll", compute, true);
    window.addEventListener("resize", compute);
    return () => {
      window.removeEventListener("scroll", compute, true);
      window.removeEventListener("resize", compute);
    };
  }, [anchor]);

  // Close on click outside
  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (popRef.current?.contains(t)) return;
      if (anchor?.contains(t)) return;
      onClose();
    };
    const timer = setTimeout(() => document.addEventListener("mousedown", onDoc), 0);
    return () => { clearTimeout(timer); document.removeEventListener("mousedown", onDoc); };
  }, [onClose, anchor]);

  // Approval-note draft state. The textarea only renders when approval has
  // a real value (anything but "unset") — admins use this to paste in the
  // email thread or describe how approval was obtained. Save button appears
  // only when the draft differs from the persisted value.
  const [noteDraft, setNoteDraft] = useState(asset.approvalNote || "");
  // Reset draft when the asset's saved note changes (multi-asset selection
  // can swap the popover target out from under us).
  useEffect(() => {
    setNoteDraft(asset.approvalNote || "");
  }, [asset.approvalNote]);
  const showApprovalNote = !!asset.approvalStatus && asset.approvalStatus !== "unset";
  const noteDirty = noteDraft !== (asset.approvalNote || "");

  // Freshness popover state — three modes mirror the bulk modal: leave
  // (no change), never (sentinel far-future), or set (custom date).
  const NEVER_THRESHOLD_YEARS = 50;
  const isNeverExpiry = (iso: string | null | undefined): boolean => {
    if (!iso) return false;
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return false;
    return d.getTime() > Date.now() + NEVER_THRESHOLD_YEARS * 365 * 24 * 60 * 60 * 1000;
  };
  const buildNeverIso = (): string => {
    const d = new Date();
    d.setFullYear(d.getFullYear() + 100);
    return d.toISOString();
  };
  const savedIsNever = isNeverExpiry(asset.freshnessExceptionUntil);
  const savedHasDate = !!asset.freshnessExceptionUntil && !savedIsNever;
  const initialFreshMode: "leave" | "never" | "set" = savedIsNever ? "never" : savedHasDate ? "set" : "leave";
  const [freshMode, setFreshMode] = useState<"leave" | "never" | "set">(initialFreshMode);
  const [freshDate, setFreshDate] = useState<string>(() => {
    if (savedHasDate) return new Date(asset.freshnessExceptionUntil!).toISOString().split("T")[0];
    const d = new Date();
    d.setFullYear(d.getFullYear() + 1);
    return d.toISOString().split("T")[0];
  });
  const handleFreshChange = (next: "leave" | "never" | "set") => {
    setFreshMode(next);
    if (next === "never") onSetFreshnessException(asset, buildNeverIso());
    else if (next === "leave") onSetFreshnessException(asset, null);
    // For "set", wait for date input change before writing.
  };
  const handleFreshDateChange = (iso: string) => {
    setFreshDate(iso);
    if (iso) onSetFreshnessException(asset, new Date(iso).toISOString());
  };

  // Custom flag toggle — same UX as the bulk modal: checkbox to expand a
  // small form, then add. Existing flags render as compact chips above so
  // admins can see and remove them.
  const [addFlagOpen, setAddFlagOpen] = useState(false);
  const [flagColor, setFlagColor] = useState<string>("yellow");
  const [flagLabel, setFlagLabel] = useState("");
  const flags: CustomFlag[] = Array.isArray(asset.customFlags) ? asset.customFlags as CustomFlag[] : [];
  const handleAddFlag = () => {
    const newFlag: CustomFlag = {
      id: (typeof crypto !== "undefined" && "randomUUID" in crypto)
        ? crypto.randomUUID()
        : `f-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      label: flagLabel.trim(),
      color: flagColor,
      note: "",
      setByEmail: "",
      setAt: new Date().toISOString(),
    };
    onSetCustomFlags(asset, [...flags, newFlag]);
    setAddFlagOpen(false);
    setFlagLabel("");
  };
  const handleRemoveFlag = (id: string) => {
    onSetCustomFlags(asset, flags.filter(f => f.id !== id));
  };

  if (!coords || typeof document === "undefined") return null;
  return createPortal(
    <div
      className="cl-pop cl-pop-portal"
      ref={popRef}
      style={{
        position: "fixed",
        left: coords.left,
        top: coords.top !== undefined ? coords.top : "auto",
        bottom: coords.bottom !== undefined ? coords.bottom : "auto",
      }}
      onClick={(e) => e.stopPropagation()}
    >
      {/* Flat stack matching the BulkStatusModal — no section heads, no
          labels above each select. Placeholder option text doubles as the
          field name. The popover writes per-asset, so changes apply immediately
          (no Apply button needed). */}
      <div className="cl-pop-body">
        <select
          ref={approvalSelectRef}
          className={`cl-select${(asset.approvalStatus || "unset") === "unset" ? " placeholder" : ""}`}
          value={asset.approvalStatus || "unset"}
          {...approvalSelectHandlers}
        >
          <option value="unset">Approval — blank</option>
          <option value="approved">Approved</option>
          <option value="pending">Pending</option>
          <option value="denied">Denied</option>
          <option value="needs_edits">Needs edits</option>
        </select>

        {/* Approval notes — appears only once an approval status is picked.
            Lets admin document how approval was obtained (paste an email
            thread, etc.). Save button only appears when there are unsaved
            edits. */}
        {showApprovalNote && (
          <>
            <textarea
              className="cl-textarea cl-approval-note"
              placeholder="Notes about this approval — paste the email thread, describe how it was obtained, etc."
              value={noteDraft}
              onChange={(e) => setNoteDraft(e.target.value)}
            />
            {noteDirty && (
              <div className="cl-row-actions">
                <button
                  className="cl-mini-btn primary"
                  onClick={() => onSetApproval(asset, { note: noteDraft })}
                >Save note</button>
                <button
                  className="cl-mini-btn"
                  onClick={() => setNoteDraft(asset.approvalNote || "")}
                >Cancel</button>
              </div>
            )}
          </>
        )}

        {(() => {
          const manuallySet = asset.clientStatusSource === "manual" || asset.clientStatusSource === "crm";
          const value = manuallySet ? (asset.clientStatus || "unknown") : "unknown";
          return (
            <select
              className={`cl-select${value === "unknown" ? " placeholder" : ""}`}
              value={value as string}
              {...clientSelectHandlers}
            >
              <option value="unknown">Client — blank</option>
              <option value="current">Active client</option>
              <option value="former">Former client</option>
            </select>
          );
        })()}

        <select
          className={`cl-select${freshMode === "leave" ? " placeholder" : ""}`}
          value={freshMode}
          onChange={(e) => handleFreshChange(e.target.value as "leave" | "never" | "set")}
        >
          <option value="leave">Expiration — default</option>
          <option value="never">Never expire</option>
          <option value="set">Expire on…</option>
        </select>
        {freshMode === "set" && (
          <input
            className="cl-exception-date"
            type="date"
            value={freshDate}
            onChange={(e) => handleFreshDateChange(e.target.value)}
          />
        )}

        {/* Existing custom flags — chips with remove. Handles hex colors
            with inline styles so any custom color the admin picked
            renders correctly. Blank labels render with no text — only
            the dot — so admins can use a flag purely as a color tag. */}
        {flags.length > 0 && (
          <div className="cl-flag-chips">
            {flags.map(f => {
              const isHex = isHexColor(f.color);
              const presetClass = !isHex ? f.color : "custom";
              const chipStyle: React.CSSProperties = isHex
                ? { background: `${f.color}1a`, borderColor: `${f.color}66`, color: "#1f2937" }
                : {};
              const dotStyle: React.CSSProperties | undefined = isHex
                ? { background: f.color, borderColor: f.color }
                : undefined;
              return (
                <span key={f.id} className={`cl-flag-chip ${presetClass}`} style={chipStyle}>
                  <span className={`cl-circle ${presetClass}`} style={dotStyle}/>
                  {f.label && <span className="cl-flag-chip-label">{f.label}</span>}
                  <button
                    type="button"
                    className="cl-flag-chip-x"
                    onClick={() => handleRemoveFlag(f.id)}
                    title="Remove flag"
                  >×</button>
                </span>
              );
            })}
          </div>
        )}

        <label className="bsm-flag-toggle">
          <input
            type="checkbox"
            checked={addFlagOpen}
            onChange={(e) => setAddFlagOpen(e.target.checked)}
          />
          Add custom status
        </label>
        {addFlagOpen && (
          <div className="bsm-flag-form">
            <FlagColorPicker name="cl-pop-color" value={flagColor} onChange={setFlagColor}/>
            <input
              className="cl-input"
              placeholder="Optional label"
              value={flagLabel}
              onChange={(e) => setFlagLabel(e.target.value)}
            />
            <KnownTagsRow
              tags={knownCustomTags || []}
              excludeKeys={new Set(flags.map(f => `${f.color}|${(f.label || "").trim()}`))}
              onPick={(t) => { setFlagColor(t.color); setFlagLabel(t.label); }}
            />
            <div className="cl-row-actions">
              <button className="cl-mini-btn primary" onClick={handleAddFlag}>Add</button>
              <button className="cl-mini-btn" onClick={() => { setAddFlagOpen(false); setFlagLabel(""); }}>Cancel</button>
            </div>
          </div>
        )}
      </div>

      <button
        className="cl-clear-all"
        onClick={() => onResetStatusIndicators(asset)}
      >Reset</button>
    </div>,
    document.body
  );
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

interface FreshnessSectionProps {
  asset: Asset;
  freshnessReason: ClearedReason;
  // When true, library-wide freshness rule is set — UX shifts to a
  // "Make exception" pattern (button on warning, link otherwise). When
  // false, the per-asset feature stands alone with a dropdown.
  libraryRuleActive: boolean;
  onSetFreshnessException: (a: Asset, untilIso: string | null) => void;
  onClose: () => void;
}
function FreshnessSection({ asset, freshnessReason, libraryRuleActive, onSetFreshnessException, onClose }: FreshnessSectionProps) {
  // Sentinel for "never flag this asset" — stored as a far-future date so
  // the schema stays simple. Detected on read and displayed as "Never expires."
  const NEVER_EXPIRY_THRESHOLD_YEARS = 50;
  const isNeverExpiry = (iso: string | null | undefined): boolean => {
    if (!iso) return false;
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return false;
    return d.getTime() > Date.now() + NEVER_EXPIRY_THRESHOLD_YEARS * 365 * 24 * 60 * 60 * 1000;
  };
  const buildNeverExpiryIso = (): string => {
    const d = new Date();
    d.setFullYear(d.getFullYear() + 100);
    return d.toISOString();
  };

  // Per-asset rule data
  const exceptionUntilDate = asset.freshnessExceptionUntil ? new Date(asset.freshnessExceptionUntil) : null;
  const hasValidUntil = exceptionUntilDate !== null && !Number.isNaN(exceptionUntilDate.getTime());
  const exceptionActive = hasValidUntil && exceptionUntilDate.getTime() > Date.now();
  const exceptionExpired = hasValidUntil && exceptionUntilDate.getTime() <= Date.now();
  const savedIsNever = isNeverExpiry(asset.freshnessExceptionUntil);

  // Editing flag — tracks whether the form is open. In no-library-rule mode
  // the trigger pill toggles this. In library-rule mode the "Make exception"
  // button toggles this. Default: open if there's a saved exception (so the
  // user sees current values), closed otherwise.
  const [editing, setEditing] = useState(hasValidUntil);
  // Within the form, "Never flag" vs "Set custom expiration"
  const [formMode, setFormMode] = useState<"never" | "custom">(savedIsNever ? "never" : "custom");

  const defaultDate = (() => {
    if (hasValidUntil && !savedIsNever) return exceptionUntilDate.toISOString().split("T")[0];
    const d = new Date();
    d.setFullYear(d.getFullYear() + 1);
    return d.toISOString().split("T")[0];
  })();
  const [untilDate, setUntilDate] = useState<string>(defaultDate);

  // Re-sync state when asset's saved value changes (e.g. after save lands).
  // Two distinct branches:
  //   • hasValidUntil → there's still a saved value, sync local state to it
  //     and KEEP the form open so the user sees current values + Clear.
  //   • !hasValidUntil → the exception was cleared. Reset the picker to a
  //     fresh default and CLOSE the form. Without this the date in the picker
  //     stays at its previous value, dirty fires, Save/Cancel buttons appear,
  //     and clicking Save would silently re-create the exception.
  useEffect(() => {
    setFormMode(savedIsNever ? "never" : "custom");
    if (hasValidUntil) {
      if (!savedIsNever) setUntilDate(exceptionUntilDate.toISOString().split("T")[0]);
    } else {
      const d = new Date();
      d.setFullYear(d.getFullYear() + 1);
      setUntilDate(d.toISOString().split("T")[0]);
      setEditing(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asset.freshnessExceptionUntil]);

  const dotLevel = freshnessReason.level;
  const hideDot = !!freshnessReason.hideDot;

  const setQuickPreset = (months: number) => {
    const d = new Date();
    d.setMonth(d.getMonth() + months);
    setUntilDate(d.toISOString().split("T")[0]);
  };

  const savedDateStr = hasValidUntil && !savedIsNever ? exceptionUntilDate.toISOString().split("T")[0] : null;
  // Dirty: form mode or date differs from saved state
  const dirty = (formMode === "never") !== savedIsNever || (formMode === "custom" && untilDate !== savedDateStr);

  const save = () => {
    if (formMode === "never") {
      onSetFreshnessException(asset, buildNeverExpiryIso());
    } else {
      onSetFreshnessException(asset, new Date(untilDate).toISOString());
    }
    setEditing(false);
  };

  // Shared form — used in both library-on (with radios) and library-off
  // (without radios, just the date picker). showRadios=true exposes the
  // "Never flag" option as a checkbox alongside "Set custom expiration."
  const renderForm = (showRadios: boolean) => (
    <div className="cl-exception-form">
      {showRadios && (
        <>
          <label className="cl-radio">
            <input type="radio" name={`fresh-${asset.id}`} checked={formMode === "never"} onChange={() => setFormMode("never")}/>
            Never flag this asset
          </label>
          <label className="cl-radio">
            <input type="radio" name={`fresh-${asset.id}`} checked={formMode === "custom"} onChange={() => setFormMode("custom")}/>
            Set custom expiration
          </label>
        </>
      )}
      {(!showRadios || formMode === "custom") && (
        <div className="cl-exception-until-row">
          <input
            className="cl-exception-date"
            type="date"
            value={untilDate}
            onChange={(e) => setUntilDate(e.target.value)}
          />
          <div className="cl-exception-quick">
            <button className="cl-quick-btn" onClick={() => setQuickPreset(12)}>+1y</button>
            <button className="cl-quick-btn" onClick={() => setQuickPreset(24)}>+2y</button>
            <button className="cl-quick-btn" onClick={() => setQuickPreset(36)}>+3y</button>
            <button className="cl-quick-btn" onClick={() => setQuickPreset(60)}>+5y</button>
          </div>
        </div>
      )}
      {dirty && (
        <div className="cl-exception-actions">
          <button className="cl-mini-btn primary" onClick={save}>Save</button>
          <button className="cl-mini-btn" onClick={() => {
            setUntilDate(savedDateStr || defaultDate);
            setFormMode(savedIsNever ? "never" : "custom");
            if (libraryRuleActive && !hasValidUntil) setEditing(false);
          }}>Cancel</button>
        </div>
      )}
      {/* Clear button — show whenever there's a saved value and the form isn't
          dirty. Available in both modes (library rule on/off). Label tracks
          the surrounding terminology: "Clear exception" when there's an org
          rule being deviated from, "Clear expiration" when the per-asset rule
          stands alone. */}
      {!dirty && hasValidUntil && (
        <div className="cl-exception-actions">
          <button className="cl-mini-btn" onClick={() => onSetFreshnessException(asset, null)}>
            {libraryRuleActive ? "Clear exception" : "Clear expiration"}
          </button>
        </div>
      )}
      {/* The "Set to expire on [date]" footer was here — removed per Logan:
          users can see the date in the picker itself, so it was redundant.
          The audit line ("[email] made an exception on [date]") still shows
          above the form via the popover's freshness-note section. */}
      {!dirty && exceptionExpired && (
        <div className="cl-exception-expired">
          ⌛ Expired on {fmtDate(asset.freshnessExceptionUntil)}
        </div>
      )}
    </div>
  );

  return (
    <div className="cl-section cl-section-secondary">
      <div className="cl-section-head">
        {!hideDot && <span className={`cl-circle ${dotLevel}`}/>}
        <span className="cl-section-title">Freshness</span>
        {asset.freshnessExceptionSetAt && (
          <span className="cl-section-meta">recorded {timeAgoShort(asset.freshnessExceptionSetAt)}</span>
        )}
      </div>

      {/* Publish date sits at the top */}
      <div className="cl-freshness-line">
        {asset.publishedAt
          ? <>Published <strong>{fmtDate(asset.publishedAt)}</strong> <span className="cl-freshness-rel">({timeAgoShort(asset.publishedAt)})</span></>
          : <span style={{ color: "var(--t4)" }}>Publish date not recorded yet — sync the source to populate.</span>}
      </div>

      {!libraryRuleActive ? (
        // ─── Mode A/B: No library rule — single trigger that toggles a form.
        // Trigger label reflects current state: "Set expiration" when none is
        // set, "Set to expire on: [date]" when one is. Trigger and form share
        // a unified bordered box so they read as one connected control. ───
        <div className={`cl-fresh-pill${editing ? " open" : ""}`}>
          <button
            type="button"
            className="cl-fresh-trigger"
            onClick={() => setEditing(o => !o)}
            aria-expanded={editing}
          >
            <span>
              {hasValidUntil
                ? <>Set to expire on: <strong>{fmtDate(asset.freshnessExceptionUntil)}</strong></>
                : "Set expiration"}
            </span>
            <span className="cl-fresh-chevron">{editing ? "▴" : "▾"}</span>
          </button>
          {editing && renderForm(false)}
        </div>
      ) : (
        // ─── Mode C/D/E: Library rule active — exception button pattern ───
        <>
          {/* Yellow warning when asset is over the org threshold and no
              active exception is suppressing it. */}
          {dotLevel === "yellow" && freshnessReason.flagDetail && !editing && !exceptionActive && (
            <div className="cl-freshness-warn cl-freshness-warn-row">
              <span>{freshnessReason.flagDetail}</span>
              <button className="cl-mini-btn" onClick={() => setEditing(true)}>Make exception</button>
            </div>
          )}

          {/* Org-rule note (italic) — only shows when the rule would
              otherwise fire on this asset. Keeps the threshold message
              visible alongside the exception so admins see both. */}
          {dotLevel === "green" && freshnessReason.flagDetail && (
            <div className="cl-freshness-note">{freshnessReason.flagDetail}</div>
          )}
          {/* Per-exception audit (italic) — always renders when an active
              exception exists, regardless of whether the org rule would
              fire. Captures Logan's "[admin email] made an exception" framing. */}
          {exceptionActive && asset.freshnessExceptionSetByEmail && (
            <div className="cl-freshness-note">
              <strong>{asset.freshnessExceptionSetByEmail}</strong> made an exception
              {asset.freshnessExceptionSetAt && <> on {fmtDate(asset.freshnessExceptionSetAt)}</>}
            </div>
          )}

          {/* Grey "set to expire on" box — when library rule is on, asset is
              within window (not flagged), AND we have a computable effective
              expiration. Lets admin pre-emptively set an exception if they
              know the asset will outlast the rule. */}
          {!editing && !exceptionActive && dotLevel !== "yellow" && freshnessReason.effectiveExpiration && (
            <div className="cl-freshness-info-row">
              <span>Set to expire on <strong>{fmtDate(freshnessReason.effectiveExpiration)}</strong></span>
              <button className="cl-mini-btn" onClick={() => setEditing(true)}>Make exception</button>
            </div>
          )}

          {/* Active exception form box — shows current values + Clear/Change */}
          {exceptionActive && !editing && renderForm(true)}

          {/* Editing form (admin clicked Make exception) */}
          {editing && renderForm(true)}

          {/* Expired exception — show a brief note */}
          {exceptionExpired && !editing && !exceptionActive && (
            <div className="cl-exception-expired">
              ⌛ Previous exception expired {fmtDate(asset.freshnessExceptionUntil)}
            </div>
          )}

          {/* Fallback link for proactive use when there's no effective
              expiration (e.g. absolute-date rule, or the asset's published_at
              is missing). Rare path; keep it as a small link. */}
          {!editing && !exceptionActive && dotLevel !== "yellow" && !freshnessReason.effectiveExpiration && (
            <button className="cl-make-exception-link" onClick={() => setEditing(true)}>
              {exceptionExpired ? "Re-apply exception" : "Make exception"} →
            </button>
          )}
        </>
      )}

      <a
        href="#/rules"
        onClick={(e) => { e.preventDefault(); onClose(); window.location.hash = "/rules"; }}
        className="cl-rules-link"
      >Configure org-wide expiration rules →</a>
    </div>
  );
}

// ─── CUSTOM FLAGS SECTION ──────────────────────────────────────────────
// Free-form admin flags for things that don't fit approval/client/freshness
// (e.g. "comments must be disabled," "logo update pending"). Each flag has
// a label, severity (yellow/red), free-form note, and audit fields.
interface CustomFlagsSectionProps {
  asset: Asset;
  onSetCustomFlags: (a: Asset, flags: CustomFlag[]) => void;
}
function CustomFlagsSection({ asset, onSetCustomFlags }: CustomFlagsSectionProps) {
  const flags = Array.isArray(asset.customFlags) ? asset.customFlags : [];
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftLabel, setDraftLabel] = useState("");
  const [draftColor, setDraftColor] = useState<string>("yellow");
  // Note field removed per Logan's spec — label replaces it. We keep the
  // `note` column in the data shape for backward compat with any flags
  // already saved with notes, but new flags always set note to "".

  const startAdd = () => {
    setDraftLabel("");
    setDraftColor("yellow");
    setEditingId(null);
    setAdding(true);
  };
  const startEdit = (f: CustomFlag) => {
    setDraftLabel(f.label);
    setDraftColor(f.color);
    setEditingId(f.id);
    setAdding(false);
  };
  const cancel = () => {
    setAdding(false);
    setEditingId(null);
  };
  const save = () => {
    // Label is now optional — admins can flag with just severity + note,
    // or even just severity. Severity is the only required input.
    const label = draftLabel.trim();
    const next: CustomFlag[] = [...flags];
    if (editingId) {
      const i = next.findIndex(f => f.id === editingId);
      if (i >= 0) {
        // Edit preserves any pre-existing note (backward compat for flags
        // created before the note field was removed).
        next[i] = { ...next[i], label, color: draftColor };
      }
    } else {
      next.push({
        id: `cf-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        label,
        color: draftColor,
        note: "",
        setByEmail: "",
        setAt: new Date().toISOString(),
      });
    }
    onSetCustomFlags(asset, next);
    cancel();
  };
  const remove = (id: string) => {
    onSetCustomFlags(asset, flags.filter(f => f.id !== id));
  };

  const showForm = adding || editingId !== null;

  return (
    <div className="cl-section cl-section-secondary">
      <div className="cl-section-head">
        <span className="cl-section-title">Custom flags</span>
      </div>

      {flags.length === 0 && !showForm && (
        <div className="cf-empty">No custom flags on this asset.</div>
      )}

      {flags.map(f => (
        <div key={f.id} className="cf-row">
          <span className={`cl-circle ${f.color}`}/>
          <div className="cf-row-body">
            {f.label && <div className="cf-row-label">{f.label}</div>}
            {f.note && <div className="cf-row-note">{f.note}</div>}
            {f.setAt && (
              <div className="cf-row-meta">
                recorded {f.setByEmail ? <>by <strong>{f.setByEmail}</strong> </> : ""}
                {timeAgoShort(f.setAt)}
              </div>
            )}
          </div>
          <div className="cf-row-actions">
            <button className="cl-mini-btn" onClick={() => startEdit(f)}>Edit</button>
            <button className="cl-mini-btn" onClick={() => remove(f.id)}>Remove</button>
          </div>
        </div>
      ))}

      {showForm && (
        <div className="cf-form">
          {/* Severity first — required input. Label below is optional and
              replaces the old note field; one text box, not two. */}
          <FlagColorPicker name={`cf-${asset.id}`} value={draftColor} onChange={setDraftColor}/>
          <input
            className="cl-input"
            placeholder="Optional label"
            value={draftLabel}
            onChange={e => setDraftLabel(e.target.value)}
            autoFocus
          />
          <div className="cf-form-actions">
            <button
              className="cl-mini-btn primary"
              onClick={save}
            >{editingId ? "Save" : "Add flag"}</button>
            <button className="cl-mini-btn" onClick={cancel}>Cancel</button>
          </div>
        </div>
      )}

      {!showForm && (
        <button className="cl-mini-btn cl-cf-add" onClick={startAdd}>+ Add custom status</button>
      )}
    </div>
  );
}

// Wrapper around the publication dropdown that uses the same-value-aware
// hook. Extracted into its own component because hooks can't be called
// inside a map() body in ListView.
function PublicationSelectCell({
  asset,
  pubStatus,
  onSetPublicationStatus,
  isInMultiSelection,
}: {
  asset: Asset;
  pubStatus: "published" | "draft" | "archived";
  onSetPublicationStatus: (a: Asset, next: "published" | "draft" | "archived") => void;
  isInMultiSelection: boolean;
}) {
  const handlers = useSameValueAwareSelect(
    isInMultiSelection,
    (v) => onSetPublicationStatus(asset, v as "published" | "draft" | "archived"),
  );
  return (
    <div onClick={(e) => e.stopPropagation()}>
      <select
        className="lv-pub-select"
        value={pubStatus}
        {...handlers}
      >
        <option value="published">Public</option>
        <option value="draft">Private</option>
        <option value="archived">Archive</option>
      </select>
    </div>
  );
}

function ListView({ assets, selectedIds, onToggleSelect, onClick, onEdit, onSetPublicationStatus, onSetClientStatus, onSetApproval, onMarkVerified, onSetFreshnessException, onSetCustomFlags, onResetStatusIndicators, onDelete, onCopyShareLink, orgSettings, knownCustomTags }: ListViewProps) {
  const [openClearedFor, setOpenClearedFor] = useState<string | null>(null);

  if (assets.length === 0) {
    return <div className="lv"><div className="lv-empty">No assets to show.</div></div>;
  }
  return (
    <div className="lv">
      <div className="lv-head">
        {/* Master checkbox lives in the library control bar above; this column
            is intentionally empty here so it aligns with the per-row checkbox. */}
        <div></div>
        <div>Title</div>
        <div>Vertical</div>
        {/* Visibility = the publication dropdown column (Public / Private / Archive). */}
        <div>Visibility</div>
        {/* Status = the cleared indicators column (approval + flags + freshness). */}
        <div>Status</div>
        <div style={{ textAlign: "right" }}>Actions</div>
      </div>
      {assets.map((a) => {
        const isArchived = a.status === "archived";
        const isDraft = a.status === "draft";
        const statusCls = isArchived ? " archived" : isDraft ? " draft" : "";
        const isSelected = selectedIds.has(a.id);
        const cleared = computeCleared(a, orgSettings);
        const open = openClearedFor === a.id;
        const vid = extractVid(a.videoUrl);
        let thumb = a.thumbnail;
        if (!thumb && vid?.p === "yt") thumb = ytThumb(vid.id);
        if (!thumb) thumb = "https://images.unsplash.com/photo-1557804506-669a67965ba0?w=160&h=90&fit=crop";
        const pubStatus = (a.status || "published") as "published" | "draft" | "archived";
        return (
          <div
            key={a.id}
            className={`lv-row${statusCls}${isSelected ? " selected" : ""}`}
            onClick={() => onClick(a)}
          >
            <input
              type="checkbox"
              className="lv-check"
              checked={isSelected}
              onChange={() => { /* handled by onClick to capture shift key */ }}
              onClick={(e) => { e.stopPropagation(); onToggleSelect(a.id, e.shiftKey); }}
              title="Shift-click to select a range"
            />
            <div className="lv-thumb">
              <img src={thumb} alt={a.company} loading="lazy" />
            </div>
            <div className="lv-title">
              <div className="lv-title-h">{a.headline || "Untitled"}</div>
              <div className="lv-title-c">{a.company || a.clientName || "—"}</div>
            </div>
            <div className="lv-vert">{a.vertical || "—"}</div>
            {/* Visibility column — publication dropdown (Public/Private/Archive). */}
            <div className="lv-visibility">
              <PublicationSelectCell
                asset={a}
                pubStatus={pubStatus}
                onSetPublicationStatus={onSetPublicationStatus}
                isInMultiSelection={selectedIds.size > 1 && selectedIds.has(a.id)}
              />
            </div>
            {/* Status column — cleared indicators (approval + flags + freshness),
                followed by any custom-status chips for at-a-glance scanning. */}
            <div className="lv-statuscell">
              <ClearedCell
                asset={a}
                cleared={cleared}
                open={open}
                onToggle={() => setOpenClearedFor(open ? null : a.id)}
                onClose={() => setOpenClearedFor(null)}
                libraryFreshnessRuleActive={!!(orgSettings.freshnessWarnAfterMonths || orgSettings.freshnessWarnBeforeDate)}
                isInMultiSelection={selectedIds.size > 1 && selectedIds.has(a.id)}
                onSetFreshnessException={onSetFreshnessException}
                onSetCustomFlags={onSetCustomFlags}
                onResetStatusIndicators={onResetStatusIndicators}
                onSetClientStatus={onSetClientStatus}
                onSetApproval={onSetApproval}
                onMarkVerified={onMarkVerified}
                knownCustomTags={knownCustomTags}
              />
              <FlagChips
                flags={(a.customFlags as CustomFlag[]) || []}
                dense
                onClick={(e) => {
                  e.stopPropagation();
                  setOpenClearedFor(open ? null : a.id);
                }}
              />
            </div>
            <div className="lv-actions">
              <DotsMenu items={[
                { label: "Open", onClick: () => onClick(a) },
                { label: "Edit details", onClick: () => onEdit(a) },
                { label: "Copy share link", onClick: () => onCopyShareLink(a) },
                { divider: true },
                isArchived
                  ? { label: "Restore", onClick: () => onSetPublicationStatus(a, "published") }
                  : { label: "Archive", onClick: () => onSetPublicationStatus(a, "archived") },
                { divider: true },
                { label: "Delete", onClick: () => { if (confirm(`Delete "${a.headline || "this asset"}"? This can't be undone.`)) onDelete(a.id); }, danger: true },
              ]}/>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function timeAgoShort(iso: string | null | undefined): string {
  if (!iso) return "never";
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

// DetailPage was extracted to ./components/AssetDetail so the public share
// page (/s/[id]) renders the exact same view as the internal library.

// ─── ADMIN: IMPORT PANEL ─────────────────────────────────────────────────────

// Detect the kind of URL pasted
function detectUrlType(url: string): UrlInfo | null {
  const u=url.trim();
  if(!u)return null;
  // YouTube playlist
  if(u.match(/youtube\.com\/playlist\?list=/)||u.match(/youtube\.com\/watch.*[?&]list=/))return{kind:"yt-playlist",url:u};
  // YouTube video
  if(u.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)/)){
    const m=u.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([^&?#]+)/);
    return{kind:"yt-video",url:u,id:m?m[1]:null};
  }
  // Vimeo showcase
  if(u.match(/vimeo\.com\/showcase\/\d+/))return{kind:"vm-showcase",url:u};
  // Vimeo album (legacy)
  if(u.match(/vimeo\.com\/album\/\d+/))return{kind:"vm-showcase",url:u};
  // Vimeo video
  if(u.match(/vimeo\.com\/(?:video\/)?\d+/)){
    const m=u.match(/vimeo\.com\/(?:video\/)?(\d+)/);
    return{kind:"vm-video",url:u,id:m?m[1]:null};
  }
  return{kind:"unknown",url:u};
}

// Parse pasted text into URLs
function parseUrls(text: string): UrlInfo[] {
  return text
    .split(/[\s,]+/)
    .map(s=>s.trim())
    .filter(s=>s.startsWith("http"))
    .map(detectUrlType)
    .filter((x): x is UrlInfo => x !== null);
}

// Fetch oEmbed metadata — returns {data, error}
async function fetchOEmbed(urlInfo: UrlInfo): Promise<OEmbedResult> {
  try{
    let endpoint: string;
    if(urlInfo.kind.startsWith("yt"))endpoint=`https://www.youtube.com/oembed?url=${encodeURIComponent(urlInfo.url)}&format=json`;
    else if(urlInfo.kind.startsWith("vm"))endpoint=`https://vimeo.com/api/oembed.json?url=${encodeURIComponent(urlInfo.url)}`;
    else return{data:null,error:"Unsupported URL"};
    const r=await fetch(endpoint);
    if(!r.ok)return{data:null,error:`${r.status} ${r.statusText}`};
    const data=await r.json() as OEmbedData;
    return{data,error:null};
  }catch(e){
    const err=e as Error;
    return{data:null,error:err.message||"Network error"};
  }
}

// Ask Claude to infer business metadata from video title/description
async function enrichWithClaude(oembed: OEmbedData | null, urlInfo: UrlInfo): Promise<Enrichment> {
  const title=oembed?.title||"";
  const desc=oembed?.description||"";
  const author=oembed?.author_name||"";
  const prompt=`You're helping a sales team catalog a customer testimonial video. Based on this video's metadata, make your best guess for each field. Be concise. If unknown, leave field empty.

Title: ${title}
Author/Uploader: ${author}
Description: ${desc.substring(0,500)}

Return ONLY valid JSON (no markdown fences):
{
  "company": "the client company name the testimonial is about",
  "clientName": "the person giving the testimonial, or '—'",
  "vertical": "one of: Logistics, Healthcare, Manufacturing, Financial Services, Retail, Education, Real Estate, Technology",
  "challenge": "short business problem (3-6 words)",
  "outcome": "measurable result if mentioned, else ''",
  "headline": "a compelling 5-10 word headline summarizing the story",
  "pullQuote": "a quotable takeaway sentence"
}`;
  try{
    const r=await fetch("https://api.anthropic.com/v1/messages",{
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({model:"claude-sonnet-4-20250514",max_tokens:500,messages:[{role:"user",content:prompt}]})
    });
    const d=await r.json();
    const txt=(d.content||[]).filter((c:{type:string})=>c.type==="text").map((c:{text:string})=>c.text).join("");
    const jm=txt.match(/\{[\s\S]*\}/);
    if(jm)return JSON.parse(jm[0]) as Enrichment;
  }catch{}
  return{};
}


// Extract videos from a showcase URL using our authenticated Vimeo API
interface ExtractedVideo {
  url: string;
  title?: string;
  description?: string;
  thumbnail?: string;
  durationSec?: number;
  transcript?: string;
  // ISO timestamp from Vimeo's `created_time` — needed so the freshness
  // signal works correctly on first import. Without it the asset gets a
  // null published_at and shows "Publish date not recorded yet" until the
  // admin manually re-syncs (which is what was happening before this fix).
  createdAt?: string;
}

async function extractShowcaseVideos(sourceUrl: string): Promise<ExtractedVideo[]> {
  try{
    const headers=await authHeaders();
    // Only call the real Vimeo API for Vimeo URLs. (YouTube would use a separate route.)
    if(sourceUrl.includes("vimeo.com")){
      const r=await fetch(`/api/vimeo/showcase?url=${encodeURIComponent(sourceUrl)}`,{headers});
      if(!r.ok){
        const body=await r.json().catch(()=>({error:`HTTP ${r.status}`}));
        console.error("Vimeo showcase fetch failed:",body);
        return[];
      }
      const data=await r.json() as {videos:{url:string;title:string;description?:string;thumbnail?:string;durationSec?:number;uploader?:string;transcript?:string;createdAt?:string}[]};
      return(data.videos||[]).map(v=>({
        url:v.url,
        title:v.title,
        description:v.description,
        thumbnail:v.thumbnail,
        durationSec:v.durationSec,
        transcript:v.transcript,
        createdAt:v.createdAt,
      }));
    }
    // Fallback: non-Vimeo URLs get nothing for now
    console.warn("Non-Vimeo source URL; skipping:",sourceUrl);
    return[];
  }catch(e){console.error("extractShowcaseVideos failed",e);return[];}
}

// Import a single video URL into an asset (oEmbed + Claude enrichment)
async function importSingleVideo(urlInfo: UrlInfo, sourceId: string | null): Promise<Asset> {
  const {data:oe}=await fetchOEmbed(urlInfo);
  let enriched: Enrichment = {};
  let meta: OEmbedData | null = oe;
  if(oe){
    enriched=await enrichWithClaude(oe,urlInfo);
  } else {
    meta={
      title:"Video (details pending)",
      description:"",
      thumbnail_url:urlInfo.kind==="yt-video"&&urlInfo.id?ytThumb(urlInfo.id):"",
      author_name:""
    };
  }
  const title=meta?.title||"Imported video";
  const desc=meta?.description||"";
  const thumb=meta?.thumbnail_url||(urlInfo.kind==="yt-video"&&urlInfo.id?ytThumb(urlInfo.id):"");
  return{
    id:`imp-${Date.now()}-${Math.random().toString(36).slice(2,7)}`,
    sourceId:sourceId||null,
    clientName:enriched?.clientName||meta?.author_name||"",
    company:enriched?.company||"",
    vertical:enriched?.vertical||"",
    geography:"",
    companySize:"",
    challenge:enriched?.challenge||"",
    outcome:enriched?.outcome||"",
    assetType:"Video Testimonial",
    videoUrl:urlInfo.url,
    status:"published",
    dateCreated:new Date().toISOString().split("T")[0],
    // Vimeo's video title is the source of truth — never let the LLM-generated
    // headline win over it. Headlines are user-editable in the Edit panel.
    headline:title,
    pullQuote:enriched?.pullQuote||"",
    // transcript stays empty unless real auto-captions come from Vimeo
    transcript:"",
    // description holds the human-written video description (more reliable than transcript for proper nouns)
    description:desc,
    thumbnail:thumb||"",
    // Snapshot for the auto-sync conflict-detection model — see source-sync.ts.
    lastSyncedTitle:title,
    lastSyncedDescription:desc,
    lastSyncedTranscript:"",
  };
}

// ─── ADMIN: SOURCES PANEL ────────────────────────────────────────────────────
interface SyncReport {
  syncedAt: string;
  videoCount: number;
  inSyncCount: number;
  // Each item carries detectedAt — when it first showed up in this report.
  // The UI shows it as "imported 2d ago", "drifted 4h ago" etc.
  imported: { assetId: string; headline: string; detectedAt: string }[];
  drifted: {
    assetId: string;
    headline: string;
    // Thumbnail is auto-applied (never user-editable in StoryMatch), so it's
    // not in this union — only fields that can have a true conflict.
    fields: ("title" | "description" | "transcript")[];
    storyMatch: { headline: string; description: string };
    vimeo: { title: string; description: string; thumbnail: string; transcript: string };
    detectedAt: string;
  }[];
  // Vimeo → StoryMatch changes that auto-applied silently because no local
  // edit existed. Informational only — already applied.
  autoApplied: {
    assetId: string;
    headline: string;
    fields: ("title" | "description" | "transcript" | "thumbnail")[];
    detectedAt: string;
  }[];
  archived: { assetId: string; headline: string; detectedAt: string }[];
  // Detected in Vimeo but admin previously soft-deleted in StoryMatch.
  // Surface so admin can choose to resync (un-delete) rather than silently
  // re-importing a video they deliberately removed.
  previouslyDeleted: {
    assetId: string;
    headline: string;
    videoUrl: string;
    vimeo: { title: string; description: string; thumbnail: string; transcript: string };
    detectedAt: string;
  }[];
}

interface SourcesPanelProps {
  sources: Source[];
  assets: Asset[];
  onAddSource: (s: Source) => Promise<void> | void;
  onRemoveSource: (id: string) => void;
  onAddAssets: (arr: Asset[]) => void;
  // Apply partial updates to existing assets (used for pull-from-Vimeo on drift,
  // restore-from-archive, resync-previously-deleted).
  onUpdateAssets: (updates: Array<Partial<Asset> & { id: string }>) => void;
  // Update a source row in place (optimistic local + persist to server).
  onUpdateSource: (updates: Partial<Source> & { id: string }) => void;
  // Re-pull sources + assets from server. Called after server-side sync to
  // pick up newly-imported assets and merged pending_sync_report.
  onRefresh: () => Promise<void>;
}

interface Progress {
  step: string;
  count: number;
  total: number | "?";
  done?: boolean;
  error?: boolean;
}

// ─── ADMIN: RULES PANEL ─────────────────────────────────────────────────────
// Two top-level sections:
//   • Defaults — one-time settings applied at import time (default approval,
//     and future entries like AI auto-infer toggle).
//   • Automations — trigger→action rule cards. Each reads as a sentence
//     ("When a story is older than 1 year, then archive it.") with an on/off
//     toggle in the header. Auto-revert to Public is always on; intentionally
//     no UI for it (it's the right default in every realistic case).
interface RulesPanelProps {
  settings: OrgSettings;
  onSave: (next: OrgSettings) => Promise<void> | void;
}

// Threshold preset values for the Expiration rule. Specific date is kept as
// an option but demoted to the bottom of the dropdown — uncommon escape hatch
// for orgs that need a hard cutoff instead of a rolling threshold.
const EXPIRATION_PRESETS: { value: string; months: number; label: string }[] = [
  { value: "6m", months: 6, label: "Older than 6 months" },
  { value: "1y", months: 12, label: "Older than 1 year" },
  { value: "2y", months: 24, label: "Older than 2 years" },
  { value: "3y", months: 36, label: "Older than 3 years" },
  { value: "5y", months: 60, label: "Older than 5 years" },
];

function RulesPanel({ settings, onSave }: RulesPanelProps) {
  // ── Expiration card state ─────────────────────────────────────────
  const expirationOn =
    settings.freshnessWarnAfterMonths !== null ||
    !!settings.freshnessWarnBeforeDate;

  const deriveExpValue = (): string => {
    if (settings.freshnessWarnBeforeDate) return "specific";
    if (settings.freshnessWarnAfterMonths !== null) {
      const preset = EXPIRATION_PRESETS.find(p => p.months === settings.freshnessWarnAfterMonths);
      return preset ? preset.value : "3y";
    }
    return "3y";
  };
  const [expValue, setExpValue] = useState<string>(deriveExpValue());
  const [specificDate, setSpecificDate] = useState<string>(settings.freshnessWarnBeforeDate || "");
  useEffect(() => {
    setExpValue(deriveExpValue());
    setSpecificDate(settings.freshnessWarnBeforeDate || "");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.freshnessWarnAfterMonths, settings.freshnessWarnBeforeDate]);

  // Action can be "draft" (Make private), "archive" (Archive), or "none"
  // (Nothing — flag-only mode). Flag-only keeps the threshold so the
  // freshness signal still flags the asset; it just skips auto-action.
  const expAction = (settings.publicationRules["expiration"]?.action ?? "archive") as "none" | "draft" | "archive";

  // Toggling the rule on/off flips multiple fields in one save: threshold
  // (months/date) AND the publication action. Off = no threshold + action
  // "none" (no flagging at all). On = default 3-year threshold + Archive.
  // Flag-only is a third state reachable via the action dropdown — keeps
  // the threshold but sets action to "none" so isExpired still returns
  // true and the cleared signal fires the yellow indicator.
  const setExpirationEnabled = (on: boolean) => {
    if (on) {
      const existing = settings.publicationRules["expiration"];
      const nextAction = existing && existing.action !== "none" ? existing.action : "archive";
      onSave({
        ...settings,
        freshnessWarnAfterMonths: 36,
        freshnessWarnBeforeDate: null,
        publicationRules: {
          ...settings.publicationRules,
          expiration: { action: nextAction, auto_revert: true },
        },
      });
    } else {
      onSave({
        ...settings,
        freshnessWarnAfterMonths: null,
        freshnessWarnBeforeDate: null,
        publicationRules: {
          ...settings.publicationRules,
          expiration: { action: "none", auto_revert: true },
        },
      });
    }
  };

  const setExpirationThreshold = (value: string, dateOverride?: string) => {
    setExpValue(value);
    if (value === "specific") {
      const d = dateOverride ?? specificDate;
      if (!d) return; // wait for date input before saving
      onSave({
        ...settings,
        freshnessWarnAfterMonths: null,
        freshnessWarnBeforeDate: d,
      });
    } else {
      const preset = EXPIRATION_PRESETS.find(p => p.value === value);
      if (!preset) return;
      onSave({
        ...settings,
        freshnessWarnAfterMonths: preset.months,
        freshnessWarnBeforeDate: null,
      });
    }
  };

  const setExpirationAction = (action: "none" | "draft" | "archive") => {
    onSave({
      ...settings,
      publicationRules: {
        ...settings.publicationRules,
        expiration: { action, auto_revert: true },
      },
    });
  };

  // ── Visibility card state ─────────────────────────────────────────
  // The Visibility card holds N branches, one per approval status that
  // has a configured visibility action. Admins can add up to one branch
  // per status via the "+ Add condition" affordance, change which
  // approval status a branch fires on, and remove individual branches.
  // The card's on/off toggle is implicit: any branch with action !==
  // "none" → on. Toggling off clears every branch's action to "none";
  // toggling on creates a default approval_denied → archive branch.
  const VISIBILITY_APPROVAL_STATUSES: { value: string; label: string }[] = [
    { value: "denied", label: "Denied" },
    { value: "pending", label: "Pending" },
    { value: "needs_edits", label: "Needs edits" },
  ];

  const visibilityBranches = VISIBILITY_APPROVAL_STATUSES
    .map(s => ({
      approval: s.value,
      action: (settings.publicationRules[`approval_${s.value}`]?.action ?? "none") as "none" | "draft" | "archive",
    }))
    .filter(b => b.action !== "none");

  const visibilityOn = visibilityBranches.length > 0;
  const canAddBranch = visibilityBranches.length < VISIBILITY_APPROVAL_STATUSES.length;

  const setVisibilityEnabled = (on: boolean) => {
    const nextRules = { ...settings.publicationRules };
    if (on) {
      if (!visibilityOn) {
        nextRules["approval_denied"] = { action: "archive", auto_revert: true };
      }
    } else {
      for (const s of VISIBILITY_APPROVAL_STATUSES) {
        nextRules[`approval_${s.value}`] = { action: "none", auto_revert: true };
      }
    }
    onSave({ ...settings, publicationRules: nextRules });
  };

  // Move a branch from one approval status to another. Carries the
  // current action over so admin doesn't lose it on a swap.
  const setBranchApproval = (oldApproval: string, newApproval: string) => {
    if (oldApproval === newApproval) return;
    const oldKey = `approval_${oldApproval}`;
    const newKey = `approval_${newApproval}`;
    const carryAction = settings.publicationRules[oldKey]?.action ?? "archive";
    onSave({
      ...settings,
      publicationRules: {
        ...settings.publicationRules,
        [oldKey]: { action: "none", auto_revert: true },
        [newKey]: { action: carryAction, auto_revert: true },
      },
    });
  };

  const setBranchAction = (approval: string, action: "draft" | "archive") => {
    onSave({
      ...settings,
      publicationRules: {
        ...settings.publicationRules,
        [`approval_${approval}`]: { action, auto_revert: true },
      },
    });
  };

  // Default action per approval status. Denied is the strongest signal —
  // archive feels right. Pending and Needs edits are softer signals where
  // making private (still recoverable) reads more proportional.
  const defaultActionForApproval = (approval: string): "draft" | "archive" =>
    approval === "denied" ? "archive" : "draft";

  const addVisibilityBranch = () => {
    const used = new Set(visibilityBranches.map(b => b.approval));
    const next = VISIBILITY_APPROVAL_STATUSES.find(s => !used.has(s.value));
    if (!next) return;
    onSave({
      ...settings,
      publicationRules: {
        ...settings.publicationRules,
        [`approval_${next.value}`]: { action: defaultActionForApproval(next.value), auto_revert: true },
      },
    });
  };

  const removeVisibilityBranch = (approval: string) => {
    onSave({
      ...settings,
      publicationRules: {
        ...settings.publicationRules,
        [`approval_${approval}`]: { action: "none", auto_revert: true },
      },
    });
  };

  // Available approval statuses for a branch's dropdown: its own current
  // value plus any unused status. Prevents two branches from binding to
  // the same approval status.
  const availableApprovalsFor = (currentApproval: string): { value: string; label: string }[] => {
    const used = new Set(visibilityBranches.map(b => b.approval));
    return VISIBILITY_APPROVAL_STATUSES.filter(s => s.value === currentApproval || !used.has(s.value));
  };

  return (
    <div className="rules-panel">
      <div className="ap-head">
        <h3>Rules</h3>
        <p className="ap-sub">Configure how the library behaves under conditions. Rules apply to the whole org.</p>
      </div>

      {/* ── Defaults block ── */}
      <div className="rules-block">
        <div className="rules-block-head">
          <div className="rules-block-title">Defaults</div>
          <div className="rules-block-sub">Applied at import time. Existing assets are unchanged.</div>
        </div>
        <DefaultApprovalSelect settings={settings} onSave={onSave}/>
      </div>

      {/* ── Automations block ── */}
      <div className="rules-block">
        <div className="rules-block-head">
          <div className="rules-block-title">Automations</div>
          <div className="rules-block-sub">Each rule fires on its own trigger. When the trigger clears, the asset auto-reverts to Public.</div>
        </div>

        <RuleCard
          icon={<TimerIcon/>}
          title="Expiration"
          enabled={expirationOn}
          onToggle={setExpirationEnabled}
        >
          <div className="rule-sentence">
            <span>When asset is</span>
            <select
              className="rules-select rule-inline-select"
              value={expValue}
              onChange={(e) => setExpirationThreshold(e.target.value)}
            >
              {EXPIRATION_PRESETS.map(p => (
                <option key={p.value} value={p.value}>{p.label}</option>
              ))}
              <option disabled>──────────</option>
              <option value="specific">Published before specific date…</option>
            </select>
            {expValue === "specific" && (
              <input
                className="rules-input rule-inline-date"
                type="date"
                value={specificDate}
                onChange={(e) => {
                  setSpecificDate(e.target.value);
                  if (e.target.value) setExpirationThreshold("specific", e.target.value);
                }}
              />
            )}
          </div>
          <div className="rule-then">↓ then</div>
          <div className="rule-sentence">
            <span>Auto-flag and</span>
            <select
              className="rules-select rule-inline-select"
              value={expAction}
              onChange={(e) => setExpirationAction(e.target.value as "none" | "draft" | "archive")}
            >
              <option value="archive">Archive</option>
              <option value="draft">Make private</option>
              <option value="none">Nothing else</option>
            </select>
          </div>
        </RuleCard>

        <RuleCard
          icon={<EyeIcon/>}
          title="Visibility"
          enabled={visibilityOn}
          onToggle={setVisibilityEnabled}
        >
          {/* Render configured branches separated by AND dividers. The
              first branch defaults to Denied → Archive; admins can swap
              the trigger via the inline approval-status dropdown. */}
          {visibilityBranches.map((b, i) => (
            <React.Fragment key={b.approval}>
              {i > 0 && <div className="rule-and">AND</div>}
              <div className="rule-branch">
                <div className="rule-sentence">
                  <span>When approval is set to</span>
                  <select
                    className="rules-select rule-inline-select"
                    value={b.approval}
                    onChange={(e) => setBranchApproval(b.approval, e.target.value)}
                  >
                    {availableApprovalsFor(b.approval).map(s => (
                      <option key={s.value} value={s.value}>{s.label}</option>
                    ))}
                  </select>
                </div>
                <div className="rule-then">↓ then</div>
                <div className="rule-sentence">
                  <span>Auto-flag and</span>
                  <select
                    className="rules-select rule-inline-select"
                    value={b.action === "none" ? "archive" : b.action}
                    onChange={(e) => setBranchAction(b.approval, e.target.value as "draft" | "archive")}
                  >
                    <option value="archive">Archive</option>
                    <option value="draft">Make private</option>
                  </select>
                  {visibilityBranches.length > 1 && (
                    <button
                      type="button"
                      className="rule-branch-remove"
                      onClick={() => removeVisibilityBranch(b.approval)}
                      title="Remove this condition"
                      aria-label="Remove condition"
                    >×</button>
                  )}
                </div>
              </div>
            </React.Fragment>
          ))}
          {/* "+ Add condition" — quietly invites stacking another approval
              status without screaming for attention. Hidden when every
              status already has a branch. */}
          {canAddBranch && (
            <button
              type="button"
              className="rule-add-condition"
              onClick={addVisibilityBranch}
            >
              <span className="rule-add-plus">+</span>
              <span>Add condition</span>
            </button>
          )}
        </RuleCard>
      </div>
    </div>
  );
}

// Reusable card for a single trigger→action rule. Header has the rule's
// icon + name + on/off toggle. When on, body renders the configurable
// trigger + action sentences. When off, body collapses entirely and the
// card goes muted.
interface RuleCardProps {
  icon: React.ReactNode;
  title: string;
  enabled: boolean;
  onToggle: (on: boolean) => void;
  children?: React.ReactNode;
}
function RuleCard({ icon, title, enabled, onToggle, children }: RuleCardProps) {
  return (
    <div className={`rule-card${enabled ? " on" : " off"}`}>
      <div className="rule-card-head">
        <div className="rule-card-title">
          <span className="rule-card-icon">{icon}</span>
          <span>{title}</span>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          className={`rule-toggle${enabled ? " on" : ""}`}
          onClick={() => onToggle(!enabled)}
          title={enabled ? "Click to turn off" : "Click to turn on"}
        >
          <span className="rule-toggle-thumb"/>
        </button>
      </div>
      {enabled && (
        <div className="rule-card-body">{children}</div>
      )}
    </div>
  );
}

function TimerIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="13" r="8"/>
      <path d="M12 9v4l2 2"/>
      <path d="M9 2h6"/>
    </svg>
  );
}

function XMarkIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9"/>
      <path d="M9 9l6 6"/>
      <path d="M15 9l-6 6"/>
    </svg>
  );
}

// Eye icon for the Visibility rule card. The visibility concept already
// uses pill colors elsewhere, so this is the icon that ties them together.
function EyeIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"/>
      <circle cx="12" cy="12" r="3"/>
    </svg>
  );
}

// Default approval status — used in the Defaults block. Saves on Save click.
function DefaultApprovalSelect({ settings, onSave }: { settings: OrgSettings; onSave: (next: OrgSettings) => Promise<void> | void }) {
  const [draft, setDraft] = useState(settings.defaultApprovalStatus);
  useEffect(() => { setDraft(settings.defaultApprovalStatus); }, [settings.defaultApprovalStatus]);
  const dirty = draft !== settings.defaultApprovalStatus;
  return (
    <div className="rules-default-row">
      <label className="rules-default-label">Default approval for new imports</label>
      <select
        className="rules-select"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
      >
        <option value="unset">Blank</option>
        <option value="pending">Pending approval</option>
        <option value="needs_edits">Needs edits</option>
        <option value="approved">Approved</option>
        <option value="denied">Denied</option>
      </select>
      {dirty && (
        <div className="rules-actions">
          <button className="rules-save" onClick={() => onSave({ ...settings, defaultApprovalStatus: draft })}>Save</button>
          <button className="rules-cancel" onClick={() => setDraft(settings.defaultApprovalStatus)}>Cancel</button>
        </div>
      )}
    </div>
  );
}

function SourcesPanel({sources,assets,onAddSource,onRemoveSource,onAddAssets,onUpdateAssets,onUpdateSource,onRefresh}: SourcesPanelProps) {
  // Sync reports now live on each source row server-side (source.pendingSyncReport).
  // Per-source UI state for which row is expanded, plus syncing-now indicators.
  const [expandedReportId, setExpandedReportId] = useState<string | null>(null);
  const [autoSyncPopFor, setAutoSyncPopFor] = useState<string | null>(null);
  const[view,setView]=useState<"list"|"add">("list");
  const[mode,setMode]=useState<"source"|"single">("source");
  const[url,setUrl]=useState("");
  const[name,setName]=useState("");
  const[working,setWorking]=useState(false);
  const[progress,setProgress]=useState<Progress|null>(null);
  const[syncingId,setSyncingId]=useState<string|null>(null);

  // Vimeo connection state
  const[vimeoStatus,setVimeoStatus]=useState<{connected:boolean;vimeoUserName?:string}|null>(null);
  const[vimeoBusy,setVimeoBusy]=useState(false);

  // Check Vimeo connection on mount
  useEffect(()=>{
    (async()=>{
      try{
        const headers=await authHeaders();
        const r=await fetch("/api/vimeo/status",{headers});
        if(r.ok){
          const data=await r.json();
          setVimeoStatus(data);
        }
      }catch(e){console.error("Failed to check Vimeo status",e);}
    })();
  },[]);

  // Also react to ?vimeo_connected=1 returning from OAuth flow
  useEffect(()=>{
    if(typeof window==="undefined")return;
    const params=new URLSearchParams(window.location.search);
    if(params.has("vimeo_connected")||params.has("vimeo_error")){
      // Refetch status
      (async()=>{
        const headers=await authHeaders();
        const r=await fetch("/api/vimeo/status",{headers});
        if(r.ok){setVimeoStatus(await r.json());}
      })();
      // Clean up the URL
      window.history.replaceState({},"",window.location.pathname);
    }
  },[]);

  const connectVimeo=async()=>{
    setVimeoBusy(true);
    try{
      const headers=await authHeaders();
      const r=await fetch("/api/vimeo/connect",{headers});
      if(!r.ok){
        const body=await r.json().catch(()=>({}));
        alert(body.error||"Failed to start Vimeo connection");
        setVimeoBusy(false);
        return;
      }
      const {url}=await r.json();
      window.location.href=url;
    }catch(e){
      console.error(e);
      setVimeoBusy(false);
    }
  };

  const disconnectVimeo=async()=>{
    if(!confirm("Disconnect your Vimeo account?"))return;
    setVimeoBusy(true);
    try{
      const headers=await authHeaders();
      await fetch("/api/vimeo/status",{method:"DELETE",headers});
      setVimeoStatus({connected:false});
    }catch(e){console.error(e);}
    setVimeoBusy(false);
  };

  const detected=url.trim()?detectUrlType(url.trim()):null;
  const isCollection=detected&&(detected.kind==="vm-showcase"||detected.kind==="yt-playlist");
  const isSingle=detected&&(detected.kind==="vm-video"||detected.kind==="yt-video");

  const typeLabel=(k: string): string => k==="yt-video"?"YouTube video":k==="yt-playlist"?"YouTube playlist":k==="vm-video"?"Vimeo video":k==="vm-showcase"?"Vimeo showcase":"Unknown";

  // Add a collection source — extract all videos and create assets
  const addCollectionSource=async()=>{
    if(!detected||!isCollection)return;
    // Vimeo showcases need Vimeo connected
    if(detected.kind==="vm-showcase"&&!vimeoStatus?.connected){
      alert("Connect your Vimeo account first to import showcases.");
      return;
    }
    setWorking(true);
    setProgress({step:"Extracting videos and transcripts from showcase…",count:0,total:"?"});
    const videos=await extractShowcaseVideos(detected.url);
    if(videos.length===0){
      setProgress({step:`No videos could be extracted. Source saved — try "Sync" later.`,count:0,total:0,done:true,error:true});
      const source: Source = {id:`src-${Date.now()}`,name:name||`${typeLabel(detected.kind)}`,url:detected.url,type:detected.kind,status:"error",lastSync:new Date().toISOString(),videoCount:0,assetIds:[]};
      onAddSource(source);
      setWorking(false);
      setTimeout(()=>{setProgress(null);setView("list");setUrl("");setName("");},2500);
      return;
    }
    setProgress({step:`Found ${videos.length} videos. Importing…`,count:0,total:videos.length});
    const sourceId=`src-${Date.now()}`;
    const newAssets: Asset[] = [];
    for(let i=0;i<videos.length;i++){
      const v=videos[i];
      const info=detectUrlType(v.url);
      if(!info||info.kind==="unknown")continue;
      setProgress({step:`Processing ${v.title||v.url}…`,count:i+1,total:videos.length});
      const asset=await importSingleVideo(info,sourceId);
      // Vimeo is the source of truth for title and description. Always overwrite
      // — don't let oEmbed-derived or LLM-guessed values win over what the admin
      // typed into Vimeo itself. Mirror into lastSynced* so the auto-sync
      // engine can tell future local edits apart from Vimeo-side changes.
      if(v.title){asset.headline=v.title;asset.lastSyncedTitle=v.title;}
      if(v.description){asset.description=v.description;asset.lastSyncedDescription=v.description;}
      if(v.thumbnail) asset.thumbnail=v.thumbnail;
      if(v.transcript){asset.transcript=v.transcript;asset.lastSyncedTranscript=v.transcript;}
      // Vimeo's actual upload date — drives freshness on first import.
      if(v.createdAt) asset.publishedAt=v.createdAt;
      newAssets.push(asset);
    }
    const source: Source = {id:sourceId,name:name||`${typeLabel(detected.kind)}`,url:detected.url,type:detected.kind,status:"synced",lastSync:new Date().toISOString(),videoCount:newAssets.length,assetIds:newAssets.map(a=>a.id)};
    onAddSource(source);
    onAddAssets(newAssets);
    setProgress({step:`Imported ${newAssets.length} videos`,count:newAssets.length,total:newAssets.length,done:true});
    setWorking(false);
    setTimeout(()=>{setProgress(null);setView("list");setUrl("");setName("");},1800);
  };

  // Add a single video — now tracked as a source (type "vm-video") so it
  // gets the same lifecycle treatment as showcases: hi-res thumbs, transcript
  // pull, drift detection, auto-archive when removed from Vimeo, and a
  // permanent entry in the admin Sources panel.
  const addSingleVideo=async()=>{
    if(!detected||!isSingle)return;
    // Only Vimeo singles get the full pipeline (server-side sync needs Vimeo
    // API). YouTube singles fall back to the legacy oEmbed import for now.
    if(detected.kind!=="vm-video"){
      setWorking(true);
      setProgress({step:"Fetching video details…",count:0,total:1});
      const asset=await importSingleVideo(detected,null);
      onAddAssets([asset]);
      setProgress({step:"Done",count:1,total:1,done:true});
      setWorking(false);
      setTimeout(()=>{setProgress(null);setView("list");setUrl("");setName("");},1500);
      return;
    }
    if(!vimeoStatus?.connected){
      alert("Connect your Vimeo account first to import single videos.");
      return;
    }
    setWorking(true);
    setProgress({step:"Creating source…",count:0,total:1});
    const sourceId=`src-${Date.now()}`;
    // Create a thin Source row first so the sync endpoint has something to
    // hang the import off of. Vimeo metadata (real title) gets filled by the
    // sync — we use a placeholder name until then.
    const source: Source = {
      id:sourceId,
      name:name||"Vimeo video",
      url:detected.url,
      type:"vm-video",
      status:"syncing",
      lastSync:null,
      videoCount:0,
      assetIds:[],
    };
    // Await so the source row is persisted in DB before we trigger the sync
    // endpoint (which needs to look it up).
    await onAddSource(source);
    setProgress({step:"Importing from Vimeo…",count:0,total:1});
    try{
      const r=await fetch(`/api/sources/${sourceId}/sync`,{
        method:"POST",
        headers:await authHeaders(),
      });
      if(!r.ok){
        const body=await r.json().catch(()=>({}));
        console.error("Single-video sync failed",body);
        setProgress({step:`Import failed: ${body.error||"unknown error"}`,count:0,total:1,done:true,error:true});
        setWorking(false);
        setTimeout(()=>setProgress(null),2500);
        return;
      }
    }catch(e){
      console.error("Single-video sync error",e);
      setProgress({step:"Import failed",count:0,total:1,done:true,error:true});
      setWorking(false);
      setTimeout(()=>setProgress(null),2500);
      return;
    }
    setProgress({step:"Imported",count:1,total:1,done:true});
    setWorking(false);
    // Pull fresh server state so the new source + asset show up
    await onRefresh();
    setTimeout(()=>{setProgress(null);setView("list");setUrl("");setName("");},1200);
  };

  // Re-sync an existing source — server-side now. The server endpoint:
  //   • Fetches the showcase from Vimeo
  //   • Imports new videos, auto-archives orphans
  //   • Computes drift + previously-deleted
  //   • Merges everything into source.pending_sync_report (the persistent inbox)
  // FE just refreshes its local state afterward.
  const doSync=async(source: Source)=>{
    setSyncingId(source.id);
    try {
      const r = await fetch(`/api/sources/${source.id}/sync`, {
        method: "POST",
        headers: await authHeaders(),
      });
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        console.error("Sync failed", body);
      }
    } catch (e) {
      console.error("Sync error", e);
    }
    // Re-pull sources + assets so the FE reflects what the server just changed
    await onRefresh();
    setSyncingId(null);
  };

  const iconFor=(type: string | undefined): string => type?.startsWith("vm")?"vm":type?.startsWith("yt")?"yt":"unk";
  const timeAgo=(iso: string | null): string => {
    if(!iso)return"Never synced";
    const m=Math.round((Date.now()-new Date(iso).getTime())/60000);
    if(m<1)return"Just now";
    if(m<60)return`${m}m ago`;
    const h=Math.round(m/60);
    if(h<24)return`${h}h ago`;
    return`${Math.round(h/24)}d ago`;
  };

  if(view==="add"){
    return(
      <React.Fragment>
        <div className="ap-head">
          <div className="ap-edit-head">
            <button className="ap-back" onClick={()=>{setView("list");setUrl("");setName("");setProgress(null);}}>← Back</button>
            <div className="ap-title" style={{fontSize:15}}>Add content</div>
          </div>
        </div>
        <div className="ap-body">
          {!working && (
            <React.Fragment>
              <div className="src-tabs">
                <button className={`src-tab ${mode==="source"?"on":""}`} onClick={()=>setMode("source")}>Showcase / Playlist</button>
                <button className={`src-tab ${mode==="single"?"on":""}`} onClick={()=>setMode("single")}>Single video</button>
              </div>
              <div className="src-add-form">
                <label>{mode==="source"?"Showcase or playlist URL":"Video URL"}</label>
                <input
                  value={url}
                  onChange={e=>setUrl(e.target.value)}
                  placeholder={mode==="source"?"https://vimeo.com/showcase/12345678":"https://vimeo.com/123456789"}
                  autoFocus
                />
                {detected&&(
                  <div className="src-detect">
                    <span className={`imp-item-type ${iconFor(detected.kind)}`}>{typeLabel(detected.kind)}</span>
                    <span>detected</span>
                  </div>
                )}
                {mode==="source"&&(
                  <React.Fragment>
                    <label>Source name (optional)</label>
                    <input
                      value={name}
                      onChange={e=>setName(e.target.value)}
                      placeholder="Customer Testimonials"
                    />
                  </React.Fragment>
                )}
                <div className="src-form-btns">
                  <button className="cancel" onClick={()=>{setView("list");setUrl("");setName("");}}>Cancel</button>
                  <button
                    className="add"
                    disabled={!detected||(mode==="source"&&!isCollection)||(mode==="single"&&!isSingle)}
                    onClick={mode==="source"?addCollectionSource:addSingleVideo}
                  >
                    {mode==="source"?"Add & sync":"Add video"}
                  </button>
                </div>
              </div>
              <div className="imp-hint">
                {mode==="source"?(
                  <React.Fragment>
                    <strong>Sources</strong> are managed collections. We'll extract individual videos from the showcase/playlist, and you can re-sync later to pull new videos as they're added.
                  </React.Fragment>
                ):(
                  <React.Fragment>
                    <strong>Single videos</strong> are tracked just like showcases — Vimeo title, description, transcript and thumbnail stay in sync, and the video shows up in your Sources list so you can re-sync, auto-sync, or remove it later.
                  </React.Fragment>
                )}
              </div>
            </React.Fragment>
          )}
          {working&&progress&&(
            <div className="src-progress">
              <div className="src-progress-step">
                <span className="imp-spin"/>
                {progress.step}
              </div>
              {typeof progress.total==="number"&&progress.total>0&&(
                <div style={{marginTop:6,fontSize:10.5,opacity:.8}}>
                  {progress.count} of {progress.total}
                </div>
              )}
            </div>
          )}
          {!working&&progress?.done&&(
            <div className={`imp-res ${progress.error?"err":""}`}>
              {progress.step}
            </div>
          )}
        </div>
      </React.Fragment>
    );
  }

  return(
    <React.Fragment>
      <div className="ap-head">
        <div className="ap-title">Import</div>
        <div className="ap-sub">Connect video sources — we&apos;ll pull them in and keep them synced</div>
      </div>
      <div className="ap-body">
        {/* Vimeo connection status */}
        {vimeoStatus && (
          <div style={{
            marginBottom:14,
            padding:"10px 12px",
            borderRadius:9,
            border:vimeoStatus.connected?"1px solid var(--accentL)":"1.5px dashed var(--border2)",
            background:vimeoStatus.connected?"var(--accentLL)":"var(--bg)",
            display:"flex",
            alignItems:"center",
            gap:10,
          }}>
            <div style={{
              width:28,height:28,borderRadius:7,background:"#1ab7ea",
              color:"#fff",display:"grid",placeItems:"center",
              fontSize:13,fontWeight:700,flexShrink:0
            }}>V</div>
            <div style={{flex:1,minWidth:0}}>
              <div style={{fontSize:12,fontWeight:600,color:"var(--t1)"}}>
                {vimeoStatus.connected?"Vimeo connected":"Connect Vimeo"}
              </div>
              <div style={{fontSize:10.5,color:"var(--t3)",marginTop:1,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>
                {vimeoStatus.connected
                  ?`Signed in as ${vimeoStatus.vimeoUserName||"Vimeo user"}`
                  :"Pull showcases and videos from your Vimeo account."}
              </div>
            </div>
            <button
              onClick={vimeoStatus.connected?disconnectVimeo:connectVimeo}
              disabled={vimeoBusy}
              style={{
                padding:"6px 11px",
                borderRadius:6,
                border:"1px solid var(--border)",
                background:vimeoStatus.connected?"#fff":"var(--accent)",
                color:vimeoStatus.connected?"var(--t2)":"#fff",
                fontSize:11,
                fontWeight:700,
                cursor:vimeoBusy?"wait":"pointer",
                fontFamily:"var(--font)",
                flexShrink:0,
                opacity:vimeoBusy?.6:1,
              }}
            >
              {vimeoBusy?"…":vimeoStatus.connected?"Disconnect":"Connect"}
            </button>
          </div>
        )}

        <button className="src-add-new" onClick={()=>setView("add")}>
          + Add source or single video
        </button>

        {sources.length===0?(
          <div className="src-empty">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="5" width="20" height="14" rx="2"/>
              <polygon points="10 9 15 12 10 15"/>
            </svg>
            <h4>No sources yet</h4>
            <p>Add a Vimeo showcase, YouTube playlist,<br/>or paste individual video URLs to get started.</p>
          </div>
        ):(
          <div className="src-list">
            {/* Render showcases (and any non-single sources) first, then single
                videos below in a compact "mini" style — see Logan's spec:
                "should be a much simpler appearing item just below the
                showcase box". Each group keeps insertion order within itself. */}
            {[...sources].sort((a,b)=>{
              const rank=(t: string|undefined)=>t==="vm-video"?1:0;
              return rank(a.type)-rank(b.type);
            }).map(s=>{
              const isSingleVideo=s.type==="vm-video";
              return (
              <div className={`src-card${isSingleVideo?" mini":""}`} key={s.id}>
                <div className="src-card-top">
                  <div className={`src-card-icon ${iconFor(s.type)}`}>
                    {s.type?.startsWith("vm")?"V":"Y"}
                  </div>
                  <div className="src-card-info">
                    <div className="src-card-name">{s.name}</div>
                    <div className="src-card-sub">
                      <span className={`src-sync-dot ${syncingId===s.id?"syncing":s.status==="error"?"error":s.lastSync?"synced":"never"}`}/>
                      {syncingId===s.id?"Syncing…":isSingleVideo?timeAgo(s.lastSync):`${s.videoCount} video${s.videoCount===1?"":"s"} · ${timeAgo(s.lastSync)}`}
                    </div>
                    <div className="src-auto-row">
                      <button
                        className={`src-auto-btn${s.autoSyncEnabled?" on":""}`}
                        onClick={(e)=>{e.stopPropagation();setAutoSyncPopFor(autoSyncPopFor===s.id?null:s.id);}}
                        title={s.autoSyncEnabled?"Auto-sync is on":"Auto-sync is off"}
                      >
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                          <circle cx="12" cy="12" r="10"/>
                          <polyline points="12 6 12 12 16 14"/>
                        </svg>
                        Auto-sync: {s.autoSyncEnabled?"On":"Off"}
                      </button>
                      {autoSyncPopFor===s.id && (
                        <div className="src-auto-pop" onClick={(e)=>e.stopPropagation()}>
                          <div className="src-auto-pop-head">Auto-sync</div>
                          <button
                            className={`src-auto-opt${!s.autoSyncEnabled?" on":""}`}
                            onClick={()=>{onUpdateSource({id:s.id,autoSyncEnabled:false});setAutoSyncPopFor(null);}}
                          >
                            <span className="src-auto-opt-radio">{!s.autoSyncEnabled?"●":"○"}</span> Off
                          </button>
                          <button
                            className={`src-auto-opt${s.autoSyncEnabled?" on":""}`}
                            onClick={()=>{onUpdateSource({id:s.id,autoSyncEnabled:true});setAutoSyncPopFor(null);}}
                          >
                            <span className="src-auto-opt-radio">{s.autoSyncEnabled?"●":"○"}</span> On — runs daily
                          </button>
                          {s.autoSyncEnabled && (
                            <div className="src-auto-pop-meta">
                              {s.lastAutoSyncAt
                                ? `Last auto-sync: ${timeAgo(s.lastAutoSyncAt)}`
                                : "Hasn't run yet — first auto-sync will be tomorrow at 2am UTC"}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="src-card-actions">
                    <button
                      className="src-act-btn"
                      disabled={syncingId===s.id}
                      onClick={()=>doSync(s)}
                      title="Sync now"
                    >
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M21 12a9 9 0 0 1-9 9c-2.5 0-4.7-1-6.4-2.6M3 12a9 9 0 0 1 9-9c2.5 0 4.7 1 6.4 2.6"/>
                        <path d="M21 3v5h-5M3 21v-5h5"/>
                      </svg>
                    </button>
                    <button
                      className="src-act-btn danger"
                      onClick={()=>onRemoveSource(s.id)}
                      title="Remove source and its imported assets"
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M18 6 6 18M6 6l12 12"/>
                      </svg>
                    </button>
                  </div>
                </div>
                <div className="src-card-url">{s.url}</div>
                {/* Subtle inline sync report — read from server-persisted
                    source.pendingSyncReport. Click to expand. */}
                {(() => {
                  const r = s.pendingSyncReport as SyncReport | null | undefined;
                  if (!r) return null;
                  // Defensive default for reports written before autoApplied existed.
                  const autoApplied = r.autoApplied ?? [];
                  const total = r.imported.length + r.drifted.length + r.archived.length + r.previouslyDeleted.length + autoApplied.length;
                  if (total === 0) return null;
                  const isOpen = expandedReportId === s.id;
                  const removeFromReport = (key: keyof Pick<SyncReport, "drifted" | "archived" | "previouslyDeleted" | "imported" | "autoApplied">, assetId: string) => {
                    const updated: SyncReport = {
                      ...r,
                      [key]: (r[key] as Array<{ assetId: string }>).filter(x => x.assetId !== assetId),
                    };
                    onUpdateSource({ id: s.id, pendingSyncReport: updated });
                  };
                  const markAllReviewed = () => {
                    if (!confirm(
                      "Are you sure? Import history will be permanently erased.\n\n" +
                      "This clears every entry in the sync report — imported, drifted, archived, and previously-deleted. " +
                      "You won't be able to see when items came in. Continue?"
                    )) return;
                    onUpdateSource({ id: s.id, pendingSyncReport: null });
                    setExpandedReportId(null);
                  };
                  // Nuclear option — apply Vimeo's current values to everything
                  // that's drifted or previously-deleted. Confirms first because
                  // this overwrites manual StoryMatch edits the admin made.
                  const pullAllFromVimeo = () => {
                    if (!confirm(
                      "Resync all Vimeo properties for this source?\n\n" +
                      "This will overwrite your local edits to title, description, and transcript on every drifted asset with Vimeo's current values, " +
                      "and bring back every previously-deleted asset that's still in Vimeo.\n\n" +
                      "Continue?"
                    )) return;
                    const updates: Array<Partial<Asset> & { id: string }> = [];
                    for (const d of r.drifted) {
                      // Advance the lastSynced snapshots so the conflict
                      // is fully resolved — next sync sees no drift.
                      updates.push({
                        id: d.assetId,
                        headline: d.vimeo.title,
                        description: d.vimeo.description,
                        ...(d.vimeo.thumbnail ? { thumbnail: d.vimeo.thumbnail } : {}),
                        ...(d.vimeo.transcript ? { transcript: d.vimeo.transcript } : {}),
                        lastSyncedTitle: d.vimeo.title,
                        lastSyncedDescription: d.vimeo.description,
                        lastSyncedTranscript: d.vimeo.transcript,
                      });
                    }
                    for (const p of r.previouslyDeleted) {
                      updates.push({
                        id: p.assetId,
                        status: "published",
                        headline: p.vimeo.title,
                        description: p.vimeo.description,
                        ...(p.vimeo.thumbnail ? { thumbnail: p.vimeo.thumbnail } : {}),
                        ...(p.vimeo.transcript ? { transcript: p.vimeo.transcript } : {}),
                        lastSyncedTitle: p.vimeo.title,
                        lastSyncedDescription: p.vimeo.description,
                        lastSyncedTranscript: p.vimeo.transcript,
                      });
                    }
                    if (updates.length > 0) onUpdateAssets(updates);
                    const updated: SyncReport = { ...r, drifted: [], previouslyDeleted: [] };
                    onUpdateSource({ id: s.id, pendingSyncReport: updated });
                  };
                  const hasPullable = r.drifted.length + r.previouslyDeleted.length > 0;
                  return (
                    <div className={`src-sync-report${isOpen ? " open" : ""}`}>
                      <button
                        className="src-sync-report-toggle"
                        onClick={() => setExpandedReportId(isOpen ? null : s.id)}
                      >
                        <span className="src-sync-report-summary">Sync report</span>
                        <span className="src-sync-report-chev">{isOpen ? "▴" : "▾"}</span>
                      </button>
                      {isOpen && (
                        <div className="src-sync-report-body">
                          {r.imported.length > 0 && (
                            <div className="ssr-section">
                              <div className="ssr-section-head">
                                <span className="ssr-icon">
                                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                                    <line x1="12" y1="5" x2="12" y2="19"/>
                                    <line x1="5" y1="12" x2="19" y2="12"/>
                                  </svg>
                                </span>
                                <span className="ssr-count">{r.imported.length}</span> Imported
                              </div>
                              {r.imported.map(i => (
                                <div key={i.assetId} className="ssr-row compact">
                                  <div className="ssr-row-title">{i.headline}</div>
                                  <div className="ssr-row-when">{timeAgoShort(i.detectedAt)}</div>
                                </div>
                              ))}
                            </div>
                          )}
                          {autoApplied.length > 0 && (
                            <div className="ssr-section">
                              <div className="ssr-section-head">
                                <span className="ssr-icon">
                                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M21 12a9 9 0 1 1-3-6.7"/>
                                    <polyline points="21 4 21 12 13 12"/>
                                  </svg>
                                </span>
                                <span className="ssr-count">{autoApplied.length}</span> Updated from Vimeo
                              </div>
                              <div className="ssr-section-help">
                                Vimeo&apos;s value changed and you hadn&apos;t edited locally — applied automatically.
                              </div>
                              {autoApplied.map(u => {
                                const labels: Record<string, string> = { title: "Title", description: "Description", transcript: "Transcript", thumbnail: "Thumbnail" };
                                const pretty = u.fields.map(f => labels[f] || f).join(", ");
                                return (
                                  <div key={u.assetId} className="ssr-row compact">
                                    <div className="ssr-row-title">{u.headline}</div>
                                    <div className="ssr-row-meta">
                                      {pretty} {u.fields.length === 1 ? "updated" : "updated"}
                                      <span className="ssr-when-sep">·</span>
                                      {timeAgoShort(u.detectedAt)}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                          {r.archived.length > 0 && (
                            <div className="ssr-section">
                              <div className="ssr-section-head">
                                <span className="ssr-icon">
                                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                                    <line x1="5" y1="12" x2="19" y2="12"/>
                                  </svg>
                                </span>
                                <span className="ssr-count">{r.archived.length}</span> Removed from Vimeo
                              </div>
                              <div className="ssr-section-help">
                                Auto-archived because they&apos;re no longer in your Vimeo showcase.
                              </div>
                              {r.archived.map(a => (
                                <div key={a.assetId} className="ssr-row">
                                  <div className="ssr-row-title">{a.headline}</div>
                                  <div className="ssr-row-when">{timeAgoShort(a.detectedAt)}</div>
                                  <div className="ssr-row-actions">
                                    <button
                                      className="ssr-btn primary"
                                      onClick={() => {
                                        onUpdateAssets([{ id: a.assetId, status: "published", archivedAt: null, archivedReason: null }]);
                                        removeFromReport("archived", a.assetId);
                                      }}
                                    >Restore</button>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                          {r.drifted.length > 0 && (
                            <div className="ssr-section">
                              <div className="ssr-section-head">
                                <span className="ssr-icon">
                                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
                                    <line x1="12" y1="9" x2="12" y2="13"/>
                                    <line x1="12" y1="17" x2="12.01" y2="17"/>
                                  </svg>
                                </span>
                                <span className="ssr-count">{r.drifted.length}</span> Edited in StoryMatch
                              </div>
                              <div className="ssr-section-help">
                                You edited these fields in StoryMatch and they no longer match Vimeo. Pull from Vimeo to overwrite your local edit.
                              </div>
                              {r.drifted.map(d => {
                                const fieldLabels: Record<string, string> = { title: "Title", description: "Description", transcript: "Transcript" };
                                const pretty = d.fields.map(f => fieldLabels[f] || f).join(", ");
                                return (
                                <div key={d.assetId} className="ssr-row">
                                  <div className="ssr-row-title">{d.headline}</div>
                                  <div className="ssr-row-meta">
                                    {pretty} {d.fields.length === 1 ? "differs" : "differ"}
                                    <span className="ssr-when-sep">·</span>
                                    {timeAgoShort(d.detectedAt)}
                                  </div>
                                  <div className="ssr-row-actions">
                                    <button
                                      className="ssr-btn primary"
                                      onClick={() => {
                                        onUpdateAssets([{
                                          id: d.assetId,
                                          headline: d.vimeo.title,
                                          description: d.vimeo.description,
                                          ...(d.vimeo.thumbnail ? { thumbnail: d.vimeo.thumbnail } : {}),
                                          ...(d.vimeo.transcript ? { transcript: d.vimeo.transcript } : {}),
                                          // Resolve the conflict by advancing
                                          // the lastSynced snapshot.
                                          lastSyncedTitle: d.vimeo.title,
                                          lastSyncedDescription: d.vimeo.description,
                                          lastSyncedTranscript: d.vimeo.transcript,
                                        }]);
                                        removeFromReport("drifted", d.assetId);
                                      }}
                                    >Pull from Vimeo</button>
                                  </div>
                                </div>
                                );
                              })}
                            </div>
                          )}
                          {r.previouslyDeleted.length > 0 && (
                            <div className="ssr-section">
                              <div className="ssr-section-head">
                                <span className="ssr-icon">
                                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <circle cx="12" cy="12" r="10"/>
                                    <line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/>
                                  </svg>
                                </span>
                                <span className="ssr-count">{r.previouslyDeleted.length}</span> Previously deleted, still in Vimeo
                              </div>
                              <div className="ssr-section-help">
                                Not auto-imported because you previously deleted them. Resync to bring them back.
                              </div>
                              {r.previouslyDeleted.map(p => (
                                <div key={p.assetId} className="ssr-row">
                                  <div className="ssr-row-title">{p.headline}</div>
                                  <div className="ssr-row-when">{timeAgoShort(p.detectedAt)}</div>
                                  <div className="ssr-row-actions">
                                    <button
                                      className="ssr-btn primary"
                                      onClick={() => {
                                        onUpdateAssets([{
                                          id: p.assetId,
                                          status: "published",
                                          headline: p.vimeo.title,
                                          description: p.vimeo.description,
                                          ...(p.vimeo.thumbnail ? { thumbnail: p.vimeo.thumbnail } : {}),
                                          ...(p.vimeo.transcript ? { transcript: p.vimeo.transcript } : {}),
                                          lastSyncedTitle: p.vimeo.title,
                                          lastSyncedDescription: p.vimeo.description,
                                          lastSyncedTranscript: p.vimeo.transcript,
                                        }]);
                                        removeFromReport("previouslyDeleted", p.assetId);
                                      }}
                                    >Resync from Vimeo</button>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                          <div className="ssr-foot-row">
                            <button
                              className="ssr-mark-reviewed-link"
                              onClick={markAllReviewed}
                              title="Clear this report. Next sync starts fresh."
                            >
                              Mark all reviewed
                            </button>
                            {hasPullable && (
                              <button
                                className="ssr-pull-all-link"
                                onClick={pullAllFromVimeo}
                                title="Overwrite all drifted and previously-deleted items with Vimeo's current values. Asks for confirmation."
                              >
                                Resync all Vimeo properties
                              </button>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })()}
              </div>
              );
            })}
          </div>
        )}
      </div>
    </React.Fragment>
  );
}

// ─── APP ─────────────────────────────────────────────────────────────────────
export default function App(){
  const{user,org,signOut}=useAuth();
  const[assets,setAssets]=useState<Asset[]>([]);
  // Distinct (color, label) pairs across every asset's customFlags. Lets
  // the Add custom status forms offer "reuse a previous tag" so admins
  // don't have to retype/re-pick the same color and label across
  // multiple assets — surface consistency without the friction.
  const knownCustomTags = React.useMemo<{ color: string; label: string }[]>(() => {
    const seen = new Map<string, { color: string; label: string }>();
    for (const a of assets) {
      if (!Array.isArray(a.customFlags)) continue;
      for (const f of a.customFlags as CustomFlag[]) {
        if (!f) continue;
        // Key on color+label so different labels with same color don't dedupe
        // and an unlabeled tag in some preset color (yellow/red/green) doesn't
        // clutter the list — those are already in the picker as presets.
        const labelTrimmed = (f.label || "").trim();
        if (!labelTrimmed && (f.color === "yellow" || f.color === "red" || f.color === "green")) continue;
        const key = `${f.color}|${labelTrimmed}`;
        if (!seen.has(key)) seen.set(key, { color: f.color, label: labelTrimmed });
      }
    }
    return Array.from(seen.values());
  }, [assets]);
  const[filters,setFilters]=useState<Filters>({vertical:[],assetType:[]});
  const[openFilter,setOpenFilter]=useState<string|null>(null);
  const[search,setSearch]=useState("");
  const[route,setRoute]=useState<Route>({page:"home",id:null});
  const[toast,setToast]=useState<string|null>(null);

  // Admin mode + nav
  const isAdmin = org?.role === "admin";
  const[adminMode,setAdminMode]=useState(true); // whether admin is viewing admin UI vs preview as sales
  const[adminSection,setAdminSection]=useState<string|null>(null); // assets | import | null (collapsed)
  // Admins (in admin mode) always see archived assets greyed out inline.
  // No toggle needed — library is one source of truth.
  const[viewMode,setViewMode]=useState<"grid"|"list">("list"); // admin-only; sales/public always see grid
  // Featured quotes powering the hero rotator. Fetched on mount and
  // refreshed after any save that could change the featured set
  // (asset edit, standalone quote create, rotation curation).
  const[featuredQuotes,setFeaturedQuotes]=useState<FeaturedQuote[]>([]);

  // ── Grid/list drag-reorder state ─────────────────────────────────
  // No visible drag handle — admins discover by clicking + holding any
  // card. On drop, we persist new positions via /api/assets/reorder
  // and force-switch sort to "custom" so the new order is preserved.
  type CardDrag = {
    assetId: string;
    fromIdx: number;
    pointerX: number;
    pointerY: number;
    initialX: number;
    initialY: number;
    width: number;
    height: number;
    rects: DOMRect[];      // rects of all visible cards at drag start
    insertIdx: number;     // current target index
  };
  const [cardDrag, setCardDrag] = React.useState<CardDrag | null>(null);
  const cardDragRef = React.useRef<CardDrag | null>(null);
  React.useEffect(() => { cardDragRef.current = cardDrag; }, [cardDrag]);
  const cardElsRef = React.useRef<Map<string, HTMLDivElement>>(new Map());
  // Suppress card click for ~150ms after a drop so the pointer-up
  // doesn't navigate to the asset detail.
  const cardDragJustEnded = React.useRef(false);

  // ── Rotator drag state ───────────────────────────────────────
  // Admin can drag the featured-quote rotator to a different slot
  // in the grid sequence. Position is "after how many cards" — 3
  // means after the first row of three cards (matches the original
  // hard-coded behaviour). Persisted to localStorage per-admin.
  const [rotatorAfterIdx, setRotatorAfterIdx] = React.useState<number>(() => {
    if (typeof window === "undefined") return 3;
    const raw = window.localStorage.getItem("storymatch.rotatorAfterIdx");
    const n = raw == null ? NaN : parseInt(raw, 10);
    return Number.isFinite(n) && n >= 0 ? n : 3;
  });
  const persistRotatorAfterIdx = React.useCallback((n: number) => {
    setRotatorAfterIdx(n);
    try { window.localStorage.setItem("storymatch.rotatorAfterIdx", String(n)); } catch {}
  }, []);
  type RotatorDrag = {
    pointerX: number;
    pointerY: number;
    initialX: number;
    initialY: number;
    rotatorRect: DOMRect;
    cardRects: DOMRect[];
    insertIdx: number;
  };
  const [rotatorDrag, setRotatorDrag] = React.useState<RotatorDrag | null>(null);
  const rotatorDragRef = React.useRef<RotatorDrag | null>(null);
  React.useEffect(() => { rotatorDragRef.current = rotatorDrag; }, [rotatorDrag]);
  const rotatorElRef = React.useRef<HTMLDivElement | null>(null);

  // Track grid column count so the rotator can only sit at row
  // boundaries (multiples of cols). Without this, the rotator can
  // land mid-row and leave weird empty grid cells next to it.
  const computeGridCols = (): number => {
    if (typeof window === "undefined") return 3;
    if (window.innerWidth <= 680) return 1;
    if (window.innerWidth <= 1100) return 2;
    return 3;
  };
  const [gridCols, setGridCols] = React.useState<number>(computeGridCols);
  React.useEffect(() => {
    const onResize = () => setGridCols(computeGridCols());
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  // Library bar: which dropdown is open (Filter, Sort, or +Add) and the
  // current sort. Null = nothing open.
  type SortBy = "custom" | "recent" | "oldest" | "az" | "za";
  const[sortBy,setSortBy]=useState<SortBy>("recent");
  const[libMenuOpen,setLibMenuOpen]=useState<"filter"|"sort"|"add"|null>(null);
  // Modal state for standalone quote creation. Opened from the
  // "+ Add" → "Standalone quote" menu entry.
  const[standaloneQuoteOpen,setStandaloneQuoteOpen]=useState(false);
  const[rotationPanelOpen,setRotationPanelOpen]=useState(false);
  // Rotation speed in seconds. Persisted to localStorage so it
  // sticks across reloads. 0 = paused. Default 7s matches the
  // design spec.
  const[rotatorIntervalSec,setRotatorIntervalSec]=useState<number>(() => {
    if (typeof window === "undefined") return 7;
    const raw = window.localStorage.getItem("storymatch.rotatorIntervalSec");
    const n = raw == null ? NaN : parseInt(raw, 10);
    return Number.isFinite(n) && n >= 0 && n <= 600 ? n : 7;
  });
  const handleRotatorIntervalChange = useCallback((sec: number) => {
    setRotatorIntervalSec(sec);
    try { window.localStorage.setItem("storymatch.rotatorIntervalSec", String(sec)); } catch {}
  }, []);
  const[selectedIds,setSelectedIds]=useState<Set<string>>(new Set()); // admin-only: multi-select for bulk actions
  const[lastSelectedId,setLastSelectedId]=useState<string|null>(null); // anchor for shift-click range select
  const[editingAssetId,setEditingAssetId]=useState<string|null>(null); // admin-only: open the edit drawer for this asset
  // Visibility-override target — set when admin tries to mark something
  // Public but one or more rules would re-flip it. Modal explains every
  // blocker and offers a single Override button that clears all triggers
  // atomically (so admin doesn't need to override repeatedly).
  const [visOverride, setVisOverride] = useState<{ asset: Asset; ruleKeys: string[] } | null>(null);
  const[sources,setSources]=useState<Source[]>([]); // video sources (showcases, playlists)
  // Org-level Rules. Loaded on mount; refreshed when admin saves in Rules panel.
  const[orgSettings,setOrgSettings]=useState<OrgSettings>({
    freshnessWarnAfterMonths:null,
    freshnessWarnBeforeDate:null,
    defaultApprovalStatus:"unset",
    publicationRules:{},
  });

  // StoryMatch state
  const[smOpen,setSmOpen]=useState(false);
  const[smQuery,setSmQuery]=useState("");
  const[smMode,setSmMode]=useState<"describe"|"prospect">("describe");
  const[smLoading,setSmLoading]=useState(false);
  const[smResults,setSmResults]=useState<AIMatchResult[]|null>(null);

  useEffect(()=>{
    const h=()=>{
      const hash=window.location.hash.slice(1);
      if(hash.startsWith("/asset/"))setRoute({page:"detail",id:hash.split("/asset/")[1]});
      else if(hash.startsWith("/shares"))setRoute({page:"shares",id:null});
      else setRoute({page:"home",id:null});
      // /rules hash opens the Rules panel from anywhere (e.g. the cleared popover's
      // "Configure freshness Rule →" link). Clear the hash after consuming so back
      // navigation doesn't re-trigger.
      if(hash.startsWith("/rules")){
        setAdminSection("rules");
        window.history.replaceState(null, "", window.location.pathname + window.location.search);
      }
    };
    h();window.addEventListener("hashchange",h);return()=>window.removeEventListener("hashchange",h);
  },[]);

  // Load assets from the database on mount
  useEffect(()=>{
    (async()=>{
      try{
        const headers=await authHeaders();
        const r=await fetch("/api/assets",{headers});
        if(!r.ok)throw new Error("Failed");
        const data=await r.json() as Asset[];
        setAssets(data);
      }catch(e){console.error("Failed to load assets",e);}
    })();
  },[]);

  // Load featured quotes for the hero rotator. Refreshable via
  // refreshFeaturedQuotes() after any save that could change the
  // featured set.
  const refreshFeaturedQuotes = useCallback(async () => {
    try {
      const headers = await authHeaders();
      const r = await fetch("/api/quotes?featured=true", { headers });
      if (!r.ok) throw new Error("Failed");
      const data = await r.json() as FeaturedQuote[];
      setFeaturedQuotes(Array.isArray(data) ? data : []);
    } catch (e) {
      console.error("Failed to load featured quotes", e);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { refreshFeaturedQuotes(); }, [refreshFeaturedQuotes]);

  // Load sources from the database on mount
  useEffect(()=>{
    (async()=>{
      try{
        const headers=await authHeaders();
        const r=await fetch("/api/sources",{headers});
        if(!r.ok)throw new Error("Failed");
        const data=await r.json() as Source[];
        setSources(data);
      }catch(e){console.error("Failed to load sources",e);}
    })();
  },[]);

  // Load org Rules settings on mount. Used by computeCleared to flag
  // testimonials whose publish age exceeds the org's freshness threshold.
  useEffect(()=>{
    (async()=>{
      try{
        const headers=await authHeaders();
        const r=await fetch("/api/org/settings",{headers});
        if(!r.ok)return; // Non-fatal — defaults stay in place
        const data=await r.json() as OrgSettings;
        setOrgSettings(data);
      }catch(e){console.error("Failed to load org settings",e);}
    })();
  },[]);

  const openAsset=(a: Asset)=>{window.location.hash=`/asset/${a.id}`;};
  const goHome=()=>{window.location.hash="/";};
  const copyQuote=(t: string)=>{navigator.clipboard?.writeText(t);setToast("Copied!");setTimeout(()=>setToast(null),1800);};

  // Copy a trackable share link for this asset to the clipboard. Each
  // (rep, asset) pair has a stable URL so re-copying returns the same link.
  // Records nothing on copy itself — the click event fires only when the
  // recipient actually opens the link.
  const copyShareLink=async(asset: Asset)=>{
    setToast("Generating link…");
    try {
      const r=await fetch("/api/share",{
        method:"POST",
        headers:{"Content-Type":"application/json",...(await authHeaders())},
        body:JSON.stringify({asset_id:asset.id}),
      });
      if(!r.ok)throw new Error("Failed");
      const {url}=await r.json() as {url: string; share_id: string};
      await navigator.clipboard?.writeText(url);
      setToast("Link copied!");
    } catch(e) {
      console.error("Share link failed",e);
      setToast("Couldn't generate link");
    }
    setTimeout(()=>setToast(null),1800);
  };

  // Generic partial-update helper for inline edits in the list view.
  // Optimistically merges into local state, then PUTs to /api/assets.
  // Used by status flips, client_status changes, and mark-verified.
  const updateAssetInline=async(id: string, patch: Partial<Asset>, toastMsg?: string)=>{
    // Propagate inline edits to multi-selection: when the user changes an
    // inline status field on a row that's part of a selection, apply to all
    // selected assets. Standalone clicks (no selection, or clicking a row
    // not in selection) keep single-asset behavior. Custom flag edits are
    // excluded — flags are per-asset arrays and replicating one asset's
    // array to others would clobber their own flags.
    const isPropagatable = !("customFlags" in patch);
    const ids = (isPropagatable && selectedIds.size > 1 && selectedIds.has(id)) ? Array.from(selectedIds) : [id];
    const isBulk = ids.length > 1;
    setAssets(prev=>prev.map(a=>ids.includes(a.id)?{...a,...patch}:a));
    if(toastMsg){
      const msg = isBulk ? `${toastMsg} · applied to ${ids.length}` : toastMsg;
      setToast(msg);
      setTimeout(()=>setToast(null),1500);
    }
    // Sequentially write each — keeps things simple and matches bulk actions.
    for(const targetId of ids){
      try{
        const r=await fetch("/api/assets",{
          method:"PUT",
          headers:{"Content-Type":"application/json",...(await authHeaders())},
          body:JSON.stringify({id:targetId,...patch}),
        });
        // Merge server response back into state — picks up any fields that
        // the server stamped but the client didn't include in the patch.
        if(r.ok){
          try{
            const updated=await r.json() as Asset;
            setAssets(prev=>prev.map(a=>a.id===targetId?{...a,...updated}:a));
          }catch{/* response body parse failed — fine, optimistic state is good enough */}
        }
      }catch(e){console.error("Inline update failed",targetId,e);}
    }
  };

  // Restore an archived asset back to active. Clears archived metadata so the
  // asset reappears in normal views and StoryMatch search.
  const restoreAsset=async(asset: Asset)=>{
    await updateAssetInline(asset.id,{status:"published",archivedAt:null,archivedReason:null},"Restored");
  };

  // Mark an asset as verified — bumps last_verified_at to now.
  const markVerified=async(asset: Asset)=>{
    await updateAssetInline(asset.id,{lastVerifiedAt:new Date().toISOString()},"Marked verified");
  };

  // Change client_status (current/former/unknown). Stamps source as 'manual'
  // so a future CRM sync knows this was admin-set and can choose its conflict
  // policy accordingly.
  const setClientStatus=async(asset: Asset, next: "current"|"former"|"unknown")=>{
    await updateAssetInline(asset.id,{
      clientStatus:next,
      clientStatusSource:"manual",
      clientStatusUpdatedAt:new Date().toISOString(),
    },next==="current"?"Marked current":next==="former"?"Marked former":"Marked unknown");
  };

  // Update approval status and/or note. Records timestamp so we can show
  // "approved on April 12" in the cleared popover.
  const setApproval=async(asset: Asset, patch: { status?: ApprovalStatus; note?: string })=>{
    const update: Partial<Asset> = {};
    if(patch.status!==undefined){
      update.approvalStatus=patch.status;
      // Reverting to "Not recorded" should clear the timestamp too — otherwise
      // the popover shows "recorded 5m ago" next to a status that says
      // not-recorded, which reads contradictory.
      update.approvalRecordedAt=patch.status==="unset"?null:new Date().toISOString();
    }
    if(patch.note!==undefined) update.approvalNote=patch.note;
    await updateAssetInline(asset.id,update,patch.status?`Approval: ${patch.status}`:"Note saved");
  };

  // Reset all status indicators on an asset (and propagate to selection
  // when multi-select is active). Same semantics as the bulk modal's
  // clearAll: when an org freshness rule is active, sets the never-flag
  // sentinel so the asset doesn't immediately re-fire yellow.
  const resetStatusIndicators=async(asset: Asset)=>{
    const ids=(selectedIds.size>1 && selectedIds.has(asset.id)) ? Array.from(selectedIds) : [asset.id];
    const isBulk=ids.length>1;
    const patch=buildResetStatusPatch(orgSettings, user?.email || "");
    setAssets(prev=>prev.map(a=>ids.includes(a.id)?{...a,...patch}:a));
    setToast(isBulk?`Reset on ${ids.length} assets`:"Status indicators reset");
    setTimeout(()=>setToast(null),1800);
    for(const id of ids){
      try{
        await fetch("/api/assets",{
          method:"PUT",
          headers:{"Content-Type":"application/json",...(await authHeaders())},
          body:JSON.stringify({id,...patch}),
        });
      }catch(e){console.error("Reset failed for",id,e);}
    }
  };

  // Set or clear a per-asset freshness exception. The server stamps
  // set_by_email and set_at automatically from the auth context — we just
  // need to send the until value (null clears the exception).
  const setFreshnessException=async(asset: Asset, untilIso: string | null)=>{
    const toast = untilIso === null ? "Exception cleared" : "Exception set";
    await updateAssetInline(asset.id, {
      freshnessExceptionUntil: untilIso,
      // Optimistically clear set_by_email/set_at when clearing; server will
      // also clear them. When setting, server overwrites with auth context.
      ...(untilIso === null ? { freshnessExceptionSetByEmail: null, freshnessExceptionSetAt: null } : {}),
    }, toast);
  };

  // Replace the asset's custom flags array. Stamps setByEmail with the
  // current user's email for any flags that were just added (id-based diff).
  const setCustomFlags=async(asset: Asset, flags: CustomFlag[])=>{
    const stampedFlags: CustomFlag[] = flags.map(f => {
      // If flag has no setByEmail yet (just-added by this client), fill it.
      if (!f.setByEmail && user?.email) {
        return { ...f, setByEmail: user.email };
      }
      return f;
    });
    await updateAssetInline(asset.id, { customFlags: stampedFlags }, "Flags updated");
  };

  // Change publication status (published / draft / archived) inline.
  const setPublicationStatus=async(asset: Asset, next: "published"|"draft"|"archived")=>{
    // Intercept Public when one or more rules would immediately re-flip
    // the change. Rules only fire on Public assets, so this guard is
    // unnecessary for Private/Archive transitions.
    if (next === "published") {
      const ruleKeys = findActiveRulesFE(asset, orgSettings);
      if (ruleKeys.length > 0) {
        setVisOverride({ asset, ruleKeys });
        return; // Modal owns the next step — admin can override or cancel.
      }
    }
    if(next==="archived"){
      const today=new Date().toISOString().split("T")[0];
      await updateAssetInline(asset.id,{
        status:"archived",
        archivedAt:new Date().toISOString(),
        archivedReason:`Manually archived on ${today}`,
      },"Archived");
    } else {
      // Moving to published or draft — clear archive metadata if previously archived
      await updateAssetInline(asset.id,{
        status:next,
        archivedAt:null,
        archivedReason:null,
      },next==="published"?"Made public":"Made private");
    }
  };

  // Override handler — neutralizes EVERY rule that's currently firing on
  // the override-target asset, then completes the original "make Public"
  // intent in one atomic update. Per-rule fix:
  //   • expiration       → set freshness exception to a "never" sentinel
  //   • approval_denied  → set approval back to approved
  // Sending all fixes in a single PUT means the server's rule engine sees
  // the post-override state on its next pass and finds nothing to fire.
  const overrideAndPublish = async () => {
    if (!visOverride) return;
    const { asset, ruleKeys } = visOverride;
    const patch: Partial<Asset> = {
      status: "published",
      archivedAt: null,
      archivedReason: null,
    };
    for (const key of ruleKeys) {
      if (key === "expiration") {
        const neverIso = (() => {
          const d = new Date();
          d.setFullYear(d.getFullYear() + 100);
          return d.toISOString();
        })();
        patch.freshnessExceptionUntil = neverIso;
      } else if (key === "approval_denied") {
        patch.approvalStatus = "approved";
        patch.approvalRecordedAt = new Date().toISOString();
      }
      // Unknown rule keys: no per-rule fix; we'll still attempt the publish
      // and rely on the server to log if its engine re-flips.
    }
    try {
      await updateAssetInline(asset.id, patch, "Override applied");
    } catch (e) {
      console.error("override failed", e);
    }
    setVisOverride(null);
  };

  // Save the full asset edit form. Mirrors what the old AssetsPanel did:
  // optimistic state update, persist via PUT, then re-embed in background so
  // semantic StoryMatch search reflects the new content.
  const saveAssetEdit=async(updated: Asset)=>{
    setAssets(prev=>prev.map(a=>a.id===updated.id?updated:a));
    setToast("Saving…");
    try{
      const r=await fetch("/api/assets",{
        method:"PUT",
        headers:{"Content-Type":"application/json",...(await authHeaders())},
        body:JSON.stringify(updated),
      });
      if(!r.ok)throw new Error("Save failed");
      setToast("Saved");
      reembedAsset(updated.id);
      // The save may have toggled a Feature flag on a quote inside
      // this asset. Refresh the rotator's data so the change shows
      // up immediately.
      refreshFeaturedQuotes();
    }catch(e){
      console.error("Asset save failed",e);
      setToast("Save failed");
    }
    setTimeout(()=>setToast(null),1500);
    // The AssetEditPanel handles its own close (saveAndClose). Don't
    // force-close here or the panel disappears mid-edit on every save.
  };

  // Soft-delete an asset by flipping status to "deleted". Used by per-row
  // 3-dot menu and bulk bar. We keep the row in the DB so:
  //   • All enrichment (embeddings, transcript, manual edits) is preserved
  //   • If the underlying Vimeo video is still in the showcase, the next
  //     sync can detect this and offer to "resync this previously-deleted
  //     asset from Vimeo" rather than silently re-importing it.
  // The displayAssets filter hides status="deleted" from every view, so
  // visually it's the same as a hard delete from the user's perspective.
  const deleteAssetInline=async(id: string)=>{
    // If the asset's source is a single-video (vm-video) source, deleting
    // the asset means the source has nothing to track — remove the whole
    // source row, which cascades a hard-delete of this asset. (Showcase
    // sources keep the soft-delete behavior so a future sync can offer to
    // restore the asset via the "previously deleted, still in Vimeo" flow.)
    const asset=assets.find(a=>a.id===id);
    const source=asset?.sourceId?sources.find(s=>s.id===asset.sourceId):null;
    if(source && source.type==="vm-video"){
      setAssets(prev=>prev.filter(a=>a.id!==id));
      setSources(prev=>prev.filter(s=>s.id!==source.id));
      try{
        await fetch(`/api/sources?id=${encodeURIComponent(source.id)}`,{
          method:"DELETE",
          headers:await authHeaders(),
        });
      }catch(e){console.error("Single-video source delete failed",e);}
      return;
    }
    // Soft-delete for everything else (showcase-attached or standalone assets)
    setAssets(prev=>prev.map(a=>a.id===id?{...a,status:"deleted"}:a));
    try{
      await fetch("/api/assets",{
        method:"PUT",
        headers:{"Content-Type":"application/json",...(await authHeaders())},
        body:JSON.stringify({id,status:"deleted"}),
      });
    }catch(e){console.error("Soft-delete failed",e);}
  };

  // ── MULTI-SELECT HELPERS ──
  // toggleSelected is shift-aware: with shift held, it selects the range between
  // the last-selected anchor and the current id (using the currently-displayed
  // asset order). Without shift, it just toggles the single id.
  const toggleSelected=(id: string, shiftKey: boolean = false)=>{
    if(shiftKey && lastSelectedId && lastSelectedId !== id){
      const ids=displayAssets.map(a=>a.id);
      const a=ids.indexOf(lastSelectedId);
      const b=ids.indexOf(id);
      if(a>=0 && b>=0){
        const [lo,hi]=a<b?[a,b]:[b,a];
        const range=ids.slice(lo,hi+1);
        setSelectedIds(prev=>{
          const next=new Set(prev);
          range.forEach(x=>next.add(x));
          return next;
        });
        setLastSelectedId(id);
        return;
      }
    }
    setSelectedIds(prev=>{
      const next=new Set(prev);
      if(next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
    setLastSelectedId(id);
  };
  const clearSelection=()=>{setSelectedIds(new Set());setLastSelectedId(null);};
  // Select-all: toggles all currently-displayed assets in/out of the selection.
  const toggleSelectAll=()=>{
    const allIds=displayAssets.map(a=>a.id);
    const allSelected=allIds.length>0 && allIds.every(id=>selectedIds.has(id));
    if(allSelected){
      setSelectedIds(prev=>{
        const next=new Set(prev);
        allIds.forEach(id=>next.delete(id));
        return next;
      });
    } else {
      setSelectedIds(prev=>{
        const next=new Set(prev);
        allIds.forEach(id=>next.add(id));
        return next;
      });
    }
  };

  // ── BULK ACTIONS ──
  // All bulk actions iterate the current selection, apply, then clear the selection.
  const bulkSetPublication=async(next: "published"|"draft"|"archived")=>{
    const ids=Array.from(selectedIds);
    if(next==="archived"){
      const today=new Date().toISOString().split("T")[0];
      const patch={status:"archived" as const,archivedAt:new Date().toISOString(),archivedReason:`Manually archived on ${today}`};
      setAssets(prev=>prev.map(a=>ids.includes(a.id)?{...a,...patch}:a));
    } else {
      const patch={status:next,archivedAt:null,archivedReason:null};
      setAssets(prev=>prev.map(a=>ids.includes(a.id)?{...a,...patch}:a));
    }
    setToast(`${ids.length} → ${next}`);setTimeout(()=>setToast(null),1800);
    for(const id of ids){
      try{
        const patch=next==="archived"
          ?{id,status:"archived",archivedAt:new Date().toISOString(),archivedReason:"Bulk archive"}
          :{id,status:next,archivedAt:null,archivedReason:null};
        await fetch("/api/assets",{method:"PUT",headers:{"Content-Type":"application/json",...(await authHeaders())},body:JSON.stringify(patch)});
      }catch(e){console.error(e);}
    }
    clearSelection();
  };
  // Bulk-apply a status patch from the BulkStatusModal. Each field in the
  // patch is optional; we only touch the fields the admin set in the modal.
  // Sequential PUTs to keep the writes simple and avoid hammering Supabase
  // when admins select 50+ rows.
  const bulkApplyStatus=async(patch: BulkStatusPatch)=>{
    const ids=Array.from(selectedIds);
    if(ids.length===0)return;
    const nowIso=new Date().toISOString();
    // Build the single-asset shape that updateAssetInline expects, plus
    // any client-side derived bits (e.g. archivedAt for publication=archived).
    const buildAssetPatch=(a: Asset): Partial<Asset> => {
      // Clear-all action wipes every status indicator field back to default.
      // Shared with the per-asset Reset button via buildResetStatusPatch
      // so the two paths stay consistent. Publication is intentionally
      // untouched — admin can change it via the publication dropdown.
      if(patch.clearAll){
        return buildResetStatusPatch(orgSettings, user?.email || "");
      }
      const p: Partial<Asset> = {};
      if(patch.publication){
        p.status=patch.publication;
        if(patch.publication==="archived"){
          p.archivedAt=nowIso;
          p.archivedReason="Bulk archive";
        } else {
          p.archivedAt=null;
          p.archivedReason=null;
        }
      }
      if(patch.approval){
        p.approvalStatus=patch.approval;
        // Reverting to Not recorded clears the timestamp; otherwise stamp now.
        p.approvalRecordedAt=patch.approval==="unset"?null:nowIso;
      }
      if(patch.client){
        p.clientStatus=patch.client;
        p.clientStatusSource="manual";
        p.clientStatusUpdatedAt=nowIso;
      }
      // freshnessExpiration: ISO string (set or never-sentinel) → write date.
      // null → clear per-asset rule. undefined → leave unchanged.
      if(patch.freshnessExpiration!==undefined && patch.freshnessExpiration!=="leave"){
        const val=patch.freshnessExpiration;
        p.freshnessExceptionUntil=val;
        if(val===null){
          p.freshnessExceptionSetByEmail=null;
          p.freshnessExceptionSetAt=null;
        }
      }
      if(patch.addFlag){
        const existing=Array.isArray(a.customFlags)?a.customFlags:[];
        const next: CustomFlag[]=[
          ...existing,
          {
            id:`cf-${Date.now()}-${Math.random().toString(36).slice(2,7)}`,
            label:patch.addFlag.label,
            color:patch.addFlag.color,
            note:"",
            setByEmail:user?.email||"",
            setAt:nowIso,
          },
        ];
        p.customFlags=next;
      }
      return p;
    };
    // Optimistic state update
    setAssets(prev=>prev.map(a=>ids.includes(a.id)?{...a,...buildAssetPatch(a)}:a));
    setToast(`Updating ${ids.length} ${ids.length===1?"asset":"assets"}…`);
    let okCount=0;
    for(const id of ids){
      const asset=assets.find(a=>a.id===id);
      if(!asset)continue;
      const p=buildAssetPatch(asset);
      try{
        const r=await fetch("/api/assets",{
          method:"PUT",
          headers:{"Content-Type":"application/json",...(await authHeaders())},
          body:JSON.stringify({id,...p}),
        });
        if(r.ok)okCount++;
      }catch(e){console.error("Bulk apply failed for",id,e);}
    }
    setToast(`Updated ${okCount} ${okCount===1?"asset":"assets"}`);
    setTimeout(()=>setToast(null),2000);
    clearSelection();
  };

  const bulkMarkVerified=async()=>{
    const ids=Array.from(selectedIds);
    const nowIso=new Date().toISOString();
    setAssets(prev=>prev.map(a=>ids.includes(a.id)?{...a,lastVerifiedAt:nowIso}:a));
    setToast(`${ids.length} marked verified`);setTimeout(()=>setToast(null),1800);
    for(const id of ids){
      try{await fetch("/api/assets",{method:"PUT",headers:{"Content-Type":"application/json",...(await authHeaders())},body:JSON.stringify({id,lastVerifiedAt:nowIso})});}catch(e){console.error(e);}
    }
    clearSelection();
  };
  const bulkDelete=async()=>{
    const ids=Array.from(selectedIds);
    if(!confirm(`Delete ${ids.length} ${ids.length===1?"asset":"assets"}? Showcase-imported assets are hidden from view but kept so a future sync can offer to restore them. Single-video imports are removed entirely along with their source.`))return;
    // Partition selected assets: single-video-source ones get hard-deleted
    // along with their source row; everything else gets soft-deleted.
    const singleVideoSourceIds=new Set<string>();
    const softDeleteIds: string[] = [];
    for(const id of ids){
      const asset=assets.find(a=>a.id===id);
      const source=asset?.sourceId?sources.find(s=>s.id===asset.sourceId):null;
      if(source && source.type==="vm-video") singleVideoSourceIds.add(source.id);
      else softDeleteIds.push(id);
    }
    // Optimistic UI: drop hard-deleted assets entirely; mark soft-deleted as such
    setAssets(prev=>prev
      .filter(a=>!(a.sourceId && singleVideoSourceIds.has(a.sourceId)))
      .map(a=>softDeleteIds.includes(a.id)?{...a,status:"deleted"}:a));
    setSources(prev=>prev.filter(s=>!singleVideoSourceIds.has(s.id)));
    setToast(`${ids.length} deleted`);setTimeout(()=>setToast(null),1800);
    // Issue server requests
    for(const sourceId of singleVideoSourceIds){
      try{
        await fetch(`/api/sources?id=${encodeURIComponent(sourceId)}`,{method:"DELETE",headers:await authHeaders()});
      }catch(e){console.error("Single-video source delete failed",e);}
    }
    for(const id of softDeleteIds){
      try{
        await fetch("/api/assets",{method:"PUT",headers:{"Content-Type":"application/json",...(await authHeaders())},body:JSON.stringify({id,status:"deleted"})});
      }catch(e){console.error(e);}
    }
    clearSelection();
  };

  const runStoryMatch=useCallback(async(query: string)=>{
    if(!query.trim())return;
    setSmLoading(true);setSmResults(null);
    try{
      const r=await fetch("/api/storymatch",{
        method:"POST",
        headers:{"Content-Type":"application/json",...(await authHeaders())},
        body:JSON.stringify({query}),
      });
      if(!r.ok){
        const body=await r.json().catch(()=>({error:`HTTP ${r.status}`}));
        console.error("StoryMatch failed:",body);
        setToast(body.error||"StoryMatch failed");
        setTimeout(()=>setToast(null),3000);
        setSmResults([]);setSmOpen(false);setSmLoading(false);
        return;
      }
      const data=await r.json() as {matches:AIMatchResult[];candidatesFound:number;note?:string};
      if(data.note)setToast(data.note);
      else if(data.candidatesFound===0)setToast("No matches found");
      setTimeout(()=>setToast(null),3000);
      setSmResults(data.matches||[]);
      setSmOpen(false);
    }catch(e){
      console.error(e);
      setSmResults([]);setSmOpen(false);
    }
    setSmLoading(false);
  },[]);

  const clearSm=()=>{setSmResults(null);setSmQuery("");};

  const descEx=["Quotes from clients with under 500 employees","Video testimonials mentioning ROI","Healthcare or financial services case studies","Legacy system migration stories","Strongest proof for enterprise buyers","Southeast clients on implementation speed"];
  const prosEx=["Series B fintech, 120 emp, selling to CFO on onboarding speed","Regional hospital, Southeast, CTO modernizing patient experience","Mid-market manufacturer, Ohio, VP Ops worried about QC"];

  // Whether to include archived assets in this view. Admins viewing the admin
  // UI can opt in via the "Show archived" toggle. Sales reps and the public
  // preview always exclude them — archived means "this testimonial should
  // not be presented to prospects right now".
  // Admins in admin mode see ALL statuses (published, draft, archived) — non-
  // published ones render greyed-out inline with a status badge. Sales reps
  // and admins-previewing-public only see published assets; drafts and
  // archived are hidden entirely.
  const showAllStatuses = isAdmin && adminMode;

  // Determine what to show in the grid
  let displayAssets: Asset[];
  const aiDataMap: Record<string, AIMatchResult> = {};
  if(smResults&&smResults.length>0){
    const matchedIds=smResults.map(r=>r.id);
    displayAssets=matchedIds
      .map(id=>assets.find(a=>a.id===id))
      .filter((a): a is Asset => a !== undefined)
      .filter(a => a.status !== "deleted")
      .filter(a => showAllStatuses || a.status === "published");
    smResults.forEach(r=>{aiDataMap[r.id]=r;});
  } else {
    displayAssets=assets.filter(a=>{
      if(a.status === "deleted") return false; // soft-deleted: hidden everywhere
      if(!showAllStatuses && a.status !== "published") return false;
      if(filters.vertical.length>0&&!filters.vertical.includes(a.vertical))return false;
      if(filters.assetType.length>0&&!filters.assetType.includes(a.assetType))return false;
      if(search){const s=search.toLowerCase();if(!(a.company||"").toLowerCase().includes(s)&&!(a.clientName||"").toLowerCase().includes(s)&&!(a.vertical||"").toLowerCase().includes(s)&&!(a.headline||"").toLowerCase().includes(s))return false;}
      return true;
    });
  }
  const anyFilter=filters.vertical.length>0||filters.assetType.length>0;

  // ── Card drag handlers ──────────────────────────────────────────
  // Computes which card index the pointer is currently over by
  // measuring distance to each card's centre. Works for both 1D list
  // and 2D grid layouts.
  const computeCardInsertIdx = React.useCallback((rects: DOMRect[], px: number, py: number, fromIdx: number): number => {
    let best = fromIdx;
    let bestDist = Infinity;
    for (let i = 0; i < rects.length; i++) {
      const r = rects[i];
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      const dx = px - cx;
      const dy = py - cy;
      const d = dx * dx + dy * dy;
      if (d < bestDist) { bestDist = d; best = i; }
    }
    return best;
  }, []);

  // Pointer-down on a visible card. Captures rects + lifts to the
  // active drag pipeline IMMEDIATELY — a small in-place click
  // without movement is treated as a no-op when pointerup fires
  // (no reorder if insertIdx === fromIdx, and the card click handler
  // gets suppressed by cardDragJustEnded only when there was a real
  // drop). One synchronous step, no threshold dance.
  const onCardPointerDown = (assetId: string, fromIdx: number) => (e: React.PointerEvent) => {
    if (!isAdmin || !adminMode) return;
    if (e.button !== 0) return;
    // Don't fight with interactive children (checkbox, action buttons,
    // dot menus, etc.). The card body is draggable; chrome is not.
    const target = e.target as HTMLElement;
    if (target.closest("input,button,a,textarea,select,.card-check,.card-share,.card-dots")) return;
    e.preventDefault();
    const rects = Array.from(cardElsRef.current.values()).map(el => el.getBoundingClientRect());
    const fromRect = rects[fromIdx] || new DOMRect();
    setCardDrag({
      assetId,
      fromIdx,
      pointerX: e.clientX,
      pointerY: e.clientY,
      initialX: e.clientX,
      initialY: e.clientY,
      width: fromRect.width,
      height: fromRect.height,
      rects,
      insertIdx: fromIdx,
    });
  };

  // While a card-drag is active, track the pointer + recompute the
  // insert index. On pointerup, commit the new order.
  React.useEffect(() => {
    if (!cardDrag) return;
    // Auto-scroll while pointer near top/bottom of viewport. Runs
    // on a 16ms tick so it stays smooth without flooring CPU.
    let lastPointerY = cardDrag.pointerY;
    const AUTOSCROLL_ZONE = 100;
    const AUTOSCROLL_MAX = 14; // px per tick at the edge
    const scrollTimer = window.setInterval(() => {
      const vh = window.innerHeight;
      let dy = 0;
      if (lastPointerY < AUTOSCROLL_ZONE) {
        const intensity = (AUTOSCROLL_ZONE - lastPointerY) / AUTOSCROLL_ZONE;
        dy = -AUTOSCROLL_MAX * intensity;
      } else if (lastPointerY > vh - AUTOSCROLL_ZONE) {
        const intensity = (lastPointerY - (vh - AUTOSCROLL_ZONE)) / AUTOSCROLL_ZONE;
        dy = AUTOSCROLL_MAX * intensity;
      }
      if (dy !== 0) window.scrollBy(0, dy);
    }, 16);
    const onMove = (e: PointerEvent) => {
      const cur = cardDragRef.current;
      if (!cur) return;
      lastPointerY = e.clientY;
      // Refresh rects on every move — captures live viewport
      // positions even if the user has scrolled (or auto-scroll
      // has scrolled for them) since drag start.
      const freshRects = Array.from(cardElsRef.current.values()).map(el => el.getBoundingClientRect());
      const insertIdx = computeCardInsertIdx(freshRects, e.clientX, e.clientY, cur.fromIdx);
      setCardDrag({ ...cur, pointerX: e.clientX, pointerY: e.clientY, insertIdx, rects: freshRects });
    };
    const onUp = () => {
      const cur = cardDragRef.current;
      setCardDrag(null);
      if (!cur) return;
      // Only suppress the upcoming click + perform reorder when the
      // pointer actually moved AND landed on a different slot. A
      // simple in-place click should still navigate to the asset.
      if (cur.insertIdx === cur.fromIdx) return;
      cardDragJustEnded.current = true;
      setTimeout(() => { cardDragJustEnded.current = false; }, 200);
      const visibleIds = Array.from(cardElsRef.current.keys());
      const next = [...visibleIds];
      const [moved] = next.splice(cur.fromIdx, 1);
      next.splice(cur.insertIdx, 0, moved);
      // Force the sort to "custom" so the new order is what shows.
      setSortBy("custom");
      void persistCardReorder(next);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.clearInterval(scrollTimer);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cardDrag?.assetId]);

  // ── Rotator drag handlers ──────────────────────────────────────
  // Pointer down on the rotator's bounding box → capture all card
  // rects (so we can compute drop targets relative to them) and the
  // rotator's own rect (for the floating clone).
  const onRotatorPointerDown = (e: React.PointerEvent) => {
    if (!isAdmin || !adminMode) return;
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    // Pagination tiles, CTA, "Manage rotation" button — all interactive
    // children. Don't start a drag from them.
    if (target.closest("button,a,input,select,textarea")) return;
    if (!rotatorElRef.current) return;
    e.preventDefault();
    const cardRects = Array.from(cardElsRef.current.values()).map(el => el.getBoundingClientRect());
    setRotatorDrag({
      pointerX: e.clientX,
      pointerY: e.clientY,
      initialX: e.clientX,
      initialY: e.clientY,
      rotatorRect: rotatorElRef.current.getBoundingClientRect(),
      cardRects,
      insertIdx: rotatorAfterIdx,
    });
  };

  React.useEffect(() => {
    if (!rotatorDrag) return;
    // Auto-scroll near viewport edges, same pattern as card drag.
    let lastY = rotatorDrag.pointerY;
    const ZONE = 100, MAX = 14;
    const scrollTimer = window.setInterval(() => {
      const vh = window.innerHeight;
      let dy = 0;
      if (lastY < ZONE) dy = -MAX * (ZONE - lastY) / ZONE;
      else if (lastY > vh - ZONE) dy = MAX * (lastY - (vh - ZONE)) / ZONE;
      if (dy !== 0) window.scrollBy(0, dy);
    }, 16);
    const onMove = (e: PointerEvent) => {
      lastY = e.clientY;
      const cur = rotatorDragRef.current;
      if (!cur) return;
      // Refresh card rects every move so scroll doesn't break the
      // drop maths.
      const fresh = Array.from(cardElsRef.current.values()).map(el => el.getBoundingClientRect());
      // Find the card whose vertical centre is closest to the
      // pointer; if pointer is above the centre, rotator lands
      // BEFORE it (so insertIdx = i). Otherwise AFTER (insertIdx = i+1).
      let insertIdx = fresh.length;
      let bestDist = Infinity;
      for (let i = 0; i < fresh.length; i++) {
        const r = fresh[i];
        const cy = r.top + r.height / 2;
        const d = Math.abs(e.clientY - cy);
        if (d < bestDist) { bestDist = d; insertIdx = e.clientY < cy ? i : i + 1; }
      }
      // Snap to a row boundary. The rotator is full-width and can
      // only sit between complete rows of cards.
      insertIdx = Math.round(insertIdx / gridCols) * gridCols;
      insertIdx = Math.max(0, Math.min(insertIdx, fresh.length));
      setRotatorDrag({ ...cur, pointerX: e.clientX, pointerY: e.clientY, insertIdx, cardRects: fresh });
    };
    const onUp = () => {
      const cur = rotatorDragRef.current;
      setRotatorDrag(null);
      if (!cur) return;
      if (cur.insertIdx !== rotatorAfterIdx) {
        persistRotatorAfterIdx(cur.insertIdx);
      }
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.clearInterval(scrollTimer);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rotatorDrag?.initialY]);

  // Persist new positions after drop. Optimistically updates local
  // assets state, fires the bulk PATCH, and falls back if the
  // request fails.
  const persistCardReorder = React.useCallback(async (newOrderIds: string[]) => {
    // Build {id, position} pairs only for the visible subset — other
    // assets keep their existing displayOrder (or null).
    const positions = newOrderIds.map((id, idx) => ({ id, position: idx }));
    // Optimistic local update.
    setAssets(prev => prev.map(a => {
      const pos = newOrderIds.indexOf(a.id);
      if (pos < 0) return a;
      return { ...a, displayOrder: pos };
    }));
    try {
      const headers: HeadersInit = { "Content-Type": "application/json" };
      const auth = await authHeaders();
      Object.assign(headers as Record<string, string>, auth);
      const r = await fetch("/api/assets/reorder", {
        method: "POST",
        headers,
        body: JSON.stringify({ positions }),
      });
      if (!r.ok && r.status !== 207) {
        const e = await r.json().catch(() => ({}));
        throw new Error(e?.error || `Reorder failed (${r.status})`);
      }
    } catch (e) {
      console.error("[card reorder] persist failed:", e);
      setToast("Reorder didn't save");
      setTimeout(() => setToast(null), 1800);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Apply sort (skip when StoryMatch is showing AI-ranked results; their
  // order is the relevance ranking and shouldn't be reshuffled).
  if (!smResults) {
    const cmpDate = (a: Asset, b: Asset) => {
      const da = new Date(a.dateCreated || 0).getTime();
      const db = new Date(b.dateCreated || 0).getTime();
      return db - da;
    };
    const cmpHeadline = (a: Asset, b: Asset) =>
      (a.headline || "").localeCompare(b.headline || "", undefined, { sensitivity: "base" });
    // Custom sort: use admin-set displayOrder; nulls (never reordered)
    // sort to the end and tie-break on date_created desc.
    const cmpCustom = (a: Asset, b: Asset) => {
      const ao = a.displayOrder, bo = b.displayOrder;
      if (ao == null && bo == null) return cmpDate(a, b);
      if (ao == null) return 1;
      if (bo == null) return -1;
      return ao - bo;
    };
    if (sortBy === "custom") displayAssets = [...displayAssets].sort(cmpCustom);
    else if (sortBy === "recent") displayAssets = [...displayAssets].sort(cmpDate);
    else if (sortBy === "oldest") displayAssets = [...displayAssets].sort((a, b) => -cmpDate(a, b));
    else if (sortBy === "az") displayAssets = [...displayAssets].sort(cmpHeadline);
    else if (sortBy === "za") displayAssets = [...displayAssets].sort((a, b) => -cmpHeadline(a, b));
  }
  const detailAsset=route.page==="detail"?assets.find(a=>a.id===route.id)||null:null;

  if(route.page==="detail"){
    return(<React.Fragment><style>{css}</style><div style={{minHeight:"100vh",background:"var(--bg)"}}>
      <header className="hdr"><div className="logo" onClick={goHome} style={{cursor:"pointer",fontFamily:"var(--serif)",fontSize:20,fontWeight:500,letterSpacing:-.4,color:"var(--t1)"}}></div><div className="hdr-r"><span className="badge">{assets.length} assets</span></div></header>
      {detailAsset && <AssetDetail
        asset={detailAsset}
        onBack={goHome}
        allAssets={assets}
        onSelect={(id)=>{const a=assets.find(x=>x.id===id);if(a)openAsset(a);}}
        // Share button is for internal use (admins in admin mode, or sales reps).
        // Hidden in the admin's "Public" preview because that simulates what an
        // external customer sees, and customers don't share testimonials.
        onCopyShareLink={((isAdmin && adminMode) || org?.role === "sales") ? (a)=>copyShareLink(a as Asset) : undefined}
      />}
    </div></React.Fragment>);
  }

  if(route.page==="shares"){
    return(<React.Fragment><style>{css}</style><div style={{minHeight:"100vh",background:"var(--bg)"}}>
      <header className="hdr"><div className="logo" onClick={goHome} style={{cursor:"pointer",fontFamily:"var(--serif)",fontSize:20,fontWeight:500,letterSpacing:-.4,color:"var(--t1)"}}></div><div className="hdr-r"><span className="badge">{assets.length} assets</span></div></header>
      <MySharesView authHeaders={authHeaders} onBack={goHome}/>
    </div></React.Fragment>);
  }

  return (
    <React.Fragment>
      <style>{css}</style>
      <div style={{minHeight:"100vh",background:"var(--bg)"}}>

        <header className="hdr">
          <div className="logo" onClick={goHome} style={{cursor:"pointer",fontFamily:"var(--serif)",fontSize:20,fontWeight:500,letterSpacing:-.4,color:"var(--t1)"}}>
          </div>
          <div className="hdr-r">
            {/* Count badge moved to the library control bar above the content.
                Show-archived toggle removed — admins always see archived assets
                inline (greyed out) so the library is one source of truth. */}
            {isAdmin && (
              <div className="mode-toggle">
                <button
                  className={`mode-btn ${adminMode?"on":""}`}
                  onClick={()=>setAdminMode(true)}
                  title="Admin view: manage assets and use StoryMatch"
                >Admin</button>
                <button
                  className={`mode-btn ${!adminMode?"on":""}`}
                  onClick={()=>setAdminMode(false)}
                  title="Public view: what your customers see"
                >Public</button>
              </div>
            )}
            <div style={{display:"flex",alignItems:"center",gap:8,marginLeft:8,paddingLeft:12,borderLeft:"1px solid var(--border)"}}>
              {/* Email/workspace/sign-out moved to AccountMenu in the rail bottom
                  for admins-in-admin-mode. Show the inline header info only when
                  the rail isn't visible (sales reps, or admin previewing public). */}
              {!(isAdmin && adminMode) && (
                <div style={{fontSize:11,color:"var(--t3)",textAlign:"right",lineHeight:1.3}}>
                  <div style={{fontWeight:600,color:"var(--t2)"}}>{user?.email}</div>
                  <div>{org?.name||"No workspace"} · {org?.role||"—"}</div>
                </div>
              )}
              <button
                onClick={()=>{window.location.hash="/shares";}}
                title="See your shared links and engagement"
                style={{padding:"6px 10px",border:"1px solid var(--border)",borderRadius:6,background:"#fff",color:"var(--accent)",fontSize:11,fontWeight:600,cursor:"pointer",fontFamily:"var(--font)",marginRight:6,display:"inline-flex",alignItems:"center",gap:5}}
              >
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
                  <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
                </svg>
                My shares
              </button>
              {!(isAdmin && adminMode) && (
                <button
                  onClick={signOut}
                  title="Sign out"
                  style={{padding:"6px 10px",border:"1px solid var(--border)",borderRadius:6,background:"#fff",color:"var(--t3)",fontSize:11,fontWeight:600,cursor:"pointer",fontFamily:"var(--font)"}}
                >Sign out</button>
              )}
            </div>
          </div>
        </header>

        <div className="layout">

          {isAdmin && adminMode && (
            <aside className="admin-rail">
              <button
                className={`rail-btn ${adminSection==="import"?"on":""}`}
                onClick={()=>setAdminSection(adminSection==="import"?null:"import")}
                title="Import"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                  <polyline points="7 10 12 15 17 10"/>
                  <line x1="12" y1="15" x2="12" y2="3"/>
                </svg>
                Import
              </button>
              <button
                className={`rail-btn ${adminSection==="rules"?"on":""}`}
                onClick={()=>setAdminSection(adminSection==="rules"?null:"rules")}
                title="Rules — automate library behavior"
              >
                {/* Forking diagram (if-then) — represents conditional logic */}
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="6" cy="5" r="2"/>
                  <circle cx="18" cy="5" r="2"/>
                  <circle cx="12" cy="19" r="2"/>
                  <path d="M6 7v3a3 3 0 0 0 3 3h6a3 3 0 0 0 3-3V7"/>
                  <line x1="12" y1="13" x2="12" y2="17"/>
                </svg>
                Rules
              </button>
              <button className="rail-btn disabled" title="Embed (coming soon)">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <polyline points="16 18 22 12 16 6"/>
                  <polyline points="8 6 2 12 8 18"/>
                </svg>
                Embed
                <span className="rail-soon">SOON</span>
              </button>
              <div className="rail-spacer"/>
              <div className="rail-foot">
                <AccountMenu
                  userEmail={user?.email || ""}
                  workspaceName={org?.name || "No workspace"}
                  role={org?.role || ""}
                  isAdmin={isAdmin}
                  onSignOut={signOut}
                  authHeaders={authHeaders}
                />
              </div>
            </aside>
          )}

          {isAdmin && adminMode && adminSection && (
            <aside className="admin-panel">
              {adminSection==="import" && (
                <SourcesPanel
                  sources={sources}
                  assets={assets}
                  onAddSource={async s=>{
                    // Optimistic local update
                    setSources(p=>[s,...p]);
                    try{
                      const r=await fetch("/api/sources",{
                        method:"POST",
                        headers:{"Content-Type":"application/json",...(await authHeaders())},
                        body:JSON.stringify(s)
                      });
                      if(!r.ok)throw new Error("Save source failed");
                    }catch(e){
                      console.error(e);
                      setToast("Couldn't save source");
                      setTimeout(()=>setToast(null),2000);
                    }
                  }}
                  onRemoveSource={async id=>{
                    const src=sources.find(s=>s.id===id);
                    const assetCount=src?.assetIds?.length||0;
                    const msg=assetCount>0
                      ?`Remove this source AND its ${assetCount} imported ${assetCount===1?"asset":"assets"}? This cannot be undone.`
                      :"Remove this source? This cannot be undone.";
                    if(!confirm(msg))return;
                    // Optimistic: remove source and its assets from local state
                    setSources(p=>p.filter(s=>s.id!==id));
                    setAssets(p=>p.filter(a=>a.sourceId!==id));
                    try{
                      const r=await fetch(`/api/sources?id=${id}`,{method:"DELETE",headers:await authHeaders()});
                      if(!r.ok)throw new Error("Delete failed");
                      const body=await r.json().catch(()=>({}));
                      const n=body.assetsDeleted||0;
                      setToast(n>0?`Removed source and ${n} ${n===1?"asset":"assets"}`:"Source removed");
                      setTimeout(()=>setToast(null),2000);
                    }catch(e){
                      console.error(e);
                      setToast("Couldn't remove source");
                      setTimeout(()=>setToast(null),2000);
                    }
                  }}
                  onUpdateSource={async (updates)=>{
                    // Optimistic local merge
                    setSources(prev=>prev.map(s=>s.id===updates.id?{...s,...updates}:s));
                    try{
                      await fetch("/api/sources",{
                        method:"PUT",
                        headers:{"Content-Type":"application/json",...(await authHeaders())},
                        body:JSON.stringify(updates),
                      });
                    }catch(e){console.error("Source update failed",e);}
                  }}
                  onRefresh={async ()=>{
                    // Pull both sources (for pendingSyncReport + last_sync) and assets
                    // (for newly-imported + auto-archived) from the server.
                    try{
                      const [sR, aR] = await Promise.all([
                        fetch("/api/sources",{headers:await authHeaders()}),
                        fetch("/api/assets",{headers:await authHeaders()}),
                      ]);
                      if(sR.ok){const data=await sR.json() as Source[];setSources(data);}
                      if(aR.ok){const data=await aR.json() as Asset[];setAssets(data);}
                    }catch(e){console.error("Refresh failed",e);}
                    setToast("Synced");setTimeout(()=>setToast(null),1500);
                  }}
                  onUpdateAssets={async updates=>{
                    if(updates.length===0)return;
                    // Optimistic UI: merge updates into local state
                    setAssets(prev=>prev.map(a=>{
                      const u=updates.find(x=>x.id===a.id);
                      return u?{...a,...u}:a;
                    }));
                    const archivedCount=updates.filter(u=>u.status==="archived").length;
                    if(archivedCount>0){
                      setToast(`Archived ${archivedCount} ${archivedCount===1?"asset":"assets"} (no longer in source)`);
                      setTimeout(()=>setToast(null),3000);
                    }
                    // Persist each update via PUT /api/assets
                    for(const u of updates){
                      try{
                        await fetch("/api/assets",{
                          method:"PUT",
                          headers:{"Content-Type":"application/json",...(await authHeaders())},
                          body:JSON.stringify(u),
                        });
                      }catch(e){console.error("Asset update failed for",u.id,e);}
                    }
                  }}
                  onAddAssets={async arr=>{
                    // Optimistic UI
                    setAssets(p=>[...arr,...p]);
                    setToast(arr.length>1?`Saving ${arr.length} assets…`:"Saving asset…");
                    try{
                      const r=await fetch("/api/assets",{
                        method:"POST",
                        headers:{"Content-Type":"application/json",...(await authHeaders())},
                        body:JSON.stringify({assets:arr})
                      });
                      if(!r.ok)throw new Error("Save failed");
                      setToast(arr.length>1?`Saved ${arr.length} assets — extracting metadata…`:"Saved");
                      // Background: extract metadata from transcripts (Claude Haiku),
                      // then embed (OpenAI). Metadata extraction nulls the embedding,
                      // so we run extraction first, then embedding picks up automatically.
                      (async()=>{
                        try{
                          const headers=await authHeaders();
                          // Extract metadata in batches
                          const extractCount=Math.min(arr.length+5,20);
                          await fetch("/api/extract-metadata",{
                            method:"POST",
                            headers:{"Content-Type":"application/json",...headers},
                            body:JSON.stringify({backfill:true,limit:extractCount}),
                          });
                          // Reload assets so the user sees the freshly extracted fields
                          const aR=await fetch("/api/assets",{headers});
                          if(aR.ok){
                            const fresh=await aR.json() as Asset[];
                            setAssets(fresh);
                          }
                          // Now embed
                          await fetch("/api/embeddings",{
                            method:"POST",
                            headers:{"Content-Type":"application/json",...headers},
                            body:JSON.stringify({backfill:true,limit:50}),
                          });
                          setToast("Library ready");
                          setTimeout(()=>setToast(null),2000);
                        }catch(e){console.warn("Background processing failed",e);}
                      })();
                    }catch(e){
                      console.error(e);
                      setToast("Save failed");
                    }
                    setTimeout(()=>setToast(null),2000);
                  }}
                />
              )}
              {adminSection==="rules" && (
                <RulesPanel
                  settings={orgSettings}
                  onSave={async (next) => {
                    // Optimistic — update local state then persist
                    setOrgSettings(next);
                    try {
                      const r = await fetch("/api/org/settings", {
                        method: "PUT",
                        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
                        body: JSON.stringify(next),
                      });
                      if (!r.ok) throw new Error("Save failed");
                      setToast("Rule saved");
                      setTimeout(() => setToast(null), 1500);
                      // The settings PUT scans all org assets and may have flipped
                      // their status (e.g. expiration rule → draft). Without a
                      // refetch, the FE shows stale statuses until something else
                      // triggers a reload. Run silently — failure is non-fatal,
                      // assets just refresh on next page load.
                      try {
                        const headers = await authHeaders();
                        const ar = await fetch("/api/assets", { headers });
                        if (ar.ok) {
                          const data = await ar.json() as Asset[];
                          setAssets(data);
                        }
                      } catch (e) {
                        console.warn("Asset refetch after rules save failed", e);
                      }
                    } catch (e) {
                      console.error("Save org settings failed", e);
                      setToast("Couldn't save rule");
                      setTimeout(() => setToast(null), 2000);
                    }
                  }}
                />
              )}
              {/* Assets panel removed — admins now use Edit on the 3-dot menu of any
                  card or row to open the AssetEditPanel side drawer. */}
            </aside>
          )}

          <div className="main-area">

            <div className="search-area">
              <div className={`search-bar ${smOpen||smLoading?"sm-active":""}`}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="11" cy="11" r="8"/>
                  <line x1="21" y1="21" x2="16.65" y2="16.65"/>
                </svg>
                <input
                  className="search-input"
                  placeholder="Search stories by name, vertical, or keyword..."
                  value={search}
                  onChange={e=>{setSearch(e.target.value);if(smResults)clearSm();}}
                  onFocus={()=>{if(smOpen)setSmOpen(false);}}
                />
                {((isAdmin && adminMode) || org?.role === "sales") && (
                  <button
                    className={`sm-btn ${smOpen||smLoading||smResults?"active":""}`}
                    onClick={()=>{if(smResults){clearSm();}else{setSmOpen(!smOpen);}}}
                  >
                    {smResults?"✕ Clear":"✦ StoryMatch"}
                  </button>
                )}
              </div>

              {((isAdmin && adminMode) || org?.role === "sales") && (smOpen||smLoading) && !smResults && (
                <div className="sm-dropdown-wrap">
                  <div className="sm-dropdown">
                    <div className="sm-inner">
                      {smLoading ? (
                        <div className="sm-loading-inline">
                          <span className="spin-inline"/>Finding your best proof points…
                        </div>
                      ) : (
                        <React.Fragment>
                          <div className="sm-hero-text">
                            <h3>Find the perfect proof point</h3>
                            <p>Describe what you're looking for, tell us about your prospect, or paste their website — we'll match you to the most relevant testimonial, case study, or quote in your library.</p>
                          </div>
                          <div className="sm-modes">
                            <button
                              className={`sm-mode ${smMode==="describe"?"on":""}`}
                              onClick={()=>setSmMode("describe")}
                            >Describe what I need</button>
                            <button
                              className={`sm-mode ${smMode==="prospect"?"on":""}`}
                              onClick={()=>setSmMode("prospect")}
                            >Tell me about my prospect</button>
                          </div>
                          <div className="sm-qbox">
                            <input
                              className="sm-qinput"
                              autoFocus
                              placeholder={smMode==="describe"?"e.g. Healthcare case studies about engagement...":"e.g. https://acme.com or 'Series B fintech, selling to CFO...'"}
                              value={smQuery}
                              onChange={e=>setSmQuery(e.target.value)}
                              onKeyDown={e=>{if(e.key==="Enter"&&smQuery.trim()&&!smLoading)runStoryMatch(smQuery);}}
                            />
                            <button
                              className="sm-go"
                              disabled={!smQuery.trim()||smLoading}
                              onClick={()=>runStoryMatch(smQuery)}
                            >Match</button>
                          </div>
                          <div className="sm-chips">
                            {(smMode==="describe"?descEx:prosEx).map((ex,i)=>(
                              <button
                                key={i}
                                className="sm-chip"
                                onClick={()=>{setSmQuery(ex);runStoryMatch(ex);}}
                              >{ex}</button>
                            ))}
                          </div>
                          {smMode==="prospect" && (
                            <div className="sm-hint">💡 Paste a website URL for automatic company analysis</div>
                          )}
                        </React.Fragment>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {smOpen && !smResults && !smLoading && (
                <div className="sm-scrim" onClick={()=>setSmOpen(false)}/>
              )}
            </div>

            {smResults && smResults.length>0 && (
              <div className="sm-status">
                <div className="sm-status-dot"/>
                <span className="sm-status-text">
                  ✦ StoryMatch found {smResults.length} results — click any card to read the full story
                </span>
                <button className="sm-status-clear" onClick={clearSm}>Clear results</button>
              </div>
            )}

            {/* The standalone filters-wrap was consolidated into the
                "Filter" popover in the lib-bar below. */}

            {/* ── Library control bar (Vimeo-style) ─────────────────────
                Select-all + count on the left; grid/list view toggle on the
                right (admin only). Visible whenever there are assets to
                manage; hides on the empty state. */}
            {displayAssets.length > 0 && (
              <div className="lib-bar">
                <div className="lib-bar-l">
                  {isAdmin && adminMode ? (
                    (() => {
                      const allSelected = displayAssets.every(a => selectedIds.has(a.id));
                      const someSelected = !allSelected && displayAssets.some(a => selectedIds.has(a.id));
                      return (
                        <label className="lib-selectall" title={allSelected ? "Deselect all" : "Select all"}>
                          <input
                            type="checkbox"
                            checked={allSelected}
                            ref={el => { if (el) el.indeterminate = someSelected; }}
                            onChange={toggleSelectAll}
                          />
                          <span>Select all</span>
                        </label>
                      );
                    })()
                  ) : null}
                  <span className="lib-count">
                    {displayAssets.length} {displayAssets.length === 1 ? "story" : "stories"}
                  </span>
                </div>
                <div className="lib-bar-r" onClick={(e) => {
                  // Close any open lib menu when clicking outside the
                  // button wrappers — keeps popover behaviour predictable.
                  if (!(e.target as HTMLElement).closest(".lib-btn-wrap")) setLibMenuOpen(null);
                }}>
                  {/* Filter — opens a popover with Industry + Type
                      checkboxes. Replaces the standalone filters bar. */}
                  <div className="lib-btn-wrap">
                    <button
                      className={`lib-btn${libMenuOpen === "filter" || anyFilter ? " on" : ""}`}
                      onClick={() => setLibMenuOpen(libMenuOpen === "filter" ? null : "filter")}
                    >
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
                      Filter
                      {anyFilter && (
                        <span className="lib-btn-count">{filters.vertical.length + filters.assetType.length}</span>
                      )}
                    </button>
                    {libMenuOpen === "filter" && (
                      <div className="lib-menu" style={{ minWidth: 240 }}>
                        {([
                          { k: "vertical" as keyof Filters, label: "Industry", opts: VERTICALS.filter(v => v !== "All") },
                          { k: "assetType" as keyof Filters, label: "Type", opts: ASSET_TYPES.filter(v => v !== "All") },
                        ]).map(f => (
                          <React.Fragment key={f.k}>
                            <div className="lib-menu-section">{f.label}</div>
                            {f.opts.map(opt => {
                              const sel = filters[f.k];
                              const on = sel.includes(opt);
                              return (
                                <div
                                  key={opt}
                                  className={`lib-menu-item${on ? " on" : ""}`}
                                  onClick={() => {
                                    setFilters(p => ({
                                      ...p,
                                      [f.k]: on ? p[f.k].filter(x => x !== opt) : [...p[f.k], opt],
                                    }));
                                  }}
                                >
                                  <svg className="lib-menu-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                                  {opt}
                                </div>
                              );
                            })}
                          </React.Fragment>
                        ))}
                        {anyFilter && (
                          <div className="lib-menu-clear" onClick={() => setFilters({ vertical: [], assetType: [] })}>
                            Clear filters
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Sort — small popover with the four sort options. */}
                  <div className="lib-btn-wrap">
                    <button
                      className={`lib-btn${libMenuOpen === "sort" ? " on" : ""}`}
                      onClick={() => setLibMenuOpen(libMenuOpen === "sort" ? null : "sort")}
                    >
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><line x1="3" y1="6" x2="21" y2="6"/><line x1="6" y1="12" x2="18" y2="12"/><line x1="9" y1="18" x2="15" y2="18"/></svg>
                      Sort: {sortBy === "recent" ? "Recent" : sortBy === "oldest" ? "Oldest" : sortBy === "az" ? "A–Z" : sortBy === "za" ? "Z–A" : "Custom"}
                    </button>
                    {libMenuOpen === "sort" && (
                      <div className="lib-menu">
                        {([
                          { k: "custom", label: "Custom (drag to reorder)" },
                          { k: "recent", label: "Recently added" },
                          { k: "oldest", label: "Oldest first" },
                          { k: "az", label: "Title A → Z" },
                          { k: "za", label: "Title Z → A" },
                        ] as { k: SortBy; label: string }[]).map(o => (
                          <div
                            key={o.k}
                            className={`lib-menu-item${sortBy === o.k ? " on" : ""}`}
                            onClick={() => { setSortBy(o.k); setLibMenuOpen(null); }}
                          >
                            <svg className="lib-menu-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                            {o.label}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {isAdmin && adminMode && (
                    <div className="view-toggle" title="Toggle grid/list view">
                      <button
                        className={`view-toggle-btn ${viewMode === "grid" ? "on" : ""}`}
                        onClick={() => setViewMode("grid")}
                        title="Grid view"
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <rect x="3" y="3" width="7" height="7" rx="1"/>
                          <rect x="14" y="3" width="7" height="7" rx="1"/>
                          <rect x="3" y="14" width="7" height="7" rx="1"/>
                          <rect x="14" y="14" width="7" height="7" rx="1"/>
                        </svg>
                      </button>
                      <button
                        className={`view-toggle-btn ${viewMode === "list" ? "on" : ""}`}
                        onClick={() => setViewMode("list")}
                        title="List view"
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <line x1="8" y1="6" x2="21" y2="6"/>
                          <line x1="8" y1="12" x2="21" y2="12"/>
                          <line x1="8" y1="18" x2="21" y2="18"/>
                          <circle cx="4" cy="6" r="1.5"/>
                          <circle cx="4" cy="12" r="1.5"/>
                          <circle cx="4" cy="18" r="1.5"/>
                        </svg>
                      </button>
                    </div>
                  )}

                  {/* + Add — admin only. Opens a popover with the available
                      creation paths. Currently just "Add a source" (jumps
                      to the Sources panel). More entries land here as
                      new asset types arrive (standalone quote, written
                      case study, etc.). */}
                  {isAdmin && adminMode && (
                    <div className="lib-btn-wrap">
                      <button
                        className="lib-btn primary"
                        onClick={() => setLibMenuOpen(libMenuOpen === "add" ? null : "add")}
                      >
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                        Add
                      </button>
                      {libMenuOpen === "add" && (
                        <div className="lib-menu">
                          <div
                            className="lib-menu-item"
                            onClick={() => { setAdminSection("import"); setLibMenuOpen(null); }}
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>
                            Add a source
                          </div>
                          <div
                            className="lib-menu-item"
                            onClick={() => { setStandaloneQuoteOpen(true); setLibMenuOpen(null); }}
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 21c3 0 7-1 7-8V5c0-1-1-2-2-2H4c-1 0-2 1-2 2v6c0 1 1 2 2 2h3"/><path d="M15 21c3 0 7-1 7-8V5c0-1-1-2-2-2h-4c-1 0-2 1-2 2v6c0 1 1 2 2 2h3"/></svg>
                            Standalone quote
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}

            <div className="lib-wrap">
              {displayAssets.length===0 ? (
                <div className="empty">
                  <h3>{smResults?"No matches found":"No stories match"}</h3>
                  <p style={{color:"var(--t4)"}}>
                    {smResults?"Try broadening your search":"Adjust filters"}
                  </p>
                </div>
              ) : (isAdmin && adminMode && viewMode === "list") ? (
                <ListView
                  assets={displayAssets}
                  selectedIds={selectedIds}
                  onToggleSelect={toggleSelected}
                  onClick={openAsset}
                  onEdit={(a)=>setEditingAssetId(a.id)}
                  onSetPublicationStatus={setPublicationStatus}
                  onSetClientStatus={setClientStatus}
                  onSetApproval={setApproval}
                  onMarkVerified={markVerified}
                  onSetFreshnessException={setFreshnessException}
                  onSetCustomFlags={setCustomFlags}
                  onResetStatusIndicators={resetStatusIndicators}
                  onDelete={deleteAssetInline}
                  onCopyShareLink={copyShareLink}
                  orgSettings={orgSettings}
                  knownCustomTags={knownCustomTags}
                />
              ) : (
                (() => {
                  // Split the grid: first row of cards, then the
                  // featured-quote rotator (if any), then the rest.
                  // The rotator only shows when:
                  //   • we're not in StoryMatch results mode (those
                  //     are AI-ranked and shouldn't be interrupted)
                  //   • there's at least one featured quote
                  //   • there are enough assets to make the break
                  //     feel natural (otherwise it's just one card +
                  //     a hero, which looks unbalanced).
                  const shouldShowRotator = !smResults && featuredQuotes.length > 0 && displayAssets.length >= 3;
                  // Snap the admin-chosen rotator slot to a row
                  // boundary so the rotator only sits BETWEEN full
                  // rows of cards — never mid-row, which would
                  // leave empty cells. Then clamp to the asset count.
                  const snapToRow = (n: number) => Math.round(n / gridCols) * gridCols;
                  const rotatorSlot = Math.min(Math.max(snapToRow(rotatorAfterIdx), 0), displayAssets.length);
                  const headAssets = shouldShowRotator ? displayAssets.slice(0, rotatorSlot) : displayAssets;
                  const tailAssets = shouldShowRotator ? displayAssets.slice(rotatorSlot) : [];
                  // Enrich featured quotes with their parent asset's
                  // headline + videoUrl so the CTA can route correctly.
                  const enriched: FeaturedQuote[] = featuredQuotes.map(q => {
                    if (!q.assetId) return q;
                    const parent = assets.find(a => a.id === q.assetId);
                    return parent
                      ? { ...q, assetVideoUrl: parent.videoUrl, assetHeadline: parent.headline }
                      : q;
                  });
                  const onCtaClick = (q: FeaturedQuote) => {
                    if (q.kind === "static" && q.staticUrl) {
                      window.open(q.staticUrl, "_blank", "noopener,noreferrer");
                    } else if (q.assetId) {
                      const parent = assets.find(a => a.id === q.assetId);
                      if (parent) openAsset(parent);
                    }
                  };
                  // Refresh the card-elements map every render so the
                  // drag-from-card logic can measure rects accurately.
                  cardElsRef.current = new Map();
                  // The dragged card needs to be hidden (clone takes
                  // its place) only after a real movement — otherwise
                  // a static click flashes empty space.
                  const pointerMoved = cardDrag
                    ? Math.abs(cardDrag.pointerX - cardDrag.initialX) > 3
                      || Math.abs(cardDrag.pointerY - cardDrag.initialY) > 3
                    : false;
                  const renderGrid = (items: Asset[], offset: number) => (
                    <div className="grid">
                      {items.map((a, i) => {
                        const idx = offset + i;
                        const isDragging = cardDrag?.assetId === a.id && pointerMoved;
                        return (
                          <div
                            key={a.id}
                            ref={el => {
                              if (el) cardElsRef.current.set(a.id, el);
                              else cardElsRef.current.delete(a.id);
                            }}
                            onPointerDown={isAdmin && adminMode ? onCardPointerDown(a.id, idx) : undefined}
                            style={{
                              cursor: isAdmin && adminMode ? "grab" : undefined,
                              visibility: isDragging ? "hidden" : undefined,
                            }}
                          >
                            {renderAssetCard(a)}
                          </div>
                        );
                      })}
                    </div>
                  );
                  // Inline helper so we don't repeat the giant per-card
                  // computation block twice. Closes over the surrounding
                  // scope (selectedIds, openAsset, etc.).
                  // Wraps openAsset so a card-click that's actually the
                  // tail end of a drag-and-drop doesn't navigate.
                  const safeOpenAsset = (a: Asset) => {
                    if (cardDragJustEnded.current) return;
                    openAsset(a);
                  };
                  function renderAssetCard(a: Asset) {
                    const ai=aiDataMap[a.id]||null;
                    const adminMgmt = isAdmin && adminMode;
                    const restore = adminMgmt ? restoreAsset : undefined;
                    const cardMenu: MenuItem[] | undefined = adminMgmt ? [
                      { label: "Open", onClick: () => openAsset(a) },
                      { label: "Edit details", onClick: () => setEditingAssetId(a.id) },
                      { label: "Copy share link", onClick: () => copyShareLink(a) },
                      { divider: true },
                      a.status === "archived"
                        ? { label: "Restore", onClick: () => setPublicationStatus(a, "published") }
                        : { label: "Archive", onClick: () => setPublicationStatus(a, "archived") },
                      { divider: true },
                      { label: "Delete", onClick: () => { if (confirm(`Delete "${a.headline || "this asset"}"? This can't be undone.`)) deleteAssetInline(a.id); }, danger: true },
                    ] : undefined;
                    const cardSelected = selectedIds.has(a.id);
                    const cardToggle = adminMgmt ? toggleSelected : undefined;
                    const share = ((isAdmin && adminMode) || org?.role === "sales") ? copyShareLink : undefined;
                    const cardCleared = adminMgmt ? (() => {
                      const c = computeCleared(a, orgSettings);
                      return {
                        level: c.level,
                        reasons: c.reasons,
                        libraryFreshnessRuleActive: !!(orgSettings.freshnessWarnAfterMonths || orgSettings.freshnessWarnBeforeDate),
                        isInMultiSelection: selectedIds.size > 1 && selectedIds.has(a.id),
                        onSetClientStatus: setClientStatus,
                        onSetApproval: setApproval,
                        onMarkVerified: markVerified,
                        onSetFreshnessException: setFreshnessException,
                        onSetCustomFlags: setCustomFlags,
                        onResetStatusIndicators: resetStatusIndicators,
                        knownCustomTags,
                      };
                    })() : undefined;
                    return a.assetType==="Quote"
                      ? <QCard key={a.id} asset={a} onClick={safeOpenAsset} aiData={ai} onCopyQuote={copyQuote} onRestore={restore} isSelected={cardSelected} onToggleSelect={cardToggle} menuItems={cardMenu} onCopyShareLink={share} cleared={cardCleared}/>
                      : <TCard key={a.id} asset={a} onClick={safeOpenAsset} aiData={ai} onCopyQuote={copyQuote} onRestore={restore} isSelected={cardSelected} onToggleSelect={cardToggle} menuItems={cardMenu} onCopyShareLink={share} cleared={cardCleared}/>;
                  }
                  return (
                    <>
                      {renderGrid(headAssets, 0)}
                      {shouldShowRotator && (
                        <div
                          ref={rotatorElRef}
                          onPointerDown={isAdmin && adminMode ? onRotatorPointerDown : undefined}
                          style={{
                            cursor: isAdmin && adminMode ? "grab" : undefined,
                            visibility: rotatorDrag ? "hidden" : undefined,
                          }}
                        >
                          <FeaturedQuoteRotator
                            quotes={enriched}
                            onCtaClick={onCtaClick}
                            onCurate={isAdmin && adminMode ? () => setRotationPanelOpen(true) : undefined}
                            intervalSec={rotatorIntervalSec}
                          />
                        </div>
                      )}
                      {tailAssets.length > 0 && renderGrid(tailAssets, headAssets.length)}
                    </>
                  );
                })()
              )}
            </div>

          </div>
        </div>

        {toast && <div className="toast">{toast}</div>}
        {isAdmin && adminMode && selectedIds.size > 0 && (
          <BulkBar
            count={selectedIds.size}
            onPublish={() => bulkSetPublication("published")}
            onDraft={() => bulkSetPublication("draft")}
            onArchive={() => bulkSetPublication("archived")}
            onMarkVerified={bulkMarkVerified}
            onDelete={bulkDelete}
            onClear={clearSelection}
            onApplyStatus={bulkApplyStatus}
            knownCustomTags={knownCustomTags}
          />
        )}
        <AssetEditPanel
          asset={editingAssetId ? assets.find(a => a.id === editingAssetId) ?? null : null}
          onSave={(updated)=>saveAssetEdit(updated as Asset)}
          onDelete={(id)=>{deleteAssetInline(id);setEditingAssetId(null);}}
          onPreview={(id)=>{const a=assets.find(x=>x.id===id);if(a){setEditingAssetId(null);openAsset(a);}}}
          onClose={()=>setEditingAssetId(null)}
          authHeaders={authHeaders}
        />
        {standaloneQuoteOpen && (
          <StandaloneQuoteModal
            authHeaders={authHeaders}
            onClose={() => setStandaloneQuoteOpen(false)}
            onCreated={() => { refreshFeaturedQuotes(); setToast("Quote added"); setTimeout(()=>setToast(null),1500); }}
          />
        )}
        {rotationPanelOpen && (
          <FeaturedRotationPanel
            authHeaders={authHeaders}
            onClose={() => setRotationPanelOpen(false)}
            onChanged={refreshFeaturedQuotes}
            intervalSec={rotatorIntervalSec}
            onIntervalChange={handleRotatorIntervalChange}
          />
        )}
        {visOverride && (
          <VisibilityOverrideModal
            asset={visOverride.asset}
            ruleKeys={visOverride.ruleKeys}
            onClose={() => setVisOverride(null)}
            onOverride={overrideAndPublish}
          />
        )}
        {/* Rotator drag — floating ghost + drop-line indicator. The
            ghost is a simplified placeholder rather than a live
            re-render of the rotator (re-rendering would create a
            duplicate timer + state and look weird). */}
        {rotatorDrag && typeof document !== "undefined" && createPortal(
          <>
            <div
              style={{
                position: "fixed",
                left: rotatorDrag.rotatorRect.left + (rotatorDrag.pointerX - rotatorDrag.initialX),
                top: rotatorDrag.rotatorRect.top + (rotatorDrag.pointerY - rotatorDrag.initialY),
                width: rotatorDrag.rotatorRect.width,
                height: rotatorDrag.rotatorRect.height,
                pointerEvents: "none",
                zIndex: 300,
                opacity: 0.9,
                transform: "rotate(.6deg)",
                background: "#f3e3d9",
                border: "1px solid rgba(0,0,0,.06)",
                borderRadius: 14,
                boxShadow: "0 24px 48px rgba(0,0,0,.22), 0 6px 16px rgba(0,0,0,.08)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontFamily: "var(--serif)",
                fontStyle: "italic",
                fontSize: 32,
                color: "#A5563A",
              }}
            >
              <span style={{ fontSize: 96, lineHeight: .6, marginRight: 20 }}>“</span>
              <span style={{ fontSize: 22, color: "#3a2a22" }}>Featured rotation</span>
            </div>
            {/* Drop-line indicator — purple line where the rotator
                will land if released here. */}
            {(() => {
              const cardRects = rotatorDrag.cardRects;
              if (cardRects.length === 0) return null;
              const i = rotatorDrag.insertIdx;
              const lineY = i === 0
                ? cardRects[0].top - 8
                : i >= cardRects.length
                  ? cardRects[cardRects.length - 1].bottom + 8
                  : (cardRects[i - 1].bottom + cardRects[i].top) / 2;
              const left = cardRects[0].left;
              const right = cardRects.reduce((m, r) => Math.max(m, r.right), 0);
              return (
                <div style={{
                  position: "fixed",
                  left,
                  top: lineY - 2,
                  width: right - left,
                  height: 4,
                  background: "var(--accent)",
                  borderRadius: 2,
                  pointerEvents: "none",
                  zIndex: 299,
                  boxShadow: "0 0 0 4px rgba(109,40,217,.14)",
                }}/>
              );
            })()}
          </>,
          document.body,
        )}
        {/* Floating drag clone — renders the in-flight card following
            the pointer. Solid white background under the whole clone
            so the title text doesn't bleed through onto the page.
            Only renders after the pointer has actually moved (>3px),
            so a click without movement doesn't briefly flash a clone. */}
        {cardDrag && typeof document !== "undefined" && (() => {
          const moved = Math.abs(cardDrag.pointerX - cardDrag.initialX) > 3
            || Math.abs(cardDrag.pointerY - cardDrag.initialY) > 3;
          if (!moved) return null;
          const fromRect = cardDrag.rects[cardDrag.fromIdx];
          if (!fromRect) return null;
          const dx = cardDrag.pointerX - cardDrag.initialX;
          const dy = cardDrag.pointerY - cardDrag.initialY;
          const draggedAsset = displayAssets.find(a => a.id === cardDrag.assetId);
          return createPortal(
            <div
              style={{
                position: "fixed",
                left: fromRect.left + dx,
                top: fromRect.top + dy,
                width: cardDrag.width,
                pointerEvents: "none",
                zIndex: 300,
                opacity: 0.95,
                transform: "rotate(1.5deg)",
                background: "#fff",
                borderRadius: "var(--r)",
                boxShadow: "0 24px 48px rgba(0,0,0,.22), 0 6px 16px rgba(0,0,0,.08)",
                padding: 6,
              }}
            >
              {draggedAsset ? (
                draggedAsset.assetType === "Quote"
                  ? <QCard asset={draggedAsset} onClick={() => {}} aiData={null} onCopyQuote={copyQuote} isSelected={false}/>
                  : <TCard asset={draggedAsset} onClick={() => {}} aiData={null} onCopyQuote={copyQuote} isSelected={false}/>
              ) : null}
            </div>,
            document.body,
          );
        })()}
      </div>
    </React.Fragment>
  );
}
