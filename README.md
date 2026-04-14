# Research Agent System

Autonomous AI research agent built on LangGraph. Implements a closed-loop reasoning machine: **Planner → Research → Analyzer → Critic → repeat until stable**.

## Quick Start

```bash
# 1. Clone and install
git clone https://github.com/MooCot/research-agent-system.git
cd research-agent-system
npm install

# 2. Configure — copy the template and add at least one LLM key
cp .env.example .env
# open .env and set OPENAI_API_KEY or ANTHROPIC_API_KEY

# 3. Run — ask any research question
LOG_FORMAT=pretty npx ts-node src/agent.ts "What is the Mamba architecture?"
```

That's it. No database, no Docker, no build step required for dev.

> **No search API key?** Leave `BRAVE_SEARCH_API_KEY` empty — the agent runs on deterministic mock results, which is enough to verify the full loop locally.

**Output example:**
```
═══════════════════════════════════════════════════════
FINAL ANSWER
═══════════════════════════════════════════════════════
Mamba is a state space model (SSM) architecture...

─── Metadata ───────────────────────────────────────────
Quality score : 0.812
Iterations    : 2
Exit reason   : threshold_met
Degraded mode : false
Sources used  : 7
═══════════════════════════════════════════════════════
```

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
- One of: `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, or `DASHSCOPE_API_KEY`
- Optional: `BRAVE_SEARCH_API_KEY` (falls back to mock results without it)

## Setup

```bash
npm install
cp .env.example .env
# fill in at minimum one of: OPENAI_API_KEY / ANTHROPIC_API_KEY / DASHSCOPE_API_KEY
```

## Run

```bash
# Zero API keys — full loop on fixture data (demo mode)
npm run demo

# Pretty logs, annotated example query (requires LLM key)
LOG_FORMAT=pretty npx ts-node src/example.ts

# CLI — single query (requires LLM key)
LOG_FORMAT=pretty npx ts-node src/agent.ts "What is the Mamba architecture?"

# Build and run compiled output
npm run build
node dist/agent.js "Your research query here"
```

### Demo mode

`npm run demo` runs the complete Planner → Research → Analyzer → Critic loop **without any API keys** using pre-baked fixture data. It shows two full iterations — the critic rejects the first pass (score 0.61 < threshold) and approves the second (score 0.83) — with realistic timing and annotated output.

```
════════════════════════════════════════════════════════════════
  RESEARCH AGENT DEMO  (no API keys required)
════════════════════════════════════════════════════════════════
  Query: "What are the key differences between transformer..."
  Max iterations : 3   |   Quality threshold : 0.75
────────────────────────────────────────────────────────────────

  [planner]  decomposing query... done
  [research] iteration 1 — calling tools.... done
  [analyzer] iteration 1 — synthesising evidence... done
  [critic]   iteration 1 — scoring output... ✗  score=0.61
  [research] iteration 2 — calling tools.... done
  [analyzer] iteration 2 — synthesising evidence... done
  [critic]   iteration 2 — scoring output... ✓  score=0.83

════════════════════════════════════════════════════════════════
  FINAL ANSWER
════════════════════════════════════════════════════════════════
Mamba is a state space model (SSM) architecture...

  QUALITY METRICS
  Score      [█████████████████████████░░░░░]  0.830
  Iterations 2 / 3
  Exit       threshold_met

  Dimension breakdown (final iteration):
    completeness         [██████████████████░░]  0.90
    structure            [████████████████░░░░]  0.80
    factual_confidence   [███████████████░░░░░]  0.78
════════════════════════════════════════════════════════════════
```

The fixtures live in [src/fixtures/index.ts](src/fixtures/index.ts) — typed against real contracts, so any contract change that breaks a fixture will surface immediately at compile time.

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
| `OPENAI_API_KEY` | — | OpenAI key (lowest priority) |
| `ANTHROPIC_API_KEY` | — | Anthropic key (highest priority) |
| `DASHSCOPE_API_KEY` | — | Alibaba Cloud / Qwen key (priority between Anthropic and OpenAI) |
| `OPENAI_MODEL` | `gpt-4o` | OpenAI model override |
| `ANTHROPIC_MODEL` | `claude-sonnet-4-6` | Anthropic model override |
| `DASHSCOPE_MODEL` | `qwen-plus` | DashScope model override (`qwen-turbo` / `qwen-plus` / `qwen-max` / `qwen-long`) |
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

## Test fixtures

Pre-baked data in [src/fixtures/index.ts](src/fixtures/index.ts) covers every contract across two iterations:

| Export | Contract | Iteration | State |
|---|---|---|---|
| `FIXTURE_PLANNER_OUTPUT` | `PlannerOutputContract` | — | 3 sub-questions, 6 search queries |
| `FIXTURE_RESEARCH_RESULT_ITER1` | `ResearchResultContract` | 1 | 2 sources, 4 tool calls |
| `FIXTURE_RESEARCH_RESULT_ITER2` | `ResearchResultContract` | 2 | 4 sources, 8 tool calls |
| `FIXTURE_ANALYSIS_RESULT_ITER1` | `AnalysisResultContract` | 1 | 2/3 sub-questions answered |
| `FIXTURE_ANALYSIS_RESULT_ITER2` | `AnalysisResultContract` | 2 | all sub-questions answered |
| `FIXTURE_CRITIC_RESULT_ITER1` | `CriticResultContract` | 1 | score=0.61, loop continues |
| `FIXTURE_CRITIC_RESULT_ITER2` | `CriticResultContract` | 2 | score=0.83, threshold_met |

All fixtures are typed against real contracts — a contract change that breaks a fixture surfaces at compile time, not at runtime.
