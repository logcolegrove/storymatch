// /api/showcases/[id]/generate-template
//
// POST → admin describes a layout in natural language; Claude
// generates a TemplateBlock[] conforming to the showcase DSL.
// We validate the response against the same shape contract the
// DAL enforces, then return it for the FE to apply to the draft.
//
// This is the "Build with Claude" affordance — the leverage point
// the whole DSL architecture was designed around. Claude generates
// CONFIG (JSON in our spec), never code. The renderer doesn't
// change; it just executes whatever spec lands in the showcase's
// templateConfig. Security, brand, accessibility all stay inside
// our block components.
//
// Admin-only. Sales reps can build showcases via the editor but
// the "describe with Claude" affordance is gated to admins so
// org-wide cost is bounded.

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { fetchShowcase } from "@/lib/showcase-dal";
import type { TemplateBlock } from "@/lib/showcase-templates";

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

// ── DSL description sent to Claude ───────────────────────────────
// Lives inline so it stays alongside the schema definition. If the
// DSL grows, expand this block-by-block and Claude's outputs scale
// automatically. Keep it terse; Claude generalizes well on shape.
const DSL_DESCRIPTION = `
You are configuring a showcase page using a JSON Domain-Specific
Language. The page is composed of an ordered array of "blocks."
Each block is an object: { "type": <string>, "props": <object> }.

Block types and their props:

1. "hero" — Title + optional subtitle band.
   props:
     align: "left" | "center"             (default: "center")
     padding: "compact" | "comfortable" | "spacious"   (default: "comfortable")
     titleSource: "showcase.name" | "literal"   (default: "showcase.name")
     titleText: string         (only when titleSource === "literal")
     subtitleSource: "showcase.description" | "literal" | "none"   (default: "showcase.description")
     subtitleText: string      (only when subtitleSource === "literal")

2. "asset-grid" — Clickable card grid of the showcase's assets.
   props:
     columns: 2 | 3 | 4        (default: 3)
     aspect: "16/9" | "4/3" | "1/1"   (default: "16/9")
     showCompany: boolean      (default: true)
     showQuote: boolean        (default: true)
     clickTarget: "modal" | "newpage"   (default: "modal")

3. "quote-rotator" — Rotating band that cycles pull quotes from
   the showcase's own assets.
   props:
     intervalSec: number (2-30)   (default: 6)
     size: "full" | "compact"     (default: "full")
     source: "showcase-assets"    (only valid value)

4. "intro-text" — Plain text paragraphs (blank line separated).
   props:
     content: string           (required)
     align: "left" | "center"  (default: "left")

5. "divider" — Horizontal rule.
   props:
     spacing: "tight" | "normal" | "wide"   (default: "normal")

Constraints:
- Return ONLY a JSON object of the form { "blocks": [...] }.
- 1-8 blocks per template. Most well-designed pages have 3-5.
- A page typically starts with "hero".
- Never emit a "footer" block. The platform no longer renders one.
- "asset-grid" should appear at most once.
- "quote-rotator" should appear at most once, and only when the
  caller's request implies prose / storytelling. Skip it for
  utilitarian / browsing-style requests.
- Omit a prop to use its default. Don't include null values.
- Strings inside the JSON must use straight quotes; no markdown,
  no commentary, no code fences in the output.
`.trim();

// Reasonable cap so a runaway response can't DoS validation.
const MAX_BLOCKS = 10;

// Shape-validation contract that matches lib/showcase-dal.ts's
// sanitizeTemplateConfig. We re-validate here so a malformed
// model response fails fast (with a clear error to the FE)
// rather than silently dropping at write time.
const KNOWN_BLOCK_TYPES = new Set([
  "hero", "asset-grid", "quote-rotator", "intro-text", "divider", "footer",
]);

function validateBlocks(raw: unknown): { ok: true; blocks: TemplateBlock[] } | { ok: false; error: string } {
  if (!Array.isArray(raw)) return { ok: false, error: "blocks must be an array" };
  if (raw.length === 0) return { ok: false, error: "blocks array is empty" };
  if (raw.length > MAX_BLOCKS) return { ok: false, error: "too many blocks" };
  const out: TemplateBlock[] = [];
  for (let i = 0; i < raw.length; i++) {
    const entry = raw[i];
    if (!entry || typeof entry !== "object") return { ok: false, error: `block ${i} is not an object` };
    const e = entry as { type?: unknown; props?: unknown };
    if (typeof e.type !== "string" || !KNOWN_BLOCK_TYPES.has(e.type)) {
      return { ok: false, error: `block ${i} has unknown type: ${String(e.type)}` };
    }
    if (!e.props || typeof e.props !== "object") {
      return { ok: false, error: `block ${i} missing props object` };
    }
    out.push(entry as TemplateBlock);
  }
  return { ok: true, blocks: out };
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const ctx = await getCurrentUserOrg(req);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (ctx.role !== "admin") {
    return NextResponse.json({ error: "Admins only" }, { status: 403 });
  }

  // Verify the showcase belongs to this org. We don't strictly
  // need its data for the prompt — Claude generates layouts based
  // on the description — but the org-scoping check prevents
  // cross-tenant calls from consuming this team's API budget.
  const showcase = await fetchShowcase(id);
  if (!showcase || showcase.orgId !== ctx.orgId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body = await req.json().catch(() => ({})) as { prompt?: unknown };
  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
  if (!prompt) return NextResponse.json({ error: "Prompt is required" }, { status: 400 });
  if (prompt.length > 2000) {
    return NextResponse.json({ error: "Prompt too long (max 2000 chars)" }, { status: 400 });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "AI provider not configured" }, { status: 500 });
  }

  // Light context about the showcase so Claude can write a more
  // appropriate layout. The user prompt is what drives the design
  // intent; this context just informs tone + scale.
  const showcaseContext = [
    `Showcase title: ${showcase.name}`,
    showcase.description ? `Description: ${showcase.description}` : null,
    `Number of assets in this showcase: ${showcase.assetIds.length}`,
  ].filter(Boolean).join("\n");

  const userPrompt = `${showcaseContext}

User's layout description:
${prompt}

Generate the showcase template JSON now. Return only the JSON object, no commentary.`;

  let raw: string;
  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-5",
        max_tokens: 2000,
        system: DSL_DESCRIPTION,
        messages: [{ role: "user", content: userPrompt }],
      }),
    });
    if (!r.ok) {
      const errText = await r.text();
      console.error("[generate-template] Claude API failed", r.status, errText.slice(0, 500));
      return NextResponse.json({ error: "AI provider error" }, { status: 502 });
    }
    const payload = (await r.json()) as { content?: { type?: string; text?: string }[] };
    raw = (payload.content || [])
      .filter(c => c.type === "text")
      .map(c => c.text || "")
      .join("")
      .trim();
  } catch (e) {
    console.error("[generate-template] fetch failed", e);
    return NextResponse.json({ error: "AI provider unreachable" }, { status: 502 });
  }

  // Strip code fences if Claude wrapped its output. Then peel out
  // the first balanced { ... } payload. Belt + suspenders parsing
  // because the model occasionally wraps in prose despite the
  // "no commentary" instruction.
  const cleaned = raw.replace(/```json|```/g, "").trim();
  const match = cleaned.match(/\{[\s\S]*\}/);
  const json = match ? match[0] : cleaned;

  let parsed: { blocks?: unknown };
  try {
    parsed = JSON.parse(json) as { blocks?: unknown };
  } catch {
    console.error("[generate-template] JSON parse failed. Raw:", raw.slice(0, 800));
    return NextResponse.json({ error: "AI response wasn't valid JSON" }, { status: 502 });
  }

  const validation = validateBlocks(parsed.blocks);
  if (!validation.ok) {
    console.error("[generate-template] validation failed:", validation.error, "Raw:", raw.slice(0, 800));
    return NextResponse.json({ error: `Generated layout was invalid: ${validation.error}` }, { status: 502 });
  }

  return NextResponse.json({ blocks: validation.blocks });
}
