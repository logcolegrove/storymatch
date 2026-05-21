// /api/showcases — list + create showcases.
//
//   GET   → { showcases: Showcase[] }
//     Admin: all showcases in the org.
//     Sales: only the showcases they own.
//   POST  → { showcase: Showcase }
//     Both roles can create. The created showcase is owned by the
//     calling user; admins building org-curated showcases just
//     happen to be the owner of their org-curated ones too.
//
// No password / email gating in v1 — once shared, anyone with the
// URL can open a showcase. Matches the existing single-asset
// share-link contract.

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import {
  createShowcase,
  fetchOrgShowcases,
  fetchUserShowcases,
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

export async function GET(req: NextRequest) {
  const ctx = await getCurrentUserOrg(req);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const showcases = ctx.role === "admin"
    ? await fetchOrgShowcases(ctx.orgId)
    : await fetchUserShowcases(ctx.orgId, ctx.userId);
  return NextResponse.json({ showcases });
}

export async function POST(req: NextRequest) {
  const ctx = await getCurrentUserOrg(req);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({})) as {
    name?: unknown;
    description?: unknown;
    asset_ids?: unknown;
    template_id?: unknown;
    template_config?: unknown;
  };
  // Name is optional — the DAL defaults blanks to "Untitled
  // showcase" so the bulk "Add to showcase" flow can ship a
  // draft straight to disk without prompting. template_id is
  // also optional — the DAL validates against the known list and
  // falls back to null (renderer defaults to "default").
  const name = typeof body.name === "string" ? body.name : "";
  const result = await createShowcase({
    orgId: ctx.orgId,
    ownerUserId: ctx.userId,
    name,
    description: typeof body.description === "string" ? body.description : null,
    assetIds: Array.isArray(body.asset_ids) ? body.asset_ids as string[] : [],
    templateId: typeof body.template_id === "string" ? body.template_id : null,
    // DAL validates the shape; we just forward what the FE sent.
    templateConfig: (body.template_config ?? null) as TemplateBlock[] | null,
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json({ showcase: result.showcase });
}
