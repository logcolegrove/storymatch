// /api/insights/summary — top-of-page counters for the admin
// Insights view.
//
//   GET (admin) → { searches, linksShared, feedbackGiven }
//
// Three integers, scoped to the caller's org. Optional ?days=N
// narrows the window; without it we report all-time.
//
// Each count is a `count: "exact", head: true` query against its
// source table — Supabase returns just the count without pulling
// rows, so this stays cheap even as orgs accumulate history.
//
//   searches       → rows in search_logs
//   linksShared    → rows in share_links (every "copy share link"
//                    click writes a new row, so this IS the count
//                    of "team members sharing assets externally")
//   feedbackGiven  → rows in asset_feedback

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";

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
  if (ctx.role !== "admin") {
    return NextResponse.json({ error: "Admins only" }, { status: 403 });
  }

  const url = req.nextUrl;

  // Range supports two shapes:
  //   ?days=N           — rolling window ending now (shortcut)
  //   ?from=ISO&to=ISO  — explicit custom range. Either is optional;
  //                       passing only one bounds is allowed (e.g.
  //                       just `from` to mean "since this date").
  // If both `days` and `from/to` are passed, `from/to` wins because
  // it's the more explicit signal.
  const days = (() => {
    const raw = url.searchParams.get("days");
    if (!raw) return null;
    const n = parseInt(raw, 10);
    return Number.isFinite(n) && n > 0 ? n : null;
  })();
  const parseIso = (raw: string | null): string | null => {
    if (!raw) return null;
    const t = Date.parse(raw);
    if (!Number.isFinite(t)) return null;
    return new Date(t).toISOString();
  };
  const fromIso = parseIso(url.searchParams.get("from"));
  const toIso = parseIso(url.searchParams.get("to"));
  const sinceIso = fromIso ?? (days ? new Date(Date.now() - days * 86400000).toISOString() : null);
  const untilIso = toIso;

  // Build three head-only count queries in parallel. The
  // `count: "exact", head: true` shape tells PostgREST to skip
  // returning rows and just report the total — much faster than a
  // .select() that pulls payload.
  const buildCount = async (table: string) => {
    let q = supabaseAdmin
      .from(table)
      .select("*", { count: "exact", head: true })
      .eq("org_id", ctx.orgId);
    if (sinceIso) q = q.gte("created_at", sinceIso);
    if (untilIso) q = q.lte("created_at", untilIso);
    const { count, error } = await q;
    if (error) {
      console.error(`[insights/summary] count failed for ${table}`, error);
      return 0;
    }
    return count ?? 0;
  };

  const [searches, linksShared, feedbackGiven] = await Promise.all([
    buildCount("search_logs"),
    buildCount("share_links"),
    buildCount("asset_feedback"),
  ]);

  return NextResponse.json({ searches, linksShared, feedbackGiven });
}
