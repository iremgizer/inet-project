import React, { useState } from "react";
import { BookOpen, GraduationCap, ArrowLeft, LogIn, AlertCircle, ChevronRight, Network } from "lucide-react";
import { UserRole, demoAuthenticate } from "../utils/demoAuth";
import { DEMO_STUDENTS } from "../utils/demoUsers";

interface LandingPageProps {
  onLogin: (role: UserRole, studentId?: string) => void;
  onGuestLab?: () => void;
}

type LandingStep = "select-role" | "login" | "select-student";

const ROLE_META = {
  teacher: {
    label: "Teacher",
    Icon: BookOpen,
    description: "Create assignments, present lecture examples, review submissions.",
    hint: "Username: teacher · Password: teacher",
  },
  student: {
    label: "Student",
    Icon: GraduationCap,
    description: "Solve assignments, run simulations, explore routing algorithms.",
    hint: "Username: student · Password: student",
  },
} as const;

const LandingPage: React.FC<LandingPageProps> = ({ onLogin, onGuestLab }) => {
  const [step, setStep] = useState<LandingStep>("select-role");
  const [selectedRole, setSelectedRole] = useState<UserRole | null>(null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  const handleSelectRole = (role: UserRole) => {
    setSelectedRole(role);
    setUsername("");
    setPassword("");
    setError(null);
    setStep("login");
  };

  const handleBack = () => {
    setStep("select-role");
    setSelectedRole(null);
    setUsername("");
    setPassword("");
    setError(null);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const role = demoAuthenticate(username, password);
    if (!role) { setError("Invalid credentials."); return; }
    if (role !== selectedRole) { setError("These credentials belong to a different role."); return; }
    if (role === "student") {
      setStep("select-student");
    } else {
      onLogin(role);
    }
  };

  return (
    <div className="landing-page">
      <div className="landing-inner">
        <div className="landing-brand">
          <div className="landing-logo">◈</div>
          <h1 className="landing-title">Network Algorithm Lab</h1>
          <p className="landing-sub">Interactive routing and traffic engineering learning platform</p>
        </div>

        {step === "select-role" && (
          <>
            <div className="landing-roles">
              {(["teacher", "student"] as UserRole[]).map((role) => {
                const { label, Icon, description } = ROLE_META[role];
                return (
                  <button
                    key={role}
                    className="landing-role-card"
                    onClick={() => handleSelectRole(role)}
                  >
                    <Icon size={26} className="landing-role-icon" />
                    <div className="landing-role-body">
                      <div className="landing-role-title">{label}</div>
                      <div className="landing-role-desc">{description}</div>
                    </div>
                    <ChevronRight size={16} style={{ color: "var(--text-3)", flexShrink: 0 }} />
                  </button>
                );
              })}
            </div>

            <div className="landing-guest-section">
              <div className="landing-guest-divider"><span>or</span></div>
              <button className="landing-guest-btn" onClick={onGuestLab}>
                <Network size={17} className="landing-guest-icon" />
                <div className="landing-guest-body">
                  <div className="landing-guest-title">Start Building a Network</div>
                  <div className="landing-guest-sub">No account needed — explore the simulator instantly.</div>
                </div>
                <ChevronRight size={15} style={{ color: "var(--text-3)", flexShrink: 0 }} />
              </button>
            </div>
          </>
        )}

        {step === "login" && selectedRole && (
          <div className="landing-login-box">
            <button className="landing-back-btn" onClick={handleBack}>
              <ArrowLeft size={13} /> Back
            </button>
            <div className="landing-login-role">
              {selectedRole === "teacher" ? <BookOpen size={16} /> : <GraduationCap size={16} />}
              <span>Sign in as {ROLE_META[selectedRole].label}</span>
            </div>
            <div className="demo-auth-notice">
              Demo login — local prototype only. Not for production use.
            </div>
            <form className="landing-form" onSubmit={handleSubmit}>
              <input
                className="landing-input"
                type="text"
                placeholder="Username"
                value={username}
                autoFocus
                autoComplete="off"
                onChange={(e) => { setUsername(e.target.value); setError(null); }}
              />
              <input
                className="landing-input"
                type="password"
                placeholder="Password"
                value={password}
                autoComplete="current-password"
                onChange={(e) => { setPassword(e.target.value); setError(null); }}
              />
              {error && (
                <div className="landing-error">
                  <AlertCircle size={12} /> {error}
                </div>
              )}
              <button className="btn-primary landing-submit" type="submit">
                <LogIn size={13} /> Sign in
              </button>
            </form>
            <div className="landing-demo-hint">{ROLE_META[selectedRole].hint}</div>
          </div>
        )}

        {step === "select-student" && (
          <div className="landing-login-box">
            <button className="landing-back-btn" onClick={() => setStep("login")}>
              <ArrowLeft size={13} /> Back
            </button>
            <div className="landing-login-role">
              <GraduationCap size={16} />
              <span>Select your profile</span>
            </div>
            <p className="landing-picker-sub">Choose which demo student you are for this session.</p>
            <div className="landing-student-picker">
              {DEMO_STUDENTS.map((s) => (
                <button
                  key={s.studentId}
                  className="landing-student-card"
                  onClick={() => onLogin("student", s.studentId)}
                >
                  <GraduationCap size={18} style={{ color: "var(--accent)", flexShrink: 0 }} />
                  <div style={{ flex: 1 }}>
                    <div className="landing-student-name">{s.name}</div>
                    <div className="landing-student-id">{s.studentId}</div>
                  </div>
                  <ChevronRight size={14} style={{ color: "var(--text-3)", flexShrink: 0 }} />
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default LandingPage;
