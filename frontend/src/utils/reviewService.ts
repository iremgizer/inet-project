import { AssignedWork } from "../types/classroom";
import { AssignmentSummary } from "../types/assignment";
import { ReviewRecord, ReviewStatus } from "../types/review";
import { DEMO_STUDENTS } from "./demoUsers";

// ── Demo performance constants (mirrors analyticsService DEMO_PERF) ───────────
// These seed the review center so it is never empty in the prototype.
// In production, replace with real StudentSubmission / ChallengeAttempt records
// fetched from MongoDB.

const DEMO_RECORDS: ReviewRecord[] = [
  {
    reviewId: "demo-r1",
    workType: "challenge",
    workId: "challenge-ecmp-triangle-congestion",
    workTitle: "ECMP Triangle: Find the Congested Link",
    topic: "ECMP",
    difficulty: "beginner",
    algorithm: "ECMP",
    studentId: "s001",
    studentName: "Alice Student",
    status: "checked",
    score: 88, maxScore: 100, percentage: 88,
    attempts: 1, hintsUsed: 0, replayUsed: true,
    submittedAt: new Date(Date.now() - 2 * 60_000).toISOString(),
    dueDate: null,
    isDemo: true,
  },
  {
    reviewId: "demo-r2",
    workType: "challenge",
    workId: "challenge-reduce-ecmp-congestion",
    workTitle: "Reduce Congestion: Adjust Link Weights",
    topic: "ECMP",
    difficulty: "intermediate",
    algorithm: "ECMP",
    studentId: "s001",
    studentName: "Alice Student",
    status: "submitted",
    score: 92, maxScore: 100, percentage: 92,
    attempts: 2, hintsUsed: 0, replayUsed: false,
    submittedAt: new Date(Date.now() - 28 * 60_000).toISOString(),
    dueDate: null,
    isDemo: true,
  },
  {
    reviewId: "demo-r3",
    workType: "challenge",
    workId: "challenge-reduce-ecmp-congestion",
    workTitle: "Reduce Congestion: Adjust Link Weights",
    topic: "ECMP",
    difficulty: "intermediate",
    algorithm: "ECMP",
    studentId: "s002",
    studentName: "Bob Student",
    status: "needs_review",
    score: 55, maxScore: 100, percentage: 55,
    attempts: 3, hintsUsed: 2, replayUsed: true,
    submittedAt: new Date(Date.now() - 3 * 3_600_000).toISOString(),
    dueDate: null,
    isDemo: true,
  },
  {
    reviewId: "demo-r4",
    workType: "challenge",
    workId: "challenge-dv-p4-table",
    workTitle: "Distance Vector P4: Compute the Routing Table",
    topic: "DISTANCE_VECTOR",
    difficulty: "beginner",
    algorithm: "DISTANCE_VECTOR",
    studentId: "s002",
    studentName: "Bob Student",
    status: "in_progress",
    score: null, maxScore: 100, percentage: null,
    attempts: 1, hintsUsed: 1, replayUsed: false,
    submittedAt: null,
    dueDate: null,
    isDemo: true,
  },
  {
    reviewId: "demo-r5",
    workType: "challenge",
    workId: "challenge-ecmp-triangle-congestion",
    workTitle: "ECMP Triangle: Find the Congested Link",
    topic: "ECMP",
    difficulty: "beginner",
    algorithm: "ECMP",
    studentId: "s003",
    studentName: "Charlie Student",
    status: "needs_review",
    score: 35, maxScore: 100, percentage: 35,
    attempts: 3, hintsUsed: 2, replayUsed: false,
    submittedAt: new Date(Date.now() - 5 * 3_600_000).toISOString(),
    dueDate: null,
    isDemo: true,
  },
  {
    reviewId: "demo-r6",
    workType: "challenge",
    workId: "challenge-dv-p4-table",
    workTitle: "Distance Vector P4: Compute the Routing Table",
    topic: "DISTANCE_VECTOR",
    difficulty: "beginner",
    algorithm: "DISTANCE_VECTOR",
    studentId: "s003",
    studentName: "Charlie Student",
    status: "not_started",
    score: null, maxScore: 100, percentage: null,
    attempts: 0, hintsUsed: 0, replayUsed: false,
    submittedAt: null,
    dueDate: null,
    isDemo: true,
  },
];

// ── Per-student demo performance (for teacher-assigned works) ─────────────────

const DEMO_PERF: Record<string, { score: number; attempts: number; hints: number; replays: number }> = {
  s001: { score: 88, attempts: 1, hints: 0, replays: 1 },
  s002: { score: 65, attempts: 2, hints: 1, replays: 1 },
  s003: { score: 45, attempts: 3, hints: 2, replays: 0 },
};

function statusFromPerf(
  studentId: string,
  perf: { score: number; attempts: number } | undefined,
): ReviewStatus {
  if (!perf) return "not_started";
  if (perf.score >= 80) return "checked";
  if (perf.score >= 60) return "submitted";
  return "needs_review";
}

// ── Build ReviewRecords from classroom data ───────────────────────────────────

export function buildReviewRecords(
  assignedWorks: AssignedWork[],
  _savedAssignments: AssignmentSummary[],
): ReviewRecord[] {
  const records: ReviewRecord[] = [...DEMO_RECORDS];

  // For each teacher-assigned work, add records per student
  for (const work of assignedWorks) {
    const students =
      work.assignedTo === "all"
        ? DEMO_STUDENTS
        : DEMO_STUDENTS.filter((s) =>
            (work.assignedTo as string[]).includes(s.studentId),
          );

    for (const student of students) {
      const reviewId = `aw-${work.assignedWorkId}-${student.studentId}`;
      // Skip if we already have a demo record for this (workId, studentId)
      const alreadyExists = records.some(
        (r) => r.workId === work.workId && r.studentId === student.studentId,
      );
      if (alreadyExists) continue;

      const perf = DEMO_PERF[student.studentId];
      const status = statusFromPerf(student.studentId, perf);
      const isSubmitted = status !== "not_started" && status !== "in_progress";

      records.push({
        reviewId,
        workType: work.workType,
        workId: work.workId,
        workTitle: work.workTitle,
        topic: work.workTopic ?? "ECMP",
        difficulty: null,
        algorithm: null,
        studentId: student.studentId,
        studentName: student.name,
        status,
        score: isSubmitted && perf ? Math.round(perf.score) : null,
        maxScore: 100,
        percentage: isSubmitted && perf ? Math.round(perf.score) : null,
        attempts: perf ? perf.attempts : 0,
        hintsUsed: perf ? perf.hints : 0,
        replayUsed: perf ? perf.replays > 0 : false,
        submittedAt: isSubmitted
          ? new Date(Date.now() - Math.random() * 7 * 86_400_000).toISOString()
          : null,
        dueDate: work.dueDate ?? null,
        isDemo: true,
      });
    }
  }

  // Sort: needs_review first, then by submittedAt desc
  return records.sort((a, b) => {
    const priority: Record<string, number> = {
      needs_review: 0,
      submitted: 1,
      in_progress: 2,
      checked: 3,
      not_started: 4,
    };
    const pa = priority[a.status] ?? 5;
    const pb = priority[b.status] ?? 5;
    if (pa !== pb) return pa - pb;
    if (a.submittedAt && b.submittedAt)
      return new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime();
    return 0;
  });
}

// ── Analytics derived from ReviewRecords ──────────────────────────────────────

export function reviewSummaryStats(records: ReviewRecord[]) {
  const submitted = records.filter(
    (r) => r.status === "submitted" || r.status === "checked" || r.status === "needs_review",
  );
  const withScore = submitted.filter((r) => r.score !== null);
  const avgScore =
    withScore.length > 0
      ? Math.round(withScore.reduce((s, r) => s + (r.percentage ?? 0), 0) / withScore.length)
      : 0;
  const avgAttempts =
    submitted.length > 0
      ? Number((submitted.reduce((s, r) => s + r.attempts, 0) / submitted.length).toFixed(1))
      : 0;
  const pendingReviews = records.filter((r) => r.status === "needs_review").length;
  const hintUsers = records.filter((r) => r.hintsUsed > 0).length;
  const replayUsers = records.filter((r) => r.replayUsed).length;

  return { submitted: submitted.length, avgScore, avgAttempts, pendingReviews, hintUsers, replayUsers };
}

// ── CSV export ────────────────────────────────────────────────────────────────

export function exportGradebookCsv(records: ReviewRecord[]): void {
  const headers = [
    "studentId", "studentName", "workTitle", "workType", "topic", "difficulty",
    "status", "score", "maxScore", "percentage", "attempts", "hintsUsed", "replayUsed",
    "submittedAt", "dueDate",
  ];

  const escape = (v: unknown) => {
    const s = String(v ?? "");
    return s.includes(",") || s.includes('"') ? `"${s.replace(/"/g, '""')}"` : s;
  };

  const rows = records.map((r) =>
    [
      r.studentId, r.studentName, r.workTitle, r.workType, r.topic, r.difficulty ?? "",
      r.status, r.score ?? "", r.maxScore, r.percentage ?? "",
      r.attempts, r.hintsUsed, r.replayUsed ? "yes" : "no",
      r.submittedAt ?? "", r.dueDate ?? "",
    ].map(escape).join(","),
  );

  const csv = [headers.join(","), ...rows].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `gradebook-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
