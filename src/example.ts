/**
 * EXAMPLE USAGE
 * ─────────────────────────────────────────────────────────────────────────────
 * Demonstrates the ResearchAgent API with annotated output inspection.
 *
 * Run:
 *   LOG_FORMAT=pretty ts-node src/example.ts
 *
 * Requires one of:
 *   OPENAI_API_KEY=sk-...
 *   ANTHROPIC_API_KEY=sk-ant-...
 *
 * Optional:
 *   BRAVE_SEARCH_API_KEY=...   (falls back to mock results without it)
 */

import { ResearchAgent } from "./agent";

async function main() {
  const agent = new ResearchAgent({
    maxIterations: 3,
    qualityThreshold: 0.75,
  });

  // ─── Example 1: Science query ─────────────────────────────────────────────

  console.log("Running research agent...\n");

  const result = await agent.run(
    "What are the key differences between transformer and mamba architectures in large language models, and what are the trade-offs in terms of memory, speed, and performance?"
  );

  // ─── Inspect the result ───────────────────────────────────────────────────

  const { finalAnswer, executionLog, memorySnapshot } = result;

  console.log("\n═══════════════════════════════════════════════════════════════");
  console.log("  FINAL ANSWER");
  console.log("═══════════════════════════════════════════════════════════════");
  console.log(finalAnswer.answer);

  console.log("\n─── Quality metrics ────────────────────────────────────────────");
  console.log(`  Score        : ${finalAnswer.qualityScore.toFixed(3)}`);
  console.log(`  Iterations   : ${finalAnswer.iterationsUsed}`);
  console.log(`  Exit reason  : ${finalAnswer.exitReason}`);
  console.log(`  Degraded     : ${finalAnswer.degradedMode}`);
  console.log(`  Sources used : ${finalAnswer.sources.length}`);

  console.log("\n─── Sources ────────────────────────────────────────────────────");
  finalAnswer.sources.slice(0, 5).forEach((src, i) => {
    console.log(`  ${i + 1}. ${src.title}`);
    console.log(`     ${src.url}`);
  });
  if (finalAnswer.sources.length > 5) {
    console.log(`  ... and ${finalAnswer.sources.length - 5} more`);
  }

  console.log("\n─── Execution log ───────────────────────────────────────────────");
  executionLog.forEach((entry) => {
    const scoreStr = entry.criticScore !== undefined
      ? ` | critic_score=${entry.criticScore.toFixed(3)}`
      : "";
    const exitStr = entry.exitReason ? ` | exit=${entry.exitReason}` : "";
    console.log(
      `  [iter ${entry.iteration}] ${entry.node.padEnd(8)} ${entry.durationMs}ms${scoreStr}${exitStr}`
    );
  });

  console.log("\n─── Memory snapshot ─────────────────────────────────────────────");
  console.log(`  Searches performed  : ${memorySnapshot.queriedSearches.length}`);
  console.log(`  URLs fetched        : ${memorySnapshot.fetchedUrls.length}`);
  console.log(`  Sub-questions done  : ${memorySnapshot.answeredSubQuestionIds.length}`);
  console.log(`  Iterations in memory: ${memorySnapshot.iterationsCompleted}`);

  console.log("\n═══════════════════════════════════════════════════════════════\n");
}

main().catch((err: unknown) => {
  console.error("Example failed:", err);
  process.exit(1);
});
