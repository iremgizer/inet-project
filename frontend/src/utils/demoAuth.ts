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
}

const DEMO_CREDENTIALS: DemoCredential[] = [
  { username: "teacher", password: "teacher", role: "teacher" },
  { username: "student", password: "student", role: "student" },
];

export function demoAuthenticate(
  username: string,
  password: string
): UserRole | null {
  const match = DEMO_CREDENTIALS.find(
    (c) => c.username === username && c.password === password
  );
  return match?.role ?? null;
}
