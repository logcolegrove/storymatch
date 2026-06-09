import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { fetchOrgAggregates, FEEDBACK_MIN_VOTES_FOR_RANKING, type FeedbackAggregate } from "@/lib/feedback-dal";
import { logSearch } from "@/lib/search-log-dal";

// ── Model selection ─────────────────────────────────────────
// The synthesis call dominates query latency. Set STORYMATCH_MODEL
// in env to switch between models without a deploy:
//   STORYMATCH_MODEL=haiku   → claude-haiku-4-5 (faster, cheaper, slightly less nuanced)
//   STORYMATCH_MODEL=sonnet  → claude-sonnet-4-5 (default, richer reasoning)
//   STORYMATCH_MODEL=<id>    → custom Anthropic model id, passed through verbatim
// Anything else / unset → Sonnet, matching prior behavior so an
// accidental missing env var doesn't silently downgrade output.
function selectSynthesisModel(): string {
  const raw = (process.env.STORYMATCH_MODEL || "").trim().toLowerCase();
  if (raw === "haiku") return "claude-haiku-4-5-20251001";
  if (raw === "sonnet" || raw === "") return "claude-sonnet-4-5";
  // Pass arbitrary model IDs through as-is (e.g. opus, future versions).
  return raw;
}

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
// Streaming JSON match extractor.
//
// Claude emits a single JSON object: { "matches": [{...}, {...}] }.
// We want to surface each completed match the moment it closes so
// the UI can render it without waiting for the rest. This walks the
// streaming text buffer character-by-character with string-aware
// brace counting, yielding each completed top-level match object's
// raw JSON string as it closes.
//
// String + escape handling is required because reasoning/quote text
// inside the JSON will contain literal { and } characters that must
// NOT count toward depth.
// ───────────────────────────────────────────────────────────
class MatchExtractor {
  private buffer = "";
  private startedArray = false;       // saw "matches":[
  private cursor = 0;                 // walk position inside buffer
  private depth = 0;                  // brace/bracket depth relative to inside the matches array
  private inString = false;
  private escapeNext = false;
  private currentMatchStart = -1;     // index of { that opened the current match (depth went 0 → 1)

  // Append a streaming chunk and return any newly-completed match
  // objects (raw JSON strings of each closed top-level object).
  append(chunk: string): string[] {
    this.buffer += chunk;
    const completed: string[] = [];

    if (!this.startedArray) {
      // Find the opening of the matches array. Tolerate whitespace
      // between the key and the [. Once found, jump the cursor past
      // the [ so the depth tracker starts from "inside the array."
      const m = /"matches"\s*:\s*\[/.exec(this.buffer);
      if (!m) return completed;
      this.cursor = m.index + m[0].length;
      this.startedArray = true;
    }

    while (this.cursor < this.buffer.length) {
      const c = this.buffer[this.cursor];

      if (this.escapeNext) {
        this.escapeNext = false;
      } else if (this.inString) {
        if (c === "\\") this.escapeNext = true;
        else if (c === '"') this.inString = false;
      } else {
        if (c === '"') this.inString = true;
        else if (c === "{") {
          if (this.depth === 0) this.currentMatchStart = this.cursor;
          this.depth++;
        } else if (c === "}") {
          this.depth--;
          if (this.depth === 0 && this.currentMatchStart !== -1) {
            completed.push(this.buffer.slice(this.currentMatchStart, this.cursor + 1));
            this.currentMatchStart = -1;
          }
        } else if (c === "[") {
          this.depth++;
        } else if (c === "]") {
          this.depth--;
          // Closing the matches array — stop trying to parse further.
          if (this.depth < 0) {
            this.cursor = this.buffer.length;
            break;
          }
        }
      }
      this.cursor++;
    }
    return completed;
  }
}

// ───────────────────────────────────────────────────────────
// Validate + sanitize a single match object against the candidate
// pool. Pulled out of the previous monolithic synthesizeMatches so
// it can be applied per-match as the stream arrives.
// ───────────────────────────────────────────────────────────
function validateMatch(
  m: RawAIMatch,
  candidates: CandidateAsset[],
  candidateById: Map<string, CandidateAsset>,
): AIMatch | null {
  const candidate = candidateById.get(m.id);
  if (!candidate) {
    console.warn(`[storymatch] Dropped match — unknown ID: ${m.id}`);
    return null;
  }
  const sanitize = (text: string) => {
    const subbed = substitutePlaceholders(text || "", candidate);
    return correctMisattributedNames(subbed, candidate, candidates);
  };
  const reasoning = sanitize(m.reasoning || "");
  const lowestFactorNote = sanitize(m.lowestFactorNote || "");
  const transcript = candidate.transcript || "";
  const verifiedQuotes = (m.quotes || []).filter((q) =>
    isQuoteInTranscript(q, transcript)
  );
  const droppedQuotes = (m.quotes || []).length - verifiedQuotes.length;
  if (droppedQuotes > 0) {
    console.warn(`[storymatch] Dropped ${droppedQuotes} unverified quote(s) from ${m.id}`);
  }
  const talkingPoints: TalkingPoint[] = (Array.isArray(m.talkingPoints) ? m.talkingPoints : [])
    .filter((tp): tp is TalkingPoint => !!tp && typeof tp.topic === "string" && typeof tp.text === "string")
    .map((tp) => ({ topic: tp.topic.trim().slice(0, 40), text: sanitize(tp.text) }))
    .filter((tp) => tp.topic.length > 0 && tp.text.length > 0)
    .slice(0, 4);
  const factorScores: FactorScores = {
    orgSimilarity: clamp100(m.factorScores?.orgSimilarity),
    painPoints: clamp100(m.factorScores?.painPoints),
    quoteMatch: clamp100(m.factorScores?.quoteMatch),
  };
  return {
    id: m.id,
    reasoning,
    factorScores,
    lowestFactorNote,
    talkingPoints,
    quotes: verifiedQuotes,
    relevanceScore: weightedRelevance(factorScores),
  };
}

// Fallback for the no-API-key case. Returns a deterministic match
// set built straight from vector similarity, no LLM involved. Kept
// as an async function (not a generator) since there's nothing to
// stream — the caller wraps the result so the streaming protocol
// stays uniform.
function buildSimilarityFallbackMatches(candidates: CandidateAsset[]): AIMatch[] {
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

// ───────────────────────────────────────────────────────────
// Streaming match synthesis.
//
// Yields each validated AIMatch as soon as Claude finishes emitting
// it (rather than waiting for the entire JSON object). Internally
// uses Anthropic's SSE streaming API + brace-counting JSON walker.
//
// If ANTHROPIC_API_KEY isn't set, falls back to a deterministic
// similarity-only result set (yielded all at once).
// ───────────────────────────────────────────────────────────
async function* synthesizeMatchesStream(
  query: string,
  candidates: CandidateAsset[]
): AsyncGenerator<AIMatch, void, unknown> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    for (const m of buildSimilarityFallbackMatches(candidates)) yield m;
    return;
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

5. **Reasoning EXPLAINS THE SCORE.** Two to three sentences. This is shown when the user hovers the % match badge, so they're asking "why this percentage?". You MUST:
   - Quote 1-3 SPECIFIC words or phrases from the salesperson's request (wrap them in "quotes") and tie each to a concrete element of THIS candidate's transcript or metadata.
   - If the user used vague or off-topic language, say so. ("The request mentions 'partner ecosystem' but this story focuses on internal team training — the score reflects that gap.") Don't generate a generic 'this is a great match' when it isn't.
   - Highlight the 1-2 strongest connection phrases with **markdown bold**. UI renders those as accent chips.
   - DO NOT lead with "Why this is a match" or any generic opener. Get straight to the specific connection.

6. **Reason from evidence.** Every claim must trace to text actually in the candidate's transcript or metadata. If a connection is tenuous, say so — accuracy beats flattery.

7. **lowestFactorNote is specific too.** Don't just say "the company is bigger." Say "The prospect's request implies a 30-person team; this testimonial is from a 5,000-person org — the org-similarity score reflects that." Quote specific phrases from the request when relevant.

8. **Better fewer strong matches than many weak ones.**

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
      "reasoning": "2-3 sentences. MUST quote 1-3 specific words/phrases from the salesperson's request (in double-quotes) and tie each to concrete evidence in THIS candidate's transcript or metadata. Use placeholders ({SPEAKER}, {COMPANY}, etc.) for names. Bold the 1-2 strongest connection phrases with **markdown bold**. Example: 'You asked about \\"unified billing\\" — {COMPANY} talks specifically about **consolidating three billing systems into one**. Their {VERTICAL} context matches the prospect closely.' If the request and the candidate don't really align, be honest about it.",
      "factorScores": {
        "orgSimilarity": 0-100,
        "painPoints": 0-100,
        "quoteMatch": 0-100
      },
      "lowestFactorNote": "1 sentence explaining the lowest-scoring factor specifically. Quote the relevant phrase from the request when possible. Use placeholders for names. Example: 'You mentioned \\"sub-50 employee teams\\" but {COMPANY} is enterprise-scale, which drags org-similarity down.'",
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
      model: selectSynthesisModel(),
      max_tokens: 5000,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
      stream: true,
    }),
  });

  if (!r.ok || !r.body) {
    const errText = r.ok ? "(no response body)" : await r.text();
    throw new Error(`Claude API failed: ${r.status} ${errText.slice(0, 300)}`);
  }

  // Walk Anthropic's SSE stream. Each event is delimited by a blank
  // line; the lines we care about are `data: {...}` payloads inside
  // content_block_delta events. Everything else (message_start,
  // ping, message_stop) is ignored — we only need the text deltas.
  const reader = r.body.getReader();
  const decoder = new TextDecoder();
  const extractor = new MatchExtractor();
  const candidateById = new Map(candidates.map((c) => [c.id, c]));
  const seenIds = new Set<string>();
  let sseBuffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    sseBuffer += decoder.decode(value, { stream: true });

    // SSE events are separated by blank lines. Pull complete events
    // off the front of the buffer; whatever remains is the partial
    // tail of the next event.
    let eventDelimIdx: number;
    while ((eventDelimIdx = sseBuffer.indexOf("\n\n")) !== -1) {
      const rawEvent = sseBuffer.slice(0, eventDelimIdx);
      sseBuffer = sseBuffer.slice(eventDelimIdx + 2);
      for (const line of rawEvent.split("\n")) {
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (!payload) continue;
        let evt: { type?: string; delta?: { type?: string; text?: string } };
        try {
          evt = JSON.parse(payload);
        } catch {
          continue;
        }
        if (evt.type !== "content_block_delta") continue;
        if (evt.delta?.type !== "text_delta") continue;
        const chunk = evt.delta.text || "";
        if (!chunk) continue;

        // Feed the new text into the brace-walker. Any newly-closed
        // top-level match objects come back as raw JSON strings; we
        // parse, validate, and yield each.
        for (const matchJson of extractor.append(chunk)) {
          let raw: RawAIMatch;
          try {
            raw = JSON.parse(matchJson) as RawAIMatch;
          } catch {
            console.warn("[storymatch] Skipping unparseable streamed match");
            continue;
          }
          if (!raw.id || seenIds.has(raw.id)) continue;
          seenIds.add(raw.id);
          const validated = validateMatch(raw, candidates, candidateById);
          if (validated) yield validated;
        }
      }
    }
  }
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
    // No-asset / no-embedding case stays a plain JSON response —
    // there's nothing to stream and the FE handles `note` separately.
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

  // Read the org's feedback flag up front so we can apply the
  // ranking adjustment after the stream completes.
  const { data: orgFlag } = await supabaseAdmin
    .from("organizations")
    .select("feedback_affects_ranking")
    .eq("id", ctx.orgId)
    .maybeSingle();
  const feedbackOn = !!orgFlag?.feedback_affects_ranking;
  // Pre-fetch feedback aggregates in parallel with the stream
  // setup — saves a roundtrip when feedback ranking is enabled.
  const aggregatesPromise: Promise<Map<string, FeedbackAggregate> | null> = feedbackOn
    ? fetchOrgAggregates(ctx.orgId)
    : Promise.resolve(null);

  // ── Streaming response ──────────────────────────────────────
  // The FE consumes a Server-Sent-Events stream. Each event has a
  // 1-line `event:` header plus a `data:` JSON payload. Events:
  //   meta   — candidates count + feedbackAffectsRanking flag (sent first)
  //   match  — one validated AIMatch (sent as each completes)
  //   final  — feedback-adjusted, reranked array + feedback aggregates
  //            attached (sent after all matches arrive)
  //   error  — fatal error string (closes stream)
  //   done   — empty terminator
  const encoder = new TextEncoder();
  const sse = (event: string, data: unknown) =>
    encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        controller.enqueue(
          sse("meta", {
            candidatesFound: filteredCandidates.length,
            feedbackAffectsRanking: feedbackOn,
          }),
        );

        // Stream + collect. We hold the matches in memory so the
        // final feedback pass + log can run after Claude closes.
        const collected: AIMatch[] = [];
        for await (const m of synthesizeMatchesStream(query, filteredCandidates)) {
          collected.push(m);
          controller.enqueue(sse("match", m));
        }

        // Feedback ranking pass — only when the org has it enabled.
        const aggregates = await aggregatesPromise;
        let ranked: { match: AIMatch; adjustedScore: number; agg?: FeedbackAggregate }[]
          = collected.map((m) => ({ match: m, adjustedScore: m.relevanceScore }));
        if (feedbackOn && aggregates) {
          ranked = collected.map((m) => {
            const agg = aggregates.get(m.id);
            const boost = feedbackBoost(agg);
            return {
              match: m,
              adjustedScore: Math.max(0, Math.min(100, m.relevanceScore + boost)),
              agg,
            };
          });
          ranked.sort((a, b) => b.adjustedScore - a.adjustedScore);
        }

        const finalMatches = ranked.map((entry, i) => ({
          ...entry.match,
          relevanceScore: entry.adjustedScore,
          rank: i + 1,
          feedback: feedbackOn && entry.agg
            ? { up: entry.agg.up, down: entry.agg.down, total: entry.agg.total }
            : undefined,
        }));

        controller.enqueue(sse("final", {
          matches: finalMatches,
          candidatesFound: filteredCandidates.length,
          feedbackAffectsRanking: feedbackOn,
        }));

        // Search log. Fire-and-forget: don't block the close on it.
        void logSearch({
          orgId: ctx.orgId,
          userId: ctx.userId,
          query,
          source: "storymatch",
          resultCount: finalMatches.length,
          topResultIds: finalMatches.slice(0, 10).map((m) => m.id),
        });

        controller.enqueue(sse("done", {}));
        controller.close();
      } catch (e) {
        const message = e instanceof Error ? e.message : "StoryMatch failed";
        try { controller.enqueue(sse("error", { error: message })); } catch { /* ignore */ }
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      // Disable buffering on proxies so chunks arrive incrementally
      // (Vercel respects this; nginx-style proxies need the explicit
      // header to flush per-chunk).
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
      Connection: "keep-alive",
    },
  });
}
