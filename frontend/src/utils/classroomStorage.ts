import { AssignedWork } from "../types/classroom";
import { ActivityEvent } from "../types/analytics";

const ASSIGNED_WORKS_KEY = "inet-assigned-works";
const CURRENT_STUDENT_KEY = "inet-current-student";

export function loadAssignedWorks(): AssignedWork[] {
  try {
    const raw = localStorage.getItem(ASSIGNED_WORKS_KEY);
    return raw ? (JSON.parse(raw) as AssignedWork[]) : [];
  } catch {
    return [];
  }
}

export function saveAssignedWorks(works: AssignedWork[]): void {
  try {
    localStorage.setItem(ASSIGNED_WORKS_KEY, JSON.stringify(works));
  } catch {
    // Ignore quota errors
  }
}

export function loadCurrentStudentId(): string | null {
  try {
    return localStorage.getItem(CURRENT_STUDENT_KEY);
  } catch {
    return null;
  }
}

export function saveCurrentStudentId(studentId: string | null): void {
  try {
    if (studentId) {
      localStorage.setItem(CURRENT_STUDENT_KEY, studentId);
    } else {
      localStorage.removeItem(CURRENT_STUDENT_KEY);
    }
  } catch {
    // Ignore
  }
}

// ── Activity log ──────────────────────────────────────────────────────────────

const ACTIVITY_KEY = "inet-activity-log";
const MAX_EVENTS = 50;

export function loadActivityLog(): ActivityEvent[] {
  try {
    const raw = localStorage.getItem(ACTIVITY_KEY);
    return raw ? (JSON.parse(raw) as ActivityEvent[]) : [];
  } catch {
    return [];
  }
}

export function appendActivity(event: ActivityEvent): void {
  try {
    const existing = loadActivityLog();
    const updated = [event, ...existing.filter(e => e.id !== event.id)].slice(0, MAX_EVENTS);
    localStorage.setItem(ACTIVITY_KEY, JSON.stringify(updated));
  } catch {
    // Ignore
  }
}
