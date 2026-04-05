/**
 * DOMAIN CONTRACTS
 * ─────────────────────────────────────────────────────────────────────────────
 * All node outputs must conform to these interfaces before state transitions.
 * No node may emit unvalidated data. Contracts are the boundary between nodes.
 *
 * Layer: Domain
 */

// ─── Sub-question produced by the planner ────────────────────────────────────

export interface SubQuestion {
  id: string;
  question: string;
  searchQueries: string[];
  priority: "high" | "medium" | "low";
}

// ─── Planner → Research ──────────────────────────────────────────────────────

export interface PlannerOutputContract {
  originalQuery: string;
  intent: string;
  subQuestions: SubQuestion[];
  searchQueries: string[];   // flat list for the research node
  planTimestamp: number;
}

// ─── Individual evidence piece collected by the research node ────────────────

export interface EvidencePiece {
  sourceId: string;          // stable hash of URL
  url: string;
  title: string;
  snippet: string;
  fetchedAt: number;
  subQuestionId?: string;    // which sub-question this answers
}

// ─── Research → Analyzer ─────────────────────────────────────────────────────

export interface ResearchResultContract {
  sources: EvidencePiece[];
  totalSourcesCollected: number;
  dedupedSourceCount: number;
  toolCallCount: number;
  searchQueriesUsed: string[];
  iterationNumber: number;
}

// ─── Key fact extracted from evidence ────────────────────────────────────────

export interface KeyFact {
  claim: string;
  supportingSourceIds: string[];
  confidence: "high" | "medium" | "low";
}

// ─── Analyzer → Critic ───────────────────────────────────────────────────────

export interface AnalysisResultContract {
  summary: string;
  keyFacts: KeyFact[];
  addressedSubQuestions: string[];   // IDs from plan
  unansweredSubQuestions: string[];  // IDs still open
  structuredAnswer: string;          // prose answer for the critic to evaluate
}

// ─── Critic scoring dimensions ────────────────────────────────────────────────

export interface CriticDimension {
  name: "completeness" | "structure" | "factual_confidence";
  score: number;       // 0..1
  reasoning: string;
}

// ─── Loop exit modes ─────────────────────────────────────────────────────────

export type ExitReason =
  | "threshold_met"
  | "max_iterations_reached"
  | "explicit_stop";

// ─── Critic → loop router ────────────────────────────────────────────────────

export interface CriticResultContract {
  overallScore: number;        // 0..1  (weighted average of dimensions)
  dimensions: CriticDimension[];
  passed: boolean;             // overallScore >= threshold
  iterationNumber: number;
  scoringReasoning: string;
  suggestedFocusAreas: string[]; // fed back to the research node on retry
  exitReason?: ExitReason;     // set only when loop terminates
  degradedMode: boolean;
}

// ─── Final answer envelope ────────────────────────────────────────────────────

export interface FinalAnswer {
  query: string;
  answer: string;
  sources: EvidencePiece[];
  qualityScore: number;
  iterationsUsed: number;
  exitReason: ExitReason;
  degradedMode: boolean;
  completedAt: number;
}

// ─── Full agent graph state (S in S→O→C→κ) ───────────────────────────────────

export interface AgentState {
  // Input
  query: string;

  // Iteration bookkeeping
  iterationNumber: number;
  maxIterations: number;
  qualityThreshold: number;

  // Node outputs (accumulated across iterations)
  plannerOutput?: PlannerOutputContract;
  researchResult?: ResearchResultContract;
  analysisResult?: AnalysisResultContract;
  criticResult?: CriticResultContract;

  // Termination
  finalAnswer?: FinalAnswer;
  shouldContinue: boolean;

  // Observability
  toolCallCount: number;
  nodeExecutionLog: NodeExecutionEntry[];
}

export interface NodeExecutionEntry {
  node: "planner" | "research" | "analyzer" | "critic";
  iteration: number;
  durationMs: number;
  criticScore?: number;
  exitReason?: ExitReason;
  timestamp: number;
}
