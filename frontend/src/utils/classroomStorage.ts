import { AssignedWork } from "../types/classroom";

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
