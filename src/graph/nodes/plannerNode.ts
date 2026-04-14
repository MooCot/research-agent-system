/**
 * PLANNER NODE  (S → structured intent)
 * ─────────────────────────────────────────────────────────────────────────────
 * Decomposes the user query into sub-questions and generates search queries.
 * Outputs a validated PlannerOutputContract.
 *
 * Layer: Service
 *
 * LLM call: one structured-output call with JSON response format.
 * Retry: handled by LangChain's withRetry — not duplicated here.
 */

import { ChatOpenAI } from "@langchain/openai";
import { ChatAnthropic } from "@langchain/anthropic";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { z } from "zod";
import crypto from "crypto";

import type { AgentState, PlannerOutputContract } from "../../contracts/index";
import { logger } from "../../observability/logger";

// ─── Zod schema for LLM response validation ───────────────────────────────────

const SubQuestionSchema = z.object({
  question: z.string().min(5),
  searchQueries: z.array(z.string().min(3)).min(1).max(4),
  priority: z.enum(["high", "medium", "low"]),
});

const PlanSchema = z.object({
  intent: z.string().min(10),
  subQuestions: z.array(SubQuestionSchema).min(1).max(6),
});

// ─── LLM factory (Anthropic > DashScope/Alibaba > OpenAI) ────────────────────

function buildLLM() {
  if (process.env.ANTHROPIC_API_KEY) {
    return new ChatAnthropic({
      model: process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-6",
      temperature: 0,
    });
  }
  if (process.env.DASHSCOPE_API_KEY) {
    return new ChatOpenAI({
      apiKey: process.env.DASHSCOPE_API_KEY,
      model: process.env.DASHSCOPE_MODEL ?? "qwen-plus",
      temperature: 0,
      configuration: {
        baseURL: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
      },
    });
  }
  return new ChatOpenAI({
    model: process.env.OPENAI_MODEL ?? "gpt-4o",
    temperature: 0,
  });
}

const SYSTEM_PROMPT = `You are a research planning expert. Given a user query, you must:
1. Identify the core intent behind the query.
2. Decompose it into 2-5 focused sub-questions that together fully answer the query.
3. For each sub-question, generate 1-4 specific web search queries.

Respond ONLY with valid JSON matching this exact structure:
{
  "intent": "<one sentence describing the core research goal>",
  "subQuestions": [
    {
      "question": "<specific sub-question>",
      "searchQueries": ["<search query 1>", "<search query 2>"],
      "priority": "high" | "medium" | "low"
    }
  ]
}

Rules:
- Sub-questions must be non-overlapping and collectively exhaustive.
- Search queries must be concrete and searchable (not vague).
- Priority "high" = essential to answering the query.
- Return only the JSON object, no prose.`;

export async function plannerNode(state: AgentState): Promise<Partial<AgentState>> {
  const startMs = Date.now();
  const llm = buildLLM();

  logger.info("plannerNode: starting", {
    iteration: state.iterationNumber,
    query: state.query,
  });

  // On retry iterations, enrich the prompt with critic feedback
  const retryContext = state.criticResult?.suggestedFocusAreas.length
    ? `\n\nPrevious research gaps identified (iteration ${state.iterationNumber - 1}):\n${state.criticResult.suggestedFocusAreas.map((a) => `- ${a}`).join("\n")}\n\nFocus sub-questions and search queries on these gaps.`
    : "";

  const messages = [
    new SystemMessage(SYSTEM_PROMPT),
    new HumanMessage(`Research query: "${state.query}"${retryContext}`),
  ];

  let raw: string;
  try {
    const response = await llm.invoke(messages);
    raw = typeof response.content === "string"
      ? response.content
      : JSON.stringify(response.content);
  } catch (err) {
    throw new Error(`plannerNode LLM call failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  // Parse and validate
  const parsed = parsePlannerResponse(raw, state.query);

  const plannerOutput: PlannerOutputContract = {
    originalQuery: state.query,
    intent: parsed.intent,
    subQuestions: parsed.subQuestions.map((sq, i) => ({
      id: crypto.createHash("sha1").update(`${state.query}-${i}-${sq.question}`).digest("hex").slice(0, 8),
      question: sq.question,
      searchQueries: sq.searchQueries,
      priority: sq.priority,
    })),
    searchQueries: parsed.subQuestions.flatMap((sq) => sq.searchQueries),
    planTimestamp: Date.now(),
  };

  const durationMs = Date.now() - startMs;
  logger.info("plannerNode: complete", {
    iteration: state.iterationNumber,
    subQuestionCount: plannerOutput.subQuestions.length,
    searchQueryCount: plannerOutput.searchQueries.length,
    durationMs,
  });

  return {
    plannerOutput,
    nodeExecutionLog: [{
        node: "planner",
        iteration: state.iterationNumber,
        durationMs,
        timestamp: Date.now(),
      }],
  };
}

// ─── Response parser with fallback ───────────────────────────────────────────

function parsePlannerResponse(
  raw: string,
  originalQuery: string
): z.infer<typeof PlanSchema> {
  // Strip markdown code fences if present
  const cleaned = raw.replace(/```(?:json)?\n?/g, "").trim();

  let json: unknown;
  try {
    json = JSON.parse(cleaned);
  } catch {
    logger.warn("plannerNode: LLM returned non-JSON, using fallback plan");
    return buildFallbackPlan(originalQuery);
  }

  const result = PlanSchema.safeParse(json);
  if (!result.success) {
    logger.warn("plannerNode: schema validation failed, using fallback plan", {
      errors: result.error.errors,
    });
    return buildFallbackPlan(originalQuery);
  }

  return result.data;
}

function buildFallbackPlan(query: string): z.infer<typeof PlanSchema> {
  return {
    intent: `Research and answer: ${query}`,
    subQuestions: [
      {
        question: `What is the core topic of "${query}"?`,
        searchQueries: [query, `${query} overview`],
        priority: "high" as const,
      },
      {
        question: `What are the key aspects and details of "${query}"?`,
        searchQueries: [`${query} details`, `${query} analysis`],
        priority: "medium" as const,
      },
    ],
  };
}

