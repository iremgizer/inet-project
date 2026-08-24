// DEMO-ONLY LOCAL AUTHENTICATION.
// Replace with real authentication (JWT, OAuth, or institutional SSO) and
// database-backed user management before any production or public deployment.
// These credentials are intentionally simple and visible in source — they exist
// exclusively for local prototype demonstrations.

export type UserRole = "teacher" | "student";

interface DemoCredential {
  username: string;
  password: string;
  role: UserRole;
  // Bound student profile — set only for the "demo" account. When present,
  // the login flow skips the manual "select your profile" picker entirely
  // and signs straight in as that student, since a demo presenter should
  // never need an extra click to reach the scenario pack. Regular student
  // credentials leave this unset and go through the normal picker.
  boundStudentId?: string;
}

const DEMO_CREDENTIALS: DemoCredential[] = [
  { username: "teacher", password: "teacher", role: "teacher" },
  { username: "student", password: "student", role: "student" },
  // Demo-only account — see WORKFLOW_MANAGER's Demo Student handling and
  // README's "Demo Student" section. Clearly demo-only, same as the two
  // credentials above; does not weaken or bypass any real authentication.
  { username: "demo", password: "demo", role: "student", boundStudentId: "demo-student" },
];

export interface DemoAuthResult {
  role: UserRole;
  boundStudentId?: string;
}

export function demoAuthenticate(
  username: string,
  password: string
): DemoAuthResult | null {
  const match = DEMO_CREDENTIALS.find(
    (c) => c.username === username && c.password === password
  );
  if (!match) return null;
  return { role: match.role, boundStudentId: match.boundStudentId };
}
