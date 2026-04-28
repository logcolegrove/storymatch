import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { runSourceSync } from "@/lib/source-sync";

// GET /api/cron/auto-sync
// Triggered by Vercel Cron once per day (see vercel.json). Iterates every
// source with auto_sync_enabled=true and runs the same server-side sync flow
// the manual refresh button uses. Each source's findings are merged into its
// pending_sync_report so the admin sees them when they next open the panel.

// Allow up to 5 minutes for cron — multiple sources × Vimeo round-trips.
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  // Vercel Cron sends `authorization: Bearer ${CRON_SECRET}` to authenticate.
  // Without this check anyone could hammer the endpoint.
  const authHeader = req.headers.get("authorization");
  if (!process.env.CRON_SECRET) {
    return NextResponse.json(
      { error: "CRON_SECRET not configured on the server" },
      { status: 500 }
    );
  }
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Find sources that opted in to auto-sync and haven't run in the last 23h
  // (the 23h cutoff prevents double-runs if the cron ever fires twice).
  const cutoff = new Date(Date.now() - 23 * 60 * 60 * 1000).toISOString();
  const { data: sources, error } = await supabaseAdmin
    .from("sources")
    .select("id, org_id, last_auto_sync_at")
    .eq("auto_sync_enabled", true)
    .or(`last_auto_sync_at.is.null,last_auto_sync_at.lt.${cutoff}`);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const results: { sourceId: string; ok: boolean; error?: string }[] = [];
  for (const source of sources || []) {
    try {
      const result = await runSourceSync(source.org_id as string, source.id as string);
      if (result.ok) {
        await supabaseAdmin
          .from("sources")
          .update({ last_auto_sync_at: new Date().toISOString() })
          .eq("id", source.id);
        results.push({ sourceId: source.id as string, ok: true });
      } else {
        results.push({ sourceId: source.id as string, ok: false, error: result.error });
      }
    } catch (e) {
      results.push({
        sourceId: source.id as string,
        ok: false,
        error: (e as Error).message,
      });
    }
  }

  return NextResponse.json({ ok: true, processed: results.length, results });
}
