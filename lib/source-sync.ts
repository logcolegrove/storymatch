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
// Every item carries `detectedAt` — the ISO timestamp when this entry was
// first added to the inbox. Lets the UI show "imported 2d ago", "drifted 4h
// ago", etc. so admins can tell new findings from stale ones at a glance.
export interface ImportedItem { assetId: string; headline: string; detectedAt: string; }
export interface ArchivedItem { assetId: string; headline: string; detectedAt: string; }
// Drift fields are only the ones the admin can edit in StoryMatch and where a
// conflict is possible (Vimeo changed AND local edit exists). Thumbnail is
// always auto-applied and never user-editable, so it's not in this union.
export type DriftField = "title" | "description" | "transcript";
export interface DriftedItem {
  assetId: string;
  headline: string;
  fields: DriftField[];
  storyMatch: { headline: string; description: string };
  // vimeo carries the *current* Vimeo values + last-synced markers, so the FE
  // can write both atomically when admin overrides their local edit.
  vimeo: { title: string; description: string; thumbnail: string; transcript: string };
  detectedAt: string;
}
export interface PreviouslyDeletedItem {
  assetId: string;
  headline: string;
  videoUrl: string;
  vimeo: { title: string; description: string; thumbnail: string; transcript: string };
  detectedAt: string;
}
export interface PendingSyncReport {
  syncedAt: string;
  videoCount: number;
  inSyncCount: number;
  imported: ImportedItem[];
  drifted: DriftedItem[];
  archived: ArchivedItem[];
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
  thumbnail: string | null;
  transcript: string | null;
  // last_synced_* track what the corresponding Vimeo field was at the most
  // recent successful sync. Lets us tell "user hasn't edited locally"
  // (current === last_synced) apart from "user has edited" (current !==
  // last_synced). Backfilled to current StoryMatch values via migration.
  last_synced_title: string | null;
  last_synced_description: string | null;
  last_synced_transcript: string | null;
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
      .select("id, source_id, status, video_url, headline, description, thumbnail, transcript, last_synced_title, last_synced_description, last_synced_transcript")
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
      // Snapshot Vimeo's current values so future syncs can tell whether the
      // admin has edited a field locally vs. just hasn't touched it.
      last_synced_title: v.title || "",
      last_synced_description: v.description || "",
      last_synced_transcript: v.transcript || "",
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

  // ── 3. Drift detection + auto-apply ──
  // Behavior:
  //   • thumbnail → ALWAYS auto-applied (never user-editable in StoryMatch)
  //   • title / description / transcript → auto-applied IF the local value
  //     still matches last_synced (i.e. user hasn't edited locally). If the
  //     user has edited locally AND Vimeo also changed, we flag it as drift
  //     so the admin can decide whether to keep their edit or pull from Vimeo.
  //
  // Each sync builds three buckets:
  //   • autoUpdates  — written to assets table directly, no admin attention
  //   • drifted      — true conflicts surfaced in the inbox
  //   • previouslyDeleted — admin previously soft-deleted, still in Vimeo
  // detectedAt is added below via .map at lines 403/404, so omit it here.
  const drifted: Omit<DriftedItem, "detectedAt">[] = [];
  const previouslyDeleted: Omit<PreviouslyDeletedItem, "detectedAt">[] = [];
  // Snake-case payloads ready to send to supabase (matches DB column names).
  type AssetUpdatePayload = {
    headline?: string;
    description?: string;
    transcript?: string;
    thumbnail?: string;
    last_synced_title?: string;
    last_synced_description?: string;
    last_synced_transcript?: string;
  };
  const autoUpdates: { assetId: string; updates: AssetUpdatePayload }[] = [];
  let inSyncCount = 0;
  let autoAppliedCount = 0;

  for (const v of videos) {
    const a = existingByUrl.get(v.url);
    if (!a) continue;
    if (a.status === "archived") continue;
    if (a.status === "deleted") {
      previouslyDeleted.push({
        assetId: a.id,
        headline: a.headline || v.title || "Untitled",
        videoUrl: a.video_url,
        vimeo: {
          title: v.title || "",
          description: v.description || "",
          thumbnail: v.thumbnail || "",
          transcript: v.transcript || "",
        },
      });
      continue;
    }

    const conflictFields: DriftField[] = [];
    const updates: AssetUpdatePayload = {};

    // Per-field decision: 4 cases based on (vimeoChanged, userEdited)
    //   • A) neither changed   → fully in sync, do nothing
    //   • B) only Vimeo changed → auto-pull (no conflict)
    //   • C) only user edited   → keep local, do nothing
    //   • D) both changed       → CONFLICT — flag as drift
    // `userEdited` requires a non-null last_synced; if null we treat as
    // no-edit (eager auto-pull), which matches the migration backfill
    // semantics.
    const fieldDecide = (
      label: DriftField,
      vimeoVal: string,
      localVal: string,
      lastSynced: string | null,
      assignAuto: () => void,
      assignSnapshot: () => void,
    ) => {
      // Empty Vimeo values never trigger sync (Vimeo strips trivial edits)
      if (!vimeoVal) return;
      const vimeoChanged = vimeoVal !== (lastSynced ?? "");
      const userEdited = lastSynced !== null && localVal !== lastSynced;
      if (vimeoChanged && userEdited) {
        conflictFields.push(label);
      } else if (vimeoChanged && !userEdited) {
        // Auto-pull from Vimeo, advance the snapshot
        assignAuto();
      } else if (!vimeoChanged && lastSynced === null) {
        // Bootstrapping: snapshot was never set and Vimeo matches an
        // already-correct local value. Just record the snapshot.
        assignSnapshot();
      }
      // Other cases: no action needed
    };

    // THUMBNAIL — always auto-apply, never a conflict
    if (v.thumbnail && v.thumbnail !== (a.thumbnail || "")) {
      updates.thumbnail = v.thumbnail;
    }

    fieldDecide(
      "title",
      v.title || "",
      a.headline || "",
      a.last_synced_title,
      () => { updates.headline = v.title; updates.last_synced_title = v.title; },
      () => { updates.last_synced_title = v.title; },
    );
    fieldDecide(
      "description",
      v.description || "",
      a.description || "",
      a.last_synced_description,
      () => { updates.description = v.description; updates.last_synced_description = v.description; },
      () => { updates.last_synced_description = v.description; },
    );
    fieldDecide(
      "transcript",
      v.transcript || "",
      a.transcript || "",
      a.last_synced_transcript,
      () => { updates.transcript = v.transcript; updates.last_synced_transcript = v.transcript; },
      () => { updates.last_synced_transcript = v.transcript; },
    );

    if (Object.keys(updates).length > 0) {
      autoUpdates.push({ assetId: a.id, updates });
      autoAppliedCount++;
    }
    if (conflictFields.length > 0) {
      drifted.push({
        assetId: a.id,
        headline: a.headline || v.title || "Untitled",
        fields: conflictFields,
        storyMatch: { headline: a.headline || "", description: a.description || "" },
        vimeo: {
          title: v.title || "",
          description: v.description || "",
          thumbnail: v.thumbnail || "",
          transcript: v.transcript || "",
        },
      });
    } else if (Object.keys(updates).length === 0) {
      inSyncCount++;
    }
  }

  // Apply auto-updates. Sequential to avoid overwhelming the DB; small per
  // showcase. Failures here just leave the asset in its previous state and
  // get re-attempted next sync — no need to abort the whole run, but we log
  // so missing columns or other schema drift are visible in Vercel logs.
  for (const u of autoUpdates) {
    const { error } = await supabaseAdmin.from("assets").update(u.updates).eq("id", u.assetId).eq("org_id", orgId);
    if (error) {
      console.error("[runSourceSync] auto-update failed", { assetId: u.assetId, error: error.message, hint: error.hint, updates: Object.keys(u.updates) });
    }
  }
  void autoAppliedCount;

  // ── 4. Merge into source.pending_sync_report ──
  // imported + archived accumulate by assetId (deduped, earlier detectedAt
  // wins). drifted + previouslyDeleted are recomputed each sync, but if the
  // same assetId was already in the previous report's same category, we
  // preserve its detectedAt so re-detected drift doesn't reset to "just now".
  const prev = (source.pending_sync_report as PendingSyncReport | null) || null;
  const nowIso = new Date().toISOString();

  // Preserve the earliest-known detectedAt for an asset within a category.
  const dedupedAccum = <T extends { assetId: string; detectedAt: string }>(
    prevList: T[] | undefined,
    newList: T[]
  ): T[] => {
    const map = new Map<string, T>();
    for (const item of (prevList || [])) map.set(item.assetId, item);
    for (const item of newList) {
      const existing = map.get(item.assetId);
      if (existing) {
        // Keep existing (with original detectedAt) — accumulation, not replacement
        continue;
      }
      map.set(item.assetId, item);
    }
    return Array.from(map.values());
  };

  // For replace-style categories, lift detectedAt from prev where it exists
  // so a still-drifted item shows "noticed 3 days ago" instead of "just now".
  const liftDetectedAt = <T extends { assetId: string; detectedAt: string }>(
    prevList: T[] | undefined,
    newList: T[]
  ): T[] => {
    const prevById = new Map((prevList || []).map(i => [i.assetId, i]));
    return newList.map(item => ({ ...item, detectedAt: prevById.get(item.assetId)?.detectedAt || item.detectedAt }));
  };

  const importedNow: ImportedItem[] = insertedAssets.map(a => ({ assetId: a.id, headline: a.headline, detectedAt: nowIso }));
  const archivedNow: ArchivedItem[] = orphaned.map(a => ({ assetId: a.id, headline: a.headline || "Untitled", detectedAt: nowIso }));
  const driftedNow: DriftedItem[] = drifted.map(d => ({ ...d, detectedAt: nowIso }));
  const previouslyDeletedNow: PreviouslyDeletedItem[] = previouslyDeleted.map(p => ({ ...p, detectedAt: nowIso }));

  const merged: PendingSyncReport = {
    syncedAt: nowIso,
    videoCount: videos.length,
    inSyncCount,
    imported: dedupedAccum(prev?.imported, importedNow),
    archived: dedupedAccum(prev?.archived, archivedNow),
    drifted: liftDetectedAt(prev?.drifted, driftedNow),
    previouslyDeleted: liftDetectedAt(prev?.previouslyDeleted, previouslyDeletedNow),
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
