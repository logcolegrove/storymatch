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

// ───────────────────────────────────────────────────────────
// Extract structured metadata using Claude Haiku.
// Source priority:
//   1. video DESCRIPTION (human-written, most reliable)
//   2. video TITLE (human-written, short)
//   3. TRANSCRIPT (auto-generated, unreliable for proper nouns)
//   4. (admin fills manually) — leave empty if no source has it
// ───────────────────────────────────────────────────────────
// Note: headline is intentionally NOT in this type. The video's headline is
// always the Vimeo title (source of truth) and must never be overwritten by
// the LLM — see runSourceSync / addCollectionSource which write it directly.
type ExtractedMetadata = {
  clientName: string;
  company: string;
  vertical: string;
  geography: string;
  companySize: string;
  challenge: string;
  outcome: string;
  pullQuote: string;
};

const EMPTY_META: ExtractedMetadata = {
  clientName: "",
  company: "",
  vertical: "",
  geography: "",
  companySize: "",
  challenge: "",
  outcome: "",
  pullQuote: "",
};

async function extractMetadata(input: {
  videoTitle: string;
  description: string;
  transcript: string;
}): Promise<ExtractedMetadata> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not configured");

  const { videoTitle, description, transcript } = input;
  const hasContent =
    (description && description.length > 10) ||
    (transcript && transcript.length > 50);
  if (!hasContent) {
    return { ...EMPTY_META };
  }
  // videoTitle is passed in only as context for the LLM — never as an output target.
  void videoTitle;

  const systemPrompt = `You extract structured metadata from customer testimonial videos.

CRITICAL RULES — VIOLATIONS BREAK THE PRODUCT:
1. NEVER invent information. If a field cannot be determined from the available sources, leave it as an empty string "".

2. SOURCE HIERARCHY for names (clientName, company):
   - First try the DESCRIPTION (human-written, reliable proper nouns)
   - Then try the TITLE (human-written, short)
   - Then try the TRANSCRIPT (auto-generated, may have transcription errors — use ONLY if no other source has the name)
   - If none have it, leave empty. NEVER GUESS.

3. The pullQuote MUST be a verbatim substring of the TRANSCRIPT. Copy character-for-character. Do not fix grammar, do not paraphrase, do not combine sentences. The transcript may have transcription errors — preserve them.

4. Auto-transcripts often misspell proper nouns. If a name appears in the transcript but is contradicted by the description/title, trust the description/title.

5. The challenge and outcome should be 1-sentence summaries grounded in what the speaker actually says (transcript) or describes (description).

Return ONLY valid JSON.`;

  const sources = [
    videoTitle ? `=== VIDEO TITLE ===\n${videoTitle}` : "",
    description
      ? `=== VIDEO DESCRIPTION (human-written, prefer for proper nouns) ===\n${description.slice(0, 3000)}`
      : "",
    transcript
      ? `=== TRANSCRIPT (auto-generated, may have transcription errors) ===\n${transcript.slice(0, 12000)}`
      : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  const userPrompt = `${sources}

Return ONLY a JSON object with this exact shape:
{
  "clientName": "the speaker's name (prefer description/title, fall back to transcript only as last resort), or empty string if not stated",
  "company": "their company/organization (prefer description/title), or empty string if not stated",
  "vertical": "industry like 'Foundation', 'Healthcare', 'Education', 'Agriculture', 'Nonprofit', 'Technology', etc., or empty string if unclear",
  "geography": "city/state/region they mention, or empty string",
  "companySize": "approximate size if stated like '50 employees', '$10M revenue', or empty string",
  "challenge": "1-sentence summary of the problem they describe, or empty string",
  "outcome": "1-sentence summary of what they achieved, or empty string",
  "pullQuote": "a single powerful 1-2 sentence VERBATIM substring from the TRANSCRIPT (not the description), or empty string if no good quote available"
}`;

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
    throw new Error(`Claude metadata extraction failed: ${r.status} ${errText.slice(0, 300)}`);
  }

  const body = (await r.json()) as { content: { type: string; text?: string }[] };
  const txt = (body.content || [])
    .filter((c) => c.type === "text")
    .map((c) => c.text || "")
    .join("");
  const cleaned = txt.replace(/```json|```/g, "").trim();
  const match = cleaned.match(/\{[\s\S]*\}/);
  const json = match ? match[0] : cleaned;

  try {
    const parsed = JSON.parse(json) as Partial<ExtractedMetadata>;
    return {
      clientName: parsed.clientName || "",
      company: parsed.company || "",
      vertical: parsed.vertical || "",
      geography: parsed.geography || "",
      companySize: parsed.companySize || "",
      challenge: parsed.challenge || "",
      outcome: parsed.outcome || "",
      pullQuote: parsed.pullQuote || "",
    };
  } catch {
    console.error("Failed to parse Claude metadata response:", txt.slice(0, 500));
    return { ...EMPTY_META };
  }
}

// Validate that a pull quote is a verbatim substring of the transcript
function validateQuote(quote: string, transcript: string): string {
  if (!quote || !transcript) return "";
  const norm = (s: string) => s.replace(/\s+/g, " ").toLowerCase().trim();
  const stripped = quote.replace(/^["']|["']$/g, "").trim();
  if (norm(transcript).includes(norm(stripped))) return quote;
  return "";
}

// ───────────────────────────────────────────────────────────
// POST /api/extract-metadata
// Body modes:
//   { assetId: string }                    → re-extract one asset
//   { backfill: true, limit?: number }     → re-extract all assets
// ───────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const ctx = await getCurrentUserOrg(req);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (ctx.role !== "admin") {
    return NextResponse.json({ error: "Admins only" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));

  // Backfill mode
  if (body?.backfill) {
    const limit = Math.min(Number(body.limit) || 5, 20);

    const { data: rows, error } = await supabaseAdmin
      .from("assets")
      .select("id, headline, description, transcript")
      .eq("org_id", ctx.orgId)
      .limit(limit);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!rows || rows.length === 0) {
      return NextResponse.json({ extracted: 0 });
    }

    let extracted = 0;
    const failures: { id: string; error: string }[] = [];
    const queue = [...rows];
    const workers = Array.from({ length: 3 }).map(async () => {
      while (true) {
        const row = queue.shift();
        if (!row) break;
        try {
          const meta = await extractMetadata({
            videoTitle: row.headline || "",
            description: row.description || "",
            transcript: row.transcript || "",
          });
          const validatedQuote = validateQuote(meta.pullQuote, row.transcript || "");
          await supabaseAdmin
            .from("assets")
            .update({
              client_name: meta.clientName || null,
              company: meta.company || null,
              vertical: meta.vertical || null,
              geography: meta.geography || null,
              company_size: meta.companySize || null,
              challenge: meta.challenge || null,
              outcome: meta.outcome || null,
              pull_quote: validatedQuote || null,
              // headline is NOT updated — it's the Vimeo title (source of truth).
              // Invalidate embedding so it gets regenerated with fresh metadata
              embedding: null,
              embedding_updated_at: null,
            })
            .eq("id", row.id)
            .eq("org_id", ctx.orgId);
          extracted++;
        } catch (e) {
          failures.push({ id: row.id, error: (e as Error).message });
        }
      }
    });
    await Promise.all(workers);

    return NextResponse.json({ extracted, failures });
  }

  // Single asset mode
  const assetId = body?.assetId as string | undefined;
  if (!assetId) {
    return NextResponse.json({ error: "assetId or backfill required" }, { status: 400 });
  }

  const { data: row, error: fetchError } = await supabaseAdmin
    .from("assets")
    .select("id, headline, description, transcript")
    .eq("id", assetId)
    .eq("org_id", ctx.orgId)
    .single();
  if (fetchError || !row) {
    return NextResponse.json({ error: "Asset not found" }, { status: 404 });
  }

  let meta: ExtractedMetadata;
  try {
    meta = await extractMetadata({
      videoTitle: row.headline || "",
      description: row.description || "",
      transcript: row.transcript || "",
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }

  const validatedQuote = validateQuote(meta.pullQuote, row.transcript || "");

  const { error: updateError } = await supabaseAdmin
    .from("assets")
    .update({
      client_name: meta.clientName || null,
      company: meta.company || null,
      vertical: meta.vertical || null,
      geography: meta.geography || null,
      company_size: meta.companySize || null,
      challenge: meta.challenge || null,
      outcome: meta.outcome || null,
      pull_quote: validatedQuote || null,
      // headline is NOT updated — it's the Vimeo title (source of truth).
      embedding: null,
      embedding_updated_at: null,
    })
    .eq("id", assetId)
    .eq("org_id", ctx.orgId);
  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, metadata: meta, quoteValidated: !!validatedQuote });
}

// GET → counts
export async function GET(req: NextRequest) {
  const ctx = await getCurrentUserOrg(req);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (ctx.role !== "admin") {
    return NextResponse.json({ error: "Admins only" }, { status: 403 });
  }

  const { count: needsExtraction } = await supabaseAdmin
    .from("assets")
    .select("id", { count: "exact", head: true })
    .eq("org_id", ctx.orgId)
    .or("client_name.is.null,client_name.eq.");

  const { count: total } = await supabaseAdmin
    .from("assets")
    .select("id", { count: "exact", head: true })
    .eq("org_id", ctx.orgId);

  return NextResponse.json({
    needsExtraction: needsExtraction ?? 0,
    total: total ?? 0,
  });
}
