// Server-side helper: applies org-level publication rules to an asset.
// Called from /api/assets PUT (when admin changes approval) and from
// runSourceSync (when freshness rules might have just kicked in).
//
// Two flows:
//   1. Trigger fires (e.g. approval flips to "denied", asset becomes
//      expired) → if rule says action="draft"/"archive", change
//      asset's status accordingly + stamp auto_status_by_rule.
//   2. Trigger reverses (e.g. approval flips back to "approved", asset
//      gets exception) → if asset's auto_status_by_rule matches a
//      previously-fired rule AND that rule has auto_revert=true, restore
//      asset to "published" + clear auto_status_by_rule.
//
// We never override admin-manual draft/archive: the auto_status_by_rule
// column is the only signal we use to know "this was set by a rule" —
// any manual edit clears it (handled in /api/assets PUT).

import { supabaseAdmin } from "./supabase-server";

export type PublicationRule = {
  action: "none" | "draft" | "archive";
  auto_revert: boolean;
};

export type OrgRulesContext = {
  freshness_warn_after_months: number | null;
  freshness_warn_before_date: string | null;
  publication_rules: Record<string, PublicationRule>;
};

export type AssetRuleInput = {
  id: string;
  status: string; // current publication status
  approval_status: string | null;
  published_at: string | null;
  freshness_exception_until: string | null;
  auto_status_by_rule: string | null;
};

// Decide whether the asset is currently "expired" by org rule, accounting
// for any per-asset freshness exception (sentinel/never overrides org rule).
function isExpired(asset: AssetRuleInput, org: OrgRulesContext): boolean {
  // Active per-asset exception suppresses the org rule.
  const exceptionActive =
    !!asset.freshness_exception_until &&
    new Date(asset.freshness_exception_until).getTime() > Date.now();
  if (exceptionActive) return false;

  if (org.freshness_warn_before_date) {
    const cutoff = new Date(org.freshness_warn_before_date);
    const pub = asset.published_at ? new Date(asset.published_at) : null;
    return !!pub && !Number.isNaN(cutoff.getTime()) && pub < cutoff;
  }
  if (org.freshness_warn_after_months !== null) {
    const pub = asset.published_at ? new Date(asset.published_at) : null;
    if (!pub || Number.isNaN(pub.getTime())) return false;
    const ageMonths = (Date.now() - pub.getTime()) / (1000 * 60 * 60 * 24 * 30);
    return ageMonths > org.freshness_warn_after_months;
  }
  return false;
}

// Approval-status keys we honor as publication rules. Other approval
// values (currently only "approval_unset" / "approval_approved") will
// not auto-flip visibility — they're not exposed as triggers in the UI
// and any orphaned data with those keys is ignored.
const ALLOWED_APPROVAL_RULE_KEYS = new Set([
  "approval_denied",
  "approval_pending",
  "approval_needs_edits",
]);

// Returns the rule key that should be firing, if any. Order of precedence:
//   1. Specific approval-status rule (currently only approval_denied)
//   2. expiration (if asset is expired)
// Returns null when nothing applies.
function findActiveRule(asset: AssetRuleInput, org: OrgRulesContext): string | null {
  const approval = asset.approval_status || "unset";

  // Specific approval rules — only honor allow-listed keys. This lets us
  // remove rules from the UI (e.g. "needs_edits") without orphaned DB data
  // continuing to fire.
  const approvalRuleKey = `approval_${approval}`;
  if (ALLOWED_APPROVAL_RULE_KEYS.has(approvalRuleKey)) {
    const approvalRule = org.publication_rules[approvalRuleKey];
    if (approvalRule && approvalRule.action !== "none") return approvalRuleKey;
  }

  // Expiration
  const expirationRule = org.publication_rules["expiration"];
  if (expirationRule && expirationRule.action !== "none" && isExpired(asset, org)) {
    return "expiration";
  }

  return null;
}

// Returns the action this rule should perform (draft / archive).
function ruleAction(ruleKey: string, org: OrgRulesContext): "draft" | "archive" {
  const rule = org.publication_rules[ruleKey];
  if (!rule) return "draft";
  return rule.action === "archive" ? "archive" : "draft";
}

// Returns whether a rule supports auto-revert (default true).
function ruleAutoRevert(ruleKey: string, org: OrgRulesContext): boolean {
  const rule = org.publication_rules[ruleKey];
  if (!rule) return true;
  return rule.auto_revert !== false;
}

// Main entry point. Re-evaluates an asset against the current org rules
// and applies any necessary publication change. Idempotent — safe to call
// multiple times (no-op when state is already correct).
export async function applyPublicationRules(
  asset: AssetRuleInput,
  org: OrgRulesContext,
): Promise<{ changed: boolean; newStatus?: string; newAutoBy?: string | null }> {
  const triggered = findActiveRule(asset, org);

  // Case 1: Rule fires → asset should be drafted/archived
  if (triggered) {
    const intendedAction = ruleAction(triggered, org);
    // Map the action verb to the actual asset.status enum value. The rule
    // engine internally uses "archive" (the action), but the assets table
    // stores past-tense "archived" — so writing "archive" directly would
    // give the FE an unrecognized status and break archive-related UI.
    const intendedStatus = intendedAction === "archive" ? "archived" : "draft";
    if (asset.status === intendedStatus && asset.auto_status_by_rule === triggered) {
      return { changed: false }; // already in the rule-driven state
    }
    if (asset.status === intendedStatus) {
      // Already in target state but auto_status not stamped — leave manually-
      // drafted/archived assets alone; the admin owns them now.
      return { changed: false };
    }
    // Allow the rule to fire when:
    //   • Asset is currently Public — normal entry into a rule-driven state.
    //   • Asset's current state was set by THIS same rule (auto_status_by_rule
    //     matches) — lets action changes escalate (draft→archive) or
    //     de-escalate (archive→draft) without admin intervention.
    // Block when asset is in a non-Public state that the admin set manually
    // (auto_status_by_rule is null after manual edits) — admin's intent wins.
    if (asset.status !== "published" && asset.auto_status_by_rule !== triggered) {
      return { changed: false };
    }
    // Build the update. For archive, also stamp archived_at and a reason
    // so the FE's archive UI (badge, restore button, etc.) lights up the
    // same way as a manual archive.
    type StatusUpdate = {
      status: string;
      auto_status_by_rule: string;
      archived_at?: string | null;
      archived_reason?: string | null;
    };
    const update: StatusUpdate = { status: intendedStatus, auto_status_by_rule: triggered };
    if (intendedStatus === "archived") {
      update.archived_at = new Date().toISOString();
      update.archived_reason = `Auto-archived by ${triggered.replace(/_/g, " ")} rule`;
    }
    await supabaseAdmin
      .from("assets")
      .update(update)
      .eq("id", asset.id);
    return { changed: true, newStatus: intendedStatus, newAutoBy: triggered };
  }

  // Case 2: No rule fires, but a previous rule had drafted/archived this
  // asset → auto-revert to published if that rule allows it.
  if (asset.auto_status_by_rule && asset.status !== "published") {
    if (ruleAutoRevert(asset.auto_status_by_rule, org)) {
      await supabaseAdmin
        .from("assets")
        .update({ status: "published", auto_status_by_rule: null, archived_at: null, archived_reason: null })
        .eq("id", asset.id);
      return { changed: true, newStatus: "published", newAutoBy: null };
    }
  }

  return { changed: false };
}

// Fetch org rules context — used by callers that don't already have it.
export async function getOrgRulesContext(orgId: string): Promise<OrgRulesContext | null> {
  const { data, error } = await supabaseAdmin
    .from("organizations")
    .select("freshness_warn_after_months, freshness_warn_before_date, default_approval_status, publication_rules")
    .eq("id", orgId)
    .maybeSingle();
  if (error || !data) return null;
  return {
    freshness_warn_after_months: data.freshness_warn_after_months as number | null,
    freshness_warn_before_date: data.freshness_warn_before_date as string | null,
    publication_rules: (data.publication_rules as Record<string, PublicationRule>) || {},
  };
}

// Fetch the org's default approval status (for new asset inserts).
export async function getDefaultApprovalStatus(orgId: string): Promise<string> {
  const { data } = await supabaseAdmin
    .from("organizations")
    .select("default_approval_status")
    .eq("id", orgId)
    .maybeSingle();
  return ((data?.default_approval_status as string | null) || "unset");
}
