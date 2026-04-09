/**
 * CRITIC NODE  (κ-evaluation layer)
 * ─────────────────────────────────────────────────────────────────────────────
 * Evaluates the analysis on three dimensions, computes a weighted score,
 * and determines whether the loop should exit or continue.
 *
 * Layer: Service
 *
 * Scoring dimensions (equal weight by default):
 *   completeness      — are all sub-questions addressed?
 *   structure         — is the answer well-organised?
 *   factual_confidence — how confident are the key facts?
 *
 * Loop exit conditions (κ):
 *   score ≥ threshold          → ExitReason "threshold_met"
 *   iteration ≥ maxIterations  → ExitReason "max_iterations_reached"
 *   otherwise                  → continue loop
 */

import { ChatOpenAI } from "@langchain/openai";
import { ChatAnthropic } from "@langchain/anthropic";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { z } from "zod";

import type {
  AgentState,
  CriticResultContract,
  CriticDimension,
  ExitReason,
  FinalAnswer,
} from "../../contracts/index.js";
import { logger } from "../../observability/logger.js";
import { getMemory } from "./researchNode.js";

// ─── Zod schema ───────────────────────────────────────────────────────────────

const DimensionSchema = z.object({
  name: z.enum(["completeness", "structure", "factual_confidence"]),
  score: z.number().min(0).max(1),
  reasoning: z.string().min(10),
});

const CriticSchema = z.object({
  dimensions: z.array(DimensionSchema).length(3),
  scoringReasoning: z.string().min(20),
  suggestedFocusAreas: z.array(z.string()).max(5),
});

// Dimension weights — must sum to 1.0
const WEIGHTS: Record<CriticDimension["name"], number> = {
  completeness: 0.45,
  structure: 0.25,
  factual_confidence: 0.30,
};

function buildLLM() {
  if (process.env.ANTHROPIC_API_KEY) {
    return new ChatAnthropic({
      model: process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-6",
      temperature: 0,
    });
  }
  return new ChatOpenAI({
    model: process.env.OPENAI_MODEL ?? "gpt-4o",
    temperature: 0,
  });
}

const SYSTEM_PROMPT = `You are a rigorous research quality evaluator. Assess the provided research answer on exactly three dimensions and return a JSON evaluation.

Respond ONLY with valid JSON matching this exact structure:
{
  "dimensions": [
    {
      "name": "completeness",
      "score": <0.0 to 1.0>,
      "reasoning": "<why this score>"
    },
    {
      "name": "structure",
      "score": <0.0 to 1.0>,
      "reasoning": "<why this score>"
    },
    {
      "name": "factual_confidence",
      "score": <0.0 to 1.0>,
      "reasoning": "<why this score>"
    }
  ],
  "scoringReasoning": "<overall evaluation summary>",
  "suggestedFocusAreas": ["<area needing more research>", ...]
}

Scoring guide:
- completeness: 1.0 = all sub-questions fully answered; 0.0 = none addressed
- structure: 1.0 = clear, logical, well-organised prose; 0.0 = incoherent
- factual_confidence: 1.0 = all facts from multiple sources; 0.0 = speculation only

suggestedFocusAreas: list gaps that a follow-up research iteration should target.
Return only the JSON object.`;

export async function criticNode(
  state: AgentState
): Promise<Partial<AgentState>> {
  const startMs = Date.now();
  const llm = buildLLM();

  const plan = state.plannerOutput;
  const analysis = state.analysisResult;

  if (!plan) throw new Error("criticNode: plannerOutput missing");
  if (!analysis) throw new Error("criticNode: analysisResult missing");

  logger.info("criticNode: evaluating", {
    iteration: state.iterationNumber,
    threshold: state.qualityThreshold,
  });

  const subQuestionSummary = plan.subQuestions
    .map((sq) => `[${sq.id}] ${sq.question}`)
    .join("\n");

  const isLastIteration = state.iterationNumber >= state.maxIterations;

  const userMessage = `
Original query: "${state.query}"

Sub-questions that should be answered:
${subQuestionSummary}

Addressed sub-question IDs: ${analysis.addressedSubQuestions.join(", ") || "none"}
Unanswered sub-question IDs: ${analysis.unansweredSubQuestions.join(", ") || "none"}

Key facts extracted (${analysis.keyFacts.length}):
${analysis.keyFacts.map((f) => `- [${f.confidence}] ${f.claim}`).join("\n")}

Structured answer:
${analysis.structuredAnswer}

${isLastIteration ? "NOTE: This is the final allowed iteration. Score what we have." : ""}
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
      `criticNode LLM call failed: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  const parsed = parseCriticResponse(raw);

  // ─── Compute weighted score ────────────────────────────────────────────────

  const overallScore = parsed.dimensions.reduce((sum, dim) => {
    return sum + dim.score * WEIGHTS[dim.name as CriticDimension["name"]];
  }, 0);

  // ─── Determine exit reason (κ) ────────────────────────────────────────────

  const passed = overallScore >= state.qualityThreshold;
  const maxReached = state.iterationNumber >= state.maxIterations;

  let exitReason: ExitReason | undefined;
  let degradedMode = false;

  if (passed) {
    exitReason = "threshold_met";
  } else if (maxReached) {
    exitReason = "max_iterations_reached";
    degradedMode = true;
  }
  // else: no exitReason → loop continues

  const criticResult: CriticResultContract = {
    overallScore: Math.round(overallScore * 1000) / 1000,
    dimensions: parsed.dimensions as CriticDimension[],
    passed,
    iterationNumber: state.iterationNumber,
    scoringReasoning: parsed.scoringReasoning,
    suggestedFocusAreas: parsed.suggestedFocusAreas,
    // exactOptionalPropertyTypes: only include exitReason when defined
    ...(exitReason !== undefined ? { exitReason } : {}),
    degradedMode,
  };

  const durationMs = Date.now() - startMs;

  logger.info("criticNode: scored", {
    iteration: state.iterationNumber,
    overallScore: criticResult.overallScore,
    passed,
    exitReason: exitReason ?? "continue",
    durationMs,
  });

  // ─── Build final answer if loop is terminating ────────────────────────────

  let finalAnswer: FinalAnswer | undefined;
  let shouldContinue = true;

  if (exitReason) {
    shouldContinue = false;
    const memory = getMemory();

    finalAnswer = {
      query: state.query,
      answer: degradedMode
        ? `[DEGRADED MODE — quality score ${criticResult.overallScore.toFixed(2)} below threshold ${state.qualityThreshold}]\n\n${analysis.structuredAnswer}`
        : analysis.structuredAnswer,
      sources: memory.getSources(),
      qualityScore: criticResult.overallScore,
      iterationsUsed: state.iterationNumber,
      exitReason,
      degradedMode,
      completedAt: Date.now(),
    };
  }

  // ─── Increment memory iteration counter ───────────────────────────────────
  getMemory().incrementIteration();

  return {
    criticResult,
    shouldContinue,
    ...(finalAnswer !== undefined ? { finalAnswer } : {}),
    iterationNumber: state.iterationNumber + (shouldContinue ? 1 : 0),
    nodeExecutionLog: [
      ...state.nodeExecutionLog,
      {
        node: "critic",
        iteration: state.iterationNumber,
        durationMs,
        criticScore: criticResult.overallScore,
        ...(exitReason !== undefined ? { exitReason } : {}),
        timestamp: Date.now(),
      },
    ],
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseCriticResponse(raw: string): z.infer<typeof CriticSchema> {
  const cleaned = raw.replace(/```(?:json)?\n?/g, "").trim();

  let json: unknown;
  try {
    json = JSON.parse(cleaned);
  } catch {
    logger.warn("criticNode: LLM returned non-JSON, using low scores");
    return buildFallbackCritic();
  }

  const result = CriticSchema.safeParse(json);
  if (!result.success) {
    logger.warn("criticNode: schema validation failed", {
      errors: result.error.errors,
    });
    return buildFallbackCritic();
  }

  return result.data;
}

function buildFallbackCritic(): z.infer<typeof CriticSchema> {
  return {
    dimensions: [
      { name: "completeness" as const, score: 0.2, reasoning: "Could not evaluate — LLM parsing error" },
      { name: "structure" as const, score: 0.2, reasoning: "Could not evaluate — LLM parsing error" },
      { name: "factual_confidence" as const, score: 0.2, reasoning: "Could not evaluate — LLM parsing error" },
    ],
    scoringReasoning: "Critic LLM response could not be parsed; defaulting to low scores.",
    suggestedFocusAreas: ["Retry all sub-questions with more specific search queries"],
  };
}
