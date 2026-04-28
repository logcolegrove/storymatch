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
// Embed query with OpenAI
// ───────────────────────────────────────────────────────────
async function embedQuery(text: string): Promise<number[]> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY not configured");
  const r = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ model: "text-embedding-3-small", input: text }),
  });
  if (!r.ok) {
    const errText = await r.text();
    throw new Error(`OpenAI embedding failed: ${r.status} ${errText.slice(0, 200)}`);
  }
  const body = (await r.json()) as { data: { embedding: number[] }[] };
  return body.data[0].embedding;
}

// ───────────────────────────────────────────────────────────
// Types
// ───────────────────────────────────────────────────────────
type CandidateAsset = {
  id: string;
  similarity: number;
  client_name: string | null;
  company: string | null;
  vertical: string | null;
  geography: string | null;
  company_size: string | null;
  challenge: string | null;
  outcome: string | null;
  asset_type: string | null;
  headline: string | null;
  pull_quote: string | null;
  transcript: string | null;
};

interface RawAIMatch {
  id: string;
  reasoning: string;       // Contains placeholders like {SPEAKER}, {COMPANY}
  quotes: string[];
  relevanceScore: number;
}

interface AIMatch {
  id: string;
  reasoning: string;       // Placeholders substituted with real values
  quotes: string[];        // Validated as verbatim substrings
  relevanceScore: number;
}

// ───────────────────────────────────────────────────────────
// Quote validation — returns the original quote if it's a verbatim
// substring of the transcript (whitespace + case insensitive).
// ───────────────────────────────────────────────────────────
function isQuoteInTranscript(quote: string, transcript: string): boolean {
  if (!quote || !transcript) return false;
  const norm = (s: string) => s.replace(/\s+/g, " ").toLowerCase().trim();
  const stripped = quote.replace(/^["']|["']$/g, "").trim();
  return norm(transcript).includes(norm(stripped));
}

// ───────────────────────────────────────────────────────────
// Placeholder substitution.
// Claude is asked to write reasoning using placeholders like {SPEAKER},
// {COMPANY}, {CHALLENGE}, {OUTCOME}. We replace them server-side using
// the candidate's actual database fields. This makes it structurally
// impossible for Claude to put a wrong name in a paragraph.
// ───────────────────────────────────────────────────────────
function substitutePlaceholders(text: string, candidate: CandidateAsset): string {
  const speaker = candidate.client_name?.trim() || "the speaker";
  const company = candidate.company?.trim() || "their organization";
  const challenge = candidate.challenge?.trim() || "their stated challenge";
  const outcome = candidate.outcome?.trim() || "their stated outcome";
  const vertical = candidate.vertical?.trim() || "";
  const geography = candidate.geography?.trim() || "";
  const companySize = candidate.company_size?.trim() || "";
  return text
    .replace(/\{SPEAKER\}/g, speaker)
    .replace(/\{COMPANY\}/g, company)
    .replace(/\{CHALLENGE\}/g, challenge)
    .replace(/\{OUTCOME\}/g, outcome)
    .replace(/\{VERTICAL\}/g, vertical)
    .replace(/\{GEOGRAPHY\}/g, geography)
    .replace(/\{COMPANY_SIZE\}/g, companySize);
}

// ───────────────────────────────────────────────────────────
// Option C: detect Claude-typed names that disagree with the database.
//
// If Claude wrote a name in the paragraph (despite being asked to use
// {SPEAKER}), and that name doesn't match what's in candidate.client_name,
// replace whatever Claude wrote with the database value.
//
// We do a simple, conservative check: if the candidate has a known
// client_name AND Claude's text mentions a DIFFERENT client_name from
// any OTHER candidate in the result set, we replace it.
// ───────────────────────────────────────────────────────────
function correctMisattributedNames(
  text: string,
  ownCandidate: CandidateAsset,
  allCandidates: CandidateAsset[]
): string {
  const ownName = ownCandidate.client_name?.trim();
  let corrected = text;

  // Build a list of OTHER candidates' names that we should never see in this paragraph
  const foreignNames = allCandidates
    .filter((c) => c.id !== ownCandidate.id)
    .map((c) => c.client_name?.trim())
    .filter((n): n is string => !!n && n.length > 1);

  for (const foreign of foreignNames) {
    if (corrected.toLowerCase().includes(foreign.toLowerCase())) {
      // Replace the foreign name with our actual speaker (or "the speaker")
      const replacement = ownName || "the speaker";
      const re = new RegExp(escapeRegex(foreign), "gi");
      corrected = corrected.replace(re, replacement);
      console.warn(
        `[storymatch] Corrected misattributed name "${foreign}" → "${replacement}" on asset ${ownCandidate.id}`
      );
    }
  }

  return corrected;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ───────────────────────────────────────────────────────────
// Synthesize ranked matches via Claude with placeholder reasoning
// ───────────────────────────────────────────────────────────
async function synthesizeMatches(
  query: string,
  candidates: CandidateAsset[]
): Promise<AIMatch[]> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    // Fallback: top 5 by vector similarity, no AI reasoning
    return candidates.slice(0, 5).map((c) => ({
      id: c.id,
      reasoning: substitutePlaceholders(
        `{SPEAKER} at {COMPANY} is a strong semantic match for "${query}".`,
        c
      ),
      quotes: c.pull_quote && c.transcript && isQuoteInTranscript(c.pull_quote, c.transcript)
        ? [c.pull_quote]
        : [],
      relevanceScore: Math.round(c.similarity * 100),
    }));
  }

  const candidateText = candidates
    .map((c, idx) => {
      return `=== CANDIDATE ${idx + 1} of ${candidates.length} ===
ID: ${c.id}
Industry: ${c.vertical || "(not specified)"}
Region: ${c.geography || "(not specified)"}
Size: ${c.company_size || "(not specified)"}
Type: ${c.asset_type || "Video Testimonial"}
Headline: ${c.headline || "(no headline)"}
Stated challenge: ${c.challenge || "(not specified)"}
Stated outcome: ${c.outcome || "(not specified)"}
Pre-existing pull quote: ${c.pull_quote || "(none)"}

Transcript for ID ${c.id}:
${c.transcript || "(no transcript available)"}
=== END CANDIDATE ${idx + 1} ===`;
    })
    .join("\n\n");

  const systemPrompt = `You are a sales enablement assistant for StoryMatch, a B2B testimonial intelligence platform. Your job is to match a salesperson's request to the most relevant customer testimonials.

ABSOLUTE RULES:

1. **Use placeholders, not names.** When writing reasoning, NEVER type a person's name or a company's name. Instead use these placeholders:
   - {SPEAKER} for the person speaking in the testimonial
   - {COMPANY} for their organization
   - {CHALLENGE} for the challenge they describe
   - {OUTCOME} for the outcome they achieved
   - {VERTICAL} for the industry
   - {GEOGRAPHY} for the region
   These will be substituted with actual values server-side.

2. **Each candidate's reasoning uses ONLY that candidate's data.** When writing the reasoning for ID X, only reference facts from candidate X's transcript and metadata. Never blend information across candidates.

3. **Quotes must be VERBATIM substrings of that candidate's transcript.** Copy character-for-character. Don't fix transcription errors, don't paraphrase, don't combine sentences. If you can't find a relevant exact quote in that candidate's transcript, return an empty quotes array.

4. **Reason from evidence.** Every claim in the reasoning must trace to text actually in the candidate's transcript or metadata. Don't embellish.

5. **Better fewer strong matches than many weak ones.**

Return ONLY valid JSON. No preamble, no markdown fences.`;

  const userPrompt = `Salesperson's request: "${query}"

Below are candidate testimonials, pre-filtered by semantic similarity. Pick the top 3-5 best matches.

${candidateText}

Return ONLY a JSON object:
{
  "matches": [
    {
      "id": "exact ID string of the chosen candidate",
      "reasoning": "2-3 sentences using {SPEAKER}, {COMPANY}, etc. placeholders — never write actual names",
      "quotes": ["verbatim substring from this candidate's transcript", "another verbatim substring"],
      "relevanceScore": 0-100
    }
  ]
}

If no candidates fit, return {"matches": []}.

Example reasoning format:
"{SPEAKER} at {COMPANY} describes the same challenge your prospect faces — a slow legacy system. They explain how moving to the new platform let their team {OUTCOME}, which directly addresses the salesperson's request."`;

  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-5",
      max_tokens: 3000,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
    }),
  });

  if (!r.ok) {
    const errText = await r.text();
    throw new Error(`Claude API failed: ${r.status} ${errText.slice(0, 300)}`);
  }

  const body = (await r.json()) as { content: { type: string; text?: string }[] };
  const txt = (body.content || [])
    .filter((c) => c.type === "text")
    .map((c) => c.text || "")
    .join("");
  const cleaned = txt.replace(/```json|```/g, "").trim();
  const match = cleaned.match(/\{[\s\S]*\}/);
  const json = match ? match[0] : cleaned;

  let parsed: { matches?: RawAIMatch[] };
  try {
    parsed = JSON.parse(json) as { matches?: RawAIMatch[] };
  } catch {
    console.error("Failed to parse Claude response:", txt.slice(0, 500));
    return [];
  }

  const rawMatches = Array.isArray(parsed.matches) ? parsed.matches : [];
  const candidateById = new Map(candidates.map((c) => [c.id, c]));
  const validated: AIMatch[] = [];

  for (const m of rawMatches) {
    const candidate = candidateById.get(m.id);
    if (!candidate) {
      console.warn(`[storymatch] Dropped match — unknown ID: ${m.id}`);
      continue;
    }

    // Step 1: Substitute placeholders with database values
    let reasoning = substitutePlaceholders(m.reasoning || "", candidate);

    // Step 2: Option C — if Claude typed any OTHER candidate's name, correct it
    reasoning = correctMisattributedNames(reasoning, candidate, candidates);

    // Step 3: Validate quotes against THIS candidate's transcript
    const transcript = candidate.transcript || "";
    const verifiedQuotes = (m.quotes || []).filter((q) =>
      isQuoteInTranscript(q, transcript)
    );
    const droppedQuotes = (m.quotes || []).length - verifiedQuotes.length;
    if (droppedQuotes > 0) {
      console.warn(
        `[storymatch] Dropped ${droppedQuotes} unverified quote(s) from ${m.id}`
      );
    }

    validated.push({
      id: m.id,
      reasoning,
      quotes: verifiedQuotes,
      relevanceScore: typeof m.relevanceScore === "number" ? m.relevanceScore : 50,
    });
  }

  return validated;
}

// ───────────────────────────────────────────────────────────
// POST /api/storymatch
// ───────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const ctx = await getCurrentUserOrg(req);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const query = (body.query as string | undefined)?.trim();
  if (!query) {
    return NextResponse.json({ error: "query required" }, { status: 400 });
  }

  let queryEmbedding: number[];
  try {
    queryEmbedding = await embedQuery(query);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }

  const { data: candidates, error: searchError } = await supabaseAdmin.rpc(
    "match_assets",
    {
      query_embedding: queryEmbedding,
      match_threshold: 0.0,
      match_count: 10,
      filter_org_id: ctx.orgId,
    }
  );

  if (searchError) {
    return NextResponse.json({ error: searchError.message }, { status: 500 });
  }
  if (!candidates || candidates.length === 0) {
    return NextResponse.json({
      matches: [],
      candidatesFound: 0,
      note: "No assets in your library have embeddings yet.",
    });
  }

  // Exclude any non-published assets (archived OR draft) from the candidate
  // pool. Drafts are admin work-in-progress and shouldn't surface to sales
  // reps; archived assets are explicitly hidden from the live library. We
  // do this in the API route rather than in match_assets() to avoid
  // invalidating the HNSW index plan.
  const { data: hiddenRows } = await supabaseAdmin
    .from("assets")
    .select("id")
    .eq("org_id", ctx.orgId)
    .neq("status", "published");
  const hiddenSet = new Set((hiddenRows || []).map((r) => r.id as string));
  const filteredCandidates = (candidates as CandidateAsset[]).filter(
    (c) => !hiddenSet.has(c.id)
  );

  if (filteredCandidates.length === 0) {
    return NextResponse.json({
      matches: [],
      candidatesFound: 0,
      note: "No published matches in your library.",
    });
  }

  let matches: AIMatch[];
  try {
    matches = await synthesizeMatches(query, filteredCandidates);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }

  return NextResponse.json({
    matches: matches.map((m, i) => ({ ...m, rank: i + 1 })),
    candidatesFound: filteredCandidates.length,
  });
}
