import { NextRequest, NextResponse } from "next/server";
import { createHash } from "crypto";
import { supabaseAdmin } from "@/lib/supabase-server";

// POST /api/share/[id]/event
// Public endpoint (no auth) — the share page itself posts engagement events
// here as the prospect interacts with the embedded video.
//
// Body: {
//   event_type: 'play' | 'progress' | 'complete',
//   watched_seconds?: number,
//   watched_percent?: number  // 0..100
// }

function hashIp(ip: string): string {
  return createHash("sha256")
    .update(ip + "|storymatch-share")
    .digest("hex")
    .slice(0, 16);
}

const ALLOWED_EVENT_TYPES = new Set(["play", "progress", "complete"]);

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  // Verify the share exists (cheap guard against random IDs)
  const { data: shareLink } = await supabaseAdmin
    .from("share_links")
    .select("id")
    .eq("id", id)
    .maybeSingle();
  if (!shareLink) {
    return NextResponse.json({ error: "Share not found" }, { status: 404 });
  }

  let body: {
    event_type?: string;
    watched_seconds?: number;
    watched_percent?: number;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const eventType = body.event_type;
  if (!eventType || !ALLOWED_EVENT_TYPES.has(eventType)) {
    return NextResponse.json(
      { error: `event_type must be one of: ${[...ALLOWED_EVENT_TYPES].join(", ")}` },
      { status: 400 }
    );
  }

  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "unknown";
  const ua = (req.headers.get("user-agent") || "").slice(0, 500);

  const watchedSeconds =
    typeof body.watched_seconds === "number" && Number.isFinite(body.watched_seconds)
      ? Math.max(0, Math.round(body.watched_seconds))
      : null;
  const watchedPercent =
    typeof body.watched_percent === "number" && Number.isFinite(body.watched_percent)
      ? Math.max(0, Math.min(100, Math.round(body.watched_percent)))
      : null;

  const { error } = await supabaseAdmin.from("share_events").insert({
    share_id: id,
    event_type: eventType,
    ip_hash: hashIp(ip),
    user_agent: ua,
    watched_seconds: watchedSeconds,
    watched_percent: watchedPercent,
  });

  if (error) {
    console.error("share event insert failed:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
