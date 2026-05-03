// /api/quotes/[id] — single-quote operations.
//
//   PATCH  — update curation fields (isFeatured, washToken,
//            featuredPosition) AND (for standalone quotes only) text
//            + attribution. Fields are optional; omitted = unchanged.
//   DELETE — delete a STANDALONE quote. Asset-attached rows can't be
//            deleted here — they're managed through PUT /api/assets.

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
    orgId: membership.org_id as string,
    role: membership.role as "admin" | "sales",
  };
}

const VALID_WASH_TOKENS: WashToken[] = ["rose","sage","sand","lavender","cream","mist"];
const VALID_STATIC_SOURCES: StaticSource[] = ["manual","trustpilot","g2","google","linkedin","capterra","other"];

interface PatchBody {
  // Curation — applies to ANY quote (asset-attached or standalone)
  isFeatured?: boolean;
  washToken?: WashToken | null;
  featuredPosition?: number | null;
  isFavorite?: boolean;
  // Standalone-only edits — applies only when asset_id IS NULL
  text?: string;
  attrName?: string | null;
  attrTitle?: string | null;
  attrOrg?: string | null;
  initialsOverride?: string | null;
  staticSource?: StaticSource;
  staticUrl?: string | null;
  stars?: number | null;
}

async function loadQuote(id: string, orgId: string) {
  const { data, error } = await supabaseAdmin
    .from("quotes")
    .select("*")
    .eq("id", id)
    .eq("org_id", orgId)
    .maybeSingle();
  if (error) return { error: error.message as string };
  if (!data) return { error: "Quote not found" };
  return { row: data as QuoteRow };
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await getCurrentUserOrg(req);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (ctx.role !== "admin") {
    return NextResponse.json({ error: "Admins only" }, { status: 403 });
  }

  const { id } = await params;
  const found = await loadQuote(id, ctx.orgId);
  if ("error" in found) {
    return NextResponse.json({ error: found.error }, { status: found.error === "Quote not found" ? 404 : 500 });
  }
  const existing = found.row;

  const body = (await req.json().catch(() => ({}))) as PatchBody;
  const updates: Partial<QuoteRow> = {};

  // ── Curation fields (always allowed) ───────────────────
  if (body.isFeatured !== undefined) {
    updates.is_featured = !!body.isFeatured;
    // First time being featured: stamp featured_at. Position stays
    // null until admin explicitly orders it via the curation panel —
    // null sorts to the end of the rotator (NULLS LAST).
    if (body.isFeatured && !existing.is_featured) {
      updates.featured_at = new Date().toISOString();
    }
    // Unfeaturing → clear ordering data so the slot is freed cleanly.
    if (!body.isFeatured) {
      updates.featured_position = null;
      updates.featured_at = null;
    }
  }
  if (body.washToken !== undefined) {
    updates.wash_token = body.washToken && VALID_WASH_TOKENS.includes(body.washToken) ? body.washToken : null;
  }
  if (body.featuredPosition !== undefined) {
    updates.featured_position = typeof body.featuredPosition === "number" ? body.featuredPosition : null;
  }
  if (body.isFavorite !== undefined) {
    updates.is_favorite = !!body.isFavorite;
  }

  // ── Content fields (standalone only) ───────────────────
  // Asset-attached quotes have their text/attribution managed by
  // PUT /api/assets. Reject content edits on those to keep one
  // canonical write path per shape.
  const isStandalone = existing.asset_id == null && existing.source_id == null;
  const contentEditAttempted =
    body.text !== undefined || body.attrName !== undefined || body.attrTitle !== undefined ||
    body.attrOrg !== undefined || body.initialsOverride !== undefined ||
    body.staticSource !== undefined || body.staticUrl !== undefined || body.stars !== undefined;
  if (contentEditAttempted && !isStandalone) {
    return NextResponse.json(
      { error: "Asset-attached quotes can only be edited via the asset they're attached to" },
      { status: 400 },
    );
  }
  if (isStandalone) {
    if (body.text !== undefined) {
      const t = (body.text || "").trim();
      if (!t) return NextResponse.json({ error: "text cannot be empty" }, { status: 400 });
      updates.text = t;
    }
    if (body.attrName !== undefined) updates.attr_name = body.attrName?.trim() || null;
    if (body.attrTitle !== undefined) updates.attr_title = body.attrTitle?.trim() || null;
    if (body.attrOrg !== undefined) updates.attr_org = body.attrOrg?.trim() || null;
    if (body.initialsOverride !== undefined) updates.initials_override = body.initialsOverride?.trim() || null;
    if (body.staticSource !== undefined && VALID_STATIC_SOURCES.includes(body.staticSource)) {
      updates.static_source = body.staticSource;
    }
    if (body.staticUrl !== undefined) updates.static_url = body.staticUrl?.trim() || null;
    if (body.stars !== undefined) {
      updates.stars = typeof body.stars === "number" && body.stars >= 1 && body.stars <= 5
        ? Math.round(body.stars)
        : null;
    }
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json(dbToFe(existing));
  }

  const { data, error } = await supabaseAdmin
    .from("quotes")
    .update(updates)
    .eq("id", id)
    .eq("org_id", ctx.orgId)
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(dbToFe(data as QuoteRow));
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await getCurrentUserOrg(req);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (ctx.role !== "admin") {
    return NextResponse.json({ error: "Admins only" }, { status: 403 });
  }

  const { id } = await params;
  const found = await loadQuote(id, ctx.orgId);
  if ("error" in found) {
    return NextResponse.json({ error: found.error }, { status: found.error === "Quote not found" ? 404 : 500 });
  }
  // Asset-attached deletion goes through PUT /api/assets so the
  // caller stays in lockstep with the JSONB dual-write.
  if (found.row.asset_id != null) {
    return NextResponse.json(
      { error: "Asset-attached quotes can only be deleted via the asset they're attached to" },
      { status: 400 },
    );
  }
  const { error } = await supabaseAdmin
    .from("quotes")
    .delete()
    .eq("id", id)
    .eq("org_id", ctx.orgId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
