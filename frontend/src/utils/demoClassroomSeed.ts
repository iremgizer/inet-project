/**
 * Demo classroom seed — persistent, localStorage-backed demo data.
 *
 * Strategy:
 *   - networkLab.demoSeedVersion   → seed version; bump to force re-seed
 *   - networkLab.demoAssignments   → AssignmentSummary[] shown in Teacher Assignments tab
 *   - networkLab.demoAssignedWorks → AssignedWork[] shown in student My Work + review center
 *
 * The demo data is designed so that:
 *   Alice (s001)  — completed ECMP Triangle 88/100, DV in progress, Reduce not started
 *   Bob   (s002)  — Reduce Congestion needs_review 55/100, ECMP not started, DV in progress
 *   Charlie (s003)— nothing submitted, completely fresh
 *
 * These records drive: Teacher Analytics, Submission Review Center, Student Dashboards.
 * They are stored here so Teacher/Student flows remain coherent across page refreshes
 * without requiring MongoDB.
 */

import { AssignmentSummary } from "../types/assignment";
import { AssignedWork } from "../types/classroom";

// ── Seed version — bump when the data model changes ──────────────────────────
const SEED_VERSION = "v2";

// ── localStorage keys ─────────────────────────────────────────────────────────
export const DEMO_VERSION_KEY    = "networkLab.demoSeedVersion";
export const DEMO_ASSIGNMENTS_KEY    = "networkLab.demoAssignments";
export const DEMO_ASSIGNED_WORKS_KEY = "networkLab.demoAssignedWorks";

// ── Demo AssignmentSummary records ────────────────────────────────────────────
// These appear in Teacher Dashboard → Assignments tab even without MongoDB.

export const DEMO_ASSIGNMENT_SUMMARIES: AssignmentSummary[] = [
  {
    assignmentId: "challenge-ecmp-triangle-congestion",
    title: "ECMP Triangle: Find the Congested Link",
    topic: "ECMP",
    mode: "challenge",
    taskType: "IDENTIFY_CONGESTED_LINKS",
    course: "Network Engineering WS2026",
    createdAt: "2026-06-15T09:00:00.000Z",
    updatedAt: "2026-06-15T09:00:00.000Z",
  },
  {
    assignmentId: "challenge-reduce-ecmp-congestion",
    title: "Reduce Congestion: Adjust Link Weights",
    topic: "ECMP",
    mode: "challenge",
    taskType: "REDUCE_MAX_UTILIZATION",
    course: "Network Engineering WS2026",
    createdAt: "2026-06-18T09:00:00.000Z",
    updatedAt: "2026-06-18T09:00:00.000Z",
  },
  {
    assignmentId: "challenge-dv-p4-table",
    title: "Distance Vector P4: Compute the Routing Table",
    topic: "DISTANCE_VECTOR",
    mode: "challenge",
    taskType: "COMPUTE_DV_TABLE",
    course: "Network Engineering WS2026",
    createdAt: "2026-06-20T09:00:00.000Z",
    updatedAt: "2026-06-20T09:00:00.000Z",
  },
];

// ── Demo AssignedWork records ─────────────────────────────────────────────────
// These appear in student My Work tab and drive the Submission Review Center.
//
// Assignment    | Assigned to         | Notes
// ECMP Triangle | all (s001,s002,s003)| All students must complete
// DV P4         | s001, s002          | Alice + Bob only
// Reduce Cong.  | all (s001,s002,s003)| All students must complete

export const DEMO_ASSIGNED_WORKS: AssignedWork[] = [
  {
    assignedWorkId: "demo-aw-ecmp",
    workType: "challenge",
    workId: "challenge-ecmp-triangle-congestion",
    workTitle: "ECMP Triangle: Find the Congested Link",
    workTopic: "ECMP",
    workMode: "challenge",
    assignedTo: "all",
    assignedAt: "2026-06-20T10:00:00.000Z",
    dueDate: "2026-07-10T23:59:00.000Z",
  },
  {
    assignedWorkId: "demo-aw-dv",
    workType: "challenge",
    workId: "challenge-dv-p4-table",
    workTitle: "Distance Vector P4: Compute the Routing Table",
    workTopic: "DISTANCE_VECTOR",
    workMode: "challenge",
    assignedTo: ["s001", "s002"],
    assignedAt: "2026-06-22T10:00:00.000Z",
    dueDate: "2026-07-12T23:59:00.000Z",
  },
  {
    assignedWorkId: "demo-aw-reduce",
    workType: "challenge",
    workId: "challenge-reduce-ecmp-congestion",
    workTitle: "Reduce Congestion: Adjust Link Weights",
    workTopic: "ECMP",
    workMode: "challenge",
    assignedTo: "all",
    assignedAt: "2026-06-25T10:00:00.000Z",
    dueDate: "2026-07-15T23:59:00.000Z",
  },
];

// ── localStorage helpers ──────────────────────────────────────────────────────

function write<T>(key: string, value: T): void {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* quota */ }
}

function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch { return null; }
}

// ── Public API ────────────────────────────────────────────────────────────────

/** Unconditionally write demo data to localStorage. */
export function seedDemoClassroomData(): void {
  write(DEMO_ASSIGNMENTS_KEY, DEMO_ASSIGNMENT_SUMMARIES);
  write(DEMO_ASSIGNED_WORKS_KEY, DEMO_ASSIGNED_WORKS);
  write(DEMO_VERSION_KEY, SEED_VERSION);
}

/** Clear demo data and re-seed. */
export function resetDemoClassroomData(): void {
  localStorage.removeItem(DEMO_ASSIGNMENTS_KEY);
  localStorage.removeItem(DEMO_ASSIGNED_WORKS_KEY);
  seedDemoClassroomData();
}

/**
 * Seed demo data only if it is absent or the version has changed.
 * Call this once on app startup.
 */
export function ensureDemoClassroomData(): void {
  const storedVersion = read<string>(DEMO_VERSION_KEY);
  if (storedVersion !== SEED_VERSION) {
    seedDemoClassroomData();
  }
}

/** Load demo AssignmentSummary records from localStorage (falls back to constants). */
export function loadDemoAssignmentSummaries(): AssignmentSummary[] {
  return read<AssignmentSummary[]>(DEMO_ASSIGNMENTS_KEY) ?? DEMO_ASSIGNMENT_SUMMARIES;
}

/** Load demo AssignedWork records from localStorage (falls back to constants). */
export function loadDemoAssignedWorks(): AssignedWork[] {
  return read<AssignedWork[]>(DEMO_ASSIGNED_WORKS_KEY) ?? DEMO_ASSIGNED_WORKS;
}
