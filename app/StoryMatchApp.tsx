"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";

// ─── DATA ────────────────────────────────────────────────────────────────────
const SEED = [
  { id:"1",clientName:"Sarah Chen",company:"Meridian Logistics",vertical:"Logistics",geography:"Southeast US",companySize:"500-1000",challenge:"Legacy System Migration",outcome:"40% reduction in processing time",assetType:"Video Testimonial",status:"active",dateCreated:"2025-11-15",headline:"From legacy chaos to streamlined operations",pullQuote:"Within three months of switching, our team was processing orders 40% faster — and actually enjoying their work again.",thumbnail:"https://images.unsplash.com/photo-1586528116311-ad8dd3c8310d?w=640&h=360&fit=crop",videoUrl:"https://vimeo.com/example1",transcript:"Sarah Chen, VP of Operations at Meridian Logistics:\n\n\"When we first looked at replacing our legacy ERP system, honestly, the team was terrified. We'd been running on the same platform for 12 years. Every workaround was someone's baby. But the pain was real — we were losing two hours a day per person on manual data entry.\n\nThe implementation team understood that. They didn't come in and say 'rip everything out.' They mapped our workflows first, found the 80/20 — the 20% of processes causing 80% of the pain — and built the migration path around that.\n\nWithin three months, we had the core system live. Within six months, we'd migrated everything. Our processing time dropped 40%. Our error rate went from 4.2% to under 0.5%.\n\nIf you're a logistics company still running on a legacy platform and you're scared to switch — I get it. We were too. But the cost of staying was so much higher than the cost of changing.\"" },
  { id:"2",clientName:"Marcus Rivera",company:"BrightPath Health",vertical:"Healthcare",geography:"Northeast US",companySize:"1000-5000",challenge:"Patient Engagement",outcome:"68% increase in portal adoption",assetType:"Written Case Study",status:"active",dateCreated:"2025-09-22",headline:"Transforming patient engagement overnight",pullQuote:"Our patients weren't disengaged — they were frustrated. Once we gave them a portal that actually worked, adoption went through the roof.",thumbnail:"https://images.unsplash.com/photo-1519494026892-80bbd2d6fd0d?w=640&h=360&fit=crop",videoUrl:"",transcript:"BrightPath Health Case Study\n\nBackground: BrightPath Health serves 200,000+ patients across 14 facilities in the Northeast US.\n\nChallenge: Low patient portal adoption hovering at 23%. \"Our patients weren't disengaged — they were frustrated,\" explains Marcus Rivera, CDO. \"Booking an appointment took 11 clicks.\"\n\nSolution: Unified access, AI-powered scheduling, real-time messaging.\n\nResults: Portal adoption 23% → 91%. Booking time 4.5min → 38sec. NPS +22 → +54. No-show rate 18% → 7%. Support calls down 41%.\n\nMarcus: \"We saved $2.1M in year one. But the real win? Patients come to appointments better prepared and more engaged in their own care.\"" },
  { id:"3",clientName:"James Whitfield",company:"Cornerstone Mfg",vertical:"Manufacturing",geography:"Midwest US",companySize:"200-500",challenge:"Compliance & QC",outcome:"92% reduction in incidents",assetType:"Video Testimonial",status:"active",dateCreated:"2025-07-10",headline:"Eliminated compliance nightmares for good",pullQuote:"We went from dreading audits to welcoming them. That's not something I ever thought I'd say.",thumbnail:"https://images.unsplash.com/photo-1581091226825-a6a2a5aee158?w=640&h=360&fit=crop",videoUrl:"https://vimeo.com/example3",transcript:"James Whitfield, Director of QA at Cornerstone Manufacturing:\n\n\"Manufacturing compliance isn't glamorous. But when you get it wrong, the consequences are devastating — fines, shutdowns, lost contracts.\n\nWe were managing compliance across three facilities with spreadsheets and paper logs. Every audit season was a three-week scramble.\n\nThe platform changed everything. Every inspection, every test result — all captured digitally with automatic audit trails. When our FDA auditor came last quarter, I pulled up 18 months of compliance history in 30 seconds.\n\nWe went from dreading audits to welcoming them. 92% reduction in compliance incidents, $1.8M in avoided penalties.\"" },
  { id:"4",clientName:"Priya Sharma",company:"Elevate Financial",vertical:"Financial Services",geography:"West Coast US",companySize:"50-200",challenge:"Client Onboarding",outcome:"Onboarding: 14 days to 3 days",assetType:"Written Case Study",status:"active",dateCreated:"2026-01-08",headline:"Cut client onboarding from two weeks to three days",pullQuote:"Our clients are high-net-worth individuals who expect white-glove service. A 14-day onboarding process was telling them we didn't value their time.",thumbnail:"https://images.unsplash.com/photo-1554224155-6726b3ff858f?w=640&h=360&fit=crop",videoUrl:"",transcript:"Elevate Financial Case Study\n\nCompany: Boutique wealth management, $2.3B AUM, ~400 HNW clients, team of 85.\n\nProblem: 14-day onboarding with 23 touchpoints and 7 document collection steps.\n\nResults: Onboarding 14 days → 3 days. Client satisfaction 67% → 95%. Doc errors down 88%. Advisor time per client 6hrs → 45min. Referral rate up 34%.\n\nPriya: \"They understood that for our clients, onboarding IS the first impression. Now new clients tell us it was the smoothest financial experience they've ever had.\"" },
  { id:"5",clientName:"David Park",company:"Atlas Retail Group",vertical:"Retail",geography:"National US",companySize:"5000+",challenge:"Inventory Optimization",outcome:"$4.2M annual savings",assetType:"Video Testimonial",status:"inactive",dateCreated:"2024-03-18",headline:"Solved their $4M overstock problem with AI",pullQuote:"We were sitting on $12M in dead inventory. Turns out, we were using last year's weather to predict this year's demand.",thumbnail:"https://images.unsplash.com/photo-1441986300917-64674bd600d8?w=640&h=360&fit=crop",videoUrl:"https://vimeo.com/example5",transcript:"David Park, SVP Supply Chain at Atlas Retail Group:\n\n\"Retail inventory is a high-wire act. We were losing on both ends — $12M in dead inventory and stockouts on bestsellers.\n\nThe AI-powered platform integrates real-time signals. First year: 23% reduction in overstock across 340 locations. $4.2M saved. Stockouts dropped 31%.\"" },
  { id:"6",clientName:"Rachel Torres",company:"Greenfield Education",vertical:"Education",geography:"Southeast US",companySize:"50-200",challenge:"Student Retention",outcome:"28% retention improvement",assetType:"Quote",status:"active",dateCreated:"2025-06-30",headline:"Early intervention AI changed everything",pullQuote:"We were losing students silently. By the time a professor flagged a struggling student, they'd already mentally checked out. Now we catch them in week two, not week twelve.",thumbnail:"",videoUrl:"",transcript:"Rachel Torres, Dean of Student Success:\n\n\"We were losing students silently. By the time a professor flagged a struggling student, they'd already mentally checked out. Now we catch them in week two, not week twelve.\n\nOur early intervention success rate is 85%. Overall retention improved 28%. For a university our size, that's transformative.\"" },
  { id:"7",clientName:"Tom Nakamura",company:"Pacific Coast Properties",vertical:"Real Estate",geography:"West Coast US",companySize:"200-500",challenge:"Lease Management",outcome:"Recovered $800K in missed revenue",assetType:"Written Case Study",status:"active",dateCreated:"2025-12-05",headline:"Recovered $800K in missed lease revenue",pullQuote:"We discovered we'd been under-collecting on 34 leases for over two years. The system paid for itself in the first month.",thumbnail:"https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=640&h=360&fit=crop",videoUrl:"",transcript:"Tom Nakamura, VP Asset Management: \"Commercial lease management is deceptively complex. We missed rent escalation dates on 34 leases. Total: $800,000.\n\nResults: Lease processing time down 60%. Zero missed escalations. Recovered $800K. CAM reconciliation time cut 70%. The system paid for itself in month one.\"" },
  { id:"8",clientName:"Angela Foster",company:"NovaTech Solutions",vertical:"Technology",geography:"National US",companySize:"1000-5000",challenge:"Sales Enablement",outcome:"Win rate: 22% to 34%",assetType:"Video Testimonial",status:"active",dateCreated:"2026-02-14",headline:"Sales team went from 22% to 34% win rate",pullQuote:"Our reps were spending more time looking for content than talking to prospects. Now the right case study finds them.",thumbnail:"https://images.unsplash.com/photo-1553877522-43269d4ea984?w=640&h=360&fit=crop",videoUrl:"https://vimeo.com/example8",transcript:"Angela Foster, CRO at NovaTech Solutions:\n\n\"200 reps, thousands of pieces of content, no intelligent way to connect the two. The average rep spent 7.2 hours per week searching for content.\n\nWin rate: 22% → 34%. Sales cycle shortened 50%. Content utilization 12% → 67%.\"" },
  { id:"9",clientName:"Elena Vasquez",company:"Summit HR",vertical:"Technology",geography:"National US",companySize:"200-500",challenge:"Employee Retention",outcome:"Turnover decreased 35%",assetType:"Quote",status:"active",dateCreated:"2025-10-12",headline:"Predictive analytics saved their best people",pullQuote:"We stopped guessing who was about to leave and started knowing. The model flagged our top performer three weeks before she updated her LinkedIn. We saved her — and seven others that quarter.",thumbnail:"",videoUrl:"",transcript:"Elena Vasquez, CHRO at Summit HR:\n\n\"We stopped guessing who was about to leave and started knowing. Turnover decreased 35%. We estimate we saved $2.8M in replacement costs in the first year.\"" },
];

const VERTICALS=["All","Logistics","Healthcare","Manufacturing","Financial Services","Retail","Education","Real Estate","Technology"];
const ASSET_TYPES=["All","Video Testimonial","Written Case Study","Quote"];
const VERT_CLR={Logistics:"#2563eb",Healthcare:"#059669",Manufacturing:"#d97706","Financial Services":"#7c3aed",Retail:"#db2777",Education:"#0891b2","Real Estate":"#65a30d",Technology:"#4f46e5"};
const CTA_MAP={"Video Testimonial":"watch","Written Case Study":"read","Quote":"quote"};

function extractVid(url){if(!url)return null;let m=url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([^&?#]+)/);if(m)return{p:"yt",id:m[1]};m=url.match(/vimeo\.com\/(?:video\/)?(\d+)/);if(m)return{p:"vm",id:m[1]};return null;}
function ytThumb(id){return`https://img.youtube.com/vi/${id}/hqdefault.jpg`;}

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
.admin-rail{width:64px;background:#fff;border-right:1px solid var(--border);display:flex;flex-direction:column;align-items:center;padding:12px 0;flex-shrink:0;}
.rail-btn{width:44px;height:44px;border-radius:10px;border:none;background:none;color:var(--t3);cursor:pointer;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;font-family:var(--font);font-size:9px;font-weight:600;transition:all .12s;margin-bottom:4px;position:relative;}
.rail-btn:hover{background:var(--bg2);color:var(--t1);}
.rail-btn.on{background:var(--accentL);color:var(--accent);}
.rail-btn.on::before{content:'';position:absolute;left:-12px;top:50%;transform:translateY(-50%);width:3px;height:24px;background:var(--accent);border-radius:0 3px 3px 0;}
.rail-btn svg{flex-shrink:0;}
.rail-btn.disabled{opacity:.35;cursor:not-allowed;}
.rail-btn.disabled:hover{background:none;color:var(--t3);}
.rail-btn .rail-soon{position:absolute;top:2px;right:2px;background:var(--t4);color:#fff;font-size:7px;font-weight:700;padding:1px 3px;border-radius:3px;letter-spacing:.3px;}
.rail-spacer{flex:1;}
.rail-collapse{width:36px;height:28px;border-radius:6px;border:1px solid var(--border);background:#fff;color:var(--t3);cursor:pointer;display:grid;place-items:center;transition:all .12s;margin-bottom:6px;}
.rail-collapse:hover{border-color:var(--accent);color:var(--accent);background:var(--accentLL);}
.rail-divider{width:32px;height:1px;background:var(--border);margin:4px auto 10px;}
.rail-toggle{width:32px;height:32px;border-radius:8px;border:1px solid var(--border);background:#fff;color:var(--t3);cursor:pointer;display:grid;place-items:center;margin:0 auto;transition:all .12s;}
.rail-toggle:hover{border-color:var(--accent);color:var(--accent);background:var(--accentLL);}
.rail-toggle .admin-pull-dots span{width:3px;height:3px;}

.admin-pull{position:fixed;left:0;top:50%;transform:translateY(-50%);width:32px;height:64px;border-radius:0 10px 10px 0;border:1px solid var(--border);border-left:none;background:#fff;color:var(--t2);cursor:pointer;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;z-index:25;box-shadow:2px 2px 12px rgba(0,0,0,.08);transition:all .15s;}
.admin-pull:hover{width:38px;color:var(--accent);border-color:var(--accent);background:var(--accentLL);}
.admin-pull-dots{display:flex;flex-direction:column;gap:3px;}
.admin-pull-dots span{display:block;width:4px;height:4px;border-radius:50%;background:currentColor;}

.admin-panel{width:340px;background:#fff;border-right:1px solid var(--border);display:flex;flex-direction:column;flex-shrink:0;overflow:hidden;animation:fadeIn .2s ease;}
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
function TCard({asset,onClick,aiData,onCopyQuote}){
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

function QCard({asset,onClick,aiData,onCopyQuote}){
  const c=VERT_CLR[asset.vertical]||"#4f46e5";
  const grad=`linear-gradient(135deg, ${c} 0%, ${c}dd 40%, ${c}99 100%)`;
  return(
    <div className="qcard" onClick={()=>onClick(asset)}>
      {aiData&&<div className="card-rank" style={{position:"absolute",top:12,left:12,zIndex:3}}>{aiData.rank}</div>}
      <div className="qcard-bg" style={{"--qgrad":grad}}/>
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
function DetailPage({asset,onBack,allAssets,onSelect}){
  if(!asset)return null;
  const c=VERT_CLR[asset.vertical]||"#4f46e5";
  const vid=extractVid(asset.videoUrl);
  let thumb=asset.thumbnail;if(!thumb&&vid?.p==="yt")thumb=ytThumb(vid.id);if(!thumb)thumb="https://images.unsplash.com/photo-1557804506-669a67965ba0?w=640&h=360&fit=crop";
  const statParts=asset.outcome.split(/[,;]/).map(s=>s.trim()).filter(Boolean);
  const parseStats=statParts.map(s=>{const m=s.match(/([\d.]+)(%|[A-Z])?/);if(m)return{num:m[1],unit:m[2]||"",label:s.replace(m[0],"").trim().replace(/^[:\-–—]\s*/,"")};return{num:"",unit:"",label:s};}).filter(s=>s.num);
  const paras=asset.transcript.split(/\n\n+/).filter(Boolean);
  const chapters=[];let cur={title:"The Story",paras:[]};
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
      {related.length>0&&<div className="dp-related"><h3>More customer stories</h3><div className="dp-related-grid">{related.map(r=>{const rt=r.thumbnail||(extractVid(r.videoUrl)?.p==="yt"?ytThumb(extractVid(r.videoUrl).id):"https://images.unsplash.com/photo-1557804506-669a67965ba0?w=400&h=225&fit=crop");return(<div className="dp-rel-card" key={r.id} onClick={()=>onSelect(r)}>{r.assetType!=="Quote"&&<div className="dp-rel-thumb"><img src={rt} alt={r.company} loading="lazy"/></div>}<div className="dp-rel-body"><div className="dp-rel-label">{r.assetType}</div><div className="dp-rel-title">{r.headline}</div></div></div>);})}</div></div>}
    </div>
  );
}

// ─── ADMIN: IMPORT PANEL ─────────────────────────────────────────────────────

// Detect the kind of URL pasted
function detectUrlType(url){
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
function parseUrls(text){
  return text
    .split(/[\s,]+/)
    .map(s=>s.trim())
    .filter(s=>s.startsWith("http"))
    .map(detectUrlType)
    .filter(Boolean);
}

// Fetch oEmbed metadata — returns {data, error}
async function fetchOEmbed(urlInfo){
  try{
    let endpoint;
    if(urlInfo.kind.startsWith("yt"))endpoint=`https://www.youtube.com/oembed?url=${encodeURIComponent(urlInfo.url)}&format=json`;
    else if(urlInfo.kind.startsWith("vm"))endpoint=`https://vimeo.com/api/oembed.json?url=${encodeURIComponent(urlInfo.url)}`;
    else return{data:null,error:"Unsupported URL"};
    const r=await fetch(endpoint);
    if(!r.ok)return{data:null,error:`${r.status} ${r.statusText}`};
    const data=await r.json();
    return{data,error:null};
  }catch(e){
    return{data:null,error:e.message||"Network error"};
  }
}

// Ask Claude to infer business metadata from video title/description
async function enrichWithClaude(oembed,urlInfo){
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
    const txt=(d.content||[]).filter(c=>c.type==="text").map(c=>c.text).join("");
    const jm=txt.match(/\{[\s\S]*\}/);
    if(jm)return JSON.parse(jm[0]);
  }catch{}
  return{};
}


// Extract video URLs from a showcase/playlist page using Claude + web search
async function extractShowcaseVideos(sourceUrl){
  try{
    const r=await fetch("https://api.anthropic.com/v1/messages",{
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({
        model:"claude-sonnet-4-20250514",
        max_tokens:2500,
        tools:[{type:"web_search_20250305",name:"web_search"}],
        messages:[{role:"user",content:`Visit this video showcase/playlist URL and extract every individual video it contains: ${sourceUrl}

For each video, return its direct video URL (like https://vimeo.com/123456789 or https://youtube.com/watch?v=ABC) and title if visible.

Search thoroughly — look for embedded players, metadata, and any linked video pages. If the showcase/playlist page itself doesn't show individual URLs, search for the collection by name to find individual videos.

Return ONLY valid JSON (no markdown fences, no preamble):
[{"url": "direct video URL", "title": "video title"}, ...]

If you cannot find any videos, return: []`}]
      })
    });
    const d=await r.json();
    const txt=(d.content||[]).filter(c=>c.type==="text").map(c=>c.text).join("");
    const jm=txt.match(/\[[\s\S]*\]/);
    if(jm){
      const arr=JSON.parse(jm[0]);
      // Filter to only those with valid URLs
      return arr.filter(v=>v.url&&(v.url.includes("vimeo.com")||v.url.includes("youtube.com")||v.url.includes("youtu.be")));
    }
  }catch(e){console.error("extractShowcaseVideos failed",e);}
  return[];
}

// Import a single video URL into an asset (oEmbed + Claude enrichment)
async function importSingleVideo(urlInfo,sourceId){
  const {data:oe}=await fetchOEmbed(urlInfo);
  let enriched={};
  let meta=oe;
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
  const thumb=meta?.thumbnail_url||(urlInfo.kind==="yt-video"?ytThumb(urlInfo.id):"");
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
function SourcesPanel({sources,assets,onAddSource,onRemoveSource,onSyncSource,onAddAssets}){
  const[view,setView]=useState("list"); // list | add
  const[mode,setMode]=useState("source"); // source | single
  const[url,setUrl]=useState("");
  const[name,setName]=useState("");
  const[working,setWorking]=useState(false);
  const[progress,setProgress]=useState(null);
  const[syncingId,setSyncingId]=useState(null);

  const detected=url.trim()?detectUrlType(url.trim()):null;
  const isCollection=detected&&(detected.kind==="vm-showcase"||detected.kind==="yt-playlist");
  const isSingle=detected&&(detected.kind==="vm-video"||detected.kind==="yt-video");

  const typeLabel=(k)=>k==="yt-video"?"YouTube video":k==="yt-playlist"?"YouTube playlist":k==="vm-video"?"Vimeo video":k==="vm-showcase"?"Vimeo showcase":"Unknown";

  // Add a collection source — extract all videos and create assets
  const addCollectionSource=async()=>{
    if(!detected||!isCollection)return;
    setWorking(true);
    setProgress({step:"Extracting video list from showcase…",count:0,total:"?"});
    const videos=await extractShowcaseVideos(detected.url);
    if(videos.length===0){
      setProgress({step:`No videos could be extracted. Source saved — try "Sync" later.`,count:0,total:0,done:true,error:true});
      const source={id:`src-${Date.now()}`,name:name||`${typeLabel(detected.kind)}`,url:detected.url,type:detected.kind,status:"error",lastSync:new Date().toISOString(),videoCount:0,assetIds:[]};
      onAddSource(source);
      setWorking(false);
      setTimeout(()=>{setProgress(null);setView("list");setUrl("");setName("");},2500);
      return;
    }
    setProgress({step:`Found ${videos.length} videos. Importing…`,count:0,total:videos.length});
    const sourceId=`src-${Date.now()}`;
    const newAssets=[];
    for(let i=0;i<videos.length;i++){
      const v=videos[i];
      const info=detectUrlType(v.url);
      if(!info||info.kind==="unknown")continue;
      setProgress({step:`Processing ${v.title||v.url}…`,count:i+1,total:videos.length});
      const asset=await importSingleVideo(info,sourceId);
      if(v.title&&!asset.headline)asset.headline=v.title;
      newAssets.push(asset);
    }
    const source={id:sourceId,name:name||`${typeLabel(detected.kind)}`,url:detected.url,type:detected.kind,status:"synced",lastSync:new Date().toISOString(),videoCount:newAssets.length,assetIds:newAssets.map(a=>a.id)};
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
  const doSync=async(source)=>{
    setSyncingId(source.id);
    const videos=await extractShowcaseVideos(source.url);
    const existingAssetIds=new Set(source.assetIds||[]);
    const existingAssets=assets.filter(a=>existingAssetIds.has(a.id));
    const existingUrls=new Set(existingAssets.map(a=>a.videoUrl));
    const newUrls=videos.filter(v=>!existingUrls.has(v.url));
    const newAssets=[];
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

  const iconFor=(type)=>type?.startsWith("vm")?"vm":type?.startsWith("yt")?"yt":"unk";
  const shortLabel=(type)=>type==="vm-showcase"?"Vimeo":type==="yt-playlist"?"YouTube":type==="vm-video"?"Vimeo":"YouTube";
  const timeAgo=(iso)=>{if(!iso)return"Never synced";const m=Math.round((Date.now()-new Date(iso).getTime())/60000);if(m<1)return"Just now";if(m<60)return`${m}m ago`;const h=Math.round(m/60);if(h<24)return`${h}h ago`;return`${Math.round(h/24)}d ago`;};

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
              {progress.total>0&&progress.total!=="?"&&(
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
        <div className="ap-sub">Connect video sources — we'll pull them in and keep them synced</div>
      </div>
      <div className="ap-body">
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
function AssetsPanel({assets,onUpdate,onDelete,onAdd,onPreview}){
  const[editingId,setEditingId]=useState(null);
  const[search,setSearch]=useState("");
  const[form,setForm]=useState(null);
  const[creating,setCreating]=useState(false);

  const editing=editingId?assets.find(a=>a.id===editingId):null;
  useEffect(()=>{
    if(editing)setForm({...editing});
    else if(creating)setForm({id:`new-${Date.now()}`,clientName:"",company:"",vertical:"Healthcare",geography:"Northeast US",companySize:"50-200",challenge:"",outcome:"",assetType:"Video Testimonial",videoUrl:"",status:"active",headline:"",pullQuote:"",transcript:"",thumbnail:"",dateCreated:new Date().toISOString().split("T")[0]});
    else setForm(null);
  },[editingId,creating]);

  const s=(k,v)=>setForm(p=>({...p,[k]:v}));
  const save=()=>{if(creating){onAdd(form);setCreating(false);setEditingId(form.id);}else{onUpdate(form);setEditingId(null);}};
  const del=()=>{if(confirm("Delete this asset?")){onDelete(editingId);setEditingId(null);}};

  const filtered=assets.filter(a=>{if(!search)return true;const s=search.toLowerCase();return a.company.toLowerCase().includes(s)||a.clientName.toLowerCase().includes(s)||a.vertical.toLowerCase().includes(s);});

  if(form){
    return(
      <React.Fragment>
        <div className="ap-head">
          <div className="ap-edit-head">
            <button className="ap-back" onClick={()=>{setEditingId(null);setCreating(false);}}>← Back</button>
            <div className="ap-title" style={{fontSize:15}}>{creating?"New Asset":"Edit Asset"}</div>
            {!creating&&<button className="ap-preview-btn" onClick={()=>onPreview(editingId)}>Preview</button>}
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
  const[assets,setAssets]=useState(SEED);
  const[filters,setFilters]=useState({vertical:[],assetType:[]});
  const[openFilter,setOpenFilter]=useState(null);
  const[search,setSearch]=useState("");
  const[route,setRoute]=useState({page:"home",id:null});
  const[toast,setToast]=useState(null);

  // Admin mode + nav
  const[adminMode,setAdminMode]=useState(true); // admin by default
  const[adminSection,setAdminSection]=useState(null); // assets | import | null (collapsed)
  const[sources,setSources]=useState([]); // video sources (showcases, playlists)
  const[railHidden,setRailHidden]=useState(true); // fully hidden by default

  // StoryMatch state
  const[smOpen,setSmOpen]=useState(false);
  const[smQuery,setSmQuery]=useState("");
  const[smMode,setSmMode]=useState("describe");
  const[smLoading,setSmLoading]=useState(false);
  const[smResults,setSmResults]=useState(null); // [{id,reasoning,quotes,rank}]

  useEffect(()=>{
    const h=()=>{const hash=window.location.hash.slice(1);if(hash.startsWith("/asset/"))setRoute({page:"detail",id:hash.split("/asset/")[1]});else setRoute({page:"home",id:null});};
    h();window.addEventListener("hashchange",h);return()=>window.removeEventListener("hashchange",h);
  },[]);

  const openAsset=a=>{window.location.hash=`/asset/${a.id}`;};
  const goHome=()=>{window.location.hash="/";};
  const copyQuote=t=>{navigator.clipboard?.writeText(t);setToast("Copied!");setTimeout(()=>setToast(null),1800);};

  const runStoryMatch=useCallback(async(query)=>{
    if(!query.trim())return;setSmLoading(true);setSmResults(null);
    const hasUrl=query.match(/https?:\/\/[^\s]+/);
    let ctx="";
    if(hasUrl){try{const r=await fetch("https://api.anthropic.com/v1/messages",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({model:"claude-sonnet-4-20250514",max_tokens:800,tools:[{type:"web_search_20250305",name:"web_search"}],messages:[{role:"user",content:`Visit ${hasUrl[0]} and summarize: what they do, industry, size, who they serve, likely pain points. 3-4 sentences only, no markdown.`}]})});const d=await r.json();ctx=(d.content||[]).filter(c=>c.type==="text").map(c=>c.text).join(" ");}catch{}}
    const s=assets.map(a=>`[ID:${a.id}] ${a.company}|${a.clientName}|${a.vertical}|${a.geography}|${a.companySize}|${a.challenge}|${a.assetType}|${a.status}|${a.outcome}\n${a.transcript.substring(0,700)}`).join("\n---\n");
    const prompt=ctx?`Sales enablement AI. Prospect context:\n${ctx}\n\nSalesperson: "${query}"\n\nMatch prospect to assets. Explain why each resonates.`:`Sales enablement AI. Need: "${query}"\n\nMatch against assets by vertical, size, geography, challenge, persona.`;
    try{const r=await fetch("https://api.anthropic.com/v1/messages",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({model:"claude-sonnet-4-20250514",max_tokens:1000,messages:[{role:"user",content:`${prompt}\n\nAssets:\n${s}\n\nReturn ONLY valid JSON array. Top 3-5. Each: {"id":"","reasoning":"","quotes":[""],"relevanceScore":0}. No matches? [].`}]})});const d=await r.json();const t=d.content?.map(i=>i.text||"").join("")||"[]";const p=JSON.parse(t.replace(/```json|```/g,"").trim());setSmResults(p.map((r,i)=>({...r,rank:i+1})));setSmOpen(false);}catch{setSmResults([]);setSmOpen(false);}setSmLoading(false);
  },[assets]);

  const clearSm=()=>{setSmResults(null);setSmQuery("");};

  const descEx=["Quotes from clients with under 500 employees","Video testimonials mentioning ROI","Healthcare or financial services case studies","Legacy system migration stories","Strongest proof for enterprise buyers","Southeast clients on implementation speed"];
  const prosEx=["Series B fintech, 120 emp, selling to CFO on onboarding speed","Regional hospital, Southeast, CTO modernizing patient experience","Mid-market manufacturer, Ohio, VP Ops worried about QC"];

  // Determine what to show in the grid
  let displayAssets;
  let aiDataMap = {};
  if(smResults&&smResults.length>0){
    const matchedIds=smResults.map(r=>r.id);
    displayAssets=matchedIds.map(id=>assets.find(a=>a.id===id)).filter(Boolean);
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
  const detailAsset=route.page==="detail"?assets.find(a=>a.id===route.id):null;

  if(route.page==="detail"){
    return(<React.Fragment><style>{css}</style><div style={{minHeight:"100vh",background:"var(--bg)"}}>
      <header className="hdr"><div className="logo" onClick={goHome}></div><div className="hdr-r"><span className="badge">{assets.length} assets</span></div></header>
      <DetailPage asset={detailAsset} onBack={goHome} allAssets={assets} onSelect={openAsset}/>
    </div></React.Fragment>);
  }

  return (
    <React.Fragment>
      <style>{css}</style>
      <div style={{minHeight:"100vh",background:"var(--bg)"}}>

        <header className="hdr">
          <div className="logo" onClick={goHome}>
          </div>
          <div className="hdr-r">
            <span className="badge">{assets.length} assets</span>
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
          </div>
        </header>

        <div className="layout">

          {adminMode && !railHidden && (
            <aside className="admin-rail">
              <button
                className="rail-collapse"
                onClick={()=>{setRailHidden(true);setAdminSection(null);}}
                title="Hide sidebar"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="15 18 9 12 15 6"/>
                </svg>
              </button>
              <div className="rail-divider"/>
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

          {adminMode && railHidden && (
            <button
              className="admin-pull"
              onClick={()=>{setRailHidden(false);if(!adminSection)setAdminSection("assets");}}
              title="Show admin sidebar"
            >
              <div className="admin-pull-dots"><span/><span/><span/></div>
            </button>
          )}

          {adminMode && !railHidden && adminSection && (
            <aside className="admin-panel">
              {adminSection==="import" && (
                <SourcesPanel
                  sources={sources}
                  assets={assets}
                  onAddSource={s=>setSources(p=>[s,...p])}
                  onRemoveSource={id=>setSources(p=>p.filter(s=>s.id!==id))}
                  onSyncSource={(id,newAssetIds,videoCount)=>{
                    setSources(p=>p.map(s=>s.id===id?{...s,lastSync:new Date().toISOString(),status:"synced",videoCount:videoCount,assetIds:[...(s.assetIds||[]),...newAssetIds]}:s));
                    setToast(newAssetIds.length>0?`Synced — ${newAssetIds.length} new`:"Synced — no new videos");
                    setTimeout(()=>setToast(null),2000);
                  }}
                  onAddAssets={arr=>{
                    setAssets(p=>[...arr,...p]);
                    if(arr.length>1){setToast(`Added ${arr.length} assets`);setTimeout(()=>setToast(null),2000);}
                  }}
                />
              )}
              {adminSection==="assets" && (
                <AssetsPanel
                  assets={assets}
                  onUpdate={u=>{
                    setAssets(p=>p.map(a=>a.id===u.id?u:a));
                    setToast("Saved");
                    setTimeout(()=>setToast(null),1500);
                  }}
                  onDelete={id=>{
                    setAssets(p=>p.filter(a=>a.id!==id));
                    setToast("Deleted");
                    setTimeout(()=>setToast(null),1500);
                  }}
                  onAdd={a=>{
                    setAssets(p=>[a,...p]);
                    setToast("Created");
                    setTimeout(()=>setToast(null),1500);
                  }}
                  onPreview={id=>openAsset({id})}
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
                {adminMode && (
                  <button
                    className={`sm-btn ${smOpen||smLoading||smResults?"active":""}`}
                    onClick={()=>{if(smResults){clearSm();}else{setSmOpen(!smOpen);}}}
                  >
                    {smResults?"✕ Clear":"✦ StoryMatch"}
                  </button>
                )}
              </div>

              {adminMode && (smOpen||smLoading) && !smResults && (
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
                onClick={e=>{if(!e.target.closest('.filter-group'))setOpenFilter(null);}}
              >
                {[
                  {k:"vertical",label:"Industry",opts:VERTICALS.filter(v=>v!=="All")},
                  {k:"assetType",label:"Type",opts:ASSET_TYPES.filter(v=>v!=="All")}
                ].map(f=>{
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
