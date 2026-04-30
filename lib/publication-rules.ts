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
  approval_required: boolean;
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

// Returns the rule key that should be firing, if any. Order of precedence:
//   1. Specific approval-status rule (e.g. approval_denied)
//   2. expiration (if asset is expired)
//   3. approval_required (if approval !== approved)
// Returns null when nothing applies.
function findActiveRule(asset: AssetRuleInput, org: OrgRulesContext): string | null {
  const approval = asset.approval_status || "unset";

  // Specific approval rules
  const approvalRuleKey = `approval_${approval}`;
  const approvalRule = org.publication_rules[approvalRuleKey];
  if (approvalRule && approvalRule.action !== "none") return approvalRuleKey;

  // Expiration
  const expirationRule = org.publication_rules["expiration"];
  if (expirationRule && expirationRule.action !== "none" && isExpired(asset, org)) {
    return "expiration";
  }

  // Approval required → effectively a draft rule when approval !== approved
  if (org.approval_required && approval !== "approved") {
    return "approval_required";
  }

  return null;
}

// Returns the action this rule should perform (draft / archive). For
// approval_required (synthetic key), always returns "draft".
function ruleAction(ruleKey: string, org: OrgRulesContext): "draft" | "archive" {
  if (ruleKey === "approval_required") return "draft";
  const rule = org.publication_rules[ruleKey];
  if (!rule) return "draft";
  return rule.action === "archive" ? "archive" : "draft";
}

// Returns whether a rule supports auto-revert (default true).
function ruleAutoRevert(ruleKey: string, org: OrgRulesContext): boolean {
  if (ruleKey === "approval_required") return true; // always auto-revert
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
    const intendedStatus = intendedAction; // "draft" or "archive"
    if (asset.status === intendedStatus && asset.auto_status_by_rule === triggered) {
      return { changed: false }; // already in the rule-driven state
    }
    if (asset.status === intendedStatus) {
      // Already in target state but auto_status not stamped — stamp it so
      // we can auto-revert later. (E.g. admin manually drafted, then
      // approval flipped to denied — claim it as rule-driven so future
      // approval restoration restores publication.)
      // Actually, don't stamp manually-drafted assets — leave them alone.
      return { changed: false };
    }
    // Only act on "published" assets — don't auto-flip drafts/archives.
    if (asset.status !== "published") return { changed: false };
    await supabaseAdmin
      .from("assets")
      .update({ status: intendedStatus, auto_status_by_rule: triggered })
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
    .select("freshness_warn_after_months, freshness_warn_before_date, approval_required, default_approval_status, publication_rules")
    .eq("id", orgId)
    .maybeSingle();
  if (error || !data) return null;
  return {
    freshness_warn_after_months: data.freshness_warn_after_months as number | null,
    freshness_warn_before_date: data.freshness_warn_before_date as string | null,
    approval_required: !!data.approval_required,
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
