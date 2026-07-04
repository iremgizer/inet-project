export type ReviewStatus =
  | "not_started"
  | "in_progress"
  | "submitted"
  | "checked"
  | "needs_review";

export interface ReviewRecord {
  reviewId: string;
  workType: "assignment" | "challenge";
  workId: string;
  workTitle: string;
  topic: string;
  difficulty: string | null;
  algorithm: string | null;
  studentId: string;
  studentName: string;
  status: ReviewStatus;
  score: number | null;
  maxScore: number;
  percentage: number | null;
  attempts: number;
  hintsUsed: number;
  replayUsed: boolean;
  submittedAt: string | null;
  dueDate: string | null;
  isDemo: boolean;
}
