import { AssignedWork } from "../types/classroom";
import {
  TopicProgress, ContinueLearningItem, StudentTimelineEvent,
  StudentAchievement, StudentInsight, StudentOverview, StudentWorkRecord,
} from "../types/studentProgress";
import { LECTURE_EXAMPLES } from "./lectureExamples";

// ── Prototype per-student seed data ───────────────────────────────────────────
// In production these come from MongoDB submission/attempt records.
// Each student has different topic mastery to make the prototype realistic.

interface SeedData {
  score: number;
  bestScore: number;
  hintsUsed: number;
  replaysWatched: number;
  challengesSolved: number;
  topics: Record<string, { pct: number; score: number | null; status: "not_started" | "learning" | "completed" }>;
  workRecords: Record<string, { status: "not_started" | "in_progress" | "submitted" | "completed" | "needs_retry"; score: number | null; attempts: number; hintsUsed: number; minsAgo: number | null }>;
  achievements: string[];
  insights: StudentInsight[];
  timeline: Array<{ minsAgo: number; action: StudentTimelineEvent["action"]; title: string; detail: string; score?: number }>;
  continueItems: ContinueLearningItem[];
}

const SEED: Record<string, SeedData> = {
  s001: {
    // Alice — strong on ECMP and Congestion, working through DV and Traffic Eng.
    score: 88, bestScore: 96, hintsUsed: 0, replaysWatched: 3, challengesSolved: 4,
    topics: {
      ECMP:                  { pct: 88,  score: 88,  status: "completed" },
      "Distance Vector":     { pct: 45,  score: 45,  status: "learning"  },
      Congestion:            { pct: 90,  score: 90,  status: "completed" },
      "Traffic Engineering": { pct: 30,  score: null, status: "learning" },
      "Shortest Path":       { pct: 75,  score: 75,  status: "completed" },
      "Routing Tables":      { pct: 0,   score: null, status: "not_started" },
      "Link Weights":        { pct: 60,  score: 60,  status: "learning"  },
      Capacity:              { pct: 0,   score: null, status: "not_started" },
    },
    workRecords: {
      "challenge-ecmp-triangle-congestion": { status: "completed",   score: 88, attempts: 1, hintsUsed: 0, minsAgo: 2 },
      "challenge-reduce-ecmp-congestion":   { status: "submitted",   score: 92, attempts: 2, hintsUsed: 0, minsAgo: 28 },
      "challenge-dv-p4-table":              { status: "in_progress", score: null, attempts: 1, hintsUsed: 1, minsAgo: 160 },
    },
    achievements: ["first_simulation", "ecmp_explorer", "congestion_detective", "no_hint_solver", "replay_learner"],
    insights: [
      { id: "i1", text: "Top performer on ECMP", detail: "You averaged 88% across ECMP challenges — well above the class average of 74%.", type: "positive" },
      { id: "i2", text: "Distance Vector needs practice", detail: "Your last DV attempt scored 45%. Try revealing a hint before your next submission.", type: "neutral" },
      { id: "i3", text: "Replay helped you improve", detail: "You watched 3 replays. Students who use replay improve their next score by 12% on average.", type: "positive" },
      { id: "i4", text: "Try Traffic Engineering next", detail: "You've completed ECMP and Congestion. Traffic Engineering is the natural next topic.", type: "suggestion" },
    ],
    timeline: [
      { minsAgo: 2,   action: "submitted",   title: "Submitted ECMP Triangle",            detail: "Challenge · 1 attempt",         score: 88 },
      { minsAgo: 28,  action: "submitted",   title: "Submitted Reduce Congestion",         detail: "Challenge · 2 attempts",        score: 92 },
      { minsAgo: 120, action: "replay",      title: "Watched replay: ECMP Triangle",       detail: "Studied how ECMP splits flows"              },
      { minsAgo: 160, action: "attempted",   title: "Attempted Distance Vector P4",        detail: "Challenge · Attempt 1 of 3"                },
      { minsAgo: 1440, action: "submitted",  title: "Attempted Reduce Congestion",         detail: "Challenge · Attempt 1 of 3",    score: 72  },
      { minsAgo: 2880, action: "lecture",    title: "Opened lecture: ECMP Triangle",       detail: "Lecture example · ECMP"                     },
      { minsAgo: 4320, action: "simulation", title: "First simulation run",                detail: "Network Lab · Triangle topology"             },
    ],
    continueItems: [
      { id: "c1", title: "Distance Vector P4: Compute the Table",   type: "challenge", estimatedMinutes: 15, progressPct: 45, cta: "Retry",    score: 45, challengeId: "challenge-dv-p4-table" },
      { id: "c2", title: "Traffic Engineering: Optimize Load",      type: "challenge", estimatedMinutes: 10, progressPct: 0,  cta: "Start",    score: null, challengeId: "challenge-reduce-ecmp-congestion" },
      { id: "c3", title: "ECMP Triangle — Lecture",                 type: "lecture",   estimatedMinutes: 5,  progressPct: 100, cta: "Start",   score: null, lectureId: "ecmp-triangle" },
    ],
  },

  s002: {
    // Bob — average performer, using hints, working on ECMP and DV
    score: 65, bestScore: 72, hintsUsed: 3, replaysWatched: 1, challengesSolved: 1,
    topics: {
      ECMP:                  { pct: 65,  score: 65, status: "learning"     },
      "Distance Vector":     { pct: 65,  score: 65, status: "learning"     },
      Congestion:            { pct: 55,  score: 55, status: "learning"     },
      "Traffic Engineering": { pct: 0,   score: null, status: "not_started" },
      "Shortest Path":       { pct: 70,  score: 70, status: "completed"    },
      "Routing Tables":      { pct: 40,  score: null, status: "learning"   },
      "Link Weights":        { pct: 65,  score: 65, status: "learning"     },
      Capacity:              { pct: 0,   score: null, status: "not_started" },
    },
    workRecords: {
      "challenge-ecmp-triangle-congestion": { status: "not_started", score: null, attempts: 0, hintsUsed: 0, minsAgo: null },
      "challenge-reduce-ecmp-congestion":   { status: "needs_retry", score: 55,  attempts: 3, hintsUsed: 2, minsAgo: 180 },
      "challenge-dv-p4-table":              { status: "in_progress", score: null, attempts: 1, hintsUsed: 1, minsAgo: 1440 },
    },
    achievements: ["first_simulation", "replay_learner"],
    insights: [
      { id: "i1", text: "You used hints in 2 of 3 recent attempts", detail: "Hints are helpful — but try working through the problem first to strengthen your intuition.", type: "neutral" },
      { id: "i2", text: "Replay helped you spot the error", detail: "You watched 1 replay after a low-scoring attempt. Keep using replays to understand what went wrong.", type: "positive" },
      { id: "i3", text: "Reduce Congestion scored below 60%", detail: "This challenge is marked needs review. Try again with the hint about link capacity revealed.", type: "suggestion" },
      { id: "i4", text: "Start ECMP Triangle next", detail: "You haven't attempted ECMP Triangle yet. It's a great entry point for understanding load splitting.", type: "suggestion" },
    ],
    timeline: [
      { minsAgo: 180,  action: "submitted",  title: "Submitted Reduce Congestion",      detail: "Challenge · 3 attempts",     score: 55 },
      { minsAgo: 200,  action: "hint",       title: "Revealed 2 hints",                 detail: "Reduce Congestion · capacity & utilization"   },
      { minsAgo: 1440, action: "attempted",  title: "Attempted Distance Vector P4",     detail: "Challenge · Attempt 1 of 3"                   },
      { minsAgo: 1440, action: "replay",     title: "Watched replay: Reduce Congestion","detail": "Reviewed where utilization exceeded capacity" },
      { minsAgo: 2880, action: "opened",     title: "Opened assignment",                detail: "Student Workspace · Assignment mode"           },
      { minsAgo: 5040, action: "simulation", title: "First simulation run",             detail: "Network Lab · Path P4 topology"                },
    ],
    continueItems: [
      { id: "c1", title: "Reduce Congestion: Adjust Link Weights",  type: "challenge", estimatedMinutes: 15, progressPct: 55, cta: "Retry",    score: 55, challengeId: "challenge-reduce-ecmp-congestion" },
      { id: "c2", title: "ECMP Triangle: Find the Congested Link",  type: "challenge", estimatedMinutes: 10, progressPct: 0,  cta: "Start",    score: null, challengeId: "challenge-ecmp-triangle-congestion" },
      { id: "c3", title: "DV Path P4 — Lecture",                    type: "lecture",   estimatedMinutes: 5,  progressPct: 0,  cta: "Start",    score: null, lectureId: "dv-path-p4" },
    ],
  },

  s003: {
    // Charlie — struggling, just starting, needs encouragement
    score: 45, bestScore: 50, hintsUsed: 4, replaysWatched: 0, challengesSolved: 0,
    topics: {
      ECMP:                  { pct: 35, score: 35, status: "learning"      },
      "Distance Vector":     { pct: 0,  score: null, status: "not_started" },
      Congestion:            { pct: 35, score: 35, status: "learning"      },
      "Traffic Engineering": { pct: 0,  score: null, status: "not_started" },
      "Shortest Path":       { pct: 45, score: 45, status: "learning"      },
      "Routing Tables":      { pct: 0,  score: null, status: "not_started" },
      "Link Weights":        { pct: 0,  score: null, status: "not_started" },
      Capacity:              { pct: 0,  score: null, status: "not_started" },
    },
    workRecords: {
      "challenge-ecmp-triangle-congestion": { status: "needs_retry", score: 35, attempts: 3, hintsUsed: 2, minsAgo: 300 },
      "challenge-reduce-ecmp-congestion":   { status: "not_started", score: null, attempts: 0, hintsUsed: 0, minsAgo: null },
      "challenge-dv-p4-table":              { status: "not_started", score: null, attempts: 0, hintsUsed: 0, minsAgo: null },
    },
    achievements: ["first_simulation"],
    insights: [
      { id: "i1", text: "Use the lecture examples to build intuition", detail: "The ECMP Triangle lecture shows step-by-step how traffic splits — it's the foundation for the challenge.", type: "suggestion" },
      { id: "i2", text: "Try revealing a hint before submitting", detail: "Hints are penalty-free on your first reveal. Use them when you're unsure about the approach.", type: "suggestion" },
      { id: "i3", text: "Every expert starts here", detail: "You completed your first simulation. That's the first step. Focus on understanding ECMP before moving forward.", type: "positive" },
    ],
    timeline: [
      { minsAgo: 300,  action: "submitted",  title: "Submitted ECMP Triangle",          detail: "Challenge · 3 attempts",      score: 35 },
      { minsAgo: 330,  action: "hint",       title: "Revealed 2 hints",                 detail: "ECMP Triangle · path costs"                  },
      { minsAgo: 360,  action: "attempted",  title: "Attempted ECMP Triangle",          detail: "Challenge · Attempt 3 of 3"                   },
      { minsAgo: 2880, action: "lecture",    title: "Opened lecture: ECMP Triangle",    detail: "Lecture example · ECMP"                       },
      { minsAgo: 10080, action: "simulation","title": "First simulation run",           "detail": "Network Lab · First network"                 },
    ],
    continueItems: [
      { id: "c1", title: "ECMP Triangle: Find the Congested Link", type: "challenge", estimatedMinutes: 10, progressPct: 35, cta: "Retry", score: 35, challengeId: "challenge-ecmp-triangle-congestion" },
      { id: "c2", title: "ECMP Triangle — Lecture",                type: "lecture",   estimatedMinutes: 5,  progressPct: 0,  cta: "Start", score: null, lectureId: "ecmp-triangle" },
      { id: "c3", title: "DV Path P4 — Lecture",                   type: "lecture",   estimatedMinutes: 5,  progressPct: 0,  cta: "Start", score: null, lectureId: "dv-path-p4" },
    ],
  },
};

// Default for unknown students (fallback)
const DEFAULT_SEED: SeedData = {
  score: 0, bestScore: 0, hintsUsed: 0, replaysWatched: 0, challengesSolved: 0,
  topics: {
    ECMP:                  { pct: 0, score: null, status: "not_started" },
    "Distance Vector":     { pct: 0, score: null, status: "not_started" },
    Congestion:            { pct: 0, score: null, status: "not_started" },
    "Traffic Engineering": { pct: 0, score: null, status: "not_started" },
    "Shortest Path":       { pct: 0, score: null, status: "not_started" },
    "Routing Tables":      { pct: 0, score: null, status: "not_started" },
    "Link Weights":        { pct: 0, score: null, status: "not_started" },
    Capacity:              { pct: 0, score: null, status: "not_started" },
  },
  workRecords: {},
  achievements: [],
  insights: [
    { id: "i1", text: "Start with the ECMP Triangle challenge", detail: "It's the best entry point for learning about routing and congestion.", type: "suggestion" },
  ],
  timeline: [],
  continueItems: [
    { id: "c1", title: "ECMP Triangle: Find the Congested Link", type: "challenge", estimatedMinutes: 10, progressPct: 0, cta: "Start", challengeId: "challenge-ecmp-triangle-congestion" },
    { id: "c2", title: "ECMP Triangle — Lecture",                type: "lecture",   estimatedMinutes: 5,  progressPct: 0, cta: "Start", lectureId: "ecmp-triangle" },
  ],
};

function getSeed(studentId: string | null): SeedData {
  if (!studentId) return DEFAULT_SEED;
  return SEED[studentId] ?? DEFAULT_SEED;
}

// ── Topic config (static descriptions) ────────────────────────────────────────

const TOPIC_META: Record<string, { description: string; nextAction: string; nextChallengeId?: string }> = {
  ECMP:                  { description: "Equal-Cost Multi-Path routing splits traffic across paths with identical cost.", nextAction: "Try the ECMP Triangle challenge.", nextChallengeId: "challenge-ecmp-triangle-congestion" },
  "Distance Vector":     { description: "Distance Vector routing tables are built iteratively using Bellman-Ford updates.", nextAction: "Try the Distance Vector P4 challenge.", nextChallengeId: "challenge-dv-p4-table" },
  Congestion:            { description: "Congestion occurs when link traffic exceeds link capacity, causing packet loss.", nextAction: "Identify congested links in the ECMP challenge.", nextChallengeId: "challenge-ecmp-triangle-congestion" },
  "Traffic Engineering": { description: "Traffic Engineering adjusts link weights to steer flows and reduce hotspots.", nextAction: "Try the Reduce Congestion challenge.", nextChallengeId: "challenge-reduce-ecmp-congestion" },
  "Shortest Path":       { description: "Shortest-path routing selects the minimum-cost route between source and destination.", nextAction: "Run a lab simulation and observe path selection." },
  "Routing Tables":      { description: "Routing tables store the next-hop decision each router makes per destination prefix.", nextAction: "Review the DV routing table in the challenge." },
  "Link Weights":        { description: "Link weights are the cost values used by shortest-path and ECMP algorithms.", nextAction: "Adjust weights in the lab and observe how paths change." },
  Capacity:              { description: "Link capacity is the maximum traffic a link can carry before becoming congested.", nextAction: "Identify a congested link in the ECMP Triangle challenge.", nextChallengeId: "challenge-ecmp-triangle-congestion" },
};

// ── Achievement config ────────────────────────────────────────────────────────

const ALL_ACHIEVEMENTS: Array<Omit<StudentAchievement, "unlocked" | "unlockedAt">> = [
  { id: "first_simulation",      title: "First Simulation",       description: "Ran your first network simulation." },
  { id: "ecmp_explorer",         title: "ECMP Explorer",          description: "Completed an ECMP challenge successfully." },
  { id: "congestion_detective",  title: "Congestion Detective",   description: "Correctly identified a congested link." },
  { id: "replay_learner",        title: "Replay Learner",         description: "Watched a replay to review your attempt." },
  { id: "no_hint_solver",        title: "No-Hint Solver",         description: "Solved a challenge without using any hints." },
  { id: "challenge_streak",      title: "Challenge Streak",       description: "Solved 3 challenges in a row." },
];

// ── Relative time helper ──────────────────────────────────────────────────────

function minsAgoToIso(minsAgo: number): string {
  return new Date(Date.now() - minsAgo * 60_000).toISOString();
}

function minsAgoToUnlockDate(minsAgo: number): string {
  return new Date(Date.now() - minsAgo * 60_000).toISOString();
}

// ── Exported compute functions ────────────────────────────────────────────────

export function computeStudentOverview(
  studentId: string | null,
  assignedWorks: AssignedWork[],
): StudentOverview {
  const seed = getSeed(studentId);
  const myWorks = assignedWorks.filter((w) =>
    w.assignedTo === "all" ||
    (Array.isArray(w.assignedTo) && studentId && w.assignedTo.includes(studentId))
  );

  const assignedTotal = Math.max(myWorks.length, 3); // at least 3 in prototype
  const records = seed.workRecords;
  const statuses = Object.values(records);
  const completed = statuses.filter((r) => r.status === "completed" || r.status === "submitted").length;
  const inProgress = statuses.filter((r) => r.status === "in_progress").length;
  const needsRetry = statuses.filter((r) => r.status === "needs_retry").length;
  const notStarted = assignedTotal - completed - inProgress - needsRetry;

  const scores = statuses.filter((r) => r.score !== null).map((r) => r.score as number);
  const avgScore = scores.length > 0 ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null;
  const bestScore = scores.length > 0 ? Math.max(...scores) : null;

  return {
    assignedTotal,
    completed,
    inProgress,
    notStarted: Math.max(notStarted, 0),
    needsRetry,
    avgScore: avgScore ?? (seed.score > 0 ? seed.score : null),
    bestScore: bestScore ?? (seed.bestScore > 0 ? seed.bestScore : null),
    challengesSolved: seed.challengesSolved,
    hintsUsed: seed.hintsUsed,
    replaysWatched: seed.replaysWatched,
  };
}

export function computeTopicProgress(studentId: string | null): TopicProgress[] {
  const seed = getSeed(studentId);
  return Object.entries(TOPIC_META).map(([topic, meta]) => {
    const data = seed.topics[topic] ?? { pct: 0, score: null, status: "not_started" as const };
    return {
      topic,
      displayName: topic,
      status: data.status,
      progressPct: data.pct,
      score: data.score,
      description: meta.description,
      nextAction: meta.nextAction,
      nextChallengeId: meta.nextChallengeId,
    };
  });
}

export function computeContinueLearning(studentId: string | null): ContinueLearningItem[] {
  return getSeed(studentId).continueItems;
}

export function computeStudentTimeline(studentId: string | null): StudentTimelineEvent[] {
  const seed = getSeed(studentId);
  return seed.timeline.map((e, i) => ({
    id: `tl-${i}`,
    timestamp: minsAgoToIso(e.minsAgo),
    action: e.action,
    title: e.title,
    detail: e.detail,
    score: e.score,
  }));
}

export function computeStudentAchievements(studentId: string | null): StudentAchievement[] {
  const seed = getSeed(studentId);
  const unlocked = new Set(seed.achievements);
  // Assign pseudo unlock dates based on timeline events
  const unlockTimes: Record<string, number> = {
    first_simulation: 10080, ecmp_explorer: 2,
    congestion_detective: 300, replay_learner: 120,
    no_hint_solver: 28, challenge_streak: 5,
  };
  return ALL_ACHIEVEMENTS.map((a) => ({
    ...a,
    unlocked: unlocked.has(a.id),
    unlockedAt: unlocked.has(a.id)
      ? minsAgoToUnlockDate(unlockTimes[a.id] ?? 60)
      : undefined,
  }));
}

export function computeStudentInsights(studentId: string | null): StudentInsight[] {
  return getSeed(studentId).insights;
}

export function getStudentWorkRecord(
  studentId: string | null,
  workId: string,
): StudentWorkRecord {
  if (!studentId) {
    return { workId, status: "not_started", score: null, attempts: 0, hintsUsed: 0, lastActivityAt: null };
  }
  const seed = getSeed(studentId);
  const r = seed.workRecords[workId];
  if (!r) {
    return { workId, status: "not_started", score: null, attempts: 0, hintsUsed: 0, lastActivityAt: null };
  }
  return {
    workId,
    status: r.status,
    score: r.score,
    attempts: r.attempts,
    hintsUsed: r.hintsUsed,
    lastActivityAt: r.minsAgo !== null ? minsAgoToIso(r.minsAgo) : null,
  };
}

export function getLectureById(id: string) {
  return LECTURE_EXAMPLES.find((l) => l.id === id) ?? null;
}
