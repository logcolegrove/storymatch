import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { applyPublicationRules, getOrgRulesContext, type AssetRuleInput } from "@/lib/publication-rules";
import { syncAssetQuotes, type AssetQuoteInput } from "@/lib/quotes-dal";

// ───────────────────────────────────────────────────────────
// Helper: get the current user + their org from the auth header
// ───────────────────────────────────────────────────────────
async function getCurrentUserOrg(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;

  const token = authHeader.slice(7);
  const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !user) return null;

  // Look up their org membership
  const { data: membership } = await supabaseAdmin
    .from("org_members")
    .select("org_id, role")
    .eq("user_id", user.id)
    .limit(1)
    .maybeSingle();

  if (!membership) return null;

  return {
    userId: user.id,
    userEmail: user.email || "",
    orgId: membership.org_id as string,
    role: membership.role as "admin" | "sales",
  };
}

// ───────────────────────────────────────────────────────────
// Helpers: convert between camelCase (FE) and snake_case (DB)
// ───────────────────────────────────────────────────────────
type AssetDB = {
  id: string;
  org_id: string | null;
  source_id: string | null;
  client_name: string;
  company: string;
  vertical: string;
  geography: string;
  company_size: string;
  challenge: string;
  outcome: string;
  asset_type: string;
  video_url: string;
  status: string;
  date_created: string;
  headline: string;
  pull_quote: string;
  transcript: string;
  description: string;
  thumbnail: string;
  // Governance / lifecycle (added in testimonial-governance migration)
  archived_at: string | null;
  archived_reason: string | null;
  client_status: string;
  client_status_source: string;
  client_status_updated_at: string | null;
  crm_account_id: string | null;
  last_verified_at: string | null;
  // Approval (one of three signals feeding the "Cleared" indicator)
  approval_status: string;
  approval_note: string | null;
  approval_recorded_at: string | null;
  // Job title / role of the primary client (e.g. "Director of IT").
  // Per-client roles for additional_clients live inside the JSONB blob.
  client_role: string | null;
  // Whether the primary pull quote is starred. Per-quote favorite flags
  // for additional_quotes live inside their JSONB objects.
  pull_quote_favorite: boolean | null;
  // Vimeo sync conflict-detection markers (auto-sync migration)
  last_synced_title: string | null;
  last_synced_description: string | null;
  last_synced_transcript: string | null;
  // Vimeo publish date — drives the org's freshness Rule.
  published_at: string | null;
  // Per-asset freshness exception (overrides org freshness rule).
  // until is null = no exception. Far-future = "never flag." With expiry =
  // approve until that date.
  freshness_exception_until: string | null;
  freshness_exception_set_by_email: string | null;
  freshness_exception_set_at: string | null;
  // Per-asset custom flags — admin-defined arbitrary review flags.
  // Each entry: { id, label, color, note, setByEmail, setAt }
  custom_flags: unknown;
  // Additional pull quotes — primary quote stays in pull_quote (singular)
  // for backward compat. This array holds the rest, in display order.
  // Empty array = no additional quotes; only the primary is used.
  additional_quotes: unknown;
  // Additional client/company pairs beyond the primary client_name +
  // company. Same pattern as additional_quotes — first entry is the
  // "primary" by convention. Used for compilation videos featuring
  // multiple speakers from one or many companies.
  additional_clients: unknown;
  // Timestamped transcript segments parsed from the source VTT. Each
  // entry: { startSeconds: number; text: string }. Plain transcript
  // (the existing `transcript` column) is still the source of truth
  // for editing; segments are read-only for the expand-view reader.
  transcript_segments: unknown;
  // Stamp tracking which org rule (if any) auto-set the current status.
  // Cleared on manual edits. Used by the rule engine to know when to
  // auto-restore a rule-drafted asset back to published.
  auto_status_by_rule: string | null;
};

type AssetFE = {
  id: string;
  sourceId?: string | null;
  clientName: string;
  company: string;
  vertical: string;
  geography: string;
  companySize: string;
  challenge: string;
  outcome: string;
  assetType: string;
  videoUrl: string;
  status: string;
  dateCreated: string;
  headline: string;
  pullQuote: string;
  transcript: string;
  description: string;
  thumbnail: string;
  // Governance / lifecycle
  archivedAt?: string | null;
  archivedReason?: string | null;
  clientStatus?: string;
  clientStatusSource?: string;
  clientStatusUpdatedAt?: string | null;
  crmAccountId?: string | null;
  lastVerifiedAt?: string | null;
  // Approval
  approvalStatus?: string;
  approvalNote?: string | null;
  approvalRecordedAt?: string | null;
  // Primary client's job title / role.
  clientRole?: string;
  // Star/favorite flag for the primary pull quote.
  pullQuoteFavorite?: boolean;
  // Vimeo sync conflict-detection markers — only set when admin pulls from
  // Vimeo via the drift report (so we know their local edit was overridden).
  lastSyncedTitle?: string | null;
  lastSyncedDescription?: string | null;
  lastSyncedTranscript?: string | null;
  // Read-only — set at insert time from Vimeo's created_time. Not editable.
  publishedAt?: string | null;
  // Per-asset freshness exception. set_by_email and set_at are stamped
  // server-side from the auth context — clients only send the until date.
  freshnessExceptionUntil?: string | null;
  freshnessExceptionSetByEmail?: string | null;
  freshnessExceptionSetAt?: string | null;
  // Custom flags — round-tripped as-is (clients send the full array on each
  // edit). Each entry: { id, label, color, note, setByEmail, setAt }.
  customFlags?: unknown;
  // Additional quotes beyond the primary pullQuote. Each entry stores
  // its own text + favorite flag. Old data may contain plain strings
  // — dbToFe coerces them to {text, favorite:false} on read.
  additionalQuotes?: { text: string; favorite?: boolean }[];
  // Additional client/company pairs beyond the primary client. Each
  // carries its own role + filter metadata (vertical/geography/size)
  // so compilation videos can mix companies and verticals cleanly.
  additionalClients?: { clientName: string; company: string; role?: string; vertical?: string; geography?: string; companySize?: string }[];
  // Read-only timestamped transcript segments (parsed from source VTT).
  // Empty when source had no captions or asset hasn't been synced since
  // segments were introduced.
  transcriptSegments?: { startSeconds: number; text: string }[];
};

function dbToFe(r: AssetDB): AssetFE {
  return {
    id: r.id,
    sourceId: r.source_id,
    clientName: r.client_name,
    company: r.company,
    vertical: r.vertical,
    geography: r.geography,
    companySize: r.company_size,
    challenge: r.challenge,
    outcome: r.outcome,
    assetType: r.asset_type,
    videoUrl: r.video_url,
    status: r.status,
    dateCreated: r.date_created,
    headline: r.headline,
    pullQuote: r.pull_quote,
    transcript: r.transcript,
    description: r.description,
    thumbnail: r.thumbnail,
    archivedAt: r.archived_at,
    archivedReason: r.archived_reason,
    clientStatus: r.client_status,
    clientStatusSource: r.client_status_source,
    clientStatusUpdatedAt: r.client_status_updated_at,
    crmAccountId: r.crm_account_id,
    lastVerifiedAt: r.last_verified_at,
    approvalStatus: r.approval_status,
    approvalNote: r.approval_note,
    approvalRecordedAt: r.approval_recorded_at,
    lastSyncedTitle: r.last_synced_title,
    lastSyncedDescription: r.last_synced_description,
    lastSyncedTranscript: r.last_synced_transcript,
    publishedAt: r.published_at,
    freshnessExceptionUntil: r.freshness_exception_until,
    freshnessExceptionSetByEmail: r.freshness_exception_set_by_email,
    freshnessExceptionSetAt: r.freshness_exception_set_at,
    customFlags: Array.isArray(r.custom_flags) ? r.custom_flags : [],
    // Quotes can be old strings or new {text, favorite} objects in DB.
    // Coerce both shapes to the new shape so the FE only deals with one.
    additionalQuotes: (Array.isArray(r.additional_quotes) ? r.additional_quotes : []).map((q: unknown) => {
      if (typeof q === "string") return { text: q, favorite: false };
      if (q && typeof q === "object") {
        const o = q as Record<string, unknown>;
        return { text: typeof o.text === "string" ? o.text : "", favorite: !!o.favorite };
      }
      return { text: "", favorite: false };
    }),
    // Additional clients — older data may only have {clientName, company}.
    // Fill in missing fields with empty strings so the FE always sees the
    // full shape.
    additionalClients: (Array.isArray(r.additional_clients) ? r.additional_clients : []).map((c: unknown) => {
      const o = (c && typeof c === "object" ? c : {}) as Record<string, unknown>;
      return {
        clientName: typeof o.clientName === "string" ? o.clientName : "",
        company: typeof o.company === "string" ? o.company : "",
        role: typeof o.role === "string" ? o.role : "",
        vertical: typeof o.vertical === "string" ? o.vertical : "",
        geography: typeof o.geography === "string" ? o.geography : "",
        companySize: typeof o.companySize === "string" ? o.companySize : "",
      };
    }),
    transcriptSegments: Array.isArray(r.transcript_segments) ? (r.transcript_segments as { startSeconds: number; text: string }[]) : [],
    clientRole: r.client_role || "",
    pullQuoteFavorite: !!r.pull_quote_favorite,
  };
}

function feToDb(a: Partial<AssetFE> & { id: string }, orgId: string, currentUserEmail?: string): Partial<AssetDB> {
  const o: Partial<AssetDB> = { id: a.id, org_id: orgId };
  if (a.sourceId !== undefined) o.source_id = a.sourceId;
  if (a.clientName !== undefined) o.client_name = a.clientName;
  if (a.company !== undefined) o.company = a.company;
  if (a.vertical !== undefined) o.vertical = a.vertical;
  if (a.geography !== undefined) o.geography = a.geography;
  if (a.companySize !== undefined) o.company_size = a.companySize;
  if (a.challenge !== undefined) o.challenge = a.challenge;
  if (a.outcome !== undefined) o.outcome = a.outcome;
  if (a.assetType !== undefined) o.asset_type = a.assetType;
  if (a.videoUrl !== undefined) o.video_url = a.videoUrl;
  if (a.status !== undefined) {
    o.status = a.status;
    // Any manual publication change clears the rule-stamp so future
    // auto-restore doesn't clobber the admin's intent. The rule engine
    // re-stamps if it fires again after this update.
    o.auto_status_by_rule = null;
  }
  if (a.dateCreated !== undefined) o.date_created = a.dateCreated;
  if (a.headline !== undefined) o.headline = a.headline;
  if (a.pullQuote !== undefined) o.pull_quote = a.pullQuote;
  if (a.transcript !== undefined) o.transcript = a.transcript;
  if (a.description !== undefined) o.description = a.description;
  if (a.thumbnail !== undefined) o.thumbnail = a.thumbnail;
  if (a.archivedAt !== undefined) o.archived_at = a.archivedAt;
  if (a.archivedReason !== undefined) o.archived_reason = a.archivedReason;
  if (a.clientStatus !== undefined) o.client_status = a.clientStatus;
  if (a.clientStatusSource !== undefined) o.client_status_source = a.clientStatusSource;
  if (a.clientStatusUpdatedAt !== undefined) o.client_status_updated_at = a.clientStatusUpdatedAt;
  if (a.crmAccountId !== undefined) o.crm_account_id = a.crmAccountId;
  if (a.lastVerifiedAt !== undefined) o.last_verified_at = a.lastVerifiedAt;
  if (a.approvalStatus !== undefined) o.approval_status = a.approvalStatus;
  if (a.approvalNote !== undefined) o.approval_note = a.approvalNote;
  if (a.approvalRecordedAt !== undefined) o.approval_recorded_at = a.approvalRecordedAt;
  if (a.lastSyncedTitle !== undefined) o.last_synced_title = a.lastSyncedTitle;
  if (a.lastSyncedDescription !== undefined) o.last_synced_description = a.lastSyncedDescription;
  if (a.lastSyncedTranscript !== undefined) o.last_synced_transcript = a.lastSyncedTranscript;
  // publishedAt is normally set server-side by source-sync, but the
  // showcase initial-import path goes through this endpoint and needs
  // to persist Vimeo's created_time on insert. Otherwise the assets
  // come back with null published_at and "Publish date not recorded yet"
  // shows in the popover until a manual sync.
  if (a.publishedAt !== undefined) o.published_at = a.publishedAt;
  // Custom flags — pass through whatever array the client sends. Server
  // doesn't validate structure beyond it being an array (client-side
  // shape enforcement is enough for this admin-only feature).
  if (a.customFlags !== undefined) o.custom_flags = a.customFlags;
  // Additional quotes — array of strings beyond the primary pull_quote.
  // Pass through; client-side validates that entries are strings.
  if (a.additionalQuotes !== undefined) o.additional_quotes = a.additionalQuotes;
  // Additional clients — array of full per-client objects beyond the
  // primary. Pass through; the JSONB column is shape-agnostic.
  if (a.additionalClients !== undefined) o.additional_clients = a.additionalClients;
  // Primary client's role + primary quote favorite flag.
  if (a.clientRole !== undefined) o.client_role = a.clientRole;
  if (a.pullQuoteFavorite !== undefined) o.pull_quote_favorite = a.pullQuoteFavorite;
  // transcript_segments is sync-derived (server-only) — clients never
  // post it. Intentionally not mapped here so a stray FE write can't
  // overwrite the parsed segments captured by source-sync.
  // Per-asset freshness exception. When the FE writes a value (set or clear),
  // server stamps set_by_email + set_at from the auth context — clients
  // never set those directly, so we ignore any FE-supplied values.
  if (a.freshnessExceptionUntil !== undefined) {
    o.freshness_exception_until = a.freshnessExceptionUntil;
    if (a.freshnessExceptionUntil === null) {
      // Clearing the exception clears the audit fields too.
      o.freshness_exception_set_by_email = null;
      o.freshness_exception_set_at = null;
    } else {
      // Setting/changing the exception stamps fresh audit fields.
      o.freshness_exception_set_by_email = currentUserEmail || null;
      o.freshness_exception_set_at = new Date().toISOString();
    }
  }
  return o;
}

// ───────────────────────────────────────────────────────────
// GET /api/assets — list all assets for the current user's org
// ───────────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const ctx = await getCurrentUserOrg(req);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data, error } = await supabaseAdmin
    .from("assets")
    .select("*")
    .eq("org_id", ctx.orgId)
    .order("date_created", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json((data as AssetDB[]).map(dbToFe));
}

// ───────────────────────────────────────────────────────────
// POST /api/assets — insert (admins only)
// ───────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const ctx = await getCurrentUserOrg(req);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (ctx.role !== "admin") {
    return NextResponse.json({ error: "Admins only" }, { status: 403 });
  }

  const body = await req.json();
  const items: AssetFE[] = Array.isArray(body) ? body : body.assets ? body.assets : [body];
  const rows = items.map((it) => feToDb(it, ctx.orgId, ctx.userEmail));

  const { data, error } = await supabaseAdmin
    .from("assets")
    .upsert(rows, { onConflict: "id" })
    .select();

  if (error) {
    console.error("[/api/assets POST] Supabase upsert error:", {
      message: error.message,
      code: error.code,
      details: error.details,
      hint: error.hint,
      sampleRow: rows[0],
    });
    return NextResponse.json({ error: error.message, code: error.code, hint: error.hint }, { status: 500 });
  }

  // ── Dual-write to the new quotes table for newly-imported assets.
  // Same logic as PUT: failures here are logged but don't fail the
  // request because JSONB is still authoritative.
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const dbRow = (data as AssetDB[])[i];
    if (!it || !dbRow) continue;
    const quotesIn: AssetQuoteInput[] = [];
    if (typeof it.pullQuote === "string" && it.pullQuote.trim().length > 0) {
      quotesIn.push({ text: it.pullQuote, favorite: !!it.pullQuoteFavorite });
    }
    if (Array.isArray(it.additionalQuotes)) {
      for (const q of it.additionalQuotes) {
        if (q && typeof q.text === "string" && q.text.trim().length > 0) {
          quotesIn.push({ text: q.text, favorite: !!q.favorite });
        }
      }
    }
    if (quotesIn.length === 0) continue;
    try {
      const sync = await syncAssetQuotes(
        {
          assetId: dbRow.id,
          orgId: ctx.orgId,
          assetType: dbRow.asset_type,
          attrName: dbRow.client_name || null,
          attrTitle: dbRow.client_role || null,
          attrOrg: dbRow.company || null,
        },
        quotesIn,
      );
      if (!sync.ok) {
        console.error("[assets POST] quotes dual-write failed:", sync.error);
      }
    } catch (e) {
      console.error("[assets POST] quotes dual-write threw:", e);
    }
  }

  return NextResponse.json((data as AssetDB[]).map(dbToFe));
}

// ───────────────────────────────────────────────────────────
// PUT /api/assets — update (admins only)
// ───────────────────────────────────────────────────────────
export async function PUT(req: NextRequest) {
  const ctx = await getCurrentUserOrg(req);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (ctx.role !== "admin") {
    return NextResponse.json({ error: "Admins only" }, { status: 403 });
  }

  const body = (await req.json()) as Partial<AssetFE> & { id: string };
  if (!body.id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const updates = feToDb(body, ctx.orgId, ctx.userEmail);
  const { data, error } = await supabaseAdmin
    .from("assets")
    .update(updates)
    .eq("id", body.id)
    .eq("org_id", ctx.orgId) // safety: can't update another org's asset
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // ── Dual-write to the new quotes table ─────────────────────────
  // Phase 1 of the quotes-as-entity refactor. JSONB stays canonical
  // (reads still hit pull_quote + additional_quotes). This keeps a
  // top-level row per quote in sync so the hero rotator + future
  // standalone-quote flows have something to query against. Failures
  // here are logged but do NOT fail the asset save — the JSONB is
  // still authoritative for now.
  try {
    const quotesIn: AssetQuoteInput[] = [];
    if (typeof body.pullQuote === "string" && body.pullQuote.trim().length > 0) {
      quotesIn.push({
        text: body.pullQuote,
        favorite: !!body.pullQuoteFavorite,
      });
    }
    if (Array.isArray(body.additionalQuotes)) {
      for (const q of body.additionalQuotes) {
        if (q && typeof q.text === "string" && q.text.trim().length > 0) {
          quotesIn.push({ text: q.text, favorite: !!q.favorite });
        }
      }
    }
    const dbAsset = data as AssetDB;
    const sync = await syncAssetQuotes(
      {
        assetId: dbAsset.id,
        orgId: ctx.orgId,
        assetType: dbAsset.asset_type,
        attrName: dbAsset.client_name || null,
        attrTitle: dbAsset.client_role || null,
        attrOrg: dbAsset.company || null,
      },
      quotesIn,
    );
    if (!sync.ok) {
      console.error("[assets PUT] quotes dual-write failed:", sync.error);
    }
  } catch (e) {
    console.error("[assets PUT] quotes dual-write threw:", e);
  }

  // Fire publication rules — re-evaluates the asset against the org's
  // configured trigger→action rules and may flip publication state. If
  // the rule changes anything, refetch to return the post-rule state to
  // the FE. No-op when no rules apply or already in correct state.
  const orgCtx = await getOrgRulesContext(ctx.orgId);
  if (orgCtx && data) {
    const ruleInput: AssetRuleInput = {
      id: (data as AssetDB).id,
      status: (data as AssetDB).status,
      approval_status: (data as AssetDB).approval_status,
      published_at: (data as AssetDB).published_at,
      freshness_exception_until: (data as AssetDB).freshness_exception_until,
      auto_status_by_rule: (data as AssetDB).auto_status_by_rule,
    };
    const result = await applyPublicationRules(ruleInput, orgCtx);
    if (result.changed) {
      const { data: final } = await supabaseAdmin
        .from("assets")
        .select("*")
        .eq("id", body.id)
        .single();
      if (final) return NextResponse.json(dbToFe(final as AssetDB));
    }
  }
  return NextResponse.json(dbToFe(data as AssetDB));
}

// ───────────────────────────────────────────────────────────
// DELETE /api/assets?id=xxx — delete (admins only)
// ───────────────────────────────────────────────────────────
export async function DELETE(req: NextRequest) {
  const ctx = await getCurrentUserOrg(req);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (ctx.role !== "admin") {
    return NextResponse.json({ error: "Admins only" }, { status: 403 });
  }

  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const { error } = await supabaseAdmin
    .from("assets")
    .delete()
    .eq("id", id)
    .eq("org_id", ctx.orgId); // safety

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
