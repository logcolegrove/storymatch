"use client";

import React, { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/lib/auth-context";

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

// ─── TYPES ───────────────────────────────────────────────────────────────────
type AssetType = "Video Testimonial" | "Written Case Study" | "Quote";
type AssetStatus = "active" | "inactive";

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
  thumbnail: string;
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
  page: "home" | "detail";
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
  --accent:#6d28d9;--accent2:#7c3aed;--accentL:#ede9fe;--accentLL:#f5f3ff;
  --green:#059669;--red:#dc2626;
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
.card{border-radius:var(--r);overflow:hidden;background:#fff;cursor:pointer;transition:all .35s cubic-bezier(.4,0,.2,1);}
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
}

function TCard({asset,onClick,aiData,onCopyQuote}: CardProps) {
  const c=VERT_CLR[asset.vertical]||"#4f46e5";
  const isV=asset.assetType==="Video Testimonial";
  const vid=extractVid(asset.videoUrl);
  let thumb=asset.thumbnail;if(!thumb&&vid?.p==="yt")thumb=ytThumb(vid.id);if(!thumb)thumb="https://images.unsplash.com/photo-1557804506-669a67965ba0?w=640&h=360&fit=crop";
  const cta=CTA_MAP[asset.assetType]||"read";
  return(
    <div className="card" onClick={()=>onClick(asset)}>
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

function QCard({asset,onClick,aiData,onCopyQuote}: CardProps) {
  const c=VERT_CLR[asset.vertical]||"#4f46e5";
  const grad=`linear-gradient(135deg, ${c} 0%, ${c}dd 40%, ${c}99 100%)`;
  return(
    <div className="qcard" onClick={()=>onClick(asset)}>
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

// ─── DETAIL PAGE ─────────────────────────────────────────────────────────────
interface DetailPageProps {
  asset: Asset | null;
  onBack: () => void;
  allAssets: Asset[];
  onSelect: (a: Asset) => void;
}

interface Chapter {
  title: string;
  paras: string[];
}

function DetailPage({asset,onBack,allAssets,onSelect}: DetailPageProps) {
  if(!asset)return null;
  const c=VERT_CLR[asset.vertical]||"#4f46e5";
  const vid=extractVid(asset.videoUrl);
  let thumb=asset.thumbnail;if(!thumb&&vid?.p==="yt")thumb=ytThumb(vid.id);if(!thumb)thumb="https://images.unsplash.com/photo-1557804506-669a67965ba0?w=640&h=360&fit=crop";
  const statParts=asset.outcome.split(/[,;]/).map(s=>s.trim()).filter(Boolean);
  const parseStats=statParts.map(s=>{const m=s.match(/([\d.]+)(%|[A-Z])?/);if(m)return{num:m[1],unit:m[2]||"",label:s.replace(m[0],"").trim().replace(/^[:\-–—]\s*/,"")};return{num:"",unit:"",label:s};}).filter(s=>s.num);
  const paras=asset.transcript.split(/\n\n+/).filter(Boolean);
  const chapters: Chapter[] = [];
  let cur: Chapter = {title:"The Story", paras:[]};
  paras.forEach(p=>{if(p.match(/^(Background|Challenge|Solution|Results|Company|Problem|Implementation):/i)){if(cur.paras.length>0)chapters.push(cur);cur={title:p.split(":")[0].trim(),paras:[p]};}else{cur.paras.push(p);}});
  if(cur.paras.length>0)chapters.push(cur);if(chapters.length===0)chapters.push({title:"The Story",paras:[asset.transcript]});
  const related=(allAssets||[]).filter(a=>a.id!==asset.id).sort((a,b)=>a.vertical===asset.vertical?-1:1).slice(0,3);
  const[activeCh,setActiveCh]=useState(0);
  return(
    <div className="dp">
      <button className="dp-back" onClick={onBack}>← Back to library</button>
      <div className="dp-hero"><div className="dp-hero-img"><img src={thumb} alt={asset.company}/></div><div className="dp-hero-content"><div className="dp-hero-eyebrow"><span className="dp-hero-co">{asset.company}</span><span className="dp-hero-vbadge">{asset.assetType}</span></div><h1>{asset.headline}.</h1><div className="dp-hero-sub">{asset.pullQuote}</div></div></div>
      <div className="dp-summary-bar"><div className="dp-summary"><h3>Summary</h3><p>{asset.pullQuote}</p></div><div className="dp-about"><h3>About</h3><p>{asset.clientName} at {asset.company}. {asset.companySize} employees, {asset.geography}.</p><div className="dp-about-tags"><span className="pill" style={{borderColor:c,color:c}}>{asset.vertical}</span><span className="pill">{asset.geography}</span><span className="pill" style={{borderColor:asset.status==="active"?"var(--green)":"var(--red)",color:asset.status==="active"?"var(--green)":"var(--red)"}}>{asset.status}</span></div></div></div>
      {parseStats.length>0&&<div className="dp-stats">{parseStats.map((s,i)=>(<div className="dp-stat" key={i}><div><span className="dp-stat-num">{s.num}</span><span className="dp-stat-unit">{s.unit}</span></div><div className="dp-stat-label">{s.label||asset.challenge}</div></div>))}</div>}
      {vid&&<div style={{maxWidth:900,margin:"0 auto 28px"}}><div className="dp-video-embed">{vid.p==="yt"?<iframe src={`https://www.youtube.com/embed/${vid.id}`} frameBorder="0" allow="accelerometer;autoplay;clipboard-write;encrypted-media;gyroscope;picture-in-picture" allowFullScreen/>:<iframe src={`https://player.vimeo.com/video/${vid.id}`} frameBorder="0" allow="autoplay;fullscreen;picture-in-picture" allowFullScreen/>}</div></div>}
      <div className="dp-body">
        <nav className="dp-chapters-nav">{chapters.map((ch,i)=>(<button key={i} className={`dp-ch-link ${activeCh===i?"active":""}`} onClick={()=>{setActiveCh(i);document.getElementById(`ch-${i}`)?.scrollIntoView({behavior:"smooth",block:"start"});}}>Ch {i+1}: {ch.title}</button>))}</nav>
        <div className="dp-content">
          {chapters.map((ch,i)=>(<div className="dp-chapter" key={i} id={`ch-${i}`}><div className="dp-chapter-label">Chapter {i+1}</div><h2>{ch.title}</h2>{ch.paras.map((p,pi)=>{const isQ=p.startsWith('"')||p.startsWith('\u201c');if(isQ){const cl=p.replace(/^[^"\u201c]*["\u201c]|["\u201d]$/g,"").replace(/["\u201d]$/,"");return(<div className="dp-bq" key={pi}><blockquote>{cl}</blockquote><div className="dp-bq-name">{asset.clientName}</div><div className="dp-bq-role">{asset.company}</div></div>);}return(<p key={pi}>{p}</p>);})}</div>))}
          <div className="dp-bq"><blockquote>{asset.pullQuote}</blockquote><div className="dp-bq-name">{asset.clientName}</div><div className="dp-bq-role">{asset.company}</div></div>
        </div>
      </div>
      {related.length>0&&<div className="dp-related"><h3>More customer stories</h3><div className="dp-related-grid">{related.map(r=>{const rvid=extractVid(r.videoUrl);const rt=r.thumbnail||(rvid?.p==="yt"?ytThumb(rvid.id):"https://images.unsplash.com/photo-1557804506-669a67965ba0?w=400&h=225&fit=crop");return(<div className="dp-rel-card" key={r.id} onClick={()=>onSelect(r)}>{r.assetType!=="Quote"&&<div className="dp-rel-thumb"><img src={rt} alt={r.company} loading="lazy"/></div>}<div className="dp-rel-body"><div className="dp-rel-label">{r.assetType}</div><div className="dp-rel-title">{r.headline}</div></div></div>);})}</div></div>}
    </div>
  );
}

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
    clientName:enriched?.clientName||meta?.author_name||"—",
    company:enriched?.company||title.split(/[-–|:]/)[0].trim(),
    vertical:enriched?.vertical||"Technology",
    geography:"—",
    companySize:"—",
    challenge:enriched?.challenge||"",
    outcome:enriched?.outcome||"",
    assetType:"Video Testimonial",
    videoUrl:urlInfo.url,
    status:"active",
    dateCreated:new Date().toISOString().split("T")[0],
    headline:enriched?.headline||title,
    pullQuote:enriched?.pullQuote||desc.substring(0,200),
    transcript:desc||"Transcript pending — paste or generate here.",
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
}

interface Progress {
  step: string;
  count: number;
  total: number | "?";
  done?: boolean;
  error?: boolean;
}

function SourcesPanel({sources,assets,onAddSource,onRemoveSource,onSyncSource,onAddAssets}: SourcesPanelProps) {
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
      // Override with rich data we already have from Vimeo (higher quality than oEmbed)
      if(v.title&&!asset.headline)asset.headline=v.title;
      if(v.thumbnail)asset.thumbnail=v.thumbnail;
      // Real auto-transcribed captions beat everything else
      if(v.transcript)asset.transcript=v.transcript;
      else if(v.description&&!asset.transcript)asset.transcript=v.description;
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

  // Re-sync an existing source
  const doSync=async(source: Source)=>{
    setSyncingId(source.id);
    const videos=await extractShowcaseVideos(source.url);
    const existingAssetIds=new Set(source.assetIds||[]);
    const existingAssets=assets.filter(a=>existingAssetIds.has(a.id));
    const existingUrls=new Set(existingAssets.map(a=>a.videoUrl));
    const newUrls=videos.filter(v=>!existingUrls.has(v.url));
    const newAssets: Asset[] = [];
    for(const v of newUrls){
      const info=detectUrlType(v.url);
      if(!info||info.kind==="unknown")continue;
      const asset=await importSingleVideo(info,source.id);
      if(v.title&&!asset.headline)asset.headline=v.title;
      newAssets.push(asset);
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
                      onClick={()=>{if(confirm(`Remove source "${s.name}"? (Assets will remain in your library.)`))onRemoveSource(s.id);}}
                      title="Remove source"
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

// ─── ADMIN: ASSETS PANEL ─────────────────────────────────────────────────────
interface AssetsPanelProps {
  assets: Asset[];
  onUpdate: (a: Asset) => void;
  onDelete: (id: string) => void;
  onAdd: (a: Asset) => void;
  onPreview: (id: string) => void;
}

function AssetsPanel({assets,onUpdate,onDelete,onAdd,onPreview}: AssetsPanelProps) {
  const[editingId,setEditingId]=useState<string|null>(null);
  const[search,setSearch]=useState("");
  const[form,setForm]=useState<Asset|null>(null);
  const[creating,setCreating]=useState(false);

  const editing=editingId?assets.find(a=>a.id===editingId):null;
  useEffect(()=>{
    if(editing)setForm({...editing});
    else if(creating)setForm({id:`new-${Date.now()}`,clientName:"",company:"",vertical:"Healthcare",geography:"Northeast US",companySize:"50-200",challenge:"",outcome:"",assetType:"Video Testimonial",videoUrl:"",status:"active",headline:"",pullQuote:"",transcript:"",thumbnail:"",dateCreated:new Date().toISOString().split("T")[0]});
    else setForm(null);
  },[editingId,creating]);

  const s=(k: keyof Asset, v: string) => setForm(p => p ? {...p, [k]: v} : p);
  const save=()=>{if(!form)return;if(creating){onAdd(form);setCreating(false);setEditingId(form.id);}else{onUpdate(form);setEditingId(null);}};
  const del=()=>{if(editingId&&confirm("Delete this asset?")){onDelete(editingId);setEditingId(null);}};

  const filtered=assets.filter(a=>{if(!search)return true;const q=search.toLowerCase();return a.company.toLowerCase().includes(q)||a.clientName.toLowerCase().includes(q)||a.vertical.toLowerCase().includes(q);});

  if(form){
    return(
      <React.Fragment>
        <div className="ap-head">
          <div className="ap-edit-head">
            <button className="ap-back" onClick={()=>{setEditingId(null);setCreating(false);}}>← Back</button>
            <div className="ap-title" style={{fontSize:15}}>{creating?"New Asset":"Edit Asset"}</div>
            {!creating&&editingId&&<button className="ap-preview-btn" onClick={()=>onPreview(editingId)}>Preview</button>}
          </div>
          {!creating&&<div className="ap-sub">{editing?.company} · {editing?.vertical}</div>}
        </div>
        <div className="ap-body edit-form">
          <div className="frow">
            <div className="fgrp"><label>Client Name *</label><input className="fin" value={form.clientName} onChange={e=>s("clientName",e.target.value)}/></div>
            <div className="fgrp"><label>Company *</label><input className="fin" value={form.company} onChange={e=>s("company",e.target.value)}/></div>
          </div>
          <div className="frow">
            <div className="fgrp"><label>Vertical</label><select className="fss" value={form.vertical} onChange={e=>s("vertical",e.target.value)}>{VERTICALS.filter(v=>v!=="All").map(v=>(<option key={v}>{v}</option>))}</select></div>
            <div className="fgrp"><label>Type</label><select className="fss" value={form.assetType} onChange={e=>s("assetType",e.target.value)}>{ASSET_TYPES.filter(v=>v!=="All").map(v=>(<option key={v}>{v}</option>))}</select></div>
          </div>
          <div className="frow">
            <div className="fgrp"><label>Geography</label><input className="fin" value={form.geography} onChange={e=>s("geography",e.target.value)}/></div>
            <div className="fgrp"><label>Size</label><input className="fin" value={form.companySize} onChange={e=>s("companySize",e.target.value)}/></div>
          </div>
          <div className="frow">
            <div className="fgrp"><label>Status</label><select className="fss" value={form.status} onChange={e=>s("status",e.target.value)}><option value="active">Active</option><option value="inactive">Inactive</option></select></div>
            <div className="fgrp"><label>Challenge</label><input className="fin" value={form.challenge} onChange={e=>s("challenge",e.target.value)}/></div>
          </div>
          <div className="fgrp"><label>Headline</label><input className="fin" value={form.headline} onChange={e=>s("headline",e.target.value)}/></div>
          <div className="fgrp"><label>Outcome</label><input className="fin" value={form.outcome} onChange={e=>s("outcome",e.target.value)}/></div>
          <div className="fgrp"><label>Pull Quote</label><textarea className="ftxt" style={{minHeight:60}} value={form.pullQuote} onChange={e=>s("pullQuote",e.target.value)}/></div>
          <div className="fgrp"><label>Video URL</label><input className="fin" value={form.videoUrl} onChange={e=>s("videoUrl",e.target.value)}/></div>
          <div className="fgrp"><label>Thumbnail URL</label><input className="fin" value={form.thumbnail} onChange={e=>s("thumbnail",e.target.value)} placeholder="Auto from YouTube"/></div>
          <div className="fgrp"><label>Transcript / Content</label><textarea className="ftxt" value={form.transcript} onChange={e=>s("transcript",e.target.value)}/></div>
          <div className="edit-save">
            <button className="save-btn" onClick={save}>{creating?"Create":"Save changes"}</button>
            {!creating&&<button className="del-btn" onClick={del}>Delete</button>}
          </div>
        </div>
      </React.Fragment>
    );
  }

  return(
    <React.Fragment>
      <div className="ap-head">
        <div className="ap-title">Assets</div>
        <div className="ap-sub">{assets.length} testimonials in your library</div>
      </div>
      <div className="ap-body">
        <input className="asset-search" placeholder="Search assets..." value={search} onChange={e=>setSearch(e.target.value)}/>
        <button className="sbtn" style={{width:"100%",padding:"8px",borderRadius:"7px",border:"1px dashed var(--border2)",background:"var(--bg2)",color:"var(--t2)",fontFamily:"var(--font)",fontSize:12,fontWeight:600,cursor:"pointer",marginBottom:12}} onClick={()=>setCreating(true)}>+ Add new asset</button>
        <div className="asset-list">
          {filtered.map(a=>{
            const c=VERT_CLR[a.vertical]||"#4f46e5";
            const vid=extractVid(a.videoUrl);
            let thumb=a.thumbnail;if(!thumb&&vid?.p==="yt")thumb=ytThumb(vid.id);
            const isQ=a.assetType==="Quote";
            return(
              <div key={a.id} className="asset-row" onClick={()=>setEditingId(a.id)}>
                <div className="asset-row-thumb" style={isQ?{background:c}:{}}>
                  {isQ?<div className="asset-row-quote">"</div>:thumb?<img src={thumb} alt={a.company}/>:null}
                </div>
                <div className="asset-row-info">
                  <div className="asset-row-co">{a.company}</div>
                  <div className="asset-row-meta">{a.vertical} · {a.assetType==="Video Testimonial"?"Video":a.assetType==="Written Case Study"?"Case Study":"Quote"}</div>
                </div>
                <div className={`asset-row-status ${a.status}`}/>
              </div>
            );
          })}
        </div>
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
  const[sources,setSources]=useState<Source[]>([]); // video sources (showcases, playlists)

  // StoryMatch state
  const[smOpen,setSmOpen]=useState(false);
  const[smQuery,setSmQuery]=useState("");
  const[smMode,setSmMode]=useState<"describe"|"prospect">("describe");
  const[smLoading,setSmLoading]=useState(false);
  const[smResults,setSmResults]=useState<AIMatchResult[]|null>(null);

  useEffect(()=>{
    const h=()=>{const hash=window.location.hash.slice(1);if(hash.startsWith("/asset/"))setRoute({page:"detail",id:hash.split("/asset/")[1]});else setRoute({page:"home",id:null});};
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

  const runStoryMatch=useCallback(async(query: string)=>{
    if(!query.trim())return;setSmLoading(true);setSmResults(null);
    const hasUrl=query.match(/https?:\/\/[^\s]+/);
    let ctx="";
    if(hasUrl){try{const r=await fetch("https://api.anthropic.com/v1/messages",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({model:"claude-sonnet-4-20250514",max_tokens:800,tools:[{type:"web_search_20250305",name:"web_search"}],messages:[{role:"user",content:`Visit ${hasUrl[0]} and summarize: what they do, industry, size, who they serve, likely pain points. 3-4 sentences only, no markdown.`}]})});const d=await r.json();ctx=(d.content||[]).filter((c:{type:string})=>c.type==="text").map((c:{text:string})=>c.text).join(" ");}catch{}}
    const s=assets.map(a=>`[ID:${a.id}] ${a.company}|${a.clientName}|${a.vertical}|${a.geography}|${a.companySize}|${a.challenge}|${a.assetType}|${a.status}|${a.outcome}\n${a.transcript.substring(0,700)}`).join("\n---\n");
    const prompt=ctx?`Sales enablement AI. Prospect context:\n${ctx}\n\nSalesperson: "${query}"\n\nMatch prospect to assets. Explain why each resonates.`:`Sales enablement AI. Need: "${query}"\n\nMatch against assets by vertical, size, geography, challenge, persona.`;
    try{const r=await fetch("https://api.anthropic.com/v1/messages",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({model:"claude-sonnet-4-20250514",max_tokens:1000,messages:[{role:"user",content:`${prompt}\n\nAssets:\n${s}\n\nReturn ONLY valid JSON array. Top 3-5. Each: {"id":"","reasoning":"","quotes":[""],"relevanceScore":0}. No matches? [].`}]})});const d=await r.json();const t=(d.content||[]).map((i:{text?:string})=>i.text||"").join("")||"[]";const p=JSON.parse(t.replace(/```json|```/g,"").trim()) as Omit<AIMatchResult,"rank">[];setSmResults(p.map((r,i)=>({...r,rank:i+1})));setSmOpen(false);}catch{setSmResults([]);setSmOpen(false);}setSmLoading(false);
  },[assets]);

  const clearSm=()=>{setSmResults(null);setSmQuery("");};

  const descEx=["Quotes from clients with under 500 employees","Video testimonials mentioning ROI","Healthcare or financial services case studies","Legacy system migration stories","Strongest proof for enterprise buyers","Southeast clients on implementation speed"];
  const prosEx=["Series B fintech, 120 emp, selling to CFO on onboarding speed","Regional hospital, Southeast, CTO modernizing patient experience","Mid-market manufacturer, Ohio, VP Ops worried about QC"];

  // Determine what to show in the grid
  let displayAssets: Asset[];
  const aiDataMap: Record<string, AIMatchResult> = {};
  if(smResults&&smResults.length>0){
    const matchedIds=smResults.map(r=>r.id);
    displayAssets=matchedIds.map(id=>assets.find(a=>a.id===id)).filter((a): a is Asset => a !== undefined);
    smResults.forEach(r=>{aiDataMap[r.id]=r;});
  } else {
    displayAssets=assets.filter(a=>{
      if(filters.vertical.length>0&&!filters.vertical.includes(a.vertical))return false;
      if(filters.assetType.length>0&&!filters.assetType.includes(a.assetType))return false;
      if(search){const s=search.toLowerCase();if(!a.company.toLowerCase().includes(s)&&!a.clientName.toLowerCase().includes(s)&&!a.vertical.toLowerCase().includes(s)&&!a.headline.toLowerCase().includes(s))return false;}
      return true;
    });
  }
  const anyFilter=filters.vertical.length>0||filters.assetType.length>0;
  const detailAsset=route.page==="detail"?assets.find(a=>a.id===route.id)||null:null;

  if(route.page==="detail"){
    return(<React.Fragment><style>{css}</style><div style={{minHeight:"100vh",background:"var(--bg)"}}>
      <header className="hdr"><div className="logo" onClick={goHome} style={{cursor:"pointer",fontFamily:"var(--serif)",fontSize:20,fontWeight:500,letterSpacing:-.4,color:"var(--t1)"}}>StoryMatch</div><div className="hdr-r"><span className="badge">{assets.length} assets</span></div></header>
      <DetailPage asset={detailAsset} onBack={goHome} allAssets={assets} onSelect={openAsset}/>
    </div></React.Fragment>);
  }

  return (
    <React.Fragment>
      <style>{css}</style>
      <div style={{minHeight:"100vh",background:"var(--bg)"}}>

        <header className="hdr">
          <div className="logo" onClick={goHome} style={{cursor:"pointer",fontFamily:"var(--serif)",fontSize:20,fontWeight:500,letterSpacing:-.4,color:"var(--t1)"}}>
            StoryMatch
          </div>
          <div className="hdr-r">
            <span className="badge">{assets.length} assets</span>
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
              <button
                className={`rail-btn ${adminSection==="assets"?"on":""}`}
                onClick={()=>setAdminSection(adminSection==="assets"?null:"assets")}
                title="Assets"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <rect x="3" y="3" width="7" height="7" rx="1"/>
                  <rect x="14" y="3" width="7" height="7" rx="1"/>
                  <rect x="3" y="14" width="7" height="7" rx="1"/>
                  <rect x="14" y="14" width="7" height="7" rx="1"/>
                </svg>
                Assets
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
                    if(!confirm("Remove this source? Assets already imported will remain in your library."))return;
                    setSources(p=>p.filter(s=>s.id!==id));
                    try{
                      const r=await fetch(`/api/sources?id=${id}`,{method:"DELETE",headers:await authHeaders()});
                      if(!r.ok)throw new Error("Delete failed");
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
                      setToast(arr.length>1?`Saved ${arr.length} assets`:"Saved");
                    }catch(e){
                      console.error(e);
                      setToast("Save failed");
                    }
                    setTimeout(()=>setToast(null),2000);
                  }}
                />
              )}
              {adminSection==="assets" && (
                <AssetsPanel
                  assets={assets}
                  onUpdate={async u=>{
                    // Optimistic UI: update local state immediately
                    setAssets(p=>p.map(a=>a.id===u.id?u:a));
                    setToast("Saving…");
                    try{
                      const r=await fetch("/api/assets",{
                        method:"PUT",
                        headers:{"Content-Type":"application/json",...(await authHeaders())},
                        body:JSON.stringify(u)
                      });
                      if(!r.ok)throw new Error("Save failed");
                      setToast("Saved");
                    }catch(e){
                      console.error(e);
                      setToast("Save failed");
                    }
                    setTimeout(()=>setToast(null),1500);
                  }}
                  onDelete={async id=>{
                    if(!confirm("Delete this asset? This cannot be undone."))return;
                    setAssets(p=>p.filter(a=>a.id!==id));
                    setToast("Deleting…");
                    try{
                      const r=await fetch(`/api/assets?id=${id}`,{method:"DELETE",headers:await authHeaders()});
                      if(!r.ok)throw new Error("Delete failed");
                      setToast("Deleted");
                    }catch(e){
                      console.error(e);
                      setToast("Delete failed");
                    }
                    setTimeout(()=>setToast(null),1500);
                  }}
                  onAdd={async a=>{
                    setAssets(p=>[a,...p]);
                    setToast("Creating…");
                    try{
                      const r=await fetch("/api/assets",{
                        method:"POST",
                        headers:{"Content-Type":"application/json",...(await authHeaders())},
                        body:JSON.stringify(a)
                      });
                      if(!r.ok)throw new Error("Create failed");
                      setToast("Created");
                    }catch(e){
                      console.error(e);
                      setToast("Create failed");
                    }
                    setTimeout(()=>setToast(null),1500);
                  }}
                  onPreview={id=>{
                    const a=assets.find(x=>x.id===id);
                    if(a)openAsset(a);
                  }}
                />
              )}
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
              ) : (
                <div className="grid">
                  {displayAssets.map(a=>{
                    const ai=aiDataMap[a.id]||null;
                    return a.assetType==="Quote"
                      ? <QCard key={a.id} asset={a} onClick={openAsset} aiData={ai} onCopyQuote={copyQuote}/>
                      : <TCard key={a.id} asset={a} onClick={openAsset} aiData={ai} onCopyQuote={copyQuote}/>;
                  })}
                </div>
              )}
            </div>

          </div>
        </div>

        {toast && <div className="toast">{toast}</div>}
      </div>
    </React.Fragment>
  );
}
