/**
 * TEST FIXTURES
 * ─────────────────────────────────────────────────────────────────────────────
 * Pre-baked data matching every contract. Used by demo.ts and future unit tests.
 * All fixtures are typed against the real contracts — if a contract changes and
 * a fixture no longer compiles, the test surface immediately reports it.
 */

import type {
  PlannerOutputContract,
  ResearchResultContract,
  AnalysisResultContract,
  CriticResultContract,
  EvidencePiece,
  SubQuestion,
} from "../../src/contracts/index";

// ─── Sub-questions ────────────────────────────────────────────────────────────

export const FIXTURE_SUB_QUESTIONS: SubQuestion[] = [
  {
    id: "sq-001",
    question: "What is the Mamba architecture and how does it differ from Transformers?",
    searchQueries: ["mamba architecture state space model", "mamba vs transformer comparison"],
    priority: "high",
  },
  {
    id: "sq-002",
    question: "What are the memory and computational trade-offs of Mamba?",
    searchQueries: ["mamba memory efficiency", "mamba linear time complexity"],
    priority: "high",
  },
  {
    id: "sq-003",
    question: "What benchmarks compare Mamba performance to GPT-style models?",
    searchQueries: ["mamba benchmark results language modeling", "mamba gpt performance evaluation"],
    priority: "medium",
  },
];

// ─── Sources ──────────────────────────────────────────────────────────────────

export const FIXTURE_SOURCES: EvidencePiece[] = [
  {
    sourceId: "a1b2c3d4e5f6",
    url: "https://arxiv.org/abs/2312.00752",
    title: "Mamba: Linear-Time Sequence Modeling with Selective State Spaces",
    snippet:
      "We present Mamba, a new state space model architecture that achieves linear scaling in sequence length. " +
      "Unlike Transformers, Mamba uses selective state space models that allow the model to selectively " +
      "propagate or forget information along the sequence dimension based on the current token.",
    fetchedAt: Date.now() - 120_000,
    subQuestionId: "sq-001",
  },
  {
    sourceId: "b2c3d4e5f6a1",
    url: "https://huggingface.co/blog/mamba",
    title: "Mamba: The Easy Introduction",
    snippet:
      "Mamba achieves 5× higher throughput than Transformers at sequence length 16K. " +
      "Memory usage grows linearly with sequence length rather than quadratically. " +
      "On language modeling benchmarks, Mamba-3B outperforms Transformers of the same size.",
    fetchedAt: Date.now() - 90_000,
    subQuestionId: "sq-002",
  },
  {
    sourceId: "c3d4e5f6a1b2",
    url: "https://github.com/state-spaces/mamba",
    title: "state-spaces/mamba — Official Implementation",
    snippet:
      "Mamba is a new state space model with selective mechanisms and a hardware-aware parallel scan. " +
      "Achieves state-of-the-art performance on language, audio, and genomics benchmarks. " +
      "Inference speed is 5x faster vs Transformers on long sequences.",
    fetchedAt: Date.now() - 60_000,
    subQuestionId: "sq-003",
  },
  {
    sourceId: "d4e5f6a1b2c3",
    url: "https://magazine.sebastianraschka.com/p/a-visual-guide-to-mamba",
    title: "A Visual Guide to Mamba and State Space Models",
    snippet:
      "The key innovation in Mamba is the selective scan mechanism — a data-dependent SSM that " +
      "lets the model decide which context to retain. Unlike RNNs, training is fully parallelizable. " +
      "Unlike Transformers, inference is O(1) in memory for each new token.",
    fetchedAt: Date.now() - 30_000,
    subQuestionId: "sq-001",
  },
];

// ─── Planner fixture ──────────────────────────────────────────────────────────

export const FIXTURE_PLANNER_OUTPUT: PlannerOutputContract = {
  originalQuery:
    "What are the key differences between transformer and mamba architectures in LLMs, and what are the trade-offs?",
  intent:
    "Compare Transformer and Mamba architectures across computational complexity, memory usage, and task performance to understand when each is preferable.",
  subQuestions: FIXTURE_SUB_QUESTIONS,
  searchQueries: FIXTURE_SUB_QUESTIONS.flatMap((sq) => sq.searchQueries),
  planTimestamp: Date.now(),
};

// ─── Research fixture (iteration 1 — partial) ────────────────────────────────

export const FIXTURE_RESEARCH_RESULT_ITER1: ResearchResultContract = {
  sources: FIXTURE_SOURCES.slice(0, 2),
  totalSourcesCollected: 2,
  dedupedSourceCount: 2,
  toolCallCount: 4,
  searchQueriesUsed: ["mamba architecture state space model", "mamba memory efficiency"],
  iterationNumber: 1,
};

// ─── Research fixture (iteration 2 — full) ───────────────────────────────────

export const FIXTURE_RESEARCH_RESULT_ITER2: ResearchResultContract = {
  sources: FIXTURE_SOURCES,
  totalSourcesCollected: 4,
  dedupedSourceCount: 4,
  toolCallCount: 8,
  searchQueriesUsed: FIXTURE_SUB_QUESTIONS.flatMap((sq) => sq.searchQueries),
  iterationNumber: 2,
};

// ─── Analysis fixture (iteration 1 — incomplete) ────────────────────────────

export const FIXTURE_ANALYSIS_RESULT_ITER1: AnalysisResultContract = {
  summary:
    "Mamba is an SSM-based architecture with linear complexity that outperforms Transformers on long sequences. " +
    "Initial evidence covers architecture and memory trade-offs but benchmark comparisons are still incomplete.",
  keyFacts: [
    {
      claim: "Mamba scales linearly with sequence length vs. quadratic scaling in Transformers.",
      supportingSourceIds: ["a1b2c3d4e5f6", "b2c3d4e5f6a1"],
      confidence: "high",
    },
    {
      claim: "Mamba achieves 5× higher inference throughput than Transformers at 16K sequence length.",
      supportingSourceIds: ["b2c3d4e5f6a1"],
      confidence: "medium",
    },
    {
      claim: "Mamba uses selective state space models to propagate or forget information dynamically.",
      supportingSourceIds: ["a1b2c3d4e5f6"],
      confidence: "high",
    },
  ],
  addressedSubQuestions: ["sq-001", "sq-002"],
  unansweredSubQuestions: ["sq-003"],
  structuredAnswer:
    "Mamba is a state space model (SSM) architecture introduced as an alternative to Transformers for sequence modeling. " +
    "The core difference lies in computational complexity: Transformers require O(n²) compute and memory for attention, " +
    "while Mamba operates in O(n) linear time using selective state space models. " +
    "In terms of memory efficiency, Mamba's inference is O(1) per token, making it dramatically more efficient " +
    "on long sequences. However, benchmark data comparing Mamba against GPT-style models across diverse tasks " +
    "requires further research to complete the picture.",
};

// ─── Analysis fixture (iteration 2 — complete) ───────────────────────────────

export const FIXTURE_ANALYSIS_RESULT_ITER2: AnalysisResultContract = {
  summary:
    "Mamba is an SSM architecture with linear-time complexity, superior memory efficiency, and competitive " +
    "performance against Transformers of equal parameter count, with 5× inference speed advantage on long sequences.",
  keyFacts: [
    {
      claim: "Mamba scales linearly with sequence length vs. quadratic in Transformers.",
      supportingSourceIds: ["a1b2c3d4e5f6", "b2c3d4e5f6a1"],
      confidence: "high",
    },
    {
      claim: "Mamba achieves 5× higher inference throughput than Transformers at sequence length 16K.",
      supportingSourceIds: ["b2c3d4e5f6a1", "c3d4e5f6a1b2"],
      confidence: "high",
    },
    {
      claim: "Mamba-3B outperforms Transformer models of the same parameter count on language modeling benchmarks.",
      supportingSourceIds: ["b2c3d4e5f6a1"],
      confidence: "medium",
    },
    {
      claim: "Mamba training is fully parallelizable unlike RNNs, while inference is O(1) in memory per token.",
      supportingSourceIds: ["d4e5f6a1b2c3"],
      confidence: "high",
    },
    {
      claim: "Selective scan mechanism allows Mamba to decide dynamically which context to retain.",
      supportingSourceIds: ["a1b2c3d4e5f6", "d4e5f6a1b2c3"],
      confidence: "high",
    },
  ],
  addressedSubQuestions: ["sq-001", "sq-002", "sq-003"],
  unansweredSubQuestions: [],
  structuredAnswer:
    "Mamba is a state space model (SSM) architecture that fundamentally differs from Transformers in how it " +
    "handles sequential context. Transformers use self-attention with O(n²) time and memory complexity, " +
    "making them expensive on long sequences. Mamba replaces attention with selective state space models " +
    "that process sequences in linear O(n) time.\n\n" +
    "Key trade-offs:\n" +
    "- **Speed**: Mamba achieves 5× higher inference throughput at sequence length 16K, with O(1) memory per token.\n" +
    "- **Training**: Both architectures are fully parallelizable during training — unlike RNNs.\n" +
    "- **Performance**: Mamba-3B matches or outperforms GPT-style Transformers of equal size on language modeling.\n" +
    "- **Context selection**: Mamba's selective scan lets the model dynamically decide which context to retain, " +
    "which works well for sequences with sparse relevant information.\n" +
    "- **Weakness**: Transformers still have advantages in tasks requiring dense cross-token attention patterns " +
    "and benefit from extensive CUDA optimization ecosystems.",
};

// ─── Critic fixture (iteration 1 — below threshold) ─────────────────────────

export const FIXTURE_CRITIC_RESULT_ITER1: CriticResultContract = {
  overallScore: 0.61,
  dimensions: [
    {
      name: "completeness",
      score: 0.55,
      reasoning: "Sub-question sq-003 (benchmarks) is unanswered. Two of three questions addressed.",
    },
    {
      name: "structure",
      score: 0.75,
      reasoning: "Answer is well-structured with clear trade-off framing, but lacks concrete benchmark data.",
    },
    {
      name: "factual_confidence",
      score: 0.60,
      reasoning: "Core claims are backed by multiple sources. Benchmark claim has only one source.",
    },
  ],
  passed: false,
  iterationNumber: 1,
  scoringReasoning:
    "The answer covers architecture and memory trade-offs well but misses benchmark comparison data. " +
    "A second research iteration targeting performance benchmarks should close the gap.",
  suggestedFocusAreas: [
    "Mamba vs Transformer benchmark results on language modeling tasks",
    "Mamba performance on downstream NLP tasks (summarization, QA, coding)",
  ],
  degradedMode: false,
};

// ─── Critic fixture (iteration 2 — passes threshold) ────────────────────────

export const FIXTURE_CRITIC_RESULT_ITER2: CriticResultContract = {
  overallScore: 0.83,
  dimensions: [
    {
      name: "completeness",
      score: 0.90,
      reasoning: "All three sub-questions fully addressed with concrete evidence.",
    },
    {
      name: "structure",
      score: 0.80,
      reasoning: "Clear structure with bullet-point trade-offs. Well-organised prose.",
    },
    {
      name: "factual_confidence",
      score: 0.78,
      reasoning: "Most claims backed by 2+ sources. Performance benchmarks still from limited sources.",
    },
  ],
  passed: true,
  iterationNumber: 2,
  scoringReasoning:
    "All sub-questions are now addressed. The answer provides a complete, evidence-backed comparison " +
    "of Transformer vs Mamba with concrete speed, memory, and performance trade-offs.",
  suggestedFocusAreas: [],
  exitReason: "threshold_met",
  degradedMode: false,
};
