import { AlgorithmConfig, NetworkInput, SimulationResult } from "./network";

// ── Challenge meta types ──────────────────────────────────────────────────────

export type ChallengeType =
  | "REDUCE_CONGESTION"
  | "FIND_ECMP_WEIGHTS"
  | "IDENTIFY_CONGESTED_LINKS"
  | "COMPUTE_ECMP_SPLIT"
  | "COMPUTE_DV_TABLE"
  | "PREDICT_SHORTEST_PATH";

export type ChallengeDifficulty = "beginner" | "intermediate" | "advanced";

export type LearningObjective =
  | "ECMP"
  | "Distance Vector"
  | "Congestion"
  | "Shortest Path"
  | "Link Weights"
  | "Capacity"
  | "Traffic Engineering";

export type SolutionVisibility =
  | "immediately"
  | "after_correct"
  | "never"
  | "after_deadline";

export type EditableField = "weights" | "capacities" | "demands" | "topology" | "algorithm";

// ── Challenge target (expected outcome) ───────────────────────────────────────

export interface ChallengeTarget {
  maxUtilizationBelow?: number;
  congestedLinks?: string[];
  expectedPaths?: { demandId: string; pathNodes: string[]; trafficShare: number }[];
  expectedTrafficSplits?: Record<string, number>;
  expectedDVEntries?: { nodeId: string; destinationId: string; cost: number; nextHop: string | null }[];
}

// ── Hint ─────────────────────────────────────────────────────────────────────

export interface Hint {
  hintId: string;
  level: "conceptual" | "calculation" | "solution_direction";
  title: string;
  text: string;
  relatedNodeIds: string[];
  relatedLinkIds: string[];
  revealCostPenalty: number; // 0–100: percentage points deducted from final score
}

// ── Challenge configuration ───────────────────────────────────────────────────

export interface ChallengeConfig {
  challengeType: ChallengeType;
  difficulty: ChallengeDifficulty;
  learningObjectives: LearningObjective[];
  expectedTimeMinutes: number;
  maxAttempts: number;
  showOfficialSolution: SolutionVisibility;
  editableFields: EditableField[];
  target: ChallengeTarget;
  hints: Hint[];
}

// ── Structured feedback ───────────────────────────────────────────────────────

export interface FeedbackItem {
  type: "success" | "warning" | "error" | "info";
  title: string;
  message: string;
  explanation?: string;
  relatedNodeIds: string[];
  relatedLinkIds: string[];
  relatedDemandIds: string[];
  expectedValue?: unknown;
  receivedValue?: unknown;
  formula?: string;
  workedExample?: string;
}

// ── Grading result ────────────────────────────────────────────────────────────

export interface ChallengeGradingResult {
  isCorrect: boolean;
  score: number;
  maxScore: number;
  percentage: number;
  attemptNumber: number;
  hintsUsed: number;
  feedbackItems: FeedbackItem[];
  summary: string;
  nextSuggestion: string;
  expected?: unknown;
  received?: unknown;
  simulationRunId?: string;
  highlightedNodes: string[];
  highlightedLinks: { linkId: string; status: "correct" | "wrong" | "missed" }[];
}

// ── Attempt ───────────────────────────────────────────────────────────────────

export interface ChallengeAttempt {
  attemptId: string;
  assignmentId: string;
  studentName: string;
  attemptNumber: number;
  submittedNetwork: NetworkInput;
  submittedAlgorithmConfig: AlgorithmConfig;
  submittedAnswers: Record<string, unknown>;
  simulationResult?: SimulationResult;
  gradingResult?: ChallengeGradingResult;
  createdAt: string;
}

// ── Attempt history entry (lightweight summary) ───────────────────────────────

export interface AttemptHistoryEntry {
  attemptNumber: number;
  timestamp: string;
  score: number;
  maxScore: number;
  maxUtilization?: number;
  congestedLinkCount?: number;
  hintsUsed: number;
  isCorrect: boolean;
}
