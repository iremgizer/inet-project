import { AssignmentSummary } from "../types/assignment";
import { AssignedWork } from "../types/classroom";
import { CourseMetrics, StudentMetrics, ActivityEvent, CourseInsight } from "../types/analytics";
import { DEMO_STUDENTS } from "./demoUsers";

// Prototype performance data — derived from demo student roster.
// In production these would come from real submission records in the database.
const DEMO_PERF: Record<string, {
  score: number; attempts: number; hints: number;
  replays: number; doneAssignments: number; doneChallenges: number;
}> = {
  s001: { score: 88, attempts: 1.2, hints: 0, replays: 2, doneAssignments: 4, doneChallenges: 2 },
  s002: { score: 74, attempts: 2.1, hints: 1, replays: 1, doneAssignments: 3, doneChallenges: 1 },
  s003: { score: 61, attempts: 2.9, hints: 2, replays: 0, doneAssignments: 2, doneChallenges: 0 },
};

export function computeCourseMetrics(
  savedAssignments: AssignmentSummary[],
  assignedWorks: AssignedWork[]
): CourseMetrics {
  const studentCount = DEMO_STUDENTS.length;
  const assignmentCount = Math.max(savedAssignments.filter(a => a.mode !== "challenge").length, 5);
  const challengeCount = Math.max(savedAssignments.filter(a => a.mode === "challenge").length, 3);

  const perfs = Object.values(DEMO_PERF);
  const averageScore = Math.round(perfs.reduce((s, p) => s + p.score, 0) / perfs.length);

  const totalDoneAssignments = perfs.reduce((s, p) => s + Math.min(p.doneAssignments, assignmentCount), 0);
  const totalDoneChallenges = perfs.reduce((s, p) => s + Math.min(p.doneChallenges, challengeCount), 0);
  const totalDone = totalDoneAssignments + totalDoneChallenges;
  const totalPossible = studentCount * (assignmentCount + challengeCount);

  const completionPct = Math.round((totalDone / totalPossible) * 100);
  const assignmentCompletionPct = Math.round((totalDoneAssignments / (studentCount * assignmentCount)) * 100);
  const challengeCompletionPct = Math.round((totalDoneChallenges / (studentCount * challengeCount)) * 100);

  const hintTotal = perfs.reduce((s, p) => s + p.hints, 0);
  const challengesDone = perfs.reduce((s, p) => s + Math.max(p.doneChallenges, 1), 0);
  const hintUsagePct = Math.min(Math.round((hintTotal / challengesDone) * 100), 100);

  const withReplays = perfs.filter(p => p.replays > 0).length;
  const replayUsagePct = Math.round((withReplays / studentCount) * 100);

  const avgAttempts = Number((perfs.reduce((s, p) => s + p.attempts, 0) / perfs.length).toFixed(1));

  return {
    studentCount,
    assignmentCount,
    challengeCount,
    submissionCount: Math.max(totalDone, 8),
    averageScore,
    pendingReviews: assignedWorks.length,
    averageAttempts: avgAttempts,
    averageCompletionTimeMin: 14,
    hintUsagePct,
    replayUsagePct,
    completionPct,
    assignmentCompletionPct,
    challengeCompletionPct,
  };
}

export function computeStudentMetrics(savedAssignments: AssignmentSummary[]): StudentMetrics[] {
  const assignmentCount = Math.max(savedAssignments.filter(a => a.mode !== "challenge").length, 5);
  const challengeCount = Math.max(savedAssignments.filter(a => a.mode === "challenge").length, 3);

  return DEMO_STUDENTS.map(student => {
    const p = DEMO_PERF[student.studentId] ?? {
      score: 60, attempts: 3, hints: 2, replays: 0, doneAssignments: 1, doneChallenges: 0,
    };
    const ac = Math.min(p.doneAssignments, assignmentCount);
    const cc = Math.min(p.doneChallenges, challengeCount);
    return {
      studentId: student.studentId,
      name: student.name,
      assignmentsCompleted: ac,
      assignmentsTotal: assignmentCount,
      challengesCompleted: cc,
      challengesTotal: challengeCount,
      averageScore: p.score,
      totalAttempts: Math.round(p.attempts * (ac + cc)),
      hintsUsed: p.hints,
      replays: p.replays,
      status: (p.score >= 80 ? "on_track" : p.score >= 65 ? "at_risk" : "not_started") as StudentMetrics["status"],
    };
  });
}

export function computeInsights(m: CourseMetrics, students: StudentMetrics[]): CourseInsight[] {
  const sorted = [...students].sort((a, b) => b.averageScore - a.averageScore);
  const top = sorted[0];
  const atRisk = students.filter(s => s.status !== "on_track");
  const totalReplays = students.reduce((s, st) => s + st.replays, 0);
  const mostAttempts = [...students].sort((a, b) => b.totalAttempts - a.totalAttempts)[0];

  return [
    {
      id: "top-student",
      title: "Top student",
      value: top.name.split(" ")[0],
      subtitle: `${top.averageScore}% average score`,
      severity: "green",
    },
    {
      id: "at-risk",
      title: "Need attention",
      value: `${atRisk.length} student${atRisk.length !== 1 ? "s" : ""}`,
      subtitle: atRisk.length ? atRisk.map(s => s.name.split(" ")[0]).join(", ") : "Everyone on track",
      severity: atRisk.length === 0 ? "green" : atRisk.length > 1 ? "red" : "yellow",
    },
    {
      id: "class-avg",
      title: "Class average",
      value: `${m.averageScore}%`,
      subtitle: "Across all submissions",
      severity: m.averageScore >= 80 ? "green" : m.averageScore >= 65 ? "yellow" : "red",
    },
    {
      id: "completion",
      title: "Completion rate",
      value: `${m.completionPct}%`,
      subtitle: `${students.reduce((s, st) => s + st.assignmentsCompleted + st.challengesCompleted, 0)} of ${m.studentCount * (m.assignmentCount + m.challengeCount)} items done`,
      severity: m.completionPct >= 70 ? "green" : m.completionPct >= 40 ? "yellow" : "red",
    },
    {
      id: "replay",
      title: "Replay adoption",
      value: `${totalReplays} session${totalReplays !== 1 ? "s" : ""}`,
      subtitle: `${m.replayUsagePct}% of students used trace replay`,
      severity: m.replayUsagePct >= 50 ? "green" : "yellow",
    },
    {
      id: "most-attempts",
      title: "Most attempts",
      value: mostAttempts.name.split(" ")[0],
      subtitle: `${mostAttempts.totalAttempts} total attempts — may need support`,
      severity: mostAttempts.totalAttempts > 6 ? "yellow" : "green",
    },
  ];
}

// Seeded activity log — timestamps relative to now so they're always "recent"
export function seedActivityLog(): ActivityEvent[] {
  const now = Date.now();
  return [
    { id: "ev1", actorType: "student", actorName: "Alice", action: "submitted", subject: "ECMP Assignment 2", timestamp: new Date(now - 2 * 60_000).toISOString() },
    { id: "ev2", actorType: "student", actorName: "Bob", action: "completed_challenge", subject: "Shortest Path Challenge", timestamp: new Date(now - 28 * 60_000).toISOString() },
    { id: "ev3", actorType: "student", actorName: "Alice", action: "watched_replay", subject: "ECMP Triangle trace", timestamp: new Date(now - 2.5 * 3_600_000).toISOString() },
    { id: "ev4", actorType: "student", actorName: "Charlie", action: "opened_lecture", subject: "DV Path P4", timestamp: new Date(now - 5 * 3_600_000).toISOString() },
    { id: "ev5", actorType: "teacher", actorName: "You", action: "exported_pdf", subject: "Assignment 2 (student copy)", timestamp: new Date(now - 22 * 3_600_000).toISOString() },
    { id: "ev6", actorType: "teacher", actorName: "You", action: "assigned_work", subject: "DV Challenge → All students", timestamp: new Date(now - 2 * 86_400_000).toISOString() },
    { id: "ev7", actorType: "student", actorName: "Bob", action: "submitted", subject: "Assignment 1", timestamp: new Date(now - 3 * 86_400_000).toISOString() },
    { id: "ev8", actorType: "student", actorName: "Charlie", action: "opened_assignment", subject: "Traffic Engineering Exercise", timestamp: new Date(now - 5 * 86_400_000).toISOString() },
  ];
}

export function mergeActivityLog(stored: ActivityEvent[]): ActivityEvent[] {
  const storedIds = new Set(stored.map(e => e.id));
  const seed = seedActivityLog().filter(e => !storedIds.has(e.id));
  return [...stored, ...seed].sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  );
}
