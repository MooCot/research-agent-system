/**
 * DEMO SCRIPT — zero API keys required
 * ─────────────────────────────────────────────────────────────────────────────
 * Runs the full Planner → Research → Analyzer → Critic loop using fixture data
 * instead of live LLM calls. The research node still runs (mock search tool),
 * and ResearchMemory operates normally — so dedup, source tracking, and loop
 * control all behave identically to production.
 *
 * Run:
 *   npx ts-node src/demo.ts
 *   LOG_FORMAT=pretty npx ts-node src/demo.ts
 */

import {
  StateGraph,
  Annotation,
  END,
  START,
} from "@langchain/langgraph";

import type {
  PlannerOutputContract,
  ResearchResultContract,
  AnalysisResultContract,
  CriticResultContract,
  FinalAnswer,
  NodeExecutionEntry,
  AgentState,
} from "./contracts/index.js";

import { ResearchMemory } from "./memory/ResearchMemory.js";
import { injectMemory } from "./graph/nodes/researchNode.js";
import { logger } from "./observability/logger.js";

import {
  FIXTURE_PLANNER_OUTPUT,
  FIXTURE_RESEARCH_RESULT_ITER1,
  FIXTURE_RESEARCH_RESULT_ITER2,
  FIXTURE_ANALYSIS_RESULT_ITER1,
  FIXTURE_ANALYSIS_RESULT_ITER2,
  FIXTURE_CRITIC_RESULT_ITER1,
  FIXTURE_CRITIC_RESULT_ITER2,
} from "./fixtures/index.js";

// ─── Demo query ───────────────────────────────────────────────────────────────

const DEMO_QUERY =
  "What are the key differences between transformer and mamba architectures in LLMs, and what are the trade-offs?";

// ─── Simulated latency (makes output feel realistic) ─────────────────────────

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ─── Mock node implementations ────────────────────────────────────────────────

async function mockPlannerNode(
  state: AgentState
): Promise<Partial<AgentState>> {
  const startMs = Date.now();
  process.stdout.write("  [planner]  decomposing query");
  for (let i = 0; i < 3; i++) { await delay(300); process.stdout.write("."); }
  console.log(" done");

  await delay(200);

  const plannerOutput: PlannerOutputContract = {
    ...FIXTURE_PLANNER_OUTPUT,
    planTimestamp: Date.now(),
  };

  return {
    plannerOutput,
    nodeExecutionLog: [
      ...state.nodeExecutionLog,
      { node: "planner", iteration: state.iterationNumber, durationMs: Date.now() - startMs, timestamp: Date.now() },
    ],
  };
}

async function mockResearchNode(
  state: AgentState
): Promise<Partial<AgentState>> {
  const startMs = Date.now();
  const iter = state.iterationNumber;
  process.stdout.write(`  [research] iteration ${iter} — calling tools`);
  for (let i = 0; i < 4; i++) { await delay(250); process.stdout.write("."); }
  console.log(" done");

  await delay(150);

  const memory = getMemory();

  // Register sources into memory so ResearchMemory dedup works correctly
  const fixture = iter === 1 ? FIXTURE_RESEARCH_RESULT_ITER1 : FIXTURE_RESEARCH_RESULT_ITER2;
  for (const src of fixture.sources) {
    memory.addSource(src);
    memory.markUrlFetched(src.url);
  }
  for (const q of (state.plannerOutput?.searchQueries ?? [])) {
    memory.markSearchQueried(q);
  }

  const researchResult: ResearchResultContract = {
    ...fixture,
    iterationNumber: iter,
  };

  return {
    researchResult,
    toolCallCount: state.toolCallCount + fixture.toolCallCount,
    nodeExecutionLog: [
      ...state.nodeExecutionLog,
      { node: "research", iteration: iter, durationMs: Date.now() - startMs, timestamp: Date.now() },
    ],
  };
}

async function mockAnalyzerNode(
  state: AgentState
): Promise<Partial<AgentState>> {
  const startMs = Date.now();
  const iter = state.iterationNumber;
  process.stdout.write(`  [analyzer] iteration ${iter} — synthesising evidence`);
  for (let i = 0; i < 3; i++) { await delay(350); process.stdout.write("."); }
  console.log(" done");

  await delay(200);

  const analysisResult: AnalysisResultContract =
    iter === 1 ? FIXTURE_ANALYSIS_RESULT_ITER1 : FIXTURE_ANALYSIS_RESULT_ITER2;

  return {
    analysisResult,
    nodeExecutionLog: [
      ...state.nodeExecutionLog,
      { node: "analyzer", iteration: iter, durationMs: Date.now() - startMs, timestamp: Date.now() },
    ],
  };
}

async function mockCriticNode(
  state: AgentState
): Promise<Partial<AgentState>> {
  const startMs = Date.now();
  const iter = state.iterationNumber;
  process.stdout.write(`  [critic]   iteration ${iter} — scoring output`);
  for (let i = 0; i < 3; i++) { await delay(300); process.stdout.write("."); }

  const criticResult: CriticResultContract =
    iter === 1 ? FIXTURE_CRITIC_RESULT_ITER1 : FIXTURE_CRITIC_RESULT_ITER2;

  const icon = criticResult.passed ? "✓" : "✗";
  console.log(` ${icon}  score=${criticResult.overallScore}`);

  const memory = getMemory();
  memory.incrementIteration();

  let finalAnswer: FinalAnswer | undefined;
  const shouldContinue = !criticResult.passed && iter < 3;

  if (!shouldContinue) {
    finalAnswer = {
      query: state.query,
      answer: criticResult.degradedMode
        ? `[DEGRADED MODE — score ${criticResult.overallScore} below threshold]\n\n${state.analysisResult!.structuredAnswer}`
        : state.analysisResult!.structuredAnswer,
      sources: memory.getSources(),
      qualityScore: criticResult.overallScore,
      iterationsUsed: iter,
      exitReason: criticResult.exitReason ?? "threshold_met",
      degradedMode: criticResult.degradedMode,
      completedAt: Date.now(),
    };
  }

  return {
    criticResult,
    shouldContinue,
    iterationNumber: shouldContinue ? iter + 1 : iter,
    ...(finalAnswer !== undefined ? { finalAnswer } : {}),
    nodeExecutionLog: [
      ...state.nodeExecutionLog,
      {
        node: "critic",
        iteration: iter,
        durationMs: Date.now() - startMs,
        criticScore: criticResult.overallScore,
        ...(criticResult.exitReason !== undefined ? { exitReason: criticResult.exitReason } : {}),
        timestamp: Date.now(),
      },
    ],
  };
}

// ─── Memory accessor (mirrors researchNode pattern) ──────────────────────────

let _demoMemory: ResearchMemory | null = null;
function getMemory(): ResearchMemory {
  if (!_demoMemory) throw new Error("Demo memory not initialised");
  return _demoMemory;
}

// ─── Graph wiring (same topology as production) ───────────────────────────────

const DemoStateAnnotation = Annotation.Root({
  query: Annotation<string>(),
  iterationNumber: Annotation<number>(),
  maxIterations: Annotation<number>(),
  qualityThreshold: Annotation<number>(),
  plannerOutput: Annotation<PlannerOutputContract | undefined>(),
  researchResult: Annotation<ResearchResultContract | undefined>(),
  analysisResult: Annotation<AnalysisResultContract | undefined>(),
  criticResult: Annotation<CriticResultContract | undefined>(),
  finalAnswer: Annotation<FinalAnswer | undefined>(),
  shouldContinue: Annotation<boolean>(),
  toolCallCount: Annotation<number>(),
  nodeExecutionLog: Annotation<NodeExecutionEntry[]>({
    reducer: (a: NodeExecutionEntry[], b: NodeExecutionEntry[]) => [...a, ...b],
    default: () => [],
  }),
});

function buildDemoGraph() {
  return new StateGraph(DemoStateAnnotation)
    .addNode("planner", mockPlannerNode)
    .addNode("research", mockResearchNode)
    .addNode("analyzer", mockAnalyzerNode)
    .addNode("critic", mockCriticNode)
    .addEdge(START, "planner")
    .addEdge("planner", "research")
    .addEdge("research", "analyzer")
    .addEdge("analyzer", "critic")
    .addConditionalEdges(
      "critic",
      (s) => (s.shouldContinue ? "research" : END),
      { research: "research", [END]: END }
    )
    .compile();
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const W = 62;
  const line = "═".repeat(W);
  const thin = "─".repeat(W);

  console.log(`\n${line}`);
  console.log("  RESEARCH AGENT DEMO  (no API keys required)");
  console.log(line);
  console.log(`  Query: "${DEMO_QUERY.slice(0, 55)}..."`);
  console.log(`  Max iterations : 3   |   Quality threshold : 0.75`);
  console.log(`${thin}\n`);

  // Init memory
  _demoMemory = new ResearchMemory();
  injectMemory(_demoMemory);

  const graph = buildDemoGraph();
  const startMs = Date.now();

  const finalState = await graph.invoke({
    query: DEMO_QUERY,
    iterationNumber: 1,
    maxIterations: 3,
    qualityThreshold: 0.75,
    shouldContinue: true,
    toolCallCount: 0,
    nodeExecutionLog: [],
  } as AgentState);

  const totalMs = Date.now() - startMs;
  const fa = finalState.finalAnswer!;

  // ─── Final answer ──────────────────────────────────────────────────────────

  console.log(`\n${line}`);
  console.log("  FINAL ANSWER");
  console.log(line);
  console.log(fa.answer);

  // ─── Metrics ───────────────────────────────────────────────────────────────

  console.log(`\n${thin}`);
  console.log("  QUALITY METRICS");
  console.log(thin);

  const scoreBar = renderBar(fa.qualityScore, 30);
  console.log(`  Score      ${scoreBar}  ${fa.qualityScore.toFixed(3)}`);
  console.log(`  Iterations ${fa.iterationsUsed} / 3`);
  console.log(`  Exit       ${fa.exitReason}`);
  console.log(`  Degraded   ${fa.degradedMode}`);
  console.log(`  Duration   ${totalMs}ms total`);

  // ─── Critic dimension breakdown ────────────────────────────────────────────

  const finalCritic = finalState.criticResult!;
  console.log(`\n  Dimension breakdown (final iteration):`);
  for (const dim of finalCritic.dimensions) {
    const bar = renderBar(dim.score, 20);
    console.log(`    ${dim.name.padEnd(20)} ${bar}  ${dim.score.toFixed(2)}`);
  }

  // ─── Key facts ─────────────────────────────────────────────────────────────

  console.log(`\n${thin}`);
  console.log("  KEY FACTS EXTRACTED");
  console.log(thin);
  const facts = finalState.analysisResult!.keyFacts;
  for (const f of facts) {
    const conf = f.confidence === "high" ? "●" : f.confidence === "medium" ? "◐" : "○";
    console.log(`  ${conf}  ${f.claim}`);
  }

  // ─── Sources ───────────────────────────────────────────────────────────────

  console.log(`\n${thin}`);
  console.log(`  SOURCES (${fa.sources.length} collected)`);
  console.log(thin);
  for (const src of fa.sources) {
    console.log(`  · ${src.title}`);
    console.log(`    ${src.url}`);
  }

  // ─── Execution log ─────────────────────────────────────────────────────────

  console.log(`\n${thin}`);
  console.log("  EXECUTION LOG");
  console.log(thin);
  for (const entry of finalState.nodeExecutionLog) {
    const scoreStr = entry.criticScore !== undefined
      ? `  critic_score=${entry.criticScore.toFixed(3)}`
      : "";
    const exitStr = entry.exitReason ? `  exit=${entry.exitReason}` : "";
    console.log(
      `  [iter ${entry.iteration}] ${entry.node.padEnd(9)} ${String(entry.durationMs).padStart(5)}ms${scoreStr}${exitStr}`
    );
  }

  // ─── Memory snapshot ───────────────────────────────────────────────────────

  const snap = _demoMemory!.snapshot();
  console.log(`\n${thin}`);
  console.log("  MEMORY SNAPSHOT");
  console.log(thin);
  console.log(`  Searches performed : ${snap.queriedSearches.length}`);
  console.log(`  URLs tracked       : ${snap.fetchedUrls.length}`);
  console.log(`  Sources stored     : ${snap.storedSources.length}`);
  console.log(`  Iterations         : ${snap.iterationsCompleted}`);

  console.log(`\n${line}\n`);

  logger.info("demo: complete", {
    exitReason: fa.exitReason,
    qualityScore: fa.qualityScore,
    iterationsUsed: fa.iterationsUsed,
    totalMs,
  });
}

function renderBar(value: number, width: number): string {
  const filled = Math.round(value * width);
  return "[" + "█".repeat(filled) + "░".repeat(width - filled) + "]";
}

main().catch((err: unknown) => {
  console.error("Demo failed:", err);
  process.exit(1);
});
