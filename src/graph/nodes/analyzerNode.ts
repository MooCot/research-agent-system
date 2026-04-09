/**
 * ANALYZER NODE  (aggregation layer)
 * ─────────────────────────────────────────────────────────────────────────────
 * Merges all collected evidence, extracts key facts, and builds a structured
 * prose answer ready for the critic to evaluate.
 *
 * Layer: Service
 *
 * LLM call: one structured-output call.
 * Input:    ResearchResultContract + PlannerOutputContract
 * Output:   AnalysisResultContract
 */

import { ChatOpenAI } from "@langchain/openai";
import { ChatAnthropic } from "@langchain/anthropic";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { z } from "zod";

import type {
  AgentState,
  AnalysisResultContract,
  EvidencePiece,
  KeyFact,
} from "../../contracts/index.js";
import { logger } from "../../observability/logger.js";

// ─── Zod schema ───────────────────────────────────────────────────────────────

const KeyFactSchema = z.object({
  claim: z.string().min(10),
  supportingSourceIds: z.array(z.string()),
  confidence: z.enum(["high", "medium", "low"]),
});

const AnalysisSchema = z.object({
  summary: z.string().min(50),
  keyFacts: z.array(KeyFactSchema).min(1).max(15),
  addressedSubQuestionIds: z.array(z.string()),
  unansweredSubQuestionIds: z.array(z.string()),
  structuredAnswer: z.string().min(100),
});

function buildLLM() {
  if (process.env.ANTHROPIC_API_KEY) {
    return new ChatAnthropic({
      model: process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-6",
      temperature: 0.1,
    });
  }
  return new ChatOpenAI({
    model: process.env.OPENAI_MODEL ?? "gpt-4o",
    temperature: 0.1,
  });
}

const SYSTEM_PROMPT = `You are an expert research analyst. You will receive:
1. A research question with sub-questions
2. A collection of evidence pieces from web sources

Your task:
1. Synthesise the evidence into a coherent, structured answer.
2. Extract 3-10 key facts with confidence levels.
3. Identify which sub-questions are now answered and which remain open.

Respond ONLY with valid JSON matching this exact structure:
{
  "summary": "<2-3 sentence executive summary of findings>",
  "keyFacts": [
    {
      "claim": "<specific factual claim>",
      "supportingSourceIds": ["<sourceId>", ...],
      "confidence": "high" | "medium" | "low"
    }
  ],
  "addressedSubQuestionIds": ["<id>", ...],
  "unansweredSubQuestionIds": ["<id>", ...],
  "structuredAnswer": "<comprehensive prose answer of 150-500 words>"
}

Rules:
- Only claim facts that appear in the evidence.
- Mark confidence "high" only when 2+ sources agree.
- The structuredAnswer must directly address the original query.
- Return only the JSON object.`;

export async function analyzerNode(
  state: AgentState
): Promise<Partial<AgentState>> {
  const startMs = Date.now();
  const llm = buildLLM();

  const plan = state.plannerOutput;
  const research = state.researchResult;

  if (!plan) throw new Error("analyzerNode: plannerOutput missing");
  if (!research) throw new Error("analyzerNode: researchResult missing");

  logger.info("analyzerNode: starting", {
    iteration: state.iterationNumber,
    sourcesAvailable: research.sources.length,
  });

  // Build evidence digest for the LLM (bounded to stay within context)
  const evidenceDigest = buildEvidenceDigest(research.sources, 8000);

  const subQuestionList = plan.subQuestions
    .map((sq) => `  [${sq.id}] (${sq.priority}) ${sq.question}`)
    .join("\n");

  const userMessage = `
Original query: "${state.query}"

Sub-questions to address:
${subQuestionList}

Evidence collected (${research.sources.length} sources):
${evidenceDigest}
`.trim();

  let raw: string;
  try {
    const response = await llm.invoke([
      new SystemMessage(SYSTEM_PROMPT),
      new HumanMessage(userMessage),
    ]);
    raw = typeof response.content === "string"
      ? response.content
      : JSON.stringify(response.content);
  } catch (err) {
    throw new Error(
      `analyzerNode LLM call failed: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  const parsed = parseAnalysisResponse(raw, plan.subQuestions.map((sq) => sq.id));

  const analysisResult: AnalysisResultContract = {
    summary: parsed.summary,
    keyFacts: parsed.keyFacts as KeyFact[],
    addressedSubQuestions: parsed.addressedSubQuestionIds,
    unansweredSubQuestions: parsed.unansweredSubQuestionIds,
    structuredAnswer: parsed.structuredAnswer,
  };

  const durationMs = Date.now() - startMs;

  logger.info("analyzerNode: complete", {
    iteration: state.iterationNumber,
    keyFactCount: analysisResult.keyFacts.length,
    addressedCount: analysisResult.addressedSubQuestions.length,
    unansweredCount: analysisResult.unansweredSubQuestions.length,
    durationMs,
  });

  return {
    analysisResult,
    nodeExecutionLog: [
      ...state.nodeExecutionLog,
      {
        node: "analyzer",
        iteration: state.iterationNumber,
        durationMs,
        timestamp: Date.now(),
      },
    ],
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildEvidenceDigest(sources: EvidencePiece[], maxChars: number): string {
  const lines: string[] = [];
  let totalChars = 0;

  for (const src of sources) {
    const entry = `[${src.sourceId}] ${src.title}\nURL: ${src.url}\n${src.snippet}\n`;
    if (totalChars + entry.length > maxChars) break;
    lines.push(entry);
    totalChars += entry.length;
  }

  return lines.join("\n---\n");
}

function parseAnalysisResponse(
  raw: string,
  allSubQuestionIds: string[]
): z.infer<typeof AnalysisSchema> {
  const cleaned = raw.replace(/```(?:json)?\n?/g, "").trim();

  let json: unknown;
  try {
    json = JSON.parse(cleaned);
  } catch {
    logger.warn("analyzerNode: LLM returned non-JSON, using fallback");
    return buildFallbackAnalysis(allSubQuestionIds);
  }

  const result = AnalysisSchema.safeParse(json);
  if (!result.success) {
    logger.warn("analyzerNode: schema validation failed", {
      errors: result.error.errors,
    });
    return buildFallbackAnalysis(allSubQuestionIds);
  }

  return result.data;
}

function buildFallbackAnalysis(
  allSubQuestionIds: string[]
): z.infer<typeof AnalysisSchema> {
  return {
    summary: "Insufficient evidence collected to produce a full analysis.",
    keyFacts: [
      {
        claim: "Evidence collection is incomplete; further research is required.",
        supportingSourceIds: [],
        confidence: "low" as const,
      },
    ],
    addressedSubQuestionIds: [],
    unansweredSubQuestionIds: allSubQuestionIds,
    structuredAnswer:
      "The available evidence was insufficient to provide a complete answer. Additional research iterations are required.",
  };
}
