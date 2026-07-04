import { DemoStudent } from "../types/classroom";

export const DEMO_STUDENTS: DemoStudent[] = [
  { studentId: "s001", name: "Alice Student" },
  { studentId: "s002", name: "Bob Student" },
  { studentId: "s003", name: "Charlie Student" },
];

export function getStudentById(id: string): DemoStudent | undefined {
  return DEMO_STUDENTS.find((s) => s.studentId === id);
}
