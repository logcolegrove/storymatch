// /api/feedback — sales-rep + admin asset feedback.
//
//   GET  /api/feedback?asset_id=...   → current user's vote + counts.
//                                       Admins also see anonymized comments.
//   GET  /api/feedback?summary=true   → admin-only dashboard: every asset's
//                                       aggregate + recent anonymized comments.
//   POST /api/feedback                → upsert the caller's vote on an asset.
//                                       Body: { asset_id, rating, comment? }.
//   DELETE /api/feedback?asset_id=... → remove the caller's vote.
//
// Anonymity contract:
//   The DB stores user_id but no response ever exposes it. Admins see
//   counts + comment text; sales reps only see counts (and their own
//   row). Enforced in this file at the response-shaping layer, not via
//   RLS, because supabaseAdmin bypasses RLS by design.

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import {
  upsertFeedback,
  removeFeedback,
  findUserVote,
  fetchAssetFeedback,
  fetchOrgFeedbackBundle,
  fetchOrgAggregates,
  type FeedbackRating,
} from "@/lib/feedback-dal";

type UserCtx = {
  userId: string;
  orgId: string;
  role: "admin" | "sales";
};

async function getCurrentUserOrg(req: NextRequest): Promise<UserCtx | null> {
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

// ── GET ──────────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const ctx = await getCurrentUserOrg(req);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = req.nextUrl;
  const summary = url.searchParams.get("summary");
  const assetId = url.searchParams.get("asset_id");

  // Admin-only org-wide summary used by the Feedback dashboard view.
  // Returns every asset with at least one vote.
  if (summary === "true") {
    if (ctx.role !== "admin") {
      return NextResponse.json({ error: "Admins only" }, { status: 403 });
    }
    const bundle = await fetchOrgFeedbackBundle(ctx.orgId);
    const out: Array<{
      assetId: string;
      up: number;
      down: number;
      total: number;
      netScore: number;
      comments: Array<{ rating: FeedbackRating; comment: string | null; createdAt: string; updatedAt: string }>;
    }> = [];
    for (const [, b] of bundle) {
      out.push({
        assetId: b.aggregate.assetId,
        up: b.aggregate.up,
        down: b.aggregate.down,
        total: b.aggregate.total,
        netScore: b.aggregate.netScore,
        comments: b.comments,
      });
    }
    return NextResponse.json({ assets: out });
  }

  // Single-asset view. Always returns counts + the caller's own vote.
  // Admins additionally get the anonymized comment list for that asset.
  if (!assetId) {
    return NextResponse.json({ error: "asset_id required" }, { status: 400 });
  }
  const [myVote, aggregates] = await Promise.all([
    findUserVote({ orgId: ctx.orgId, assetId, userId: ctx.userId }),
    fetchOrgAggregates(ctx.orgId),
  ]);
  const agg = aggregates.get(assetId) || { assetId, up: 0, down: 0, total: 0, netScore: 0 };
  const payload: {
    assetId: string;
    up: number;
    down: number;
    total: number;
    myVote: { rating: FeedbackRating; comment: string | null; createdAt: string; updatedAt: string } | null;
    comments?: Array<{ rating: FeedbackRating; comment: string | null; createdAt: string; updatedAt: string }>;
  } = {
    assetId,
    up: agg.up,
    down: agg.down,
    total: agg.total,
    myVote: myVote
      ? {
          rating: myVote.rating,
          comment: myVote.comment,
          createdAt: myVote.createdAt,
          updatedAt: myVote.updatedAt,
        }
      : null,
  };
  if (ctx.role === "admin") {
    payload.comments = (await fetchAssetFeedback({ orgId: ctx.orgId, assetId }))
      .filter(c => c.comment && c.comment.length > 0)
      .map(c => ({
        rating: c.rating,
        comment: c.comment,
        createdAt: c.createdAt,
        updatedAt: c.updatedAt,
      }));
  }
  return NextResponse.json(payload);
}

// ── POST (upsert) ────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const ctx = await getCurrentUserOrg(req);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({})) as {
    asset_id?: unknown;
    rating?: unknown;
    comment?: unknown;
  };
  const assetId = typeof body.asset_id === "string" ? body.asset_id : "";
  const rating = body.rating === "up" || body.rating === "down" ? body.rating : null;
  if (!assetId) return NextResponse.json({ error: "asset_id required" }, { status: 400 });
  if (!rating) return NextResponse.json({ error: "rating must be 'up' or 'down'" }, { status: 400 });

  // Verify the asset belongs to the caller's org — prevents a malicious
  // client from voting on another tenant's asset.
  const { data: assetCheck } = await supabaseAdmin
    .from("assets")
    .select("id, org_id")
    .eq("id", assetId)
    .maybeSingle();
  if (!assetCheck || assetCheck.org_id !== ctx.orgId) {
    return NextResponse.json({ error: "Asset not found" }, { status: 404 });
  }

  const comment = typeof body.comment === "string" ? body.comment : null;
  const result = await upsertFeedback({
    orgId: ctx.orgId,
    assetId,
    userId: ctx.userId,
    rating,
    comment,
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 500 });
  return NextResponse.json({ feedback: result.feedback });
}

// ── DELETE ───────────────────────────────────────────────────────
export async function DELETE(req: NextRequest) {
  const ctx = await getCurrentUserOrg(req);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const assetId = req.nextUrl.searchParams.get("asset_id");
  if (!assetId) return NextResponse.json({ error: "asset_id required" }, { status: 400 });

  const result = await removeFeedback({
    orgId: ctx.orgId,
    assetId,
    userId: ctx.userId,
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 500 });
  return NextResponse.json({ ok: true });
}
