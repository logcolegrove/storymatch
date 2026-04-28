// Server-side source sync. Single shared implementation used by both:
//   • POST /api/sources/[id]/sync — manual refresh from the admin UI
//   • /api/cron/auto-sync — Vercel cron job for scheduled auto-syncs
//
// What it does (mirrors the old client-side doSync):
//   1. Fetches the showcase's current videos from Vimeo
//   2. Compares against existing assets to find:
//      • new (in Vimeo, no asset exists yet) → import
//      • orphaned (in StoryMatch, gone from Vimeo) → auto-archive
//      • drifted (asset exists, headline/description differs from Vimeo)
//      • previously-deleted (admin soft-deleted, but still in Vimeo)
//   3. Merges findings into source.pending_sync_report (the persistent inbox)
//   4. Updates source's last_sync metadata

import { supabaseAdmin } from "@/lib/supabase-server";

// ── Types matching the FE SyncReport ────────────────────────────────────
export interface DriftedItem {
  assetId: string;
  headline: string;
  fields: ("title" | "description")[];
  storyMatch: { headline: string; description: string };
  vimeo: { title: string; description: string; thumbnail: string };
}
export interface PreviouslyDeletedItem {
  assetId: string;
  headline: string;
  videoUrl: string;
  vimeo: { title: string; description: string; thumbnail: string };
}
export interface PendingSyncReport {
  syncedAt: string;
  videoCount: number;
  inSyncCount: number;
  imported: { assetId: string; headline: string }[];
  drifted: DriftedItem[];
  archived: { assetId: string; headline: string }[];
  previouslyDeleted: PreviouslyDeletedItem[];
}

// ── Vimeo fetching (subset of /api/vimeo/showcase logic) ───────────────
interface VimeoVideo {
  uri: string;
  link: string;
  name: string;
  description: string | null;
  duration: number;
  created_time: string;
  pictures?: { sizes?: { link: string; width: number; height: number }[] };
}

function extractShowcaseId(url: string): string | null {
  const m = url.match(/vimeo\.com\/(?:showcase|album)\/(\d+)/);
  return m ? m[1] : null;
}

function pickLargestThumb(sizes?: { link: string; width: number; height: number }[]): string {
  if (!sizes || sizes.length === 0) return "";
  const sorted = [...sizes].sort((a, b) => (b.width * b.height) - (a.width * a.height));
  return sorted[0].link;
}

async function fetchHighResThumb(videoId: string, accessToken: string): Promise<string> {
  try {
    const resp = await fetch(`https://api.vimeo.com/videos/${videoId}?fields=pictures.sizes`, {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/vnd.vimeo.*+json;version=3.4" },
    });
    if (!resp.ok) return "";
    const data = await resp.json() as { pictures?: { sizes?: { link: string; width: number; height: number }[] } };
    return pickLargestThumb(data?.pictures?.sizes);
  } catch {
    return "";
  }
}

function parseVtt(vtt: string): string {
  const lines = vtt.split(/\r?\n/);
  const out: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith("WEBVTT")) continue;
    if (trimmed.startsWith("NOTE")) continue;
    if (/^\d+$/.test(trimmed)) continue;
    if (/-->/.test(trimmed)) continue;
    out.push(trimmed.replace(/<[^>]+>/g, ""));
  }
  return out.join(" ").replace(/\s+/g, " ").trim();
}

async function fetchTranscript(videoId: string, accessToken: string): Promise<string> {
  try {
    const tracksResp = await fetch(`https://api.vimeo.com/videos/${videoId}/texttracks`, {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/vnd.vimeo.*+json;version=3.4" },
    });
    if (!tracksResp.ok) return "";
    const tracksBody = await tracksResp.json() as { data?: { active: boolean; type: string; language: string; link: string; auto_generated?: boolean }[] };
    const tracks = tracksBody.data || [];
    if (tracks.length === 0) return "";
    const chosen =
      tracks.find(t => t.active && t.language?.toLowerCase().startsWith("en")) ||
      tracks.find(t => t.language?.toLowerCase().startsWith("en")) ||
      tracks.find(t => t.active) || tracks[0];
    if (!chosen?.link) return "";
    const vttResp = await fetch(chosen.link, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!vttResp.ok) return "";
    return parseVtt(await vttResp.text());
  } catch {
    return "";
  }
}

interface NormalizedVideo {
  vimeoId: string;
  url: string;
  title: string;
  description: string;
  thumbnail: string;
  transcript: string;
}

async function fetchShowcaseVideos(showcaseUrl: string, accessToken: string): Promise<NormalizedVideo[] | null> {
  const albumId = extractShowcaseId(showcaseUrl);
  if (!albumId) return null;

  const allVideos: VimeoVideo[] = [];
  let nextUrl: string | null = `https://api.vimeo.com/me/albums/${albumId}/videos?per_page=100&fields=uri,link,name,description,duration,created_time,pictures,user`;

  try {
    while (nextUrl) {
      const resp: Response = await fetch(nextUrl, {
        headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/vnd.vimeo.*+json;version=3.4" },
      });
      if (!resp.ok) {
        if (resp.status === 404 && nextUrl.includes("/me/albums/")) {
          nextUrl = nextUrl.replace("/me/albums/", "/albums/");
          continue;
        }
        return null;
      }
      const body = await resp.json() as { data?: VimeoVideo[]; paging?: { next?: string | null } };
      allVideos.push(...(body.data || []));
      nextUrl = body.paging?.next
        ? body.paging.next.startsWith("http") ? body.paging.next : `https://api.vimeo.com${body.paging.next}&fields=uri,link,name,description,duration,created_time,pictures,user`
        : null;
      if (allVideos.length > 500) break;
    }
  } catch {
    return null;
  }

  // Fetch hi-res thumbnails + transcripts in parallel (concurrency 5)
  const basics = allVideos.map(v => ({
    vimeoId: v.uri.split("/").pop() || "",
    url: v.link,
    title: v.name,
    description: v.description || "",
    thumbnailFallback: pickLargestThumb(v.pictures?.sizes),
  }));

  const parallelMap = async <T, R>(items: T[], concurrency: number, fn: (item: T) => Promise<R>): Promise<R[]> => {
    const results: R[] = new Array(items.length);
    let cursor = 0;
    const workers = Array.from({ length: Math.min(concurrency, items.length) }).map(async () => {
      while (cursor < items.length) {
        const i = cursor++;
        results[i] = await fn(items[i]);
      }
    });
    await Promise.all(workers);
    return results;
  };

  const [transcripts, hiResThumbs] = await Promise.all([
    parallelMap(basics, 5, async b => b.vimeoId ? await fetchTranscript(b.vimeoId, accessToken) : ""),
    parallelMap(basics, 5, async b => b.vimeoId ? await fetchHighResThumb(b.vimeoId, accessToken) : ""),
  ]);

  return basics.map((b, i) => ({
    vimeoId: b.vimeoId,
    url: b.url,
    title: b.title,
    description: b.description,
    thumbnail: hiResThumbs[i] || b.thumbnailFallback,
    transcript: transcripts[i] || "",
  }));
}

// ── Org's Vimeo connection lookup ──────────────────────────────────────
async function getVimeoTokenForOrg(orgId: string): Promise<string | null> {
  // Find any admin in this org that has a connected Vimeo account.
  const { data: members } = await supabaseAdmin
    .from("org_members")
    .select("user_id")
    .eq("org_id", orgId)
    .eq("role", "admin");
  const adminIds = (members || []).map(m => m.user_id as string);
  if (adminIds.length === 0) return null;
  const { data: connection } = await supabaseAdmin
    .from("vimeo_connections")
    .select("access_token")
    .in("user_id", adminIds)
    .limit(1)
    .maybeSingle();
  return (connection?.access_token as string) || null;
}

// ── Asset DB helpers ───────────────────────────────────────────────────
interface AssetRow {
  id: string;
  source_id: string | null;
  status: string;
  video_url: string;
  headline: string | null;
  description: string | null;
}

function genAssetId(): string {
  return `imp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

// ── Main entry point ──────────────────────────────────────────────────
export interface SyncResult {
  ok: true;
  pendingSyncReport: PendingSyncReport;
  newAssetIds: string[];
  videoCount: number;
}
export interface SyncFailure {
  ok: false;
  error: string;
  status: number;
}

export async function runSourceSync(orgId: string, sourceId: string): Promise<SyncResult | SyncFailure> {
  // Fetch the source row
  const { data: source } = await supabaseAdmin
    .from("sources")
    .select("id, org_id, url, type, asset_ids, video_count, pending_sync_report")
    .eq("id", sourceId)
    .eq("org_id", orgId)
    .maybeSingle();
  if (!source) return { ok: false, error: "Source not found", status: 404 };
  if (!String(source.url).includes("vimeo.com")) {
    return { ok: false, error: "Only Vimeo sources are supported by sync currently", status: 400 };
  }

  // Find a usable Vimeo token for this org
  const token = await getVimeoTokenForOrg(orgId);
  if (!token) return { ok: false, error: "No connected Vimeo account in this org", status: 400 };

  // Fetch current showcase videos
  const videos = await fetchShowcaseVideos(source.url as string, token);
  if (!videos) return { ok: false, error: "Failed to fetch Vimeo showcase", status: 502 };

  // Look up all existing assets attached to this source. Include soft-deleted
  // (status='deleted') so we can detect "previously deleted, still in Vimeo".
  const existingAssetIds = (source.asset_ids as string[] | null) || [];
  let existingAssets: AssetRow[] = [];
  if (existingAssetIds.length > 0) {
    const { data: rows } = await supabaseAdmin
      .from("assets")
      .select("id, source_id, status, video_url, headline, description")
      .in("id", existingAssetIds);
    existingAssets = (rows || []) as AssetRow[];
  }

  const existingByUrl = new Map(existingAssets.map(a => [a.video_url, a]));
  const currentVimeoUrls = new Set(videos.map(v => v.url));

  // ── 1. New imports ──
  const nowDate = new Date().toISOString().split("T")[0];
  const insertedAssets: { id: string; headline: string }[] = [];
  for (const v of videos) {
    if (existingByUrl.has(v.url)) continue;
    const id = genAssetId();
    const { error: insertError } = await supabaseAdmin.from("assets").insert({
      id,
      org_id: orgId,
      source_id: sourceId,
      client_name: "",
      company: "",
      vertical: "",
      geography: "",
      company_size: "",
      challenge: "",
      outcome: "",
      asset_type: "Video Testimonial",
      video_url: v.url,
      status: "published",
      date_created: nowDate,
      headline: v.title || "Imported video",
      pull_quote: "",
      transcript: v.transcript || "",
      description: v.description || "",
      thumbnail: v.thumbnail || "",
    });
    if (insertError) {
      console.error("Sync: failed to insert asset", v.url, insertError);
      continue;
    }
    insertedAssets.push({ id, headline: v.title || "Imported video" });
  }

  // ── 2. Orphans (in StoryMatch, gone from Vimeo) — auto-archive ──
  const orphaned = existingAssets.filter(a =>
    !currentVimeoUrls.has(a.video_url) &&
    a.status !== "archived" &&
    a.status !== "deleted"
  );
  if (orphaned.length > 0) {
    const archivedAt = new Date().toISOString();
    for (const a of orphaned) {
      await supabaseAdmin
        .from("assets")
        .update({
          status: "archived",
          archived_at: archivedAt,
          archived_reason: `Removed from Vimeo showcase on ${nowDate}`,
        })
        .eq("id", a.id);
    }
  }

  // ── 3. Drift + previously-deleted detection ──
  const drifted: DriftedItem[] = [];
  const previouslyDeleted: PreviouslyDeletedItem[] = [];
  let inSyncCount = 0;
  for (const v of videos) {
    const a = existingByUrl.get(v.url);
    if (!a) continue;
    if (a.status === "archived") continue;
    if (a.status === "deleted") {
      previouslyDeleted.push({
        assetId: a.id,
        headline: a.headline || v.title || "Untitled",
        videoUrl: a.video_url,
        vimeo: { title: v.title || "", description: v.description || "", thumbnail: v.thumbnail || "" },
      });
      continue;
    }
    const fields: ("title" | "description")[] = [];
    if (v.title && v.title !== a.headline) fields.push("title");
    if (v.description && v.description !== a.description) fields.push("description");
    if (fields.length > 0) {
      drifted.push({
        assetId: a.id,
        headline: a.headline || v.title || "Untitled",
        fields,
        storyMatch: { headline: a.headline || "", description: a.description || "" },
        vimeo: { title: v.title || "", description: v.description || "", thumbnail: v.thumbnail || "" },
      });
    } else {
      inSyncCount++;
    }
  }

  // ── 4. Merge into source.pending_sync_report ──
  // imported + archived accumulate by assetId (deduped). drifted +
  // previouslyDeleted are recomputed each sync, so they replace.
  const prev = (source.pending_sync_report as PendingSyncReport | null) || null;

  const dedupedById = <T extends { assetId: string }>(prevList: T[] | undefined, newList: T[]): T[] => {
    const map = new Map<string, T>();
    for (const item of (prevList || [])) map.set(item.assetId, item);
    for (const item of newList) map.set(item.assetId, item);
    return Array.from(map.values());
  };

  const merged: PendingSyncReport = {
    syncedAt: new Date().toISOString(),
    videoCount: videos.length,
    inSyncCount,
    imported: dedupedById(prev?.imported, insertedAssets.map(a => ({ assetId: a.id, headline: a.headline }))),
    archived: dedupedById(prev?.archived, orphaned.map(a => ({ assetId: a.id, headline: a.headline || "Untitled" }))),
    drifted,
    previouslyDeleted,
  };

  // ── 5. Update source row ──
  const newAssetIds = [...existingAssetIds, ...insertedAssets.map(a => a.id)];
  await supabaseAdmin
    .from("sources")
    .update({
      pending_sync_report: merged,
      last_sync: new Date().toISOString(),
      video_count: videos.length,
      asset_ids: newAssetIds,
      status: "synced",
    })
    .eq("id", sourceId);

  return {
    ok: true,
    pendingSyncReport: merged,
    newAssetIds: insertedAssets.map(a => a.id),
    videoCount: videos.length,
  };
}
