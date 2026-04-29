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
// AutoAppliedItem records changes that flowed Vimeo → StoryMatch silently
// because the admin hadn't edited the field locally. Includes thumbnail
// (which is *only* ever auto-applied — never user-editable in StoryMatch).
export type AutoAppliedField = "title" | "description" | "transcript" | "thumbnail";
export interface AutoAppliedItem {
  assetId: string;
  headline: string;
  fields: AutoAppliedField[];
  detectedAt: string;
}
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
  // Vimeo → StoryMatch changes that auto-applied silently. Informational
  // only; admin doesn't need to take action (they're already applied).
  autoApplied: AutoAppliedItem[];
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

function extractVimeoVideoId(url: string): string | null {
  // Matches vimeo.com/123456789, vimeo.com/video/123456789, plus optional
  // hash suffix like vimeo.com/123456789/abc123 (private link). Skips
  // showcase/album URLs which have a non-numeric path segment.
  if (/vimeo\.com\/(?:showcase|album)\//.test(url)) return null;
  const m = url.match(/vimeo\.com\/(?:video\/)?(\d+)/);
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
  // Vimeo's created_time — the actual publish date of the video. Used by
  // the Cleared signal to flag stale stories per org-level freshness rule.
  publishedAt: string;
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
    publishedAt: v.created_time || "",
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
    publishedAt: b.publishedAt,
  }));
}

// Fetch a single video as a one-element NormalizedVideo[] (or empty if the
// video is gone from Vimeo — caller treats empty as "orphan, auto-archive").
// Returns null only on hard failure (no token, network error). Reuses the
// same hi-res thumb + transcript fetches as showcase sync so single videos
// get the same quality as showcase imports.
async function fetchSingleVideo(videoUrl: string, accessToken: string): Promise<NormalizedVideo[] | null> {
  const videoId = extractVimeoVideoId(videoUrl);
  if (!videoId) return null;
  try {
    const resp = await fetch(
      `https://api.vimeo.com/videos/${videoId}?fields=uri,link,name,description,duration,created_time,pictures`,
      { headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/vnd.vimeo.*+json;version=3.4" } },
    );
    // 404 → video deleted from Vimeo. Return empty so the orphan-check
    // logic auto-archives the existing asset. Don't surface as an error.
    if (resp.status === 404) return [];
    if (!resp.ok) return null;
    const v = await resp.json() as VimeoVideo;
    const [transcript, hiResThumb] = await Promise.all([
      fetchTranscript(videoId, accessToken),
      fetchHighResThumb(videoId, accessToken),
    ]);
    return [{
      vimeoId: videoId,
      url: v.link,
      title: v.name,
      description: v.description || "",
      thumbnail: hiResThumb || pickLargestThumb(v.pictures?.sizes),
      transcript: transcript || "",
      publishedAt: v.created_time || "",
    }];
  } catch {
    return null;
  }
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
  // Vimeo's actual upload date — auto-updated on every sync (never user-editable).
  published_at: string | null;
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

  // Fetch the current Vimeo state for this source. Showcase sources fetch
  // many videos; single-video sources fetch just one. Both return the same
  // NormalizedVideo[] shape so the rest of the sync logic is identical.
  const sourceType = String(source.type || "");
  const videos = sourceType === "vm-video"
    ? await fetchSingleVideo(source.url as string, token)
    : await fetchShowcaseVideos(source.url as string, token);
  if (!videos) return { ok: false, error: `Failed to fetch Vimeo ${sourceType === "vm-video" ? "video" : "showcase"}`, status: 502 };

  // Look up all existing assets attached to this source. Include soft-deleted
  // (status='deleted') so we can detect "previously deleted, still in Vimeo".
  const existingAssetIds = (source.asset_ids as string[] | null) || [];
  let existingAssets: AssetRow[] = [];
  if (existingAssetIds.length > 0) {
    const { data: rows } = await supabaseAdmin
      .from("assets")
      .select("id, source_id, status, video_url, headline, description, thumbnail, transcript, published_at, last_synced_title, last_synced_description, last_synced_transcript")
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
      // Vimeo's actual publish date — drives the freshness Rule.
      published_at: v.publishedAt || null,
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
  // Per-field decision (for title / description / transcript):
  //   • local === current Vimeo                → in sync, no action
  //   • local !== current Vimeo, user edited   → DRIFT (admin sees in inbox,
  //     can choose to keep their edit or pull from Vimeo)
  //   • local !== current Vimeo, user untouched → AUTO-PULL from Vimeo, also
  //     log to autoApplied so the admin sees what changed
  //
  // Thumbnail is special: never user-editable in StoryMatch, so any Vimeo
  // change just auto-applies and gets logged to autoApplied. Never drift.
  //
  // "user edited" = last_synced is non-null AND differs from current local.
  // last_synced null is treated as "no edit recorded" (eager auto-pull) —
  // matches the migration backfill semantics.
  // detectedAt is added below via .map, so omit it here.
  const drifted: Omit<DriftedItem, "detectedAt">[] = [];
  const previouslyDeleted: Omit<PreviouslyDeletedItem, "detectedAt">[] = [];
  // Per-asset list of fields that auto-applied this sync run.
  const autoAppliedThisRun = new Map<string, { headline: string; fields: AutoAppliedField[] }>();
  const noteAutoApplied = (assetId: string, headline: string, field: AutoAppliedField) => {
    const existing = autoAppliedThisRun.get(assetId);
    if (existing) {
      if (!existing.fields.includes(field)) existing.fields.push(field);
    } else {
      autoAppliedThisRun.set(assetId, { headline, fields: [field] });
    }
  };
  // Snake-case payloads ready to send to supabase (matches DB column names).
  type AssetUpdatePayload = {
    headline?: string;
    description?: string;
    transcript?: string;
    thumbnail?: string;
    published_at?: string;
    last_synced_title?: string;
    last_synced_description?: string;
    last_synced_transcript?: string;
  };
  const autoUpdates: { assetId: string; updates: AssetUpdatePayload }[] = [];
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
        vimeo: {
          title: v.title || "",
          description: v.description || "",
          thumbnail: v.thumbnail || "",
          transcript: v.transcript || "",
        },
      });
      continue;
    }

    const displayHeadline = a.headline || v.title || "Untitled";
    const conflictFields: DriftField[] = [];
    const updates: AssetUpdatePayload = {};

    const fieldDecide = (
      label: DriftField,
      vimeoVal: string,
      localVal: string,
      lastSynced: string | null,
      assignAuto: () => void,
      assignSnapshot: () => void,
    ) => {
      if (!vimeoVal) return;                  // Empty Vimeo values never trigger
      if (vimeoVal === localVal) {
        // In sync. Refresh snapshot if it's stale (e.g. lastSynced null after migration).
        if (lastSynced !== vimeoVal) assignSnapshot();
        return;
      }
      const userEdited = lastSynced !== null && localVal !== lastSynced;
      if (userEdited) {
        conflictFields.push(label);
      } else {
        assignAuto();
        noteAutoApplied(a.id, displayHeadline, label);
      }
    };

    // THUMBNAIL — always auto-apply, never a conflict
    if (v.thumbnail && v.thumbnail !== (a.thumbnail || "")) {
      updates.thumbnail = v.thumbnail;
      noteAutoApplied(a.id, displayHeadline, "thumbnail");
    }

    // PUBLISH DATE — always auto-apply (Vimeo source of truth, never
    // user-editable). Repairs assets where the migration backfilled
    // date_created instead of the real upload time, and any future drift.
    // Not surfaced in autoApplied (admin doesn't care — it's a fact
    // about Vimeo, not a content change to review).
    if (v.publishedAt) {
      const currentTs = a.published_at ? new Date(a.published_at).getTime() : 0;
      const vimeoTs = new Date(v.publishedAt).getTime();
      if (!Number.isNaN(vimeoTs) && currentTs !== vimeoTs) {
        updates.published_at = v.publishedAt;
      }
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
    }
    if (conflictFields.length > 0) {
      drifted.push({
        assetId: a.id,
        headline: displayHeadline,
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

  // autoApplied accumulates by assetId, but unions the field set so an asset
  // that auto-applied a title last week and a description today shows both.
  // Earliest detectedAt wins. Headline always reflects the most recent value
  // so the row label stays useful as titles change.
  const accumAutoApplied = (
    prevList: AutoAppliedItem[] | undefined,
    newList: AutoAppliedItem[]
  ): AutoAppliedItem[] => {
    const map = new Map<string, AutoAppliedItem>();
    for (const item of (prevList || [])) map.set(item.assetId, item);
    for (const item of newList) {
      const existing = map.get(item.assetId);
      if (existing) {
        const fields = Array.from(new Set([...existing.fields, ...item.fields])) as AutoAppliedField[];
        map.set(item.assetId, { ...existing, fields, headline: item.headline });
      } else {
        map.set(item.assetId, item);
      }
    }
    return Array.from(map.values());
  };

  const importedNow: ImportedItem[] = insertedAssets.map(a => ({ assetId: a.id, headline: a.headline, detectedAt: nowIso }));
  const archivedNow: ArchivedItem[] = orphaned.map(a => ({ assetId: a.id, headline: a.headline || "Untitled", detectedAt: nowIso }));
  const driftedNow: DriftedItem[] = drifted.map(d => ({ ...d, detectedAt: nowIso }));
  const previouslyDeletedNow: PreviouslyDeletedItem[] = previouslyDeleted.map(p => ({ ...p, detectedAt: nowIso }));
  const autoAppliedNow: AutoAppliedItem[] = Array.from(autoAppliedThisRun.entries()).map(([assetId, info]) => ({
    assetId,
    headline: info.headline,
    fields: info.fields,
    detectedAt: nowIso,
  }));

  const merged: PendingSyncReport = {
    syncedAt: nowIso,
    videoCount: videos.length,
    inSyncCount,
    imported: dedupedAccum(prev?.imported, importedNow),
    archived: dedupedAccum(prev?.archived, archivedNow),
    drifted: liftDetectedAt(prev?.drifted, driftedNow),
    previouslyDeleted: liftDetectedAt(prev?.previouslyDeleted, previouslyDeletedNow),
    autoApplied: accumAutoApplied(prev?.autoApplied, autoAppliedNow),
  };

  // ── 5. Update source row ──
  const newAssetIds = [...existingAssetIds, ...insertedAssets.map(a => a.id)];
  // For single-video sources, mirror the Vimeo video's title into source.name
  // so the admin sees the actual title in the sources list (instead of the
  // placeholder "Vimeo video"). Showcase sources keep their admin-set name.
  type SourceUpdate = {
    pending_sync_report: PendingSyncReport;
    last_sync: string;
    video_count: number;
    asset_ids: string[];
    status: string;
    name?: string;
  };
  const sourceUpdate: SourceUpdate = {
    pending_sync_report: merged,
    last_sync: new Date().toISOString(),
    video_count: videos.length,
    asset_ids: newAssetIds,
    status: "synced",
  };
  if (sourceType === "vm-video" && videos.length > 0 && videos[0].title) {
    sourceUpdate.name = videos[0].title;
  }
  await supabaseAdmin
    .from("sources")
    .update(sourceUpdate)
    .eq("id", sourceId);

  return {
    ok: true,
    pendingSyncReport: merged,
    newAssetIds: insertedAssets.map(a => a.id),
    videoCount: videos.length,
  };
}
