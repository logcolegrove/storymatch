import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { fetchOrgAggregates, FEEDBACK_MIN_VOTES_FOR_RANKING, type FeedbackAggregate } from "@/lib/feedback-dal";
import { logSearch } from "@/lib/search-log-dal";

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

// ── Match factor weights ─────────────────────────────────────
// Org similarity is the highest-weighted because a story from a
// peer organisation lands harder than one from a different kind of
// customer — even if topic + quotes are great. These are tunable.
const FACTOR_WEIGHTS = {
  orgSimilarity: 0.45,
  painPoints: 0.35,
  quoteMatch: 0.20,
} as const;

interface FactorScores {
  orgSimilarity: number; // 0-100
  painPoints: number;    // 0-100
  quoteMatch: number;    // 0-100
}

interface TalkingPoint {
  topic: string;
  text: string;
}

interface RawAIMatch {
  id: string;
  reasoning: string;          // 1-2 sentence why-this-match, may use placeholders
  factorScores?: FactorScores;
  lowestFactorNote?: string;  // 1-sentence explanation of weakest factor
  talkingPoints?: TalkingPoint[];
  quotes: string[];
  relevanceScore?: number;    // legacy field — recomputed from factor weights
}

interface AIMatch {
  id: string;
  reasoning: string;
  factorScores: FactorScores;
  lowestFactorNote: string;
  talkingPoints: TalkingPoint[];
  quotes: string[];
  relevanceScore: number;     // weighted from factorScores
}

function clamp100(n: unknown): number {
  if (typeof n !== "number" || !Number.isFinite(n)) return 50;
  return Math.max(0, Math.min(100, Math.round(n)));
}
function weightedRelevance(f: FactorScores): number {
  return Math.round(
    f.orgSimilarity * FACTOR_WEIGHTS.orgSimilarity
    + f.painPoints * FACTOR_WEIGHTS.painPoints
    + f.quoteMatch * FACTOR_WEIGHTS.quoteMatch,
  );
}

// Map an aggregate of sales-rep feedback into a relevance-score
// adjustment. The shape: a single thumbs-up shifts +1.5; thumbs-down
// shifts -1.5; capped at ±10 so a brigading run can never override
// genuine semantic match. Assets with fewer than the confidence floor
// votes contribute 0 — they're treated as "no signal" rather than
// being penalized for newness.
//
// This is deliberately a small effect — feedback is a tie-breaker, not
// a primary signal. The point is to nudge close calls based on which
// testimonials reps have actually used successfully.
function feedbackBoost(agg: FeedbackAggregate | undefined): number {
  if (!agg) return 0;
  if (agg.total < FEEDBACK_MIN_VOTES_FOR_RANKING) return 0;
  const raw = agg.netScore * 1.5;
  return Math.max(-10, Math.min(10, raw));
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
    // Fallback: top 5 by vector similarity, no AI reasoning. Build
    // a minimal factor-score shape so the FE renders consistently.
    return candidates.slice(0, 5).map((c) => {
      const sim = Math.round(c.similarity * 100);
      const factorScores: FactorScores = {
        orgSimilarity: sim,
        painPoints: sim,
        quoteMatch: sim,
      };
      return {
        id: c.id,
        reasoning: substitutePlaceholders(
          `{SPEAKER} at {COMPANY} is a strong semantic match for the request.`,
          c,
        ),
        factorScores,
        lowestFactorNote: "",
        talkingPoints: [] as TalkingPoint[],
        quotes: c.pull_quote && c.transcript && isQuoteInTranscript(c.pull_quote, c.transcript)
          ? [c.pull_quote]
          : [],
        relevanceScore: weightedRelevance(factorScores),
      } satisfies AIMatch;
    });
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

  const systemPrompt = `You are a sales enablement assistant for StoryMatch, a B2B testimonial intelligence platform. Match the salesperson's request to the most relevant customer testimonials and return a structured response the UI will render.

ABSOLUTE RULES:

1. **Use placeholders, not names.** When writing reasoning, talking-point text, or the lowest-factor note, NEVER type a person's name or a company's name. Instead use these placeholders:
   - {SPEAKER} for the person speaking in the testimonial
   - {COMPANY} for their organization
   - {CHALLENGE} for the challenge they describe
   - {OUTCOME} for the outcome they achieved
   - {VERTICAL} for the industry
   - {GEOGRAPHY} for the region
   These get substituted with actual values server-side. Quotes are verbatim and DO contain real names — that's fine.

2. **Each candidate's content uses ONLY that candidate's data.** Never blend information across candidates.

3. **Quotes must be VERBATIM substrings of that candidate's transcript.** Copy character-for-character. Don't fix transcription errors, don't paraphrase. Empty array if no exact quote applies.

4. **Talking points are PARAPHRASED claims, not quotes.** Each talking point has a short topic header (2-4 words like "Time savings", "Migration support", "Peer reference") and a 1-2 sentence paraphrased summary written in third person about {COMPANY}. NOT a verbatim quote. Example: "Time savings — {COMPANY} got twelve hours a week back on reconciliation."

5. **Reasoning is 1-2 sentences MAX.** Punchy, sales-coach voice. Highlight the 1-2 most important phrases with **markdown bold** — the UI renders those as accent chips.

6. **Reason from evidence.** Every claim must trace to text actually in the candidate's transcript or metadata.

7. **Better fewer strong matches than many weak ones.**

SCORING — each candidate gets three independent factor scores 0-100:
   - orgSimilarity: how closely THIS candidate's organisation matches the salesperson's described prospect (type, size, geography, vertical). 80+ = peer-org. 50-70 = same world but different size/geo. <50 = different category.
   - painPoints: how directly this story addresses the SPECIFIC concerns or pain points the salesperson named. 80+ = the story is about exactly that pain. 50-70 = related but tangential. <50 = doesn't really tackle it.
   - quoteMatch: do verbatim quotes exist that DIRECTLY answer the salesperson's request? 80+ = multiple strong quotes. 50-70 = one decent quote. <50 = no verbatim line lands the point.

Return ONLY valid JSON. No preamble, no markdown fences.`;

  const userPrompt = `Salesperson's request: "${query}"

Below are candidate testimonials, pre-filtered by semantic similarity. Pick the top 3-5 best matches.

${candidateText}

Return ONLY a JSON object in this shape:
{
  "matches": [
    {
      "id": "exact ID string of the chosen candidate",
      "reasoning": "1-2 sentences with {SPEAKER}, {COMPANY}, etc. placeholders. Highlight 1-2 key phrases with **markdown bold**.",
      "factorScores": {
        "orgSimilarity": 0-100,
        "painPoints": 0-100,
        "quoteMatch": 0-100
      },
      "lowestFactorNote": "One short sentence in plain English explaining the lowest-scoring factor. Use placeholders for names. e.g. '{COMPANY} is larger than the prospect, which is the biggest reason this isn't a stronger match.'",
      "talkingPoints": [
        {
          "topic": "Short 2-4 word topic header",
          "text": "1-2 sentence paraphrased summary about {COMPANY}. NOT a verbatim quote."
        }
      ],
      "quotes": ["verbatim substring from this candidate's transcript", "another verbatim substring"]
    }
  ]
}

Aim for 2-3 talking points per match and 1-2 verbatim quotes. If no candidates fit, return {"matches": []}.`;

  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-5",
      max_tokens: 4500,
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

    // Substitute placeholders + correct any cross-candidate name leakage.
    const sanitize = (text: string) => {
      const subbed = substitutePlaceholders(text || "", candidate);
      return correctMisattributedNames(subbed, candidate, candidates);
    };

    const reasoning = sanitize(m.reasoning || "");
    const lowestFactorNote = sanitize(m.lowestFactorNote || "");

    // Validate verbatim quotes against THIS candidate's transcript only.
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

    // Talking points are paraphrased prose — no transcript validation,
    // but we DO run them through placeholder substitution + name
    // correction so any speaker/company refs come from the DB.
    const talkingPoints: TalkingPoint[] = (Array.isArray(m.talkingPoints) ? m.talkingPoints : [])
      .filter((tp): tp is TalkingPoint => !!tp && typeof tp.topic === "string" && typeof tp.text === "string")
      .map(tp => ({
        topic: tp.topic.trim().slice(0, 40),  // hard cap on topic length
        text: sanitize(tp.text),
      }))
      .filter(tp => tp.topic.length > 0 && tp.text.length > 0)
      .slice(0, 4);  // cap at 4 to keep cards scannable

    // Clamp factor scores to 0-100, fall back to neutral 50 on bad data.
    const factorScores: FactorScores = {
      orgSimilarity: clamp100(m.factorScores?.orgSimilarity),
      painPoints: clamp100(m.factorScores?.painPoints),
      quoteMatch: clamp100(m.factorScores?.quoteMatch),
    };
    const relevanceScore = weightedRelevance(factorScores);

    validated.push({
      id: m.id,
      reasoning,
      factorScores,
      lowestFactorNote,
      talkingPoints,
      quotes: verifiedQuotes,
      relevanceScore,
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

  // ── Feedback ranking pass ──────────────────────────────────
  // Read the org's flag and, if on, fold sales-rep feedback into
  // the final relevance score. Run AFTER Claude's synthesis so we
  // don't bias the LLM's reasoning with raw counts (the LLM is too
  // easily steered by numbers). Deterministic math here keeps the
  // effect explainable + capped.
  const { data: orgFlag } = await supabaseAdmin
    .from("organizations")
    .select("feedback_affects_ranking")
    .eq("id", ctx.orgId)
    .maybeSingle();
  let feedbackAdjusted: { match: AIMatch; adjustedScore: number; agg?: FeedbackAggregate }[] = matches.map(m => ({ match: m, adjustedScore: m.relevanceScore }));
  if (orgFlag?.feedback_affects_ranking) {
    const aggregates = await fetchOrgAggregates(ctx.orgId);
    feedbackAdjusted = matches.map(m => {
      const agg = aggregates.get(m.id);
      const boost = feedbackBoost(agg);
      return {
        match: m,
        adjustedScore: Math.max(0, Math.min(100, m.relevanceScore + boost)),
        agg,
      };
    });
    // Re-sort by adjusted score so the rank order reflects feedback.
    feedbackAdjusted.sort((a, b) => b.adjustedScore - a.adjustedScore);
  }

  const finalMatches = feedbackAdjusted.map((entry, i) => ({
    ...entry.match,
    relevanceScore: entry.adjustedScore,
    rank: i + 1,
    // Surface aggregate counts so the FE can show them in the
    // hover popover without an extra round trip. Always present
    // when the org's flag is on; undefined when feedback isn't
    // affecting ranking (FE hides the indicator entirely).
    feedback: orgFlag?.feedback_affects_ranking && entry.agg
      ? { up: entry.agg.up, down: entry.agg.down, total: entry.agg.total }
      : undefined,
  }));

  // Log every StoryMatch search for the admin Insights view. Fire
  // and forget — never block the response. result_count is the
  // length of the final match set the user actually sees; zero is
  // the gap signal admins care about most.
  void logSearch({
    orgId: ctx.orgId,
    userId: ctx.userId,
    query,
    source: "storymatch",
    resultCount: finalMatches.length,
    topResultIds: finalMatches.slice(0, 10).map(m => m.id),
  });

  return NextResponse.json({
    matches: finalMatches,
    candidatesFound: filteredCandidates.length,
    feedbackAffectsRanking: !!orgFlag?.feedback_affects_ranking,
  });
}
