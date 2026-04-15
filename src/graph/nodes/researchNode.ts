/**
 * RESEARCH NODE  (external grounding layer)
 * ─────────────────────────────────────────────────────────────────────────────
 * Executes tool calls (WebSearch + FetchURL) against the plan's search queries.
 * Deduplicates sources using memory before emitting.
 *
 * Layer: Service
 *
 * Invariants:
 *  - No query is searched twice (memory.hasSearchedQuery).
 *  - No URL is fetched twice (memory.hasFetchedUrl).
 *  - Every source gets a stable sourceId (URL hash).
 *  - Errors from tools are logged but do NOT abort the node.
 */

import type {
  AgentState,
  ResearchResultContract,
  EvidencePiece,
} from "../../contracts/index";
import { ResearchMemory } from "../../memory/ResearchMemory";
import { WebSearchTool } from "../../tools/WebSearchTool";
import { FetchURLTool } from "../../tools/FetchURLTool";
import { logger } from "../../observability/logger";

// Shared across the agent run — injected via module-level singleton
// (LangGraph nodes are functions; state for cross-node services is passed in)
let _memory: ResearchMemory | null = null;

export function injectMemory(memory: ResearchMemory): void {
  _memory = memory;
}

export function getMemory(): ResearchMemory {
  if (!_memory) throw new Error("ResearchMemory not injected");
  return _memory;
}

// Tool instances (constructed once, reused)
const searchTool = new WebSearchTool();
const fetchTool = new FetchURLTool();

// Max URLs to fully fetch per iteration (cost + latency control)
const MAX_URLS_TO_FETCH = parseInt(process.env.MAX_URLS_TO_FETCH ?? "3", 10);

export async function researchNode(
  state: AgentState
): Promise<Partial<AgentState>> {
  const startMs = Date.now();
  const memory = getMemory();
  const plan = state.plannerOutput;

  if (!plan) {
    throw new Error("researchNode: plannerOutput is missing from state");
  }

  logger.info("researchNode: starting", {
    iteration: state.iterationNumber,
    queriesInPlan: plan.searchQueries.length,
  });

  const newSources: EvidencePiece[] = [];
  let toolCallCount = state.toolCallCount;

  // ─── Step 1: Execute web searches ─────────────────────────────────────────

  const urlsToFetch: { url: string; title: string; subQuestionId?: string }[] = [];

  for (const subQuestion of plan.subQuestions) {
    // Skip sub-questions already answered in a previous iteration
    if (memory.isSubQuestionAnswered(subQuestion.id)) {
      logger.debug("researchNode: sub-question already answered, skipping", {
        subQuestionId: subQuestion.id,
      });
      continue;
    }

    for (const query of subQuestion.searchQueries) {
      if (memory.hasSearchedQuery(query)) {
        logger.debug("researchNode: duplicate query, skipping", { query });
        continue;
      }

      memory.markSearchQueried(query);
      toolCallCount++;

      const result = await searchTool.search(query);

      if (!result.ok || !result.data) {
        logger.warn("researchNode: search failed", { query, error: result.error });
        continue;
      }

      for (const sr of result.data.results) {
        if (!memory.hasFetchedUrl(sr.url)) {
          urlsToFetch.push({
            url: sr.url,
            title: sr.title,
            subQuestionId: subQuestion.id,
          });
        }

        // Always add snippet as lightweight evidence (even if we skip full fetch)
        const evidencePiece: EvidencePiece = {
          sourceId: memory.urlHash(sr.url),
          url: sr.url,
          title: sr.title,
          snippet: sr.snippet,
          fetchedAt: Date.now(),
          subQuestionId: subQuestion.id,  // always defined here
        };
        memory.addSource(evidencePiece);
        newSources.push(evidencePiece);
      }
    }
  }

  // ─── Step 2: Full-fetch top URLs (enriches snippets with page content) ────

  const fetchCandidates = urlsToFetch.slice(0, MAX_URLS_TO_FETCH);

  for (const candidate of fetchCandidates) {
    if (memory.hasFetchedUrl(candidate.url)) continue;

    memory.markUrlFetched(candidate.url);
    toolCallCount++;

    const result = await fetchTool.fetch(candidate.url);

    if (!result.ok || !result.data) {
      logger.warn("researchNode: fetch failed", {
        url: candidate.url,
        error: result.error,
      });
      continue;
    }

    // Overwrite snippet with richer extracted content
    const enriched: EvidencePiece = {
      sourceId: memory.urlHash(candidate.url),
      url: candidate.url,
      title: result.data.title,
      snippet: result.data.content.slice(0, 1500), // bounded snippet
      fetchedAt: Date.now(),
      // exactOptionalPropertyTypes: only include when defined
      ...(candidate.subQuestionId !== undefined
        ? { subQuestionId: candidate.subQuestionId }
        : {}),
    };
    memory.addSource(enriched); // replaces prior snippet-only entry
  }

  // ─── Step 3: Assemble output ──────────────────────────────────────────────

  const allSources = memory.getSources();

  const researchResult: ResearchResultContract = {
    sources: allSources,
    totalSourcesCollected: allSources.length,
    dedupedSourceCount: allSources.length, // memory already dedupes
    toolCallCount,
    searchQueriesUsed: plan.searchQueries,
    iterationNumber: state.iterationNumber,
  };

  const durationMs = Date.now() - startMs;

  logger.info("researchNode: complete", {
    iteration: state.iterationNumber,
    totalSources: researchResult.totalSourcesCollected,
    newSourcesThisIteration: newSources.length,
    toolCalls: toolCallCount,
    durationMs,
  });

  return {
    researchResult,
    toolCallCount,
    nodeExecutionLog: [{
        node: "research",
        iteration: state.iterationNumber,
        durationMs,
        timestamp: Date.now(),
      }],
  };
}
