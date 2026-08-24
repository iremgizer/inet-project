import { DemoStudent } from "../types/classroom";

export const DEMO_STUDENTS: DemoStudent[] = [
  { studentId: "s001", name: "Alice Student" },
  { studentId: "s002", name: "Bob Student" },
  { studentId: "s003", name: "Charlie Student" },
  // Demo-only profile — signed into directly via the "demo"/"demo" login
  // (see demoAuth.ts's boundStudentId), and also selectable here manually.
  // Sees the MongoDB-backed Demo Scenario Pack instead of the normal
  // assignment-driven My Work tab — see WorkflowManager's demo-student branch.
  { studentId: "demo-student", name: "Demo Student" },
];

export const DEMO_STUDENT_ID = "demo-student";

export function getStudentById(id: string): DemoStudent | undefined {
  return DEMO_STUDENTS.find((s) => s.studentId === id);
}
