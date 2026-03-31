import type { Env, AnalyzeRequest, AuditResult, AnalysisMode } from "./types";
import { getGuidelines } from "./guidelines";

const MODEL = "claude-sonnet-4-20250514";

const OUTPUT_SCHEMA = `{
  "overallScore": <number 0-100>,
  "dimensions": [
    { "dimension": "Terminology", "score": <0-100>, "fullMark": 100 },
    { "dimension": "Tone", "score": <0-100>, "fullMark": 100 },
    { "dimension": "Hierarchy", "score": <0-100>, "fullMark": 100 },
    { "dimension": "Claims", "score": <0-100>, "fullMark": 100 },
    { "dimension": "Positioning", "score": <0-100>, "fullMark": 100 }
  ],
  "findings": [
    {
      "id": <sequential number starting at 1>,
      "severity": "critical" | "warning" | "suggestion",
      "category": "Terminology" | "Hierarchy" | "Tone" | "Claims" | "Positioning",
      "text": "<short label for the issue, max 60 chars>",
      "location": "<where in the content this appears, e.g. 'Hero section', 'Paragraph 3'>",
      "explanation": "<detailed explanation of why this violates the guidelines, 2-4 sentences>",
      "docRef": "<which guideline section this references, e.g. 'Approved Terminology', 'Messaging Hierarchy'>",
      "suggestion": "<what to do instead, actionable advice>",
      "original": "<the exact text from the content that has the issue>",
      "revised": "<rewritten version that fixes the issue>"
    }
  ],
  "terms": {
    "approved": [
      { "term": "<approved term from terminology guidelines>", "found": <boolean>, "count": <number of occurrences> }
    ],
    "forbidden": [
      { "term": "<forbidden term from terminology guidelines>", "found": <boolean>, "count": <number of occurrences> }
    ]
  }
}`;

function buildSystemPrompt(guidelines: string, mode: AnalysisMode, persona?: string | null): string {
  const modeInstructions = getModeInstructions(mode, persona);

  return `You are Lighthouse, the social.plus brand messaging auditor. You analyze content against official brand guidelines and return structured audit results.

## Brand Guidelines

${guidelines}

## Your Task

Analyze the provided content against the brand guidelines above. Be thorough, specific, and actionable.

${modeInstructions}

## Scoring Dimensions (each 0-100)

- **Terminology**: Are approved terms used consistently? Are forbidden terms absent? Scan for EVERY approved and forbidden term listed in the terminology guidelines and report found/count for each one.
- **Tone**: Does it match the brand voice? Active voice, no emojis, no em dashes, no hype language, confidence through clarity, structured paragraphs, no rhetorical fluff.
- **Hierarchy**: Does messaging follow the prescribed order? Context/market shift first, then infrastructure positioning, then engagement, then intelligence/analytics, then revenue/monetization, then long-term compounding advantage. Revenue must NEVER lead.
- **Claims**: Are all claims verifiable? No invented statistics, no guaranteed outcomes ("guaranteed growth/retention/revenue"), no fabricated customer references, no features not documented in official product docs.
- **Positioning**: Is social.plus framed as "infrastructure" (not a tool, not a social network, not a forum)? Is "platform" used only as a secondary/supporting term, never the primary descriptor?

## Severity Definitions

- **critical**: Direct violation of a mandatory rule. Wrong terminology, forbidden terms used, messaging hierarchy violated, unverifiable claims, positioning as tool/network/forum.
- **warning**: Significant departure from guidelines that weakens the message. Missing key terms, suboptimal positioning, revenue language too prominent, generic/weak CTAs.
- **suggestion**: Improvement opportunity. Typos, missing context, strengthening opportunities, dead links, minor style issues.

## Output Requirements

Respond with ONLY valid JSON matching this exact schema. No markdown code fences, no explanation outside the JSON:

${OUTPUT_SCHEMA}

CRITICAL RULES:
1. Every finding MUST include the exact "original" text from the content and a concrete "revised" replacement.
2. The "docRef" must name the actual guideline section being referenced.
3. overallScore = weighted average: Terminology 25%, Tone 20%, Hierarchy 20%, Claims 15%, Positioning 20%.
4. Scan for ALL approved and forbidden terms from the terminology guidelines — report every single one with found status and count.
5. Be specific — quote exact phrases from the content, don't be vague.
6. Only report genuine issues. Do not invent problems that don't exist in the content.
7. Sort findings by severity: critical first, then warning, then suggestion.`;
}

function getModeInstructions(mode: AnalysisMode, persona?: string | null): string {
  switch (mode) {
    case "terminology":
      return `## Analysis Mode: TERMINOLOGY FOCUS
Focus exclusively on terminology compliance. Check every approved and forbidden term.
For dimensions that are not terminology, assign a neutral score of 75 and report no findings for those categories.
The terms scan must be exhaustive — check every single approved and forbidden term listed in the guidelines.`;

    case "hierarchy":
      return `## Analysis Mode: HIERARCHY FOCUS
Focus exclusively on messaging hierarchy and narrative structure. Check if the content follows the prescribed messaging order.
For dimensions that are not hierarchy, assign a neutral score of 75 and report no findings for those categories.`;

    case "tone":
      return `## Analysis Mode: TONE OF VOICE FOCUS
Focus exclusively on tone of voice, writing style, and energy. Check active voice usage, confidence vs. hype, structure, and brand voice adherence.
For dimensions that are not tone, assign a neutral score of 75 and report no findings for those categories.`;

    case "positioning":
      return `## Analysis Mode: POSITIONING FOCUS
Focus exclusively on how social.plus is positioned — infrastructure vs. platform/tool, category framing, competitive differentiation.
For dimensions that are not positioning, assign a neutral score of 75 and report no findings for those categories.`;

    case "persona":
      return `## Analysis Mode: PERSONA LENS
Analyze the content from the perspective of a ${persona || "CPO"}.
Frame every finding from what a ${persona || "CPO"} would notice, care about, and be concerned by.
A CPO cares about product-market fit, positioning clarity, and user experience messaging.
A CTO cares about technical accuracy, integration claims, and infrastructure positioning.
A Developer cares about SDK/API references, technical terminology, and getting-started clarity.
All five dimensions should be scored and analyzed, but findings should be framed through the persona lens.`;

    case "full":
    default:
      return `## Analysis Mode: FULL AUDIT
Perform a complete analysis across all five dimensions. Be thorough — check every term, every hierarchy element, every claim, every positioning choice.`;
  }
}

function buildUserPrompt(request: AnalyzeRequest): string {
  const source = request.sourceUrl ? ` from ${request.sourceUrl}` : "";
  return `Analyze this ${request.contentType}${source}:

---
${request.content}
---

Analysis mode: ${request.mode}${request.persona ? `\nPersona: ${request.persona}` : ""}`;
}

/**
 * Run the brand audit analysis using Claude API.
 */
export async function analyzeContent(
  request: AnalyzeRequest,
  env: Env,
): Promise<AuditResult> {
  // Check content hash cache
  const cacheKey = `analysis:${await hashContent(request.content + request.mode + request.contentType + (request.persona || ""))}`;
  const cached = await env.CACHE.get(cacheKey, "json") as AuditResult | null;
  if (cached) {
    return cached;
  }

  // Fetch guidelines
  const { text: guidelines, version } = await getGuidelines(env);

  // Build prompts
  const systemPrompt = buildSystemPrompt(guidelines, request.mode, request.persona);
  const userPrompt = buildUserPrompt(request);

  // Call Claude API
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 8192,
      system: systemPrompt,
      messages: [
        {
          role: "user",
          content: userPrompt,
        },
      ],
    }),
  });

  if (!response.ok) {
    const status = response.status;
    const errText = await response.text().catch(() => "");
    if (status === 429) {
      throw new Error("Rate limited by Claude API. Please try again in a moment.");
    }
    throw new Error(`Claude API error (${status}). Please try again.`);
  }

  const data = (await response.json()) as {
    content: Array<{ type: string; text: string }>;
    stop_reason: string;
  };

  // Check if response was truncated
  if (data.stop_reason === "max_tokens") {
    throw new Error("Analysis was too large for the content provided. Try a focused mode (Terminology, Tone, etc.) instead of Full Audit.");
  }

  // Extract the text response
  const textBlock = data.content.find((b) => b.type === "text");
  if (!textBlock) {
    throw new Error("No text response from Claude API");
  }

  // Parse JSON from the response (handle potential markdown fences)
  let jsonStr = textBlock.text.trim();
  if (jsonStr.startsWith("```")) {
    jsonStr = jsonStr.replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "");
  }

  let result: AuditResult;
  try {
    const parsed = JSON.parse(jsonStr);
    result = {
      ...parsed,
      guidelinesVersion: version,
      analyzedUrl: request.sourceUrl,
      mode: request.mode,
      contentType: request.contentType,
    };
  } catch {
    throw new Error(`Failed to parse Claude response as JSON: ${jsonStr.slice(0, 200)}...`);
  }

  // Validate and normalize the result
  result = normalizeResult(result);

  // Cache the result for 24 hours
  await env.CACHE.put(cacheKey, JSON.stringify(result), {
    expirationTtl: 86400,
  });

  return result;
}

/**
 * Ensure the result has the expected shape and sensible values.
 */
function normalizeResult(result: AuditResult): AuditResult {
  // Clamp scores to 0-100
  result.overallScore = Math.max(0, Math.min(100, Math.round(result.overallScore)));

  if (result.dimensions) {
    result.dimensions = result.dimensions.map((d) => ({
      ...d,
      score: Math.max(0, Math.min(100, Math.round(d.score))),
      fullMark: 100,
    }));
  }

  // Ensure findings have sequential IDs
  if (result.findings) {
    result.findings = result.findings.map((f, i) => ({
      ...f,
      id: i + 1,
    }));
  }

  return result;
}

/**
 * SHA-256 hash of a string, returned as a hex string.
 */
async function hashContent(content: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(content);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}
