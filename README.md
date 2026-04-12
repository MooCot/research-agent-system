# Research Agent System

Autonomous AI research agent built on LangGraph. Implements a closed-loop reasoning machine: **Planner → Research → Analyzer → Critic → repeat until stable**.

## Architecture

```
Domain → Services → Infrastructure → API
```

```
src/
├── contracts/        ← TypeScript interfaces (domain boundary)
├── memory/           ← In-process research memory (dedup, persistence)
├── tools/            ← WebSearchTool, FetchURLTool (infrastructure)
├── observability/    ← Structured JSON logger
├── graph/
│   ├── nodes/        ← plannerNode, researchNode, analyzerNode, criticNode
│   └── stateGraph.ts ← LangGraph wiring + loop control
├── agent.ts          ← ResearchAgent API + CLI entry point
└── example.ts        ← Annotated usage example
```

### Graph flow

```
START → planner → research → analyzer → critic
                     ↑                    │
                     │   score < threshold │
                     └────────────────────┘
                                          │ score ≥ threshold
                                          │ OR max_iterations reached
                                          ↓
                                         END
```

The critic scores output on three weighted dimensions:

| Dimension | Weight | Description |
|---|---|---|
| `completeness` | 0.45 | All sub-questions addressed |
| `factual_confidence` | 0.30 | Facts backed by multiple sources |
| `structure` | 0.25 | Answer is coherent and well-organised |

If `overallScore >= qualityThreshold` → **threshold_met** exit.  
If `iterationNumber >= maxIterations` → **max_iterations_reached** + degraded mode flag.

## Requirements

- Node.js >= 20
- One of: `OPENAI_API_KEY` or `ANTHROPIC_API_KEY`
- Optional: `BRAVE_SEARCH_API_KEY` (falls back to mock results without it)

## Setup

```bash
npm install
cp .env.example .env
# fill in at minimum OPENAI_API_KEY or ANTHROPIC_API_KEY
```

## Run

```bash
# Pretty logs, example query
LOG_FORMAT=pretty npx ts-node src/example.ts

# CLI — single query
LOG_FORMAT=pretty npx ts-node src/agent.ts "What is the Mamba architecture?"

# Build and run compiled output
npm run build
node dist/agent.js "Your research query here"
```

## Programmatic API

```typescript
import { ResearchAgent } from "./src/agent";

const agent = new ResearchAgent({
  maxIterations: 3,        // hard cap on reasoning loops
  qualityThreshold: 0.75,  // critic score required to exit cleanly
});

const result = await agent.run("What are the trade-offs between RAG and fine-tuning?");

console.log(result.finalAnswer.answer);
console.log(result.finalAnswer.qualityScore);  // 0..1
console.log(result.finalAnswer.exitReason);    // "threshold_met" | "max_iterations_reached"
console.log(result.finalAnswer.degradedMode);  // true = answer is best-effort only
console.log(result.finalAnswer.sources);       // EvidencePiece[]
console.log(result.executionLog);              // per-node timing + critic scores
console.log(result.memorySnapshot);            // searches, URLs, answered sub-questions
```

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `OPENAI_API_KEY` | — | OpenAI key (used if no Anthropic key) |
| `ANTHROPIC_API_KEY` | — | Anthropic key (takes priority over OpenAI) |
| `OPENAI_MODEL` | `gpt-4o` | OpenAI model override |
| `ANTHROPIC_MODEL` | `claude-sonnet-4-6` | Anthropic model override |
| `BRAVE_SEARCH_API_KEY` | — | Brave Search key (mock results if absent) |
| `SEARCH_TIMEOUT_MS` | `8000` | Web search request timeout |
| `SEARCH_MAX_RESULTS` | `5` | Results per search query |
| `FETCH_TIMEOUT_MS` | `10000` | URL fetch request timeout |
| `FETCH_MAX_CONTENT_LEN` | `6000` | Max chars of extracted page text |
| `MAX_URLS_TO_FETCH` | `3` | Full-fetch URL cap per iteration |
| `LOG_LEVEL` | `info` | `debug` \| `info` \| `warn` \| `error` |
| `LOG_FORMAT` | `json` | `json` (for aggregators) \| `pretty` (for dev) |

## Contracts

All node transitions are typed and validated. Key interfaces:

- `PlannerOutputContract` — intent + sub-questions + search queries
- `ResearchResultContract` — deduplicated sources + tool call count
- `AnalysisResultContract` — key facts + structured answer + open sub-questions
- `CriticResultContract` — dimension scores + exit reason + focus areas for retry

See [src/contracts/index.ts](src/contracts/index.ts) for full definitions.
