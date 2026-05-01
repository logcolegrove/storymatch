import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";

// /api/suggest-quotes — admin-triggered. Takes a transcript and returns
// 3-5 verbatim, standout quotes that admins can review and add to the
// asset. Uses Claude Haiku for speed/cost; the model is told to copy
// substrings exactly so admins don't have to fact-check the wording.

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

// Validate that a quote is actually present in the transcript. The model
// is instructed to copy verbatim, but we double-check so we never return
// a hallucinated quote. Returns the original quote text on success, ""
// on failure (which the consumer should drop).
function validateAgainstTranscript(quote: string, transcript: string): string {
  if (!quote || !transcript) return "";
  const norm = (s: string) => s.replace(/\s+/g, " ").toLowerCase().trim();
  const stripped = quote.replace(/^["']|["']$/g, "").trim();
  if (norm(transcript).includes(norm(stripped))) return quote;
  return "";
}

export async function POST(req: NextRequest) {
  const ctx = await getCurrentUserOrg(req);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (ctx.role !== "admin") {
    return NextResponse.json({ error: "Admins only" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const transcript: string = (body?.transcript || "").toString();
  // Optional: existing quotes the admin has already added — passed in so
  // the model can avoid suggesting near-duplicates.
  const existing: string[] = Array.isArray(body?.existingQuotes)
    ? body.existingQuotes.filter((q: unknown) => typeof q === "string")
    : [];

  if (!transcript || transcript.length < 50) {
    return NextResponse.json({ quotes: [] });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "AI not configured" }, { status: 500 });
  }

  const systemPrompt = `You pick standout pull quotes from customer testimonial transcripts.

CRITICAL RULES:
1. Each quote MUST be a verbatim substring of the transcript. Copy character-for-character. Do not paraphrase, do not fix grammar, do not combine sentences.
2. Pick quotes that are emotionally resonant, specific, or quotable on their own — what marketing would put on a landing page.
3. Each quote should be 1-3 sentences, around 10-40 words. Skip filler, skip generic statements.
4. Don't repeat or near-duplicate quotes the admin has already added.
5. Return 3-5 quotes. If the transcript is short or unremarkable, return fewer (or none) rather than padding.

Return ONLY valid JSON.`;

  const existingHint = existing.length > 0
    ? `\n\n=== ALREADY-ADDED QUOTES (do not duplicate these) ===\n${existing.map(q => `- ${q}`).join("\n")}`
    : "";

  const userPrompt = `=== TRANSCRIPT ===
${transcript.slice(0, 12000)}${existingHint}

Return ONLY a JSON object:
{
  "quotes": [
    "verbatim quote 1",
    "verbatim quote 2",
    "verbatim quote 3"
  ]
}`;

  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5",
        max_tokens: 1500,
        system: systemPrompt,
        messages: [{ role: "user", content: userPrompt }],
      }),
    });

    if (!r.ok) {
      const errText = await r.text();
      console.error("[suggest-quotes] Claude error:", r.status, errText.slice(0, 300));
      return NextResponse.json({ error: "AI request failed" }, { status: 502 });
    }

    const claudeBody = (await r.json()) as { content: { type: string; text?: string }[] };
    const txt = (claudeBody.content || [])
      .filter(c => c.type === "text")
      .map(c => c.text || "")
      .join("");
    const cleaned = txt.replace(/```json|```/g, "").trim();
    const match = cleaned.match(/\{[\s\S]*\}/);
    const json = match ? match[0] : cleaned;

    const parsed = JSON.parse(json) as { quotes?: unknown };
    const raw = Array.isArray(parsed.quotes) ? parsed.quotes : [];
    // Validate each suggestion against the transcript. Drop hallucinations.
    const validated: string[] = [];
    for (const q of raw) {
      if (typeof q !== "string") continue;
      const ok = validateAgainstTranscript(q, transcript);
      if (ok) validated.push(ok);
    }
    return NextResponse.json({ quotes: validated.slice(0, 5) });
  } catch (e) {
    console.error("[suggest-quotes] failed:", e);
    return NextResponse.json({ error: "AI request failed" }, { status: 500 });
  }
}
