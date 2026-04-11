/**
 * RESEARCH AGENT — PUBLIC API
 * ─────────────────────────────────────────────────────────────────────────────
 * Entry point for running a research agent run.
 * Orchestrates: memory init → graph compile → invoke → return FinalAnswer.
 *
 * Layer: API
 *
 * Usage:
 *   const agent = new ResearchAgent();
 *   const result = await agent.run("What is quantum computing?");
 */

import { ResearchMemory } from "./memory/ResearchMemory.js";
import { injectMemory } from "./graph/nodes/researchNode.js";
import { buildResearchGraph, buildInitialState } from "./graph/stateGraph.js";
import { logger } from "./observability/logger.js";
import type { FinalAnswer, NodeExecutionEntry } from "./contracts/index.js";

export interface AgentRunOptions {
  /** Maximum reasoning iterations before degraded exit. Default: 3 */
  maxIterations?: number;
  /** Quality threshold [0..1] for the critic to pass. Default: 0.75 */
  qualityThreshold?: number;
}

export interface AgentRunResult {
  finalAnswer: FinalAnswer;
  executionLog: NodeExecutionEntry[];
  memorySnapshot: ReturnType<ResearchMemory["snapshot"]>;
}

export class ResearchAgent {
  private readonly defaultOptions: Required<AgentRunOptions>;

  constructor(options: AgentRunOptions = {}) {
    this.defaultOptions = {
      maxIterations: options.maxIterations ?? 3,
      qualityThreshold: options.qualityThreshold ?? 0.75,
    };
  }

  async run(query: string, options?: AgentRunOptions): Promise<AgentRunResult> {
    const opts: Required<AgentRunOptions> = {
      maxIterations: options?.maxIterations ?? this.defaultOptions.maxIterations,
      qualityThreshold:
        options?.qualityThreshold ?? this.defaultOptions.qualityThreshold,
    };

    logger.info("ResearchAgent: run started", {
      query,
      maxIterations: opts.maxIterations,
      qualityThreshold: opts.qualityThreshold,
    });

    // Each run gets its own isolated memory instance
    const memory = new ResearchMemory();
    injectMemory(memory);

    const graph = buildResearchGraph();
    const initialState = buildInitialState(query, opts);

    let finalState: Awaited<ReturnType<typeof graph.invoke>>;

    try {
      finalState = await graph.invoke(initialState);
    } catch (err) {
      logger.error("ResearchAgent: graph execution failed", {
        query,
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }

    if (!finalState.finalAnswer) {
      // Should not happen if criticNode is correctly wired, but guard anyway
      throw new Error(
        "ResearchAgent: graph completed without producing a FinalAnswer"
      );
    }

    const result: AgentRunResult = {
      finalAnswer: finalState.finalAnswer,
      executionLog: finalState.nodeExecutionLog,
      memorySnapshot: memory.snapshot(),
    };

    this.logRunSummary(result);

    return result;
  }

  // ─── Observability summary ───────────────────────────────────────────────

  private logRunSummary(result: AgentRunResult): void {
    const fa = result.finalAnswer;
    const totalDurationMs = result.executionLog.reduce(
      (sum, e) => sum + e.durationMs,
      0
    );

    logger.info("ResearchAgent: run complete", {
      exitReason: fa.exitReason,
      degradedMode: fa.degradedMode,
      qualityScore: fa.qualityScore,
      iterationsUsed: fa.iterationsUsed,
      totalSources: fa.sources.length,
      totalToolCalls: result.memorySnapshot.storedSources.length,
      totalDurationMs,
      nodeBreakdown: result.executionLog.map((e) => ({
        node: e.node,
        iteration: e.iteration,
        durationMs: e.durationMs,
        criticScore: e.criticScore,
      })),
    });
  }
}

// ─── CLI entrypoint ──────────────────────────────────────────────────────────

if (require.main === module) {
  const query = process.argv[2];
  if (!query) {
    console.error("Usage: ts-node src/agent.ts \"<research query>\"");
    process.exit(1);
  }

  const agent = new ResearchAgent();
  agent
    .run(query)
    .then((result) => {
      console.log("\n═══════════════════════════════════════════════════════");
      console.log("FINAL ANSWER");
      console.log("═══════════════════════════════════════════════════════");
      console.log(result.finalAnswer.answer);
      console.log("\n─── Metadata ───────────────────────────────────────────");
      console.log(`Quality score : ${result.finalAnswer.qualityScore}`);
      console.log(`Iterations    : ${result.finalAnswer.iterationsUsed}`);
      console.log(`Exit reason   : ${result.finalAnswer.exitReason}`);
      console.log(`Degraded mode : ${result.finalAnswer.degradedMode}`);
      console.log(`Sources used  : ${result.finalAnswer.sources.length}`);
      console.log("═══════════════════════════════════════════════════════\n");
    })
    .catch((err: unknown) => {
      console.error("Agent run failed:", err);
      process.exit(1);
    });
}
