export type InsightSeverity = "green" | "yellow" | "red" | "blue";

export interface CourseMetrics {
  studentCount: number;
  assignmentCount: number;
  challengeCount: number;
  submissionCount: number;
  averageScore: number;
  pendingReviews: number;
  averageAttempts: number;
  averageCompletionTimeMin: number;
  hintUsagePct: number;
  replayUsagePct: number;
  completionPct: number;
  assignmentCompletionPct: number;
  challengeCompletionPct: number;
}

export interface StudentMetrics {
  studentId: string;
  name: string;
  assignmentsCompleted: number;
  assignmentsTotal: number;
  challengesCompleted: number;
  challengesTotal: number;
  averageScore: number;
  totalAttempts: number;
  hintsUsed: number;
  replays: number;
  status: "on_track" | "at_risk" | "not_started";
}

export type ActivityAction =
  | "submitted"
  | "completed_challenge"
  | "watched_replay"
  | "opened_lecture"
  | "exported_pdf"
  | "assigned_work"
  | "exported_json"
  | "opened_assignment";

export interface ActivityEvent {
  id: string;
  actorType: "student" | "teacher";
  actorName: string;
  action: ActivityAction;
  subject: string;
  timestamp: string;
}

export interface CourseInsight {
  id: string;
  title: string;
  value: string;
  subtitle: string;
  severity: InsightSeverity;
}
