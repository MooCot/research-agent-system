/**
 * LANGGRAPH STATE MACHINE
 * ─────────────────────────────────────────────────────────────────────────────
 * Wires the four nodes into a directed graph with conditional loop control.
 *
 * Layer: Infrastructure
 *
 * Graph topology:
 *
 *   START → planner → research → analyzer → critic ┐
 *                  ↑                                │ score < threshold
 *                  └──────────── research ◄─────────┘
 *                                                   │ score ≥ threshold OR
 *                                                   │ max iterations reached
 *                                                   ↓
 *                                                  END
 *
 * State channel reducers:
 *   - nodeExecutionLog: append (accumulate across iterations)
 *   - toolCallCount: use latest value
 *   - all other channels: use latest value (last-write-wins)
 */

import {
  StateGraph,
  Annotation,
  END,
  START,
} from "@langchain/langgraph";

import type {
  AgentState,
  PlannerOutputContract,
  ResearchResultContract,
  AnalysisResultContract,
  CriticResultContract,
  FinalAnswer,
  NodeExecutionEntry,
} from "../contracts/index.js";

import { plannerNode } from "./nodes/plannerNode.js";
import { researchNode } from "./nodes/researchNode.js";
import { analyzerNode } from "./nodes/analyzerNode.js";
import { criticNode } from "./nodes/criticNode.js";
import { logger } from "../observability/logger.js";

// ─── State annotation (LangGraph channel definitions) ────────────────────────
//
// LangGraph uses "reducers" to merge partial state returned by nodes.
// For arrays we use an append reducer so logs accumulate.
// For all other fields, last-write-wins (default).

const AgentStateAnnotation = Annotation.Root({
  // Input
  query: Annotation<string>(),

  // Iteration bookkeeping
  iterationNumber: Annotation<number>(),
  maxIterations: Annotation<number>(),
  qualityThreshold: Annotation<number>(),

  // Node outputs
  plannerOutput: Annotation<PlannerOutputContract | undefined>(),
  researchResult: Annotation<ResearchResultContract | undefined>(),
  analysisResult: Annotation<AnalysisResultContract | undefined>(),
  criticResult: Annotation<CriticResultContract | undefined>(),

  // Termination
  finalAnswer: Annotation<FinalAnswer | undefined>(),
  shouldContinue: Annotation<boolean>(),

  // Observability
  toolCallCount: Annotation<number>(),
  nodeExecutionLog: Annotation<NodeExecutionEntry[]>({
    // Append reducer: accumulates log entries across all nodes/iterations
    reducer: (existing: NodeExecutionEntry[], incoming: NodeExecutionEntry[]) =>
      [...existing, ...incoming],
    default: () => [],
  }),
});

export type GraphState = typeof AgentStateAnnotation.State;

// ─── Conditional edge: critic → (research | END) ─────────────────────────────

function routeAfterCritic(state: GraphState): "research" | typeof END {
  if (!state.shouldContinue) {
    logger.info("graph: loop exiting", {
      exitReason: state.criticResult?.exitReason,
      finalScore: state.criticResult?.overallScore,
      iterations: state.iterationNumber,
    });
    return END;
  }

  logger.info("graph: loop continuing → research", {
    iteration: state.iterationNumber,
    score: state.criticResult?.overallScore,
    threshold: state.qualityThreshold,
  });
  return "research";
}

// ─── Graph builder ────────────────────────────────────────────────────────────

export function buildResearchGraph() {
  const graph = new StateGraph(AgentStateAnnotation)
    .addNode("planner", plannerNode)
    .addNode("research", researchNode)
    .addNode("analyzer", analyzerNode)
    .addNode("critic", criticNode)
    // Linear edges
    .addEdge(START, "planner")
    .addEdge("planner", "research")
    .addEdge("research", "analyzer")
    .addEdge("analyzer", "critic")
    // Conditional loop edge: critic → research OR END
    .addConditionalEdges("critic", routeAfterCritic, {
      research: "research",
      [END]: END,
    });

  return graph.compile();
}

// ─── Initial state factory ────────────────────────────────────────────────────

export function buildInitialState(
  query: string,
  opts: {
    maxIterations?: number;
    qualityThreshold?: number;
  } = {}
): AgentState {
  // exactOptionalPropertyTypes: omit optional fields rather than setting them to undefined
  return {
    query,
    iterationNumber: 1,
    maxIterations: opts.maxIterations ?? 3,
    qualityThreshold: opts.qualityThreshold ?? 0.75,
    shouldContinue: true,
    toolCallCount: 0,
    nodeExecutionLog: [],
  } as AgentState;
}
