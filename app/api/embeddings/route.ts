import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";

// Reuse the auth pattern used everywhere else
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
// Build the text we embed for each asset.
// Fields are weighted by importance — headline + transcript + pull quote
// are most useful for matching, metadata is supportive context.
// ───────────────────────────────────────────────────────────
type AssetRow = {
  client_name?: string | null;
  company?: string | null;
  vertical?: string | null;
  geography?: string | null;
  company_size?: string | null;
  challenge?: string | null;
  outcome?: string | null;
  asset_type?: string | null;
  headline?: string | null;
  pull_quote?: string | null;
  transcript?: string | null;
};

function buildEmbeddingText(a: AssetRow): string {
  const parts: string[] = [];
  if (a.headline) parts.push(`Headline: ${a.headline}`);
  if (a.company) parts.push(`Company: ${a.company}`);
  if (a.vertical) parts.push(`Industry: ${a.vertical}`);
  if (a.geography) parts.push(`Region: ${a.geography}`);
  if (a.company_size) parts.push(`Size: ${a.company_size}`);
  if (a.challenge) parts.push(`Challenge: ${a.challenge}`);
  if (a.outcome) parts.push(`Outcome: ${a.outcome}`);
  if (a.asset_type) parts.push(`Type: ${a.asset_type}`);
  if (a.pull_quote) parts.push(`Quote: "${a.pull_quote}"`);
  if (a.transcript) parts.push(`Transcript: ${a.transcript}`);
  // Cap at ~25k chars (~6k tokens) to stay well under the OpenAI 8k token limit
  return parts.join("\n").slice(0, 25000);
}

// ───────────────────────────────────────────────────────────
// Call OpenAI embeddings API
// ───────────────────────────────────────────────────────────
async function embedTexts(texts: string[]): Promise<number[][]> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY not configured");
  const resp = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "text-embedding-3-small",
      input: texts,
    }),
  });
  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`OpenAI embeddings failed: ${resp.status} ${errText}`);
  }
  const body = (await resp.json()) as { data: { embedding: number[] }[] };
  return body.data.map((d) => d.embedding);
}

// ───────────────────────────────────────────────────────────
// POST /api/embeddings
// Body: { assetId: string }              → embed one asset
//   OR  { backfill: true, limit?: number } → embed all unembedded in this org
// ───────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const ctx = await getCurrentUserOrg(req);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (ctx.role !== "admin") {
    return NextResponse.json({ error: "Admins only" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));

  // ─── Backfill mode ──────────────────────────────────────
  if (body?.backfill) {
    const limit = Math.min(Number(body.limit) || 50, 100); // cap per request
    const { data: rows, error } = await supabaseAdmin
      .from("assets")
      .select("id, client_name, company, vertical, geography, company_size, challenge, outcome, asset_type, headline, pull_quote, transcript")
      .eq("org_id", ctx.orgId)
      .is("embedding", null)
      .limit(limit);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!rows || rows.length === 0) {
      return NextResponse.json({ embedded: 0, remaining: 0 });
    }

    const texts = rows.map(buildEmbeddingText);
    let embeddings: number[][];
    try {
      embeddings = await embedTexts(texts);
    } catch (e) {
      return NextResponse.json({ error: (e as Error).message }, { status: 500 });
    }

    // Save each embedding
    const now = new Date().toISOString();
    const updates = rows.map((row, i) =>
      supabaseAdmin
        .from("assets")
        .update({ embedding: embeddings[i], embedding_updated_at: now })
        .eq("id", row.id)
        .eq("org_id", ctx.orgId)
    );
    await Promise.all(updates);

    // Check how many remain
    const { count } = await supabaseAdmin
      .from("assets")
      .select("id", { count: "exact", head: true })
      .eq("org_id", ctx.orgId)
      .is("embedding", null);

    return NextResponse.json({ embedded: rows.length, remaining: count ?? 0 });
  }

  // ─── Single asset mode ──────────────────────────────────
  const assetId = body?.assetId as string | undefined;
  if (!assetId) {
    return NextResponse.json({ error: "assetId or backfill required" }, { status: 400 });
  }

  const { data: row, error: fetchError } = await supabaseAdmin
    .from("assets")
    .select("id, client_name, company, vertical, geography, company_size, challenge, outcome, asset_type, headline, pull_quote, transcript")
    .eq("id", assetId)
    .eq("org_id", ctx.orgId)
    .single();
  if (fetchError || !row) {
    return NextResponse.json({ error: "Asset not found" }, { status: 404 });
  }

  const text = buildEmbeddingText(row);
  let embedding: number[];
  try {
    [embedding] = await embedTexts([text]);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }

  const { error: updateError } = await supabaseAdmin
    .from("assets")
    .update({ embedding, embedding_updated_at: new Date().toISOString() })
    .eq("id", assetId)
    .eq("org_id", ctx.orgId);
  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

// ───────────────────────────────────────────────────────────
// GET /api/embeddings — return how many assets need embedding
// ───────────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const ctx = await getCurrentUserOrg(req);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (ctx.role !== "admin") {
    return NextResponse.json({ error: "Admins only" }, { status: 403 });
  }

  const { count: missing } = await supabaseAdmin
    .from("assets")
    .select("id", { count: "exact", head: true })
    .eq("org_id", ctx.orgId)
    .is("embedding", null);

  const { count: total } = await supabaseAdmin
    .from("assets")
    .select("id", { count: "exact", head: true })
    .eq("org_id", ctx.orgId);

  return NextResponse.json({
    missing: missing ?? 0,
    total: total ?? 0,
    embedded: (total ?? 0) - (missing ?? 0),
  });
}
