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

interface VimeoPicture {
  sizes?: { link: string; width: number; height: number }[];
}

interface VimeoVideo {
  uri: string;           // e.g., "/videos/123456789"
  link: string;          // public URL
  name: string;
  description: string | null;
  duration: number;
  created_time: string;
  pictures?: VimeoPicture;
  user?: { name?: string; uri?: string };
}

interface VimeoAlbumVideosResponse {
  total: number;
  page: number;
  per_page: number;
  data: VimeoVideo[];
  paging?: { next?: string | null };
}

interface VimeoTextTrack {
  uri: string;
  active: boolean;
  type: string;         // "captions" | "subtitles"
  language: string;     // "en", "en-US", etc.
  link: string;         // URL to fetch the actual VTT file
  auto_generated?: boolean;
}

interface VimeoTextTracksResponse {
  total: number;
  data: VimeoTextTrack[];
}

// Extract album/showcase ID from a URL like https://vimeo.com/showcase/11991019
function extractShowcaseId(url: string): string | null {
  const m = url.match(/vimeo\.com\/(?:showcase|album)\/(\d+)/);
  return m ? m[1] : null;
}

// Pick the largest available thumbnail from a Vimeo `sizes` array.
// Sort by total pixel area so vertical videos correctly pick their tallest
// variant (e.g. 1080x1920 has area 2,073,600 — same as 1920x1080).
function pickLargestThumb(sizes: { link: string; width: number; height: number }[]): string {
  if (!sizes || sizes.length === 0) return "";
  const sorted = [...sizes].sort((a, b) => (b.width * b.height) - (a.width * a.height));
  return sorted[0].link;
}

// Fall-back thumbnail picker for the album-list response. The album endpoint
// often returns an abbreviated `pictures` object with only one or two small
// sizes (typically 295×166), even for videos whose full picture set on Vimeo
// includes 1920×1080 or larger. We only use this if the dedicated
// /videos/{id} fetch fails.
function bestThumbFromVideo(video: VimeoVideo): string {
  return pickLargestThumb(video.pictures?.sizes || []);
}

// Fetch the full pictures.sizes array for a single video via the dedicated
// /videos/{id} endpoint. Returns the largest thumbnail URL, or "" on failure.
// This guarantees we get every size Vimeo has generated (up to 1920×1080
// for landscape, 1080×1920 for portrait), not the truncated set the album
// listing returns.
async function fetchHighResThumb(
  videoId: string,
  accessToken: string
): Promise<string> {
  try {
    const resp = await fetch(
      `https://api.vimeo.com/videos/${videoId}?fields=pictures.sizes`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/vnd.vimeo.*+json;version=3.4",
        },
      }
    );
    if (!resp.ok) return "";
    const data = (await resp.json()) as { pictures?: VimeoPicture };
    return pickLargestThumb(data?.pictures?.sizes || []);
  } catch (e) {
    console.warn(`Hi-res thumbnail fetch failed for video ${videoId}:`, e);
    return "";
  }
}

// Strip a WebVTT caption file down to just the spoken text
function parseVtt(vtt: string): string {
  const lines = vtt.split(/\r?\n/);
  const out: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    // Skip blank lines, the WEBVTT header, timestamp cues, and numeric cue IDs
    if (!trimmed) continue;
    if (trimmed.startsWith("WEBVTT")) continue;
    if (trimmed.startsWith("NOTE")) continue;
    if (/^\d+$/.test(trimmed)) continue;
    if (/-->/.test(trimmed)) continue;
    // Strip HTML/VTT styling tags like <v.speaker>, <c.yellow>
    const cleaned = trimmed.replace(/<[^>]+>/g, "");
    out.push(cleaned);
  }
  // Join with spaces, collapse runs of whitespace
  return out.join(" ").replace(/\s+/g, " ").trim();
}

// Fetch the full transcript for a single Vimeo video ID.
// Returns empty string if no caption track is available.
async function fetchTranscript(
  videoId: string,
  accessToken: string
): Promise<string> {
  try {
    const tracksResp = await fetch(
      `https://api.vimeo.com/videos/${videoId}/texttracks`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/vnd.vimeo.*+json;version=3.4",
        },
      }
    );
    if (!tracksResp.ok) return "";
    const tracksBody = (await tracksResp.json()) as VimeoTextTracksResponse;
    const tracks = tracksBody.data || [];
    if (tracks.length === 0) return "";

    // Prefer English, then active track, then auto-generated, then anything
    const chosen =
      tracks.find((t) => t.active && t.language?.toLowerCase().startsWith("en")) ||
      tracks.find((t) => t.language?.toLowerCase().startsWith("en")) ||
      tracks.find((t) => t.active) ||
      tracks[0];

    if (!chosen?.link) return "";

    const vttResp = await fetch(chosen.link, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!vttResp.ok) return "";
    const vtt = await vttResp.text();
    return parseVtt(vtt);
  } catch (e) {
    console.warn(`Transcript fetch failed for video ${videoId}:`, e);
    return "";
  }
}

// Run async tasks with a concurrency limit so we don't overwhelm Vimeo's rate limit.
async function parallelMap<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }).map(async () => {
    while (cursor < items.length) {
      const i = cursor++;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

// GET /api/vimeo/showcase?url=https://vimeo.com/showcase/11991019
export async function GET(req: NextRequest) {
  const ctx = await getCurrentUserOrg(req);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (ctx.role !== "admin") {
    return NextResponse.json({ error: "Admins only" }, { status: 403 });
  }

  const showcaseUrl = req.nextUrl.searchParams.get("url");
  if (!showcaseUrl) {
    return NextResponse.json({ error: "url parameter required" }, { status: 400 });
  }

  const albumId = extractShowcaseId(showcaseUrl);
  if (!albumId) {
    return NextResponse.json(
      { error: "Not a valid Vimeo showcase URL" },
      { status: 400 }
    );
  }

  // Get the user's Vimeo access token
  const { data: connection } = await supabaseAdmin
    .from("vimeo_connections")
    .select("access_token, vimeo_user_id")
    .eq("user_id", ctx.userId)
    .maybeSingle();

  if (!connection?.access_token) {
    return NextResponse.json(
      { error: "Vimeo not connected. Connect your Vimeo account first." },
      { status: 401 }
    );
  }

  // Fetch all videos in the album, handling pagination
  const allVideos: VimeoVideo[] = [];
  let nextUrl: string | null =
    `https://api.vimeo.com/me/albums/${albumId}/videos?per_page=100&fields=uri,link,name,description,duration,created_time,pictures,user`;

  try {
    while (nextUrl) {
      const resp: Response = await fetch(nextUrl, {
        headers: {
          Authorization: `Bearer ${connection.access_token}`,
          Accept: "application/vnd.vimeo.*+json;version=3.4",
        },
      });

      if (!resp.ok) {
        // If album isn't under /me, try the generic /albums/{id}/videos path
        if (resp.status === 404 && nextUrl.includes("/me/albums/")) {
          nextUrl = nextUrl.replace("/me/albums/", "/albums/");
          continue;
        }
        const errText = await resp.text();
        return NextResponse.json(
          {
            error: `Vimeo API error: ${resp.status}`,
            details: errText.substring(0, 400),
          },
          { status: resp.status }
        );
      }

      const body = (await resp.json()) as VimeoAlbumVideosResponse;
      allVideos.push(...(body.data || []));
      nextUrl = body.paging?.next
        ? body.paging.next.startsWith("http")
          ? body.paging.next
          : `https://api.vimeo.com${body.paging.next}&fields=uri,link,name,description,duration,created_time,pictures,user`
        : null;
      // Safety break
      if (allVideos.length > 500) break;
    }
  } catch (e) {
    return NextResponse.json(
      { error: `Fetch failed: ${(e as Error).message}` },
      { status: 500 }
    );
  }

  // Transform basics, then fetch transcripts AND high-res thumbnails in parallel.
  // The album endpoint's `pictures` response is often truncated (only 295×166
  // returned), so we hit /videos/{id}?fields=pictures.sizes directly per video
  // to get the full size set. Falls back to whatever the album listing returned
  // if the dedicated fetch fails.
  const basics = allVideos.map((v) => ({
    vimeoId: v.uri.split("/").pop() || "",
    url: v.link,
    title: v.name,
    description: v.description || "",
    durationSec: v.duration,
    createdAt: v.created_time,
    thumbnailFallback: bestThumbFromVideo(v),
    uploader: v.user?.name || "",
  }));

  const [transcripts, hiResThumbs] = await Promise.all([
    parallelMap(basics, 5, async (b) =>
      b.vimeoId ? await fetchTranscript(b.vimeoId, connection.access_token) : ""
    ),
    parallelMap(basics, 5, async (b) =>
      b.vimeoId ? await fetchHighResThumb(b.vimeoId, connection.access_token) : ""
    ),
  ]);

  const normalized = basics.map((b, i) => {
    const { thumbnailFallback, ...rest } = b;
    return {
      ...rest,
      thumbnail: hiResThumbs[i] || thumbnailFallback,
      transcript: transcripts[i] || "",
    };
  });

  return NextResponse.json({
    albumId,
    videoCount: normalized.length,
    videos: normalized,
  });
}
