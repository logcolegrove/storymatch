// /api/search-logs — search-log admin view + FE write path.
//
//   GET   (admin)    → { recent: SearchLogEntry[], top: TopQueryRow[] }
//                      Anonymized. Optional ?source=library|storymatch
//                      and ?days=30 to narrow the top-queries window.
//   POST  (any auth) → { ok: true } — logs a new search row.
//                      Used by the library top-bar search field for
//                      its debounced log. StoryMatch logs server-side
//                      directly inside /api/storymatch.
//
// Anonymity: GET responses never include user_id. POSTs require the
// caller to be an authenticated org member — user_id is taken from
// the bearer token, not the body, so the client can't spoof it.

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { logSearch, fetchRecentLogs, fetchTopQueries, type SearchSource } from "@/lib/search-log-dal";

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

function parseSourceParam(v: string | null): SearchSource | undefined {
  if (v === "library" || v === "storymatch") return v;
  return undefined;
}

// ── GET ──────────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const ctx = await getCurrentUserOrg(req);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (ctx.role !== "admin") {
    return NextResponse.json({ error: "Admins only" }, { status: 403 });
  }

  const url = req.nextUrl;
  const source = parseSourceParam(url.searchParams.get("source"));
  const days = (() => {
    const raw = url.searchParams.get("days");
    if (!raw) return null;
    const n = parseInt(raw, 10);
    return Number.isFinite(n) && n > 0 ? n : null;
  })();
  const parseIso = (raw: string | null): string | undefined => {
    if (!raw) return undefined;
    const t = Date.parse(raw);
    if (!Number.isFinite(t)) return undefined;
    return new Date(t).toISOString();
  };
  const fromIso = parseIso(url.searchParams.get("from"));
  const toIso = parseIso(url.searchParams.get("to"));
  // Explicit from/to wins over rolling days.
  const sinceIso = fromIso ?? (days ? new Date(Date.now() - days * 86400000).toISOString() : undefined);
  const untilIso = toIso;

  const [recent, top] = await Promise.all([
    fetchRecentLogs({ orgId: ctx.orgId, limit: 200, source, sinceIso, untilIso }),
    fetchTopQueries({ orgId: ctx.orgId, limit: 25, sinceIso, source }),
  ]);

  return NextResponse.json({ recent, top });
}

// ── POST ─────────────────────────────────────────────────────────
// FE write path for library searches. Body: { query, source,
// result_count, top_result_ids }. Server stamps user_id from auth.
export async function POST(req: NextRequest) {
  const ctx = await getCurrentUserOrg(req);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({})) as {
    query?: unknown;
    source?: unknown;
    result_count?: unknown;
    top_result_ids?: unknown;
  };
  const query = typeof body.query === "string" ? body.query : "";
  const source = body.source === "library" || body.source === "storymatch" ? body.source : null;
  if (!query.trim() || !source) {
    return NextResponse.json({ error: "query and source required" }, { status: 400 });
  }
  const resultCount = typeof body.result_count === "number" ? body.result_count : 0;
  const topResultIds = Array.isArray(body.top_result_ids)
    ? (body.top_result_ids as unknown[]).filter(x => typeof x === "string") as string[]
    : [];

  // Fire-and-forget. Don't await failure surfacing — a failed log
  // shouldn't make the FE think the search itself broke.
  await logSearch({
    orgId: ctx.orgId,
    userId: ctx.userId,
    query,
    source,
    resultCount,
    topResultIds,
  });

  return NextResponse.json({ ok: true });
}
