// Search-log data-access layer.
//
// Logs every library + StoryMatch search so admins can answer
// "what are our reps actually looking for?" and "where do they get
// zero results?" — i.e. demand signal + library gap signal.
//
// Attribution model: the admin Insights view sees who ran each
// search (email). Earlier iterations anonymized this for privacy,
// but the org admin needs to know which reps are searching for
// what — both to coach reps and to assess whether the library
// gaps they hit are widespread or isolated. Sales reps NEVER see
// other reps' searches; the only consumer of these helpers is the
// admin-only /api/search-logs endpoint.

import { supabaseAdmin } from "./supabase-server";

export type SearchSource = "library" | "storymatch";

// Log entry returned to admin /api consumers. Includes the
// searcher's email so admins can identify which rep ran the query.
export interface SearchLogEntry {
  id: string;
  query: string;
  source: SearchSource;
  resultCount: number;
  topResultIds: string[];
  createdAt: string;
  userId: string | null;     // raw id — used for grouping in the FE
  userEmail: string | null;  // null if the user record was deleted
}

// Aggregate row for the "Top queries" panel.
export interface TopQueryRow {
  queryNormalized: string;   // lowercase, trimmed — the grouping key
  exampleQuery: string;      // most recent original casing for display
  count: number;             // total times this query was run
  avgResultCount: number;    // mean result_count across runs
  zeroResultRuns: number;    // # runs where result_count was 0 — the gap signal
  lastSeen: string;          // ISO timestamp of the most recent run
  sources: SearchSource[];   // distinct sources this query showed up in
}

function buildLogId(): string {
  return "sl-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
}

// Fire-and-forget log write. The caller never awaits this in the
// hot path of a search — a failed log row should never cause a
// search to look broken. We catch + console.error here and move on.
export async function logSearch(params: {
  orgId: string;
  userId: string;
  query: string;
  source: SearchSource;
  resultCount: number;
  topResultIds: string[];
}): Promise<void> {
  try {
    const trimmed = (params.query || "").trim();
    if (trimmed.length === 0) return;
    const capped = trimmed.slice(0, 500);
    await supabaseAdmin.from("search_logs").insert({
      id: buildLogId(),
      org_id: params.orgId,
      user_id: params.userId,
      query: capped,
      source: params.source,
      result_count: Math.max(0, Math.floor(params.resultCount || 0)),
      top_result_ids: (params.topResultIds || []).slice(0, 10),
    });
  } catch (e) {
    console.error("[search-log-dal] logSearch failed", e);
  }
}

// Recent activity feed for the admin Insights view. Returns up to
// `limit` rows, newest first, with the searcher's email joined in.
//
// Email join strategy: pull the row set first, collect the distinct
// user_ids, then make a single `auth.admin.listUsers` call to build
// an id→email map. This avoids N+1 queries and matches the pattern
// used by /api/share/list. Deleted users come back with email=null
// rather than dropping the row, so the admin still sees the search
// occurred (just without attribution).
export async function fetchRecentLogs(params: {
  orgId: string;
  limit?: number;
  source?: SearchSource;
  sinceIso?: string;
  untilIso?: string;
}): Promise<SearchLogEntry[]> {
  const limit = Math.min(Math.max(params.limit ?? 200, 1), 500);
  let q = supabaseAdmin
    .from("search_logs")
    .select("id, user_id, query, source, result_count, top_result_ids, created_at")
    .eq("org_id", params.orgId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (params.source) q = q.eq("source", params.source);
  if (params.sinceIso) q = q.gte("created_at", params.sinceIso);
  if (params.untilIso) q = q.lte("created_at", params.untilIso);
  const { data, error } = await q;
  if (error || !data) {
    if (error) console.error("[search-log-dal] fetchRecentLogs failed", error);
    return [];
  }

  // Build the user_id → email map. Skipped entirely when the result
  // set is empty so we don't pay the auth admin RTT for nothing.
  const emailMap = new Map<string, string>();
  if (data.length > 0) {
    try {
      const { data: usersData } = await supabaseAdmin.auth.admin.listUsers({ perPage: 200 });
      if (usersData?.users) {
        const wanted = new Set(data.map(r => r.user_id as string));
        for (const u of usersData.users) {
          if (wanted.has(u.id) && u.email) emailMap.set(u.id, u.email);
        }
      }
    } catch (e) {
      // Email lookup is best-effort. If it fails we still return
      // rows with email=null rather than failing the whole request.
      console.warn("[search-log-dal] email map lookup failed", e);
    }
  }

  return data.map(r => ({
    id: r.id as string,
    query: r.query as string,
    source: r.source as SearchSource,
    resultCount: (r.result_count as number) ?? 0,
    topResultIds: (r.top_result_ids as string[]) || [],
    createdAt: r.created_at as string,
    userId: (r.user_id as string) || null,
    userEmail: emailMap.get(r.user_id as string) || null,
  }));
}

// Aggregate top queries for the admin Insights view. Grouped by
// lower(query) so "Healthcare" and "healthcare" collapse into one
// row. Zero-result runs are surfaced as a column so admins can
// instantly spot demand-with-no-supply gaps.
//
// We pull the recent slice (default 1000 rows) and aggregate in
// memory — fine at the scale of a single org's search history,
// and avoids needing a Postgres function or materialised view.
export async function fetchTopQueries(params: {
  orgId: string;
  sinceIso?: string;     // optional time window (defaults to all-time)
  limit?: number;        // top N (default 25)
  pullLimit?: number;    // how many raw rows to aggregate (default 1000)
  source?: SearchSource;
}): Promise<TopQueryRow[]> {
  const pullLimit = Math.min(Math.max(params.pullLimit ?? 1000, 1), 5000);
  let q = supabaseAdmin
    .from("search_logs")
    .select("query, source, result_count, created_at")
    .eq("org_id", params.orgId)
    .order("created_at", { ascending: false })
    .limit(pullLimit);
  if (params.sinceIso) q = q.gte("created_at", params.sinceIso);
  if (params.source) q = q.eq("source", params.source);
  const { data, error } = await q;
  if (error || !data) {
    if (error) console.error("[search-log-dal] fetchTopQueries failed", error);
    return [];
  }

  type Bucket = {
    queryNormalized: string;
    exampleQuery: string;
    count: number;
    resultSum: number;
    zeroResultRuns: number;
    lastSeen: string;
    sources: Set<SearchSource>;
  };
  const buckets = new Map<string, Bucket>();
  for (const row of data) {
    const raw = (row.query as string) || "";
    const key = raw.trim().toLowerCase();
    if (!key) continue;
    let b = buckets.get(key);
    if (!b) {
      b = {
        queryNormalized: key,
        exampleQuery: raw,
        count: 0,
        resultSum: 0,
        zeroResultRuns: 0,
        lastSeen: row.created_at as string,
        sources: new Set<SearchSource>(),
      };
      buckets.set(key, b);
    }
    b.count += 1;
    b.resultSum += (row.result_count as number) ?? 0;
    if (((row.result_count as number) ?? 0) === 0) b.zeroResultRuns += 1;
    b.sources.add(row.source as SearchSource);
    // Keep the most recent lastSeen — rows came back DESC, so the
    // first occurrence is already the newest.
  }

  const rows: TopQueryRow[] = [];
  for (const b of buckets.values()) {
    rows.push({
      queryNormalized: b.queryNormalized,
      exampleQuery: b.exampleQuery,
      count: b.count,
      avgResultCount: b.count > 0 ? Math.round((b.resultSum / b.count) * 10) / 10 : 0,
      zeroResultRuns: b.zeroResultRuns,
      lastSeen: b.lastSeen,
      sources: Array.from(b.sources),
    });
  }
  rows.sort((a, b) => b.count - a.count || a.queryNormalized.localeCompare(b.queryNormalized));
  return rows.slice(0, Math.max(params.limit ?? 25, 1));
}
