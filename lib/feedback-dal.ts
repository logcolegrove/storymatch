// Asset feedback data-access layer.
//
// One thumbs-up / thumbs-down rating per user per asset, with an
// optional ≤500-char comment. The UNIQUE (asset_id, user_id) constraint
// on the table enforces the "one vote per user" rule at the DB level;
// every helper here either upserts against that constraint or deletes
// the user's existing row.
//
// Attribution model:
//   Admins see counts + comment text AND who left each one (email).
//   This used to be anonymized but the org admin needs to know which
//   rep flagged a problem to follow up. Sales reps still only ever
//   see their own row + aggregate counts — never another rep's vote.
//
// All queries filter on org_id first so a misconfigured caller can't
// accidentally cross tenant boundaries.

import { supabaseAdmin } from "./supabase-server";

export type FeedbackRating = "up" | "down";

// Row shape — matches DB columns 1:1. user_id is stripped from any
// type that leaves this module via a public-facing helper.
interface FeedbackRow {
  id: string;
  org_id: string;
  asset_id: string;
  user_id: string;
  // Null when the row is a comment-only submission. Aggregates
  // ignore null-rated rows when computing up/down/net.
  rating: FeedbackRating | null;
  comment: string | null;
  created_at: string;
  updated_at: string;
}

// Comment + rating for the admin view. Surfaces user attribution
// (email) so admins can identify who left each note. Sales reps
// never see this shape — only their own MyFeedback row.
//
// Name retained as `AnonymizedFeedback` for callsite stability;
// effectively now "AdminFeedbackComment". TODO: rename if/when we
// next sweep.
export interface AnonymizedFeedback {
  // Null for comment-only submissions (no thumb picked).
  rating: FeedbackRating | null;
  comment: string | null;
  createdAt: string;
  updatedAt: string;
  userId: string | null;
  userEmail: string | null;
}

// Per-asset rollup used by the dashboard list and the StoryMatch
// ranking signal. `netScore = up - down`; `total = up + down`.
export interface FeedbackAggregate {
  assetId: string;
  up: number;
  down: number;
  total: number;
  netScore: number;
}

// The current user's own vote on a given asset. Returned in full so
// the FE can show the active state of their thumbs control.
//
// rating is nullable: a user can submit a comment without picking
// a thumb. Comment-only rows still occupy the same (asset, user)
// row but contribute nothing to up/down/net aggregates — they only
// surface in the admin Feedback view as "comment without rating".
export interface MyFeedback {
  rating: FeedbackRating | null;
  comment: string | null;
  createdAt: string;
  updatedAt: string;
}

// Build a deterministic id from (asset, user). Lets us upsert without
// needing a separate "find existing row" lookup; the UNIQUE constraint
// covers correctness either way but ID stability keeps audit + debug
// queries readable.
function buildFeedbackId(assetId: string, userId: string): string {
  return `fb-${assetId}-${userId}`;
}

// Cap comment length defensively even though the DB also enforces it.
// Trims trailing whitespace and collapses null/empty to null so the
// admin view doesn't show blank comment rows.
function normalizeComment(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const trimmed = raw.toString().trim();
  if (trimmed.length === 0) return null;
  return trimmed.slice(0, 500);
}

// Upsert (insert-or-update) the current user's feedback on an asset.
// If rating changes, comment changes, or both — same row stays, only
// the columns + updated_at move. Returns the resulting MyFeedback or
// an error message.
export async function upsertFeedback(params: {
  orgId: string;
  assetId: string;
  userId: string;
  // Nullable: a user can submit a comment without picking a thumb.
  // The caller (API route) is responsible for refusing rows with
  // BOTH rating null AND comment empty — a fully empty row is a
  // bug, not a feature.
  rating: FeedbackRating | null;
  comment: string | null | undefined;
}): Promise<{ ok: true; feedback: MyFeedback } | { ok: false; error: string }> {
  const id = buildFeedbackId(params.assetId, params.userId);
  const comment = normalizeComment(params.comment);
  if (params.rating == null && !comment) {
    return { ok: false, error: "Provide a rating or a comment" };
  }
  const { data, error } = await supabaseAdmin
    .from("asset_feedback")
    .upsert(
      {
        id,
        org_id: params.orgId,
        asset_id: params.assetId,
        user_id: params.userId,
        rating: params.rating,
        comment,
      },
      { onConflict: "asset_id,user_id" },
    )
    .select("rating, comment, created_at, updated_at")
    .single();
  if (error || !data) {
    console.error("[feedback-dal] upsert failed", error);
    return { ok: false, error: error?.message || "Couldn't save feedback" };
  }
  return {
    ok: true,
    feedback: {
      rating: data.rating as FeedbackRating | null,
      comment: data.comment as string | null,
      createdAt: data.created_at as string,
      updatedAt: data.updated_at as string,
    },
  };
}

// Hard-delete the user's vote for a single asset. Used when a user
// clicks their already-active thumbs a second time (toggle-off) or
// hits an explicit "Clear my vote" affordance.
export async function removeFeedback(params: {
  orgId: string;
  assetId: string;
  userId: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const { error } = await supabaseAdmin
    .from("asset_feedback")
    .delete()
    .eq("org_id", params.orgId)
    .eq("asset_id", params.assetId)
    .eq("user_id", params.userId);
  if (error) {
    console.error("[feedback-dal] remove failed", error);
    return { ok: false, error: error.message };
  }
  return { ok: true };
}

// Fetch the calling user's own vote on a single asset. Returns null
// when the user hasn't voted yet so the FE can render the empty state.
export async function findUserVote(params: {
  orgId: string;
  assetId: string;
  userId: string;
}): Promise<MyFeedback | null> {
  const { data, error } = await supabaseAdmin
    .from("asset_feedback")
    .select("rating, comment, created_at, updated_at")
    .eq("org_id", params.orgId)
    .eq("asset_id", params.assetId)
    .eq("user_id", params.userId)
    .maybeSingle();
  if (error || !data) return null;
  return {
    rating: data.rating as FeedbackRating | null,
    comment: data.comment as string | null,
    createdAt: data.created_at as string,
    updatedAt: data.updated_at as string,
  };
}

// Shared helper: build a user_id → email map for the given set of
// ids via the auth admin API. Mirrors the pattern used by
// search-log-dal and /api/share/list. Failures are swallowed with a
// warning — admins still see the comment, just without attribution.
async function lookupEmailMap(userIds: Iterable<string>): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const wanted = new Set<string>();
  for (const id of userIds) if (id) wanted.add(id);
  if (wanted.size === 0) return map;
  try {
    const { data: usersData } = await supabaseAdmin.auth.admin.listUsers({ perPage: 200 });
    if (usersData?.users) {
      for (const u of usersData.users) {
        if (wanted.has(u.id) && u.email) map.set(u.id, u.email);
      }
    }
  } catch (e) {
    console.warn("[feedback-dal] email map lookup failed", e);
  }
  return map;
}

// Fetch the comment + rating list for a single asset. Admin-facing —
// each row includes user attribution (email). Sorted newest first.
export async function fetchAssetFeedback(params: {
  orgId: string;
  assetId: string;
}): Promise<AnonymizedFeedback[]> {
  const { data, error } = await supabaseAdmin
    .from("asset_feedback")
    .select("user_id, rating, comment, created_at, updated_at")
    .eq("org_id", params.orgId)
    .eq("asset_id", params.assetId)
    .order("created_at", { ascending: false });
  if (error || !data) {
    if (error) console.error("[feedback-dal] fetch asset failed", error);
    return [];
  }
  const emailMap = await lookupEmailMap(data.map(r => r.user_id as string));
  return data.map(r => ({
    rating: r.rating as FeedbackRating | null,
    comment: r.comment as string | null,
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
    userId: (r.user_id as string) || null,
    userEmail: emailMap.get(r.user_id as string) || null,
  }));
}

// Aggregate counts for every asset in an org. Used by the dashboard
// view AND the StoryMatch ranking signal. Returns a map keyed by
// asset_id for O(1) lookup at the call site.
export async function fetchOrgAggregates(orgId: string): Promise<Map<string, FeedbackAggregate>> {
  const { data, error } = await supabaseAdmin
    .from("asset_feedback")
    .select("asset_id, rating")
    .eq("org_id", orgId);
  const map = new Map<string, FeedbackAggregate>();
  if (error || !data) {
    if (error) console.error("[feedback-dal] aggregates failed", error);
    return map;
  }
  for (const row of data as Pick<FeedbackRow, "asset_id" | "rating">[]) {
    const cur = map.get(row.asset_id) || { assetId: row.asset_id, up: 0, down: 0, total: 0, netScore: 0 };
    // Null-rated rows are comment-only — they don't contribute to
    // the up/down/total/net counts. Skip silently here; the comment
    // still surfaces in the admin Feedback view via fetchAssetFeedback.
    if (row.rating === "up") cur.up += 1;
    else if (row.rating === "down") cur.down += 1;
    cur.total = cur.up + cur.down;
    cur.netScore = cur.up - cur.down;
    map.set(row.asset_id, cur);
  }
  return map;
}

// Compose the admin dashboard payload: aggregates per asset plus the
// recent comment stream per asset. Limited to `maxComments` per asset
// so the dashboard payload doesn't blow up on heavily-rated assets.
export interface AssetFeedbackBundle {
  aggregate: FeedbackAggregate;
  comments: AnonymizedFeedback[];
}

export async function fetchOrgFeedbackBundle(
  orgId: string,
  opts?: { maxCommentsPerAsset?: number; sinceIso?: string; untilIso?: string },
): Promise<Map<string, AssetFeedbackBundle>> {
  const maxComments = opts?.maxCommentsPerAsset ?? 25;
  let q = supabaseAdmin
    .from("asset_feedback")
    .select("asset_id, user_id, rating, comment, created_at, updated_at")
    .eq("org_id", orgId)
    .order("created_at", { ascending: false });
  if (opts?.sinceIso) q = q.gte("created_at", opts.sinceIso);
  if (opts?.untilIso) q = q.lte("created_at", opts.untilIso);
  const { data, error } = await q;
  const out = new Map<string, AssetFeedbackBundle>();
  if (error || !data) {
    if (error) console.error("[feedback-dal] bundle failed", error);
    return out;
  }
  // Build the email map once for all rows in this bundle. Cheaper
  // than per-asset lookups and the user set is small.
  const emailMap = await lookupEmailMap(data.map(r => r.user_id as string));
  for (const r of data) {
    const aid = r.asset_id as string;
    let bundle = out.get(aid);
    if (!bundle) {
      bundle = {
        aggregate: { assetId: aid, up: 0, down: 0, total: 0, netScore: 0 },
        comments: [],
      };
      out.set(aid, bundle);
    }
    const rating = r.rating as FeedbackRating | null;
    // Null-rated (comment-only) rows skip the score buckets but
    // still flow into the comments list below so admins see them.
    if (rating === "up") bundle.aggregate.up += 1;
    else if (rating === "down") bundle.aggregate.down += 1;
    bundle.aggregate.total = bundle.aggregate.up + bundle.aggregate.down;
    bundle.aggregate.netScore = bundle.aggregate.up - bundle.aggregate.down;
    if ((r.comment as string | null) && bundle.comments.length < maxComments) {
      bundle.comments.push({
        rating,
        comment: r.comment as string | null,
        createdAt: r.created_at as string,
        updatedAt: r.updated_at as string,
        userId: (r.user_id as string) || null,
        userEmail: emailMap.get(r.user_id as string) || null,
      });
    }
  }
  return out;
}

// Confidence floor used by the StoryMatch ranking signal. Assets with
// fewer than this many total votes are treated as "no signal" so a
// single early thumbs-down doesn't bury a new upload. Tuned to be the
// smallest number where directional signal feels stable.
export const FEEDBACK_MIN_VOTES_FOR_RANKING = 3;
