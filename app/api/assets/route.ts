import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";

// ───────────────────────────────────────────────────────────
// Helper: get the current user + their org from the auth header
// ───────────────────────────────────────────────────────────
async function getCurrentUserOrg(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;

  const token = authHeader.slice(7);
  const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !user) return null;

  // Look up their org membership
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
// Helpers: convert between camelCase (FE) and snake_case (DB)
// ───────────────────────────────────────────────────────────
type AssetDB = {
  id: string;
  org_id: string | null;
  source_id: string | null;
  client_name: string;
  company: string;
  vertical: string;
  geography: string;
  company_size: string;
  challenge: string;
  outcome: string;
  asset_type: string;
  video_url: string;
  status: string;
  date_created: string;
  headline: string;
  pull_quote: string;
  transcript: string;
  description: string;
  thumbnail: string;
};

type AssetFE = {
  id: string;
  sourceId?: string | null;
  clientName: string;
  company: string;
  vertical: string;
  geography: string;
  companySize: string;
  challenge: string;
  outcome: string;
  assetType: string;
  videoUrl: string;
  status: string;
  dateCreated: string;
  headline: string;
  pullQuote: string;
  transcript: string;
  description: string;
  thumbnail: string;
};

function dbToFe(r: AssetDB): AssetFE {
  return {
    id: r.id,
    sourceId: r.source_id,
    clientName: r.client_name,
    company: r.company,
    vertical: r.vertical,
    geography: r.geography,
    companySize: r.company_size,
    challenge: r.challenge,
    outcome: r.outcome,
    assetType: r.asset_type,
    videoUrl: r.video_url,
    status: r.status,
    dateCreated: r.date_created,
    headline: r.headline,
    pullQuote: r.pull_quote,
    transcript: r.transcript,
    description: r.description,
    thumbnail: r.thumbnail,
  };
}

function feToDb(a: Partial<AssetFE> & { id: string }, orgId: string): Partial<AssetDB> {
  const o: Partial<AssetDB> = { id: a.id, org_id: orgId };
  if (a.sourceId !== undefined) o.source_id = a.sourceId;
  if (a.clientName !== undefined) o.client_name = a.clientName;
  if (a.company !== undefined) o.company = a.company;
  if (a.vertical !== undefined) o.vertical = a.vertical;
  if (a.geography !== undefined) o.geography = a.geography;
  if (a.companySize !== undefined) o.company_size = a.companySize;
  if (a.challenge !== undefined) o.challenge = a.challenge;
  if (a.outcome !== undefined) o.outcome = a.outcome;
  if (a.assetType !== undefined) o.asset_type = a.assetType;
  if (a.videoUrl !== undefined) o.video_url = a.videoUrl;
  if (a.status !== undefined) o.status = a.status;
  if (a.dateCreated !== undefined) o.date_created = a.dateCreated;
  if (a.headline !== undefined) o.headline = a.headline;
  if (a.pullQuote !== undefined) o.pull_quote = a.pullQuote;
  if (a.transcript !== undefined) o.transcript = a.transcript;
  if (a.description !== undefined) o.description = a.description;
  if (a.thumbnail !== undefined) o.thumbnail = a.thumbnail;
  return o;
}

// ───────────────────────────────────────────────────────────
// GET /api/assets — list all assets for the current user's org
// ───────────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const ctx = await getCurrentUserOrg(req);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data, error } = await supabaseAdmin
    .from("assets")
    .select("*")
    .eq("org_id", ctx.orgId)
    .order("date_created", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json((data as AssetDB[]).map(dbToFe));
}

// ───────────────────────────────────────────────────────────
// POST /api/assets — insert (admins only)
// ───────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const ctx = await getCurrentUserOrg(req);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (ctx.role !== "admin") {
    return NextResponse.json({ error: "Admins only" }, { status: 403 });
  }

  const body = await req.json();
  const items: AssetFE[] = Array.isArray(body) ? body : body.assets ? body.assets : [body];
  const rows = items.map((it) => feToDb(it, ctx.orgId));

  const { data, error } = await supabaseAdmin
    .from("assets")
    .upsert(rows, { onConflict: "id" })
    .select();

  if (error) {
    console.error("[/api/assets POST] Supabase upsert error:", {
      message: error.message,
      code: error.code,
      details: error.details,
      hint: error.hint,
      sampleRow: rows[0],
    });
    return NextResponse.json({ error: error.message, code: error.code, hint: error.hint }, { status: 500 });
  }
  return NextResponse.json((data as AssetDB[]).map(dbToFe));
}

// ───────────────────────────────────────────────────────────
// PUT /api/assets — update (admins only)
// ───────────────────────────────────────────────────────────
export async function PUT(req: NextRequest) {
  const ctx = await getCurrentUserOrg(req);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (ctx.role !== "admin") {
    return NextResponse.json({ error: "Admins only" }, { status: 403 });
  }

  const body = (await req.json()) as Partial<AssetFE> & { id: string };
  if (!body.id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const updates = feToDb(body, ctx.orgId);
  const { data, error } = await supabaseAdmin
    .from("assets")
    .update(updates)
    .eq("id", body.id)
    .eq("org_id", ctx.orgId) // safety: can't update another org's asset
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(dbToFe(data as AssetDB));
}

// ───────────────────────────────────────────────────────────
// DELETE /api/assets?id=xxx — delete (admins only)
// ───────────────────────────────────────────────────────────
export async function DELETE(req: NextRequest) {
  const ctx = await getCurrentUserOrg(req);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (ctx.role !== "admin") {
    return NextResponse.json({ error: "Admins only" }, { status: 403 });
  }

  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const { error } = await supabaseAdmin
    .from("assets")
    .delete()
    .eq("id", id)
    .eq("org_id", ctx.orgId); // safety

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
