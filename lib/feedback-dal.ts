// Asset feedback data-access layer.
//
// One thumbs-up / thumbs-down rating per user per asset, with an
// optional ≤500-char comment. The UNIQUE (asset_id, user_id) constraint
// on the table enforces the "one vote per user" rule at the DB level;
// every helper here either upserts against that constraint or deletes
// the user's existing row.
//
// Anonymity model:
//   Admins see counts + comment text but NOT which user wrote it. The
//   DB stores user_id (we need it for upsert + de-dup), but no helper
//   here returns it in any shape that crosses the API boundary except
//   `findUserVote`, which is scoped to the calling user themselves.
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
  rating: FeedbackRating;
  comment: string | null;
  created_at: string;
  updated_at: string;
}

// Comment + rating for the admin view. Intentionally omits user_id
// and id so admins can't reverse-engineer authorship from order or
// internal ids.
export interface AnonymizedFeedback {
  rating: FeedbackRating;
  comment: string | null;
  createdAt: string;
  updatedAt: string;
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
export interface MyFeedback {
  rating: FeedbackRating;
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
  rating: FeedbackRating;
  comment: string | null | undefined;
}): Promise<{ ok: true; feedback: MyFeedback } | { ok: false; error: string }> {
  const id = buildFeedbackId(params.assetId, params.userId);
  const comment = normalizeComment(params.comment);
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
      rating: data.rating as FeedbackRating,
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
    rating: data.rating as FeedbackRating,
    comment: data.comment as string | null,
    createdAt: data.created_at as string,
    updatedAt: data.updated_at as string,
  };
}

// Fetch the anonymized comment + rating list for a single asset. This
// is the admin-facing shape — comments without authorship. Sorted
// newest first so recent reactions surface immediately.
export async function fetchAssetFeedback(params: {
  orgId: string;
  assetId: string;
}): Promise<AnonymizedFeedback[]> {
  const { data, error } = await supabaseAdmin
    .from("asset_feedback")
    .select("rating, comment, created_at, updated_at")
    .eq("org_id", params.orgId)
    .eq("asset_id", params.assetId)
    .order("created_at", { ascending: false });
  if (error || !data) {
    if (error) console.error("[feedback-dal] fetch asset failed", error);
    return [];
  }
  return data.map(r => ({
    rating: r.rating as FeedbackRating,
    comment: r.comment as string | null,
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
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
    if (row.rating === "up") cur.up += 1;
    else cur.down += 1;
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
  opts?: { maxCommentsPerAsset?: number },
): Promise<Map<string, AssetFeedbackBundle>> {
  const maxComments = opts?.maxCommentsPerAsset ?? 25;
  const { data, error } = await supabaseAdmin
    .from("asset_feedback")
    .select("asset_id, rating, comment, created_at, updated_at")
    .eq("org_id", orgId)
    .order("created_at", { ascending: false });
  const out = new Map<string, AssetFeedbackBundle>();
  if (error || !data) {
    if (error) console.error("[feedback-dal] bundle failed", error);
    return out;
  }
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
    const rating = r.rating as FeedbackRating;
    if (rating === "up") bundle.aggregate.up += 1;
    else bundle.aggregate.down += 1;
    bundle.aggregate.total = bundle.aggregate.up + bundle.aggregate.down;
    bundle.aggregate.netScore = bundle.aggregate.up - bundle.aggregate.down;
    if ((r.comment as string | null) && bundle.comments.length < maxComments) {
      bundle.comments.push({
        rating,
        comment: r.comment as string | null,
        createdAt: r.created_at as string,
        updatedAt: r.updated_at as string,
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
