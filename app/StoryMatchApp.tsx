"use client";

import React, { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/lib/auth-context";
import AssetDetail from "./components/AssetDetail";
import MySharesView from "./components/MySharesView";
import AssetEditPanel from "./components/AssetEditPanel";

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
type ApprovalStatus = "approved" | "pending" | "denied" | "unset";

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
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:16px;}

/* ── THUMBNAIL CARD ── */
.card{position:relative;border-radius:var(--r);overflow:hidden;background:#fff;cursor:pointer;transition:all .35s cubic-bezier(.4,0,.2,1);}
.card:hover{transform:translateY(-4px);box-shadow:0 20px 50px rgba(0,0,0,.1);}
.card-thumb{position:relative;width:100%;aspect-ratio:16/9;overflow:hidden;background:var(--bg3);}
.card-thumb img{width:100%;height:100%;object-fit:cover;transition:transform .5s cubic-bezier(.4,0,.2,1);filter:brightness(.97);}
.card:hover .card-thumb img{transform:scale(1.05);filter:brightness(1);}
.play-over{position:absolute;inset:0;display:grid;place-items:center;opacity:0;transition:opacity .3s;}
.card:hover .play-over{opacity:1;}
.play-circle{width:50px;height:50px;border-radius:50%;background:rgba(255,255,255,.95);display:grid;place-items:center;box-shadow:0 4px 20px rgba(0,0,0,.2);}
.play-circle svg{margin-left:2px;}
.card-overlay{position:absolute;bottom:0;left:0;right:0;padding:14px 16px;background:linear-gradient(to top,rgba(0,0,0,.55) 0%,transparent 100%);display:flex;justify-content:space-between;align-items:flex-end;pointer-events:none;opacity:0;transition:opacity .3s;}
.card:hover .card-overlay{opacity:1;}
.card-overlay-tag{font-size:11px;color:rgba(255,255,255,.8);font-weight:500;}
.card-overlay-cta{font-size:11px;color:rgba(255,255,255,.7);font-weight:600;}
.card-body{padding:12px 14px;}
.card-co{font-size:13px;font-weight:600;color:var(--t1);display:flex;align-items:center;justify-content:space-between;}
.card-co-name{display:flex;align-items:center;gap:7px;}
.vdot{width:6px;height:6px;border-radius:50%;flex-shrink:0;}
.card-vert{font-size:11px;color:var(--t4);font-weight:500;}

/* ── AI ENRICHMENT on card ── */
.card-ai{padding:0 14px 14px;}
.card-ai-reason{font-size:11.5px;color:var(--t2);line-height:1.5;padding:10px 12px;background:var(--accentLL);border-radius:var(--r3);margin-bottom:8px;border-left:2px solid var(--accent);}
.card-ai-q{font-size:11.5px;color:var(--t2);font-style:italic;font-family:var(--serif);line-height:1.45;padding:6px 10px;background:var(--bg2);border-radius:var(--r3);margin-bottom:4px;cursor:pointer;transition:all .1s;position:relative;}
.card-ai-q:hover{background:var(--bg3);}
.card-ai-q::after{content:'copy';position:absolute;right:8px;top:50%;transform:translateY(-50%);font-size:9px;font-family:var(--font);font-style:normal;color:var(--t4);font-weight:600;text-transform:uppercase;letter-spacing:.5px;opacity:0;transition:opacity .15s;}
.card-ai-q:hover::after{opacity:1;}
.card-rank{position:absolute;top:12px;left:12px;width:28px;height:28px;border-radius:8px;background:var(--accent);color:#fff;font-size:12px;font-weight:700;display:grid;place-items:center;z-index:2;box-shadow:0 2px 8px rgba(109,40,217,.3);}

/* ── ARCHIVED ASSET TREATMENT ── */
.card.archived,.qcard.archived{opacity:.55;}
.card.archived:hover,.qcard.archived:hover{opacity:.8;}
.card.archived .card-thumb img,.qcard.archived .qcard-bg{filter:grayscale(.9);}
.archived-badge{position:absolute;top:10px;right:10px;background:var(--amberL);color:var(--amber);font-size:9.5px;font-weight:700;letter-spacing:.5px;text-transform:uppercase;padding:4px 7px;border-radius:5px;z-index:3;border:1px solid var(--amber);}
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
.view-toggle{display:flex;border:1px solid var(--border);border-radius:7px;overflow:hidden;background:#fff;}
.view-toggle-btn{padding:6px 9px;background:none;border:none;cursor:pointer;color:var(--t3);display:grid;place-items:center;}
.view-toggle-btn.on{background:var(--accentLL);color:var(--accent);}
.view-toggle-btn:hover:not(.on){background:var(--bg2);}
.view-toggle-btn+.view-toggle-btn{border-left:1px solid var(--border);}

/* ── LIST VIEW ── */
.lv{width:100%;border:1px solid var(--border);border-radius:var(--r2);background:#fff;}
.lv-head{display:grid;grid-template-columns:72px minmax(220px,2fr) 1fr 130px 130px 90px;gap:14px;padding:11px 14px;background:var(--bg2);border-bottom:1px solid var(--border);font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--t3);border-radius:var(--r2) var(--r2) 0 0;}
.lv-row{display:grid;grid-template-columns:72px minmax(220px,2fr) 1fr 130px 130px 90px;gap:14px;padding:10px 14px;align-items:center;border-bottom:1px solid var(--border);font-size:13px;cursor:pointer;transition:background .15s;position:relative;}
.lv-row:last-child{border-bottom:none;border-radius:0 0 var(--r2) var(--r2);}
.lv-row:hover{background:var(--bg2);}
.lv-row.archived{opacity:.65;}
.lv-thumb{width:72px;height:48px;border-radius:6px;overflow:hidden;background:var(--bg3);position:relative;}
.lv-thumb img{width:100%;height:100%;object-fit:cover;}
.lv-row.archived .lv-thumb img{filter:grayscale(.9);}
.lv-title{display:flex;flex-direction:column;gap:2px;min-width:0;}
.lv-title-h{font-weight:600;color:var(--t1);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.lv-title-c{font-size:11.5px;color:var(--t3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.lv-vert{font-size:12px;color:var(--t2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.lv-pub-select{font-family:var(--font);font-size:12px;padding:5px 7px;border:1px solid var(--border);border-radius:5px;background:#fff;color:var(--t1);cursor:pointer;width:100%;}
.lv-pub-select:hover{background:var(--bg2);}
.lv-actions{display:flex;gap:5px;justify-content:flex-end;}
.lv-act-btn{font-family:var(--font);font-size:11px;padding:4px 8px;border:1px solid var(--border);border-radius:5px;background:#fff;color:var(--t2);cursor:pointer;font-weight:600;}
.lv-act-btn:hover{background:var(--bg2);color:var(--t1);}
.lv-act-btn.accent{color:var(--accent);border-color:var(--accent);}
.lv-empty{padding:40px;text-align:center;color:var(--t3);}

/* ── CLEARED INDICATOR + POPOVER ── */
.cl-cell{position:relative;}
.cl-trigger{display:inline-flex;align-items:center;gap:7px;cursor:pointer;border:1px solid transparent;padding:4px 8px;border-radius:6px;font-size:11.5px;color:var(--t2);}
.cl-trigger:hover{border-color:var(--border);background:#fff;}
.cl-trigger.open{border-color:var(--accent);background:var(--accentLL);}
.cl-circle{width:11px;height:11px;border-radius:50%;flex-shrink:0;border:1px solid rgba(0,0,0,.08);}
.cl-circle.green{background:var(--green);}
.cl-circle.yellow{background:var(--amber);}
.cl-circle.red{background:var(--red);}
.cl-pop{position:absolute;top:calc(100% + 6px);left:0;width:340px;background:#fff;border:1px solid var(--border);border-radius:9px;box-shadow:0 14px 36px rgba(0,0,0,.14);padding:14px;z-index:60;cursor:default;}
.cl-pop-head{font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--t3);margin-bottom:8px;}
.cl-section{padding:10px 0;border-top:1px solid var(--border);}
.cl-section:first-of-type{border-top:none;padding-top:4px;}
.cl-section-head{display:flex;align-items:center;gap:8px;margin-bottom:7px;}
.cl-section-head .cl-circle{width:9px;height:9px;}
.cl-section-title{font-size:12.5px;font-weight:600;color:var(--t1);flex:1;}
.cl-section-meta{font-size:11px;color:var(--t3);}
.cl-input,.cl-select,.cl-textarea{font-family:var(--font);font-size:12px;padding:6px 8px;border:1px solid var(--border);border-radius:5px;background:#fff;color:var(--t1);width:100%;margin-top:5px;box-sizing:border-box;}
.cl-textarea{min-height:64px;resize:vertical;font-family:var(--font);}
.cl-row-actions{display:flex;gap:6px;margin-top:6px;}
.cl-mini-btn{font-family:var(--font);font-size:11px;padding:4px 9px;border:1px solid var(--border);border-radius:5px;background:#fff;color:var(--t2);cursor:pointer;font-weight:600;}
.cl-mini-btn:hover{background:var(--bg2);color:var(--t1);}
.cl-mini-btn.primary{background:var(--accent);color:#fff;border-color:var(--accent);}
.cl-mini-btn.primary:hover{background:var(--accent2);}

/* Empty Cleared state — no admin engagement yet */
.cl-trigger.unset{color:var(--t4);}
.cl-trigger.unset:hover{color:var(--t2);}
.cl-trigger.unset .cl-set-hint{font-size:11px;}

/* ── MULTI-SELECT (checkboxes + bulk action bar) ── */
.lv-row{padding-left:38px;}
.lv-head{padding-left:38px;}
.lv-check{position:absolute;left:14px;top:50%;transform:translateY(-50%);width:16px;height:16px;cursor:pointer;accent-color:var(--accent);}
.lv-row.selected{background:var(--accentLL);}
.lv-row.selected:hover{background:var(--accentL);}

/* Grid card checkbox — appears on hover or when card is selected */
.card-check,.qcard-check{position:absolute;top:10px;left:10px;width:20px;height:20px;cursor:pointer;accent-color:var(--accent);z-index:5;background:#fff;border-radius:4px;opacity:0;transition:opacity .15s;}
.card:hover .card-check,.qcard:hover .qcard-check,.card.selected .card-check,.qcard.selected .qcard-check{opacity:1;}
.card.selected,.qcard.selected{box-shadow:inset 0 0 0 2px var(--accent);}
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
}

function TCard({asset,onClick,aiData,onCopyQuote,onRestore,isSelected,onToggleSelect,menuItems,onCopyShareLink}: CardProps) {
  const c=VERT_CLR[asset.vertical]||"#4f46e5";
  const isV=asset.assetType==="Video Testimonial";
  const vid=extractVid(asset.videoUrl);
  let thumb=asset.thumbnail;if(!thumb&&vid?.p==="yt")thumb=ytThumb(vid.id);if(!thumb)thumb="https://images.unsplash.com/photo-1557804506-669a67965ba0?w=640&h=360&fit=crop";
  const cta=CTA_MAP[asset.assetType]||"read";
  const isArchived=asset.status==="archived";
  return(
    <div className={`card${isArchived?" archived":""}${isSelected?" selected":""}`} onClick={()=>onClick(asset)}>
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
      {isArchived&&<div className="archived-badge" title={asset.archivedReason||""}>Archived</div>}
      {isArchived&&onRestore&&!menuItems&&(
        <button className="archived-restore" onClick={e=>{e.stopPropagation();onRestore(asset);}}>↶ Restore</button>
      )}
      <div className="card-thumb">
        {aiData&&<div className="card-rank">{aiData.rank}</div>}
        <img src={thumb} alt={asset.company} loading="lazy"/>
        {isV&&<div className="play-over"><div className="play-circle"><svg width="18" height="18" viewBox="0 0 24 24" fill="#111"><polygon points="6,3 20,12 6,21"/></svg></div></div>}
        <div className="card-overlay"><span className="card-overlay-tag">{asset.vertical}</span><span className="card-overlay-cta">{cta} →</span></div>
      </div>
      <div className="card-body">
        <div className="card-co"><span className="card-co-name"><span className="vdot" style={{background:c}}/>{asset.company}</span><span className="card-vert">{cta}</span></div>
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

function QCard({asset,onClick,aiData,onCopyQuote,onRestore,isSelected,onToggleSelect,menuItems,onCopyShareLink}: CardProps) {
  const c=VERT_CLR[asset.vertical]||"#4f46e5";
  const grad=`linear-gradient(135deg, ${c} 0%, ${c}dd 40%, ${c}99 100%)`;
  const isArchived=asset.status==="archived";
  return(
    <div className={`qcard${isArchived?" archived":""}${isSelected?" selected":""}`} onClick={()=>onClick(asset)}>
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
      {isArchived&&<div className="archived-badge" title={asset.archivedReason||""}>Archived</div>}
      {isArchived&&onRestore&&!menuItems&&(
        <button className="archived-restore" onClick={e=>{e.stopPropagation();onRestore(asset);}}>↶ Restore</button>
      )}
      {aiData&&<div className="card-rank" style={{position:"absolute",top:12,left:12,zIndex:3}}>{aiData.rank}</div>}
      <div className="qcard-bg" style={{["--qgrad" as string]:grad} as React.CSSProperties}/>
      <div className="qcard-content">
        <div className="qcard-quote-text">"{asset.pullQuote}"</div>
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
  const ref = React.useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const t = setTimeout(() => document.addEventListener("mousedown", onDoc), 0);
    return () => { clearTimeout(t); document.removeEventListener("mousedown", onDoc); };
  }, [open]);
  return (
    <div ref={ref} style={{ position: "relative" }} onClick={(e) => e.stopPropagation()}>
      <button className="dots-btn" onClick={() => setOpen(o => !o)} title="Actions">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>
      </button>
      {open && (
        <div className="dots-pop">
          {items.map((it, i) => "divider" in it
            ? <div key={`d${i}`} className="dots-divider"/>
            : <button key={i} className={`dots-item${it.danger ? " danger" : ""}`} onClick={() => { setOpen(false); it.onClick(); }}>{it.label}</button>
          )}
        </div>
      )}
    </div>
  );
}

// ─── BULK ACTION BAR (floating, appears when any rows are selected) ──────────
interface BulkBarProps {
  count: number;
  onPublish: () => void;
  onDraft: () => void;
  onArchive: () => void;
  onMarkVerified: () => void;
  onDelete: () => void;
  onClear: () => void;
}
function BulkBar({ count, onPublish, onDraft, onArchive, onMarkVerified, onDelete, onClear }: BulkBarProps) {
  return (
    <div className="bulk-bar">
      <span className="bulk-count">{count} selected</span>
      <button className="bulk-btn" onClick={onPublish}>Publish</button>
      <button className="bulk-btn" onClick={onDraft}>Move to draft</button>
      <button className="bulk-btn" onClick={onArchive}>Archive</button>
      <button className="bulk-btn" onClick={onMarkVerified}>✓ Mark verified</button>
      <button className="bulk-btn danger" onClick={onDelete}>Delete</button>
      <button className="bulk-close" onClick={onClear} title="Clear selection">✕</button>
    </div>
  );
}

interface ListViewProps {
  assets: Asset[];
  selectedIds: Set<string>;
  onToggleSelect: (id: string, shiftKey?: boolean) => void;
  onSelectAll: () => void;
  onClick: (a: Asset) => void;
  onEdit: (a: Asset) => void;
  onSetPublicationStatus: (a: Asset, next: "published" | "draft" | "archived") => void;
  onSetClientStatus: (a: Asset, next: "current" | "former" | "unknown") => void;
  onSetApproval: (a: Asset, patch: { status?: ApprovalStatus; note?: string }) => void;
  onMarkVerified: (a: Asset) => void;
  onDelete: (id: string) => void;
  onCopyShareLink: (a: Asset) => void;
}

// Compute the "Cleared for use" composite signal from approval, client status,
// and freshness. Worst-of-three logic. Returns the level (green / yellow / red)
// and a per-signal breakdown for the popover.
//
// Default state when no admin has engaged: `unset` — no dot, no nag. The dot
// only appears once an admin records approval or actively sets client status,
// because that's when the lifecycle data is meaningful enough to display.
type ClearedLevel = "green" | "yellow" | "red" | "unset";
interface ClearedReason { signal: "approval" | "client" | "freshness"; level: "green" | "yellow" | "red"; label: string; }

function isClearedEngaged(asset: Asset): boolean {
  const approvalEngaged = !!asset.approvalStatus && asset.approvalStatus !== "unset";
  const clientEngaged = asset.clientStatusSource === "manual" || asset.clientStatusSource === "crm";
  return approvalEngaged || clientEngaged;
}

function computeCleared(asset: Asset): { level: ClearedLevel; reasons: ClearedReason[] } {
  // Always compute the per-signal reasons so the popover can render them
  // regardless of engagement state. Only the *overall* level is gated by
  // engagement — when the admin hasn't touched anything, we return level:
  // "unset" so the row shows no dot.
  const reasons: ClearedReason[] = [];

  // Approval
  const approval = (asset.approvalStatus || "unset") as ApprovalStatus;
  if (approval === "approved") reasons.push({ signal: "approval", level: "green", label: "Approval received" });
  else if (approval === "denied") reasons.push({ signal: "approval", level: "red", label: "Approval denied" });
  else if (approval === "pending") reasons.push({ signal: "approval", level: "yellow", label: "Approval pending" });
  else reasons.push({ signal: "approval", level: "yellow", label: "Approval not recorded" });

  // Client relationship
  const cs = (asset.clientStatus || "current") as ClientStatus;
  if (cs === "current") reasons.push({ signal: "client", level: "green", label: "Current client" });
  else if (cs === "former") reasons.push({ signal: "client", level: "yellow", label: "Former client" });
  else reasons.push({ signal: "client", level: "yellow", label: "Client status unknown" });

  // Freshness
  if (asset.lastVerifiedAt) {
    const months = (Date.now() - new Date(asset.lastVerifiedAt).getTime()) / (1000 * 60 * 60 * 24 * 30);
    if (months < 6) reasons.push({ signal: "freshness", level: "green", label: `Verified ${timeAgoShort(asset.lastVerifiedAt)}` });
    else if (months < 18) reasons.push({ signal: "freshness", level: "yellow", label: `Verified ${timeAgoShort(asset.lastVerifiedAt)} — getting stale` });
    else reasons.push({ signal: "freshness", level: "red", label: `Verified ${timeAgoShort(asset.lastVerifiedAt)} — too old` });
  } else {
    reasons.push({ signal: "freshness", level: "yellow", label: "Never verified" });
  }

  // No admin engagement yet — show no dot, but still expose the signals so the
  // popover can render them when admin clicks to set things up.
  if (!isClearedEngaged(asset)) {
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
  onSetClientStatus: (a: Asset, next: "current" | "former" | "unknown") => void;
  onSetApproval: (a: Asset, patch: { status?: ApprovalStatus; note?: string }) => void;
  onMarkVerified: (a: Asset) => void;
}

function ClearedPopover({ asset, reasons, onClose, onSetClientStatus, onSetApproval, onMarkVerified }: ClearedPopoverProps) {
  const [noteDraft, setNoteDraft] = useState(asset.approvalNote || "");
  const popRef = React.useRef<HTMLDivElement>(null);

  // Close on click outside
  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (popRef.current && !popRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    // Defer one tick so the click that opened us doesn't immediately close us
    const timer = setTimeout(() => document.addEventListener("mousedown", onDoc), 0);
    return () => { clearTimeout(timer); document.removeEventListener("mousedown", onDoc); };
  }, [onClose]);

  const reasonFor = (signal: "approval" | "client" | "freshness"): ClearedReason =>
    reasons.find(r => r.signal === signal) || { signal, level: "yellow", label: "—" };

  return (
    <div className="cl-pop" ref={popRef} onClick={(e) => e.stopPropagation()}>
      <div className="cl-pop-head">Cleared for use</div>

      {/* Approval section */}
      <div className="cl-section">
        <div className="cl-section-head">
          <span className={`cl-circle ${reasonFor("approval").level}`}/>
          <span className="cl-section-title">Approval</span>
          {asset.approvalRecordedAt && (
            <span className="cl-section-meta">recorded {timeAgoShort(asset.approvalRecordedAt)}</span>
          )}
        </div>
        <select
          className="cl-select"
          value={asset.approvalStatus || "unset"}
          onChange={(e) => onSetApproval(asset, { status: e.target.value as ApprovalStatus })}
        >
          <option value="unset">Not recorded</option>
          <option value="pending">Pending</option>
          <option value="approved">Approved</option>
          <option value="denied">Denied</option>
        </select>
        <textarea
          className="cl-textarea"
          placeholder="Paste the email thread, or write a note about how approval was obtained…"
          value={noteDraft}
          onChange={(e) => setNoteDraft(e.target.value)}
        />
        {noteDraft !== (asset.approvalNote || "") && (
          <div className="cl-row-actions">
            <button className="cl-mini-btn primary" onClick={() => onSetApproval(asset, { note: noteDraft })}>Save note</button>
            <button className="cl-mini-btn" onClick={() => setNoteDraft(asset.approvalNote || "")}>Cancel</button>
          </div>
        )}
      </div>

      {/* Client status section */}
      <div className="cl-section">
        <div className="cl-section-head">
          <span className={`cl-circle ${reasonFor("client").level}`}/>
          <span className="cl-section-title">Client relationship</span>
          {asset.clientStatusSource && asset.clientStatusSource !== "unset" && (
            <span className="cl-section-meta">via {asset.clientStatusSource}</span>
          )}
        </div>
        <select
          className="cl-select"
          value={(asset.clientStatus || "current") as string}
          onChange={(e) => onSetClientStatus(asset, e.target.value as "current" | "former" | "unknown")}
        >
          <option value="current">Current client</option>
          <option value="former">Former client</option>
          <option value="unknown">Unknown</option>
        </select>
      </div>

      {/* Freshness section */}
      <div className="cl-section">
        <div className="cl-section-head">
          <span className={`cl-circle ${reasonFor("freshness").level}`}/>
          <span className="cl-section-title">Freshness</span>
          <span className="cl-section-meta">verified {timeAgoShort(asset.lastVerifiedAt)}</span>
        </div>
        <button className="cl-mini-btn primary" onClick={() => onMarkVerified(asset)}>
          ✓ Mark verified now
        </button>
      </div>
    </div>
  );
}

function ListView({ assets, selectedIds, onToggleSelect, onSelectAll, onClick, onEdit, onSetPublicationStatus, onSetClientStatus, onSetApproval, onMarkVerified, onDelete, onCopyShareLink }: ListViewProps) {
  const [openClearedFor, setOpenClearedFor] = useState<string | null>(null);
  const allSelected = assets.length > 0 && assets.every(a => selectedIds.has(a.id));
  const someSelected = !allSelected && assets.some(a => selectedIds.has(a.id));
  const headerCheckRef = React.useRef<HTMLInputElement>(null);
  // Native HTML doesn't support indeterminate via attribute — set via DOM
  useEffect(() => {
    if (headerCheckRef.current) headerCheckRef.current.indeterminate = someSelected;
  }, [someSelected]);

  if (assets.length === 0) {
    return <div className="lv"><div className="lv-empty">No assets to show.</div></div>;
  }
  return (
    <div className="lv">
      <div className="lv-head">
        <input
          type="checkbox"
          ref={headerCheckRef}
          className="lv-check"
          checked={allSelected}
          onChange={onSelectAll}
          title={allSelected ? "Deselect all" : "Select all"}
        />
        <div>Title</div>
        <div>Vertical</div>
        <div>Publication</div>
        <div title="Cleared for use: approval, client status, freshness">Cleared</div>
        <div style={{ textAlign: "right" }}>Actions</div>
      </div>
      {assets.map((a) => {
        const isArchived = a.status === "archived";
        const isSelected = selectedIds.has(a.id);
        const cleared = computeCleared(a);
        const open = openClearedFor === a.id;
        const vid = extractVid(a.videoUrl);
        let thumb = a.thumbnail;
        if (!thumb && vid?.p === "yt") thumb = ytThumb(vid.id);
        if (!thumb) thumb = "https://images.unsplash.com/photo-1557804506-669a67965ba0?w=160&h=90&fit=crop";
        const pubStatus = (a.status || "published") as "published" | "draft" | "archived";
        return (
          <div
            key={a.id}
            className={`lv-row${isArchived ? " archived" : ""}${isSelected ? " selected" : ""}`}
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
            <div onClick={(e) => e.stopPropagation()}>
              <select
                className="lv-pub-select"
                value={pubStatus}
                onChange={(e) => onSetPublicationStatus(a, e.target.value as "published" | "draft" | "archived")}
              >
                <option value="published">Published</option>
                <option value="draft">Draft</option>
                <option value="archived">Archived</option>
              </select>
            </div>
            <div className="cl-cell" onClick={(e) => e.stopPropagation()}>
              <div
                className={`cl-trigger${open ? " open" : ""}${cleared.level === "unset" ? " unset" : ""}`}
                onClick={() => setOpenClearedFor(open ? null : a.id)}
                title={cleared.level === "unset" ? "Click to set approval & client status" : "Cleared for use: approval, client status, freshness"}
              >
                {cleared.level === "unset" ? (
                  <span className="cl-set-hint">—</span>
                ) : (
                  <>
                    <span className={`cl-circle ${cleared.level}`}/>
                    <span>{cleared.level === "green" ? "Cleared" : cleared.level === "yellow" ? "Review" : "Issues"}</span>
                  </>
                )}
              </div>
              {open && (
                <ClearedPopover
                  asset={a}
                  reasons={cleared.reasons}
                  onClose={() => setOpenClearedFor(null)}
                  onSetClientStatus={onSetClientStatus}
                  onSetApproval={onSetApproval}
                  onMarkVerified={onMarkVerified}
                />
              )}
            </div>
            <div className="lv-actions">
              <DotsMenu items={[
                { label: "Open", onClick: () => onClick(a) },
                { label: "Edit details", onClick: () => onEdit(a) },
                { label: "Copy share link", onClick: () => onCopyShareLink(a) },
                { label: "✓ Mark verified", onClick: () => onMarkVerified(a) },
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
      const data=await r.json() as {videos:{url:string;title:string;description?:string;thumbnail?:string;durationSec?:number;uploader?:string;transcript?:string}[]};
      return(data.videos||[]).map(v=>({
        url:v.url,
        title:v.title,
        description:v.description,
        thumbnail:v.thumbnail,
        durationSec:v.durationSec,
        transcript:v.transcript,
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
    headline:enriched?.headline||title,
    pullQuote:enriched?.pullQuote||"",
    // transcript stays empty unless real auto-captions come from Vimeo
    transcript:"",
    // description holds the human-written video description (more reliable than transcript for proper nouns)
    description:desc,
    thumbnail:thumb||""
  };
}

// ─── ADMIN: SOURCES PANEL ────────────────────────────────────────────────────
interface SourcesPanelProps {
  sources: Source[];
  assets: Asset[];
  onAddSource: (s: Source) => void;
  onRemoveSource: (id: string) => void;
  onSyncSource: (id: string, newAssetIds: string[], videoCount: number) => void;
  onAddAssets: (arr: Asset[]) => void;
  // Apply partial updates to existing assets (used for auto-archive on Vimeo removal)
  onUpdateAssets: (updates: Array<Partial<Asset> & { id: string }>) => void;
}

interface Progress {
  step: string;
  count: number;
  total: number | "?";
  done?: boolean;
  error?: boolean;
}

function SourcesPanel({sources,assets,onAddSource,onRemoveSource,onSyncSource,onAddAssets,onUpdateAssets}: SourcesPanelProps) {
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
      // typed into Vimeo itself.
      if(v.title) asset.headline=v.title;
      if(v.description) asset.description=v.description;
      if(v.thumbnail) asset.thumbnail=v.thumbnail;
      if(v.transcript) asset.transcript=v.transcript;
      newAssets.push(asset);
    }
    const source: Source = {id:sourceId,name:name||`${typeLabel(detected.kind)}`,url:detected.url,type:detected.kind,status:"synced",lastSync:new Date().toISOString(),videoCount:newAssets.length,assetIds:newAssets.map(a=>a.id)};
    onAddSource(source);
    onAddAssets(newAssets);
    setProgress({step:`Imported ${newAssets.length} videos`,count:newAssets.length,total:newAssets.length,done:true});
    setWorking(false);
    setTimeout(()=>{setProgress(null);setView("list");setUrl("");setName("");},1800);
  };

  // Add a single video (not tracked as a source)
  const addSingleVideo=async()=>{
    if(!detected||!isSingle)return;
    setWorking(true);
    setProgress({step:"Fetching video details…",count:0,total:1});
    const asset=await importSingleVideo(detected,null);
    onAddAssets([asset]);
    setProgress({step:"Done",count:1,total:1,done:true});
    setWorking(false);
    setTimeout(()=>{setProgress(null);setView("list");setUrl("");setName("");},1500);
  };

  // Re-sync an existing source.
  //
  // For each newly-detected video, we mirror the same override pattern that
  // `addCollectionSource` uses on initial import: importSingleVideo gives us
  // a baseline asset from oEmbed, then we layer the rich Vimeo data we
  // already fetched in extractShowcaseVideos on top — hi-res thumbnail,
  // human-written description, and auto-generated transcript. Without these
  // overrides, re-synced videos came in with low-res thumbnails, no
  // transcript, and nothing for Claude's metadata extraction to work with.
  const doSync=async(source: Source)=>{
    setSyncingId(source.id);
    const videos=await extractShowcaseVideos(source.url);
    const existingAssetIds=new Set(source.assetIds||[]);
    const existingAssets=assets.filter(a=>existingAssetIds.has(a.id));
    const existingUrls=new Set(existingAssets.map(a=>a.videoUrl));

    // 1) New videos in Vimeo that we don't have yet — import them
    const newUrls=videos.filter(v=>!existingUrls.has(v.url));
    const newAssets: Asset[] = [];
    for(const v of newUrls){
      const info=detectUrlType(v.url);
      if(!info||info.kind==="unknown")continue;
      const asset=await importSingleVideo(info,source.id);
      // Vimeo is source of truth for title/description (see addCollectionSource).
      if(v.title) asset.headline=v.title;
      if(v.description) asset.description=v.description;
      if(v.thumbnail) asset.thumbnail=v.thumbnail;
      if(v.transcript) asset.transcript=v.transcript;
      newAssets.push(asset);
    }

    // 2) Orphaned assets — we have them, Vimeo no longer does. Auto-archive
    //    rather than delete: preserves enrichment data, embeddings, manual edits,
    //    and lets admin restore with one click. Skip already-archived assets.
    const currentVimeoUrls=new Set(videos.map(v=>v.url));
    const orphaned=existingAssets.filter(a=>
      !currentVimeoUrls.has(a.videoUrl) && a.status!=="archived"
    );
    if(orphaned.length>0){
      const today=new Date().toISOString().split("T")[0];
      const nowIso=new Date().toISOString();
      const updates=orphaned.map(a=>({
        id:a.id,
        status:"archived",
        archivedAt:nowIso,
        archivedReason:`Removed from Vimeo showcase on ${today}`,
      }));
      onUpdateAssets(updates);
    }

    if(newAssets.length>0)onAddAssets(newAssets);
    onSyncSource(source.id,newAssets.map(a=>a.id),videos.length);
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
                    <strong>Single videos</strong> are added as standalone assets. Use this for one-off imports when you just want to add a specific video.
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
            {sources.map(s=>(
              <div className="src-card" key={s.id}>
                <div className="src-card-top">
                  <div className={`src-card-icon ${iconFor(s.type)}`}>
                    {s.type?.startsWith("vm")?"V":"Y"}
                  </div>
                  <div className="src-card-info">
                    <div className="src-card-name">{s.name}</div>
                    <div className="src-card-sub">
                      <span className={`src-sync-dot ${syncingId===s.id?"syncing":s.status==="error"?"error":s.lastSync?"synced":"never"}`}/>
                      {syncingId===s.id?"Syncing…":`${s.videoCount} video${s.videoCount===1?"":"s"} · ${timeAgo(s.lastSync)}`}
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
              </div>
            ))}
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
  const[filters,setFilters]=useState<Filters>({vertical:[],assetType:[]});
  const[openFilter,setOpenFilter]=useState<string|null>(null);
  const[search,setSearch]=useState("");
  const[route,setRoute]=useState<Route>({page:"home",id:null});
  const[toast,setToast]=useState<string|null>(null);

  // Admin mode + nav
  const isAdmin = org?.role === "admin";
  const[adminMode,setAdminMode]=useState(true); // whether admin is viewing admin UI vs preview as sales
  const[adminSection,setAdminSection]=useState<string|null>(null); // assets | import | null (collapsed)
  const[showArchived,setShowArchived]=useState(false); // admin-only: include archived assets in views
  const[viewMode,setViewMode]=useState<"grid"|"list">("grid"); // admin-only; sales/public always see grid
  const[selectedIds,setSelectedIds]=useState<Set<string>>(new Set()); // admin-only: multi-select for bulk actions
  const[lastSelectedId,setLastSelectedId]=useState<string|null>(null); // anchor for shift-click range select
  const[editingAssetId,setEditingAssetId]=useState<string|null>(null); // admin-only: open the edit drawer for this asset
  const[sources,setSources]=useState<Source[]>([]); // video sources (showcases, playlists)

  // StoryMatch state
  const[smOpen,setSmOpen]=useState(false);
  const[smQuery,setSmQuery]=useState("");
  const[smMode,setSmMode]=useState<"describe"|"prospect">("describe");
  const[smLoading,setSmLoading]=useState(false);
  const[smResults,setSmResults]=useState<AIMatchResult[]|null>(null);

  useEffect(()=>{
    const h=()=>{const hash=window.location.hash.slice(1);if(hash.startsWith("/asset/"))setRoute({page:"detail",id:hash.split("/asset/")[1]});else if(hash.startsWith("/shares"))setRoute({page:"shares",id:null});else setRoute({page:"home",id:null});};
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
    setAssets(prev=>prev.map(a=>a.id===id?{...a,...patch}:a));
    if(toastMsg){setToast(toastMsg);setTimeout(()=>setToast(null),1500);}
    try{
      await fetch("/api/assets",{
        method:"PUT",
        headers:{"Content-Type":"application/json",...(await authHeaders())},
        body:JSON.stringify({id,...patch}),
      });
    }catch(e){console.error("Inline update failed",e);}
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
      update.approvalRecordedAt=new Date().toISOString();
    }
    if(patch.note!==undefined) update.approvalNote=patch.note;
    await updateAssetInline(asset.id,update,patch.status?`Approval: ${patch.status}`:"Note saved");
  };

  // Change publication status (published / draft / archived) inline.
  const setPublicationStatus=async(asset: Asset, next: "published"|"draft"|"archived")=>{
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
      },next==="published"?"Published":"Moved to draft");
    }
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
    }catch(e){
      console.error("Asset save failed",e);
      setToast("Save failed");
    }
    setTimeout(()=>setToast(null),1500);
    setEditingAssetId(null);
  };

  // Delete an asset (irreversible). Used by per-row 3-dot menu and bulk bar.
  const deleteAssetInline=async(id: string)=>{
    setAssets(prev=>prev.filter(a=>a.id!==id));
    try{
      await fetch(`/api/assets?id=${id}`,{
        method:"DELETE",
        headers:await authHeaders(),
      });
    }catch(e){console.error("Delete failed",e);}
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
    if(!confirm(`Delete ${ids.length} ${ids.length===1?"asset":"assets"} permanently? This can't be undone.`))return;
    setAssets(prev=>prev.filter(a=>!selectedIds.has(a.id)));
    setToast(`${ids.length} deleted`);setTimeout(()=>setToast(null),1800);
    for(const id of ids){
      try{await fetch(`/api/assets?id=${id}`,{method:"DELETE",headers:await authHeaders()});}catch(e){console.error(e);}
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
  const includeArchived = isAdmin && adminMode && showArchived;
  const archivedCount = assets.filter(a=>a.status==="archived").length;

  // Determine what to show in the grid
  let displayAssets: Asset[];
  const aiDataMap: Record<string, AIMatchResult> = {};
  if(smResults&&smResults.length>0){
    const matchedIds=smResults.map(r=>r.id);
    displayAssets=matchedIds
      .map(id=>assets.find(a=>a.id===id))
      .filter((a): a is Asset => a !== undefined)
      .filter(a => includeArchived || a.status !== "archived");
    smResults.forEach(r=>{aiDataMap[r.id]=r;});
  } else {
    displayAssets=assets.filter(a=>{
      if(!includeArchived && a.status === "archived") return false;
      if(filters.vertical.length>0&&!filters.vertical.includes(a.vertical))return false;
      if(filters.assetType.length>0&&!filters.assetType.includes(a.assetType))return false;
      if(search){const s=search.toLowerCase();if(!(a.company||"").toLowerCase().includes(s)&&!(a.clientName||"").toLowerCase().includes(s)&&!(a.vertical||"").toLowerCase().includes(s)&&!(a.headline||"").toLowerCase().includes(s))return false;}
      return true;
    });
  }
  const anyFilter=filters.vertical.length>0||filters.assetType.length>0;
  const detailAsset=route.page==="detail"?assets.find(a=>a.id===route.id)||null:null;

  if(route.page==="detail"){
    return(<React.Fragment><style>{css}</style><div style={{minHeight:"100vh",background:"var(--bg)"}}>
      <header className="hdr"><div className="logo" onClick={goHome} style={{cursor:"pointer",fontFamily:"var(--serif)",fontSize:20,fontWeight:500,letterSpacing:-.4,color:"var(--t1)"}}></div><div className="hdr-r"><span className="badge">{assets.length} assets</span></div></header>
      {detailAsset && <AssetDetail asset={detailAsset} onBack={goHome} allAssets={assets} onSelect={(id)=>{const a=assets.find(x=>x.id===id);if(a)openAsset(a);}}/>}
    </div></React.Fragment>);
  }

  if(route.page==="shares"){
    return(<React.Fragment><style>{css}</style><div style={{minHeight:"100vh",background:"var(--bg)"}}>
      <header className="hdr"><div className="logo" onClick={goHome} style={{cursor:"pointer",fontFamily:"var(--serif)",fontSize:20,fontWeight:500,letterSpacing:-.4,color:"var(--t1)"}}></div><div className="hdr-r"><span className="badge">{assets.length} assets</span></div></header>
      <MySharesView isAdmin={isAdmin} authHeaders={authHeaders} onBack={goHome}/>
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
            <span className="badge">{assets.length - (includeArchived?0:archivedCount)} assets{includeArchived&&archivedCount>0?` (${archivedCount} archived)`:""}</span>
            {isAdmin && adminMode && archivedCount > 0 && (
              <button
                onClick={()=>setShowArchived(v=>!v)}
                title={showArchived?"Hide archived assets":"Show archived assets"}
                style={{padding:"5px 10px",border:"1px solid var(--border)",borderRadius:6,background:showArchived?"var(--accent-bg)":"#fff",color:showArchived?"var(--accent)":"var(--t3)",fontSize:11,fontWeight:600,cursor:"pointer",fontFamily:"var(--font)"}}
              >{showArchived?`Hide archived (${archivedCount})`:`Show archived (${archivedCount})`}</button>
            )}
            {isAdmin && adminMode && (
              <div className="view-toggle" title="Toggle grid/list view">
                <button
                  className={`view-toggle-btn ${viewMode==="grid"?"on":""}`}
                  onClick={()=>setViewMode("grid")}
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
                  className={`view-toggle-btn ${viewMode==="list"?"on":""}`}
                  onClick={()=>setViewMode("list")}
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
              <div style={{fontSize:11,color:"var(--t3)",textAlign:"right",lineHeight:1.3}}>
                <div style={{fontWeight:600,color:"var(--t2)"}}>{user?.email}</div>
                <div>{org?.name||"No workspace"} · {org?.role||"—"}</div>
              </div>
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
              <button
                onClick={signOut}
                title="Sign out"
                style={{padding:"6px 10px",border:"1px solid var(--border)",borderRadius:6,background:"#fff",color:"var(--t3)",fontSize:11,fontWeight:600,cursor:"pointer",fontFamily:"var(--font)"}}
              >Sign out</button>
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
              <button className="rail-btn disabled" title="Embed (coming soon)">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <polyline points="16 18 22 12 16 6"/>
                  <polyline points="8 6 2 12 8 18"/>
                </svg>
                Embed
                <span className="rail-soon">SOON</span>
              </button>
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
                  onSyncSource={async (id,newAssetIds,videoCount)=>{
                    const updated=sources.find(s=>s.id===id);
                    if(!updated)return;
                    const nextSource={
                      ...updated,
                      lastSync:new Date().toISOString(),
                      status:"synced",
                      videoCount,
                      assetIds:[...(updated.assetIds||[]),...newAssetIds],
                    };
                    setSources(p=>p.map(s=>s.id===id?nextSource:s));
                    setToast(newAssetIds.length>0?`Synced — ${newAssetIds.length} new`:"Synced — no new videos");
                    setTimeout(()=>setToast(null),2000);
                    try{
                      await fetch("/api/sources",{
                        method:"PUT",
                        headers:{"Content-Type":"application/json",...(await authHeaders())},
                        body:JSON.stringify(nextSource)
                      });
                    }catch(e){console.error(e);}
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

            {!smResults && (
              <div
                className="filters-wrap"
                onClick={e=>{if(!(e.target as HTMLElement).closest('.filter-group'))setOpenFilter(null);}}
              >
                {([
                  {k:"vertical" as keyof Filters,label:"Industry",opts:VERTICALS.filter(v=>v!=="All")},
                  {k:"assetType" as keyof Filters,label:"Type",opts:ASSET_TYPES.filter(v=>v!=="All")}
                ]).map(f=>{
                  const sel=filters[f.k];
                  const isOpen=openFilter===f.k;
                  const display=sel.length===0?"All":sel.length===1?sel[0]:`${sel.length} selected`;
                  return (
                    <div className="filter-group" key={f.k}>
                      <div className="filter-label">{f.label}</div>
                      <div
                        className={`filter-trigger ${isOpen?"open":""}`}
                        onClick={()=>setOpenFilter(isOpen?null:f.k)}
                      >
                        {display}
                        {sel.length>0 && <span className="f-count">{sel.length}</span>}
                      </div>
                      {isOpen && (
                        <div className="filter-dd">
                          {f.opts.map(opt=>{
                            const on=sel.includes(opt);
                            return (
                              <div
                                key={opt}
                                className={`filter-dd-item ${on?"on":""}`}
                                onClick={e=>{
                                  e.stopPropagation();
                                  setFilters(p=>{
                                    const arr=on?p[f.k].filter(x=>x!==opt):[...p[f.k],opt];
                                    return {...p,[f.k]:arr};
                                  });
                                }}
                              >
                                <span className="f-check"/>{opt}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
                {anyFilter && (
                  <button
                    className="fclear"
                    onClick={()=>{setFilters({vertical:[],assetType:[]});setOpenFilter(null);}}
                  >Clear</button>
                )}
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
                  onSelectAll={toggleSelectAll}
                  onClick={openAsset}
                  onEdit={(a)=>setEditingAssetId(a.id)}
                  onSetPublicationStatus={setPublicationStatus}
                  onSetClientStatus={setClientStatus}
                  onSetApproval={setApproval}
                  onMarkVerified={markVerified}
                  onDelete={deleteAssetInline}
                  onCopyShareLink={copyShareLink}
                />
              ) : (
                <div className="grid">
                  {displayAssets.map(a=>{
                    const ai=aiDataMap[a.id]||null;
                    const adminMgmt = isAdmin && adminMode;
                    const restore = adminMgmt ? restoreAsset : undefined;
                    const cardMenu: MenuItem[] | undefined = adminMgmt ? [
                      { label: "Open", onClick: () => openAsset(a) },
                      { label: "Edit details", onClick: () => setEditingAssetId(a.id) },
                      { label: "Copy share link", onClick: () => copyShareLink(a) },
                      { label: "✓ Mark verified", onClick: () => markVerified(a) },
                      { divider: true },
                      a.status === "archived"
                        ? { label: "Restore", onClick: () => setPublicationStatus(a, "published") }
                        : { label: "Archive", onClick: () => setPublicationStatus(a, "archived") },
                      { divider: true },
                      { label: "Delete", onClick: () => { if (confirm(`Delete "${a.headline || "this asset"}"? This can't be undone.`)) deleteAssetInline(a.id); }, danger: true },
                    ] : undefined;
                    const cardSelected = selectedIds.has(a.id);
                    const cardToggle = adminMgmt ? toggleSelected : undefined;
                    // Share link is available to all signed-in users (sales reps share too)
                    const share = user ? copyShareLink : undefined;
                    return a.assetType==="Quote"
                      ? <QCard key={a.id} asset={a} onClick={openAsset} aiData={ai} onCopyQuote={copyQuote} onRestore={restore} isSelected={cardSelected} onToggleSelect={cardToggle} menuItems={cardMenu} onCopyShareLink={share}/>
                      : <TCard key={a.id} asset={a} onClick={openAsset} aiData={ai} onCopyQuote={copyQuote} onRestore={restore} isSelected={cardSelected} onToggleSelect={cardToggle} menuItems={cardMenu} onCopyShareLink={share}/>;
                  })}
                </div>
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
          />
        )}
        <AssetEditPanel
          asset={editingAssetId ? assets.find(a => a.id === editingAssetId) ?? null : null}
          onSave={(updated)=>saveAssetEdit(updated as Asset)}
          onDelete={(id)=>{deleteAssetInline(id);setEditingAssetId(null);}}
          onPreview={(id)=>{const a=assets.find(x=>x.id===id);if(a){setEditingAssetId(null);openAsset(a);}}}
          onClose={()=>setEditingAssetId(null)}
        />
      </div>
    </React.Fragment>
  );
}
