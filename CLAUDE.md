# CLAUDE.md — Research Agent System

## Project overview

Autonomous AI research agent using LangGraph. Closed-loop reasoning: Planner → Research → Analyzer → Critic, iterating until the critic's quality score crosses a threshold.

## Commands

```bash
npm run build          # tsc → dist/
npx tsc --noEmit       # type-check only (no output)
LOG_FORMAT=pretty npx ts-node src/example.ts   # run example
LOG_FORMAT=pretty npx ts-node src/agent.ts "query"  # CLI run
```

## Architecture rules

**Layer order: Domain → Services → Infrastructure → API. Never skip or reverse layers.**

- `contracts/` is Domain — no imports from other src/ folders allowed
- `memory/` is Domain/Service — may import contracts only
- `tools/` is Infrastructure — may import contracts and observability
- `graph/nodes/` are Service — may import contracts, memory, tools, observability
- `graph/stateGraph.ts` is Infrastructure — wires nodes, imports from graph/nodes
- `agent.ts` is API — imports from graph and memory only

## Key design decisions

**Memory injection** — `ResearchMemory` is created per-run in `agent.ts` and injected into `researchNode` via `injectMemory()`. This keeps node functions pure (testable) while sharing state across iterations. Do not make memory a module-level singleton.

**LLM selection** — If `ANTHROPIC_API_KEY` is set it takes priority over OpenAI. This logic lives in each node's `buildLLM()` helper. Do not centralise it unless adding a third provider.

**Zod validation on every LLM response** — Each node parses the LLM JSON with a Zod schema and calls a `buildFallback*()` function on failure. Never let a parse error crash the graph; degrade gracefully instead.

**exactOptionalPropertyTypes is enabled** — When assigning optional fields that may be `undefined`, use conditional spread: `...(value !== undefined ? { field: value } : {})`. Do not assign `undefined` directly to optional properties.

**Loop control lives entirely in `criticNode`** — The critic sets `shouldContinue`, `exitReason`, and `degradedMode`. The router in `stateGraph.ts` only reads `state.shouldContinue`. Do not add loop logic elsewhere.

**Degraded mode** — When `exitReason === "max_iterations_reached"`, the final answer is prefixed with `[DEGRADED MODE ...]`. This is the contract with callers; do not remove it.

## Adding a new node

1. Create `src/graph/nodes/myNode.ts` — export `async function myNode(state: AgentState): Promise<Partial<AgentState>>`
2. Add the output contract to `src/contracts/index.ts`
3. Add the node to `AgentState` in contracts
4. Add the `Annotation` channel to `AgentStateAnnotation` in `stateGraph.ts`
5. Wire with `.addNode()` and `.addEdge()` in `buildResearchGraph()`

## Adding a new tool

1. Create `src/tools/MyTool.ts` — class with a single async method returning `ToolResult<YourOutputType>`
2. Add output type to `src/tools/types.ts`
3. Instantiate once at the top of `researchNode.ts` (not inside the function)

## Observability

All structured logs go through `src/observability/logger.ts`. Use `logger.info/warn/error/debug`. Do not use `console.log` in production paths. Set `LOG_FORMAT=pretty` for dev, `LOG_FORMAT=json` for production (pipe to Datadog/Loki/CloudWatch).

Per-run summary is emitted by `ResearchAgent.logRunSummary()` after each run — includes exit reason, quality score, iteration count, total duration, and per-node timing breakdown.

## Environment

Requires Node.js >= 20, TypeScript 5.4+. At least one of `OPENAI_API_KEY` or `ANTHROPIC_API_KEY` must be set. `BRAVE_SEARCH_API_KEY` is optional — without it the search tool returns deterministic mock results suitable for development.
