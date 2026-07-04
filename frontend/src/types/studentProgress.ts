export type TopicStatus = "not_started" | "learning" | "completed";

export interface TopicProgress {
  topic: string;
  displayName: string;
  status: TopicStatus;
  progressPct: number;
  score: number | null;
  description: string;
  nextAction: string;
  nextChallengeId?: string;
}

export interface ContinueLearningItem {
  id: string;
  title: string;
  type: "assignment" | "challenge" | "lecture" | "lab";
  estimatedMinutes: number;
  progressPct: number;
  cta: "Continue" | "Retry" | "Start";
  score?: number | null;
  challengeId?: string;
  lectureId?: string;
}

export interface StudentTimelineEvent {
  id: string;
  timestamp: string;
  action: "submitted" | "attempted" | "solved" | "hint" | "replay" | "lecture" | "simulation" | "opened";
  title: string;
  detail: string;
  score?: number;
}

export interface StudentAchievement {
  id: string;
  title: string;
  description: string;
  unlocked: boolean;
  unlockedAt?: string;
}

export interface StudentInsight {
  id: string;
  text: string;
  detail: string;
  type: "positive" | "neutral" | "suggestion";
}

export interface StudentOverview {
  assignedTotal: number;
  completed: number;
  inProgress: number;
  notStarted: number;
  needsRetry: number;
  avgScore: number | null;
  bestScore: number | null;
  challengesSolved: number;
  hintsUsed: number;
  replaysWatched: number;
}

export interface StudentWorkRecord {
  workId: string;
  status: "not_started" | "in_progress" | "submitted" | "completed" | "needs_retry";
  score: number | null;
  attempts: number;
  hintsUsed: number;
  lastActivityAt: string | null;
}
