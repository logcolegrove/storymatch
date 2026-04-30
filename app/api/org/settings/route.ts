import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { applyPublicationRules, getOrgRulesContext } from "@/lib/publication-rules";

// /api/org/settings — read+write the current user's org-level Rules settings.
// GET: any member can read (so the cleared signal in the library reflects org policy).
// PUT: admins only — Rules are policy decisions.
//
// Freshness rule modes (mutually exclusive, applied in this priority):
//   1. freshnessWarnBeforeDate  — fixed cutoff, "flag if published before X"
//   2. freshnessWarnAfterMonths — rolling, "flag if older than X months"
//   3. neither set              — no flagging (default off)
// When admin saves one mode, we clear the other so they can't both be active.

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

// Camel-case shape returned to the FE. Keep this stable; future Rules add
// new optional fields here but never remove old ones.
//
// publicationRules is a JSONB blob keyed by trigger:
//   "expiration"           — fires when asset becomes flagged by org expiration rule
//   "approval_needs_edits" — fires when admin sets approval to needs_edits
//   "approval_denied"      — fires when admin sets approval to denied
// Each value: { action: "none" | "draft" | "archive", auto_revert: boolean }
type PublicationRule = { action: "none" | "draft" | "archive"; auto_revert: boolean };
type OrgSettingsFE = {
  freshnessWarnAfterMonths: number | null;
  freshnessWarnBeforeDate: string | null;
  // Approval-required mode: when true, an asset can only be in "published"
  // if approval_status === "approved". Anything else → forced to draft.
  approvalRequired: boolean;
  // Default approval status applied to NEW imports only (existing assets
  // are unchanged). e.g. an org that pre-approves everything by policy
  // can set this to "approved" so imports come in cleared.
  defaultApprovalStatus: string;
  // Publication rules — trigger → action mappings.
  publicationRules: Record<string, PublicationRule>;
};

export async function GET(req: NextRequest) {
  const ctx = await getCurrentUserOrg(req);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { data, error } = await supabaseAdmin
    .from("organizations")
    .select("freshness_warn_after_months, freshness_warn_before_date, approval_required, default_approval_status, publication_rules")
    .eq("id", ctx.orgId)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const settings: OrgSettingsFE = {
    freshnessWarnAfterMonths: (data?.freshness_warn_after_months as number | null) ?? null,
    freshnessWarnBeforeDate: (data?.freshness_warn_before_date as string | null) ?? null,
    approvalRequired: !!data?.approval_required,
    defaultApprovalStatus: (data?.default_approval_status as string | null) || "unset",
    publicationRules: (data?.publication_rules as Record<string, PublicationRule>) || {},
  };
  return NextResponse.json(settings);
}

export async function PUT(req: NextRequest) {
  const ctx = await getCurrentUserOrg(req);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (ctx.role !== "admin") {
    return NextResponse.json({ error: "Admins only" }, { status: 403 });
  }
  const body = (await req.json().catch(() => ({}))) as Partial<OrgSettingsFE>;

  // Validate months
  const months = body.freshnessWarnAfterMonths;
  if (months !== null && months !== undefined) {
    if (typeof months !== "number" || !Number.isInteger(months) || months <= 0 || months > 600) {
      return NextResponse.json({ error: "freshnessWarnAfterMonths must be a positive integer (or null to disable)" }, { status: 400 });
    }
  }
  // Validate date — accept YYYY-MM-DD strings and parse to Date for sanity check
  const beforeDate = body.freshnessWarnBeforeDate;
  if (beforeDate !== null && beforeDate !== undefined) {
    if (typeof beforeDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(beforeDate)) {
      return NextResponse.json({ error: "freshnessWarnBeforeDate must be YYYY-MM-DD (or null to disable)" }, { status: 400 });
    }
    const parsed = new Date(beforeDate);
    if (Number.isNaN(parsed.getTime())) {
      return NextResponse.json({ error: "freshnessWarnBeforeDate is not a valid date" }, { status: 400 });
    }
  }

  // Build updates object. Enforce mutual exclusion: when admin sets months,
  // clear the date; when admin sets date, clear months. Lets the FE send
  // either field freely without worrying about the other.
  type DbUpdates = {
    freshness_warn_after_months?: number | null;
    freshness_warn_before_date?: string | null;
    approval_required?: boolean;
    default_approval_status?: string;
    publication_rules?: Record<string, PublicationRule>;
  };
  const updates: DbUpdates = {};
  if (body.freshnessWarnAfterMonths !== undefined) {
    updates.freshness_warn_after_months = body.freshnessWarnAfterMonths;
    if (body.freshnessWarnAfterMonths !== null) {
      updates.freshness_warn_before_date = null;
    }
  }
  if (body.freshnessWarnBeforeDate !== undefined) {
    updates.freshness_warn_before_date = body.freshnessWarnBeforeDate;
    if (body.freshnessWarnBeforeDate !== null) {
      updates.freshness_warn_after_months = null;
    }
  }
  if (body.approvalRequired !== undefined) {
    if (typeof body.approvalRequired !== "boolean") {
      return NextResponse.json({ error: "approvalRequired must be boolean" }, { status: 400 });
    }
    updates.approval_required = body.approvalRequired;
  }
  if (body.defaultApprovalStatus !== undefined) {
    const allowed = ["unset", "pending", "needs_edits", "approved", "denied"];
    if (typeof body.defaultApprovalStatus !== "string" || !allowed.includes(body.defaultApprovalStatus)) {
      return NextResponse.json({ error: "defaultApprovalStatus invalid" }, { status: 400 });
    }
    updates.default_approval_status = body.defaultApprovalStatus;
  }
  if (body.publicationRules !== undefined) {
    if (typeof body.publicationRules !== "object" || body.publicationRules === null) {
      return NextResponse.json({ error: "publicationRules must be an object" }, { status: 400 });
    }
    updates.publication_rules = body.publicationRules;
  }
  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin
    .from("organizations")
    .update(updates)
    .eq("id", ctx.orgId)
    .select("freshness_warn_after_months, freshness_warn_before_date, approval_required, default_approval_status, publication_rules")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // After saving rules, immediately re-evaluate every org asset against
  // the new rule set. Without this, admin would have to wait for the next
  // sync to see rules take effect — confusing since the Rules panel implies
  // "save = active." Scanning fires rules for existing assets that newly
  // meet (or stop meeting) a trigger.
  const triggeredRulesChange =
    body.approvalRequired !== undefined ||
    body.publicationRules !== undefined ||
    body.freshnessWarnAfterMonths !== undefined ||
    body.freshnessWarnBeforeDate !== undefined;
  if (triggeredRulesChange) {
    const orgCtx = await getOrgRulesContext(ctx.orgId);
    if (orgCtx) {
      const { data: scan } = await supabaseAdmin
        .from("assets")
        .select("id, status, approval_status, published_at, freshness_exception_until, auto_status_by_rule")
        .eq("org_id", ctx.orgId);
      if (scan) {
        for (const a of scan) {
          try {
            await applyPublicationRules({
              id: a.id as string,
              status: a.status as string,
              approval_status: (a.approval_status as string | null),
              published_at: (a.published_at as string | null),
              freshness_exception_until: (a.freshness_exception_until as string | null),
              auto_status_by_rule: (a.auto_status_by_rule as string | null),
            }, orgCtx);
          } catch (e) {
            console.error("[org/settings] rule scan failed for asset", a.id, e);
          }
        }
      }
    }
  }

  const settings: OrgSettingsFE = {
    freshnessWarnAfterMonths: (data?.freshness_warn_after_months as number | null) ?? null,
    freshnessWarnBeforeDate: (data?.freshness_warn_before_date as string | null) ?? null,
    approvalRequired: !!data?.approval_required,
    defaultApprovalStatus: (data?.default_approval_status as string | null) || "unset",
    publicationRules: (data?.publication_rules as Record<string, PublicationRule>) || {},
  };
  return NextResponse.json(settings);
}
