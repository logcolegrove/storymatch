// /api/quotes — collection-level CRUD for the quotes entity.
//
//   GET  /api/quotes                — list all quotes for the org
//   GET  /api/quotes?featured=true  — featured set (hero rotator)
//   GET  /api/quotes?asset_id=X     — quotes attached to a specific asset
//   POST /api/quotes                — create a standalone (kind='static') quote
//
// Asset-attached quotes are still managed via PUT /api/assets (the
// dual-write keeps them in sync). This endpoint is for standalone
// quotes + curation reads.

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { dbToFe, type QuoteRow, type StaticSource, type WashToken } from "@/lib/quotes-dal";

async function getCurrentUserOrg(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;
  const token = authHeader.slice(7);
  const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !user) return null;
  const { data: membership } = await supabaseAdmin
    .from("org_members")
    .select("org_id, role")
    .eq("user_id", user.id)
    .limit(1)
    .maybeSingle();
  if (!membership) return null;
  return {
    userId: user.id,
    userEmail: user.email || "",
    orgId: membership.org_id as string,
    role: membership.role as "admin" | "sales",
  };
}

// ── GET /api/quotes ──────────────────────────────────────────
export async function GET(req: NextRequest) {
  const ctx = await getCurrentUserOrg(req);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const featured = req.nextUrl.searchParams.get("featured");
  const assetId = req.nextUrl.searchParams.get("asset_id");

  let q = supabaseAdmin.from("quotes").select("*").eq("org_id", ctx.orgId);

  if (featured === "true") {
    q = q.eq("is_featured", true)
      .order("featured_position", { ascending: true, nullsFirst: false })
      .order("featured_at", { ascending: false, nullsFirst: false })
      .limit(12);
  } else if (assetId) {
    q = q.eq("asset_id", assetId)
      .order("position_within_parent", { ascending: true, nullsFirst: false });
  } else {
    q = q.order("created_at", { ascending: false });
  }

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json((data as QuoteRow[]).map(dbToFe));
}

// ── POST /api/quotes ─────────────────────────────────────────
// Creates a new STANDALONE quote (kind='static'). Asset-attached
// quotes are created/updated through PUT /api/assets.
const VALID_STATIC_SOURCES: StaticSource[] = ["manual","trustpilot","g2","google","linkedin","capterra","other"];
const VALID_WASH_TOKENS: WashToken[] = ["rose","sage","sand","lavender","cream","mist"];

interface PostBody {
  text?: string;
  attrName?: string;
  attrTitle?: string;
  attrOrg?: string;
  initialsOverride?: string;
  staticSource?: StaticSource;
  staticUrl?: string;
  stars?: number;
  isFeatured?: boolean;
  washToken?: WashToken;
}

export async function POST(req: NextRequest) {
  const ctx = await getCurrentUserOrg(req);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (ctx.role !== "admin") {
    return NextResponse.json({ error: "Admins only" }, { status: 403 });
  }

  const body = (await req.json().catch(() => ({}))) as PostBody;
  const text = (body.text || "").trim();
  if (!text) return NextResponse.json({ error: "text required" }, { status: 400 });

  const staticSource: StaticSource = body.staticSource && VALID_STATIC_SOURCES.includes(body.staticSource)
    ? body.staticSource
    : "manual";
  const stars = typeof body.stars === "number" && body.stars >= 1 && body.stars <= 5
    ? Math.round(body.stars)
    : null;
  const wash = body.washToken && VALID_WASH_TOKENS.includes(body.washToken) ? body.washToken : null;

  // Generate an ID. Distinct shape from asset-attached IDs (which use
  // q-{assetId}-{position}) so the two namespaces never collide.
  const id = "qs-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);

  const row: Partial<QuoteRow> = {
    id,
    org_id: ctx.orgId,
    text,
    attr_name: body.attrName?.trim() || null,
    attr_title: body.attrTitle?.trim() || null,
    attr_org: body.attrOrg?.trim() || null,
    initials_override: body.initialsOverride?.trim() || null,
    asset_id: null,
    source_id: null,
    kind: "static",
    static_source: staticSource,
    static_url: body.staticUrl?.trim() || null,
    stars,
    is_featured: !!body.isFeatured,
    // Position is null on first feature — quotes with null position
    // sort to the end of the rotator (NULLS LAST). Admin can give it
    // an explicit slot via the curation panel.
    featured_position: null,
    featured_at: body.isFeatured ? new Date().toISOString() : null,
    wash_token: wash,
    is_favorite: false,
    position_within_parent: null,
  };

  const { data, error } = await supabaseAdmin.from("quotes").insert(row).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(dbToFe(data as QuoteRow));
}
