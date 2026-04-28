import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";

// Reuse the same auth helper pattern as the assets route
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

// ───────────────────────────────────────────────────────────
// snake_case ↔ camelCase mapping
// ───────────────────────────────────────────────────────────
type SourceDB = {
  id: string;
  org_id: string | null;
  name: string;
  url: string;
  type: string;
  status: string;
  last_sync: string | null;
  video_count: number;
  asset_ids: string[];
  // Auto-sync (added in auto-sync migration)
  auto_sync_enabled?: boolean;
  auto_sync_frequency?: string;
  auto_sync_time?: string;
  auto_sync_day?: string;
  last_auto_sync_at?: string | null;
  pending_sync_report?: unknown;
  created_at?: string;
  updated_at?: string;
};

type SourceFE = {
  id: string;
  name: string;
  url: string;
  type: string;
  status: string;
  lastSync: string | null;
  videoCount: number;
  assetIds: string[];
  autoSyncEnabled?: boolean;
  autoSyncFrequency?: string;
  autoSyncTime?: string;
  autoSyncDay?: string;
  lastAutoSyncAt?: string | null;
  pendingSyncReport?: unknown;
};

function dbToFe(r: SourceDB): SourceFE {
  return {
    id: r.id,
    name: r.name,
    url: r.url,
    type: r.type,
    status: r.status,
    lastSync: r.last_sync,
    videoCount: r.video_count,
    assetIds: r.asset_ids || [],
    autoSyncEnabled: r.auto_sync_enabled ?? false,
    autoSyncFrequency: r.auto_sync_frequency || "daily",
    autoSyncTime: r.auto_sync_time || "02:00",
    autoSyncDay: r.auto_sync_day || "monday",
    lastAutoSyncAt: r.last_auto_sync_at ?? null,
    pendingSyncReport: r.pending_sync_report ?? null,
  };
}

function feToDb(s: Partial<SourceFE> & { id: string }, orgId: string): Partial<SourceDB> {
  const o: Partial<SourceDB> = { id: s.id, org_id: orgId };
  if (s.name !== undefined) o.name = s.name;
  if (s.url !== undefined) o.url = s.url;
  if (s.type !== undefined) o.type = s.type;
  if (s.status !== undefined) o.status = s.status;
  if (s.lastSync !== undefined) o.last_sync = s.lastSync;
  if (s.videoCount !== undefined) o.video_count = s.videoCount;
  if (s.assetIds !== undefined) o.asset_ids = s.assetIds;
  if (s.autoSyncEnabled !== undefined) o.auto_sync_enabled = s.autoSyncEnabled;
  if (s.autoSyncFrequency !== undefined) o.auto_sync_frequency = s.autoSyncFrequency;
  if (s.autoSyncTime !== undefined) o.auto_sync_time = s.autoSyncTime;
  if (s.autoSyncDay !== undefined) o.auto_sync_day = s.autoSyncDay;
  if (s.lastAutoSyncAt !== undefined) o.last_auto_sync_at = s.lastAutoSyncAt;
  if (s.pendingSyncReport !== undefined) o.pending_sync_report = s.pendingSyncReport;
  return o;
}

// ───────────────────────────────────────────────────────────
// GET /api/sources — list current org's sources (admins only)
// ───────────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const ctx = await getCurrentUserOrg(req);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (ctx.role !== "admin") {
    // Sales users don't need source visibility
    return NextResponse.json([]);
  }
  const { data, error } = await supabaseAdmin
    .from("sources")
    .select("*")
    .eq("org_id", ctx.orgId)
    .order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json((data as SourceDB[]).map(dbToFe));
}

// ───────────────────────────────────────────────────────────
// POST /api/sources — create or upsert (admins only)
// ───────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const ctx = await getCurrentUserOrg(req);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (ctx.role !== "admin") {
    return NextResponse.json({ error: "Admins only" }, { status: 403 });
  }
  const body = (await req.json()) as SourceFE;
  if (!body?.id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const row = feToDb(body, ctx.orgId);
  const { data, error } = await supabaseAdmin
    .from("sources")
    .upsert(row, { onConflict: "id" })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(dbToFe(data as SourceDB));
}

// ───────────────────────────────────────────────────────────
// PUT /api/sources — update (admins only)
// ───────────────────────────────────────────────────────────
export async function PUT(req: NextRequest) {
  const ctx = await getCurrentUserOrg(req);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (ctx.role !== "admin") {
    return NextResponse.json({ error: "Admins only" }, { status: 403 });
  }
  const body = (await req.json()) as Partial<SourceFE> & { id: string };
  if (!body.id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const updates = feToDb(body, ctx.orgId);
  const { data, error } = await supabaseAdmin
    .from("sources")
    .update(updates)
    .eq("id", body.id)
    .eq("org_id", ctx.orgId)
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(dbToFe(data as SourceDB));
}

// ───────────────────────────────────────────────────────────
// DELETE /api/sources?id=xxx — remove source AND all its imported assets (admins only)
// ───────────────────────────────────────────────────────────
export async function DELETE(req: NextRequest) {
  const ctx = await getCurrentUserOrg(req);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (ctx.role !== "admin") {
    return NextResponse.json({ error: "Admins only" }, { status: 403 });
  }
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  // First delete all assets that came from this source
  // (Scope by org_id as a safety check so we never touch another org's data)
  const { error: assetError, count: assetsDeleted } = await supabaseAdmin
    .from("assets")
    .delete({ count: "exact" })
    .eq("source_id", id)
    .eq("org_id", ctx.orgId);
  if (assetError) {
    return NextResponse.json({ error: assetError.message }, { status: 500 });
  }

  // Then delete the source itself
  const { error: sourceError } = await supabaseAdmin
    .from("sources")
    .delete()
    .eq("id", id)
    .eq("org_id", ctx.orgId);
  if (sourceError) {
    return NextResponse.json({ error: sourceError.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, assetsDeleted: assetsDeleted ?? 0 });
}
