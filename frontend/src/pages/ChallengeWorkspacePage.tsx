import React, { useState } from "react";
import {
  GraduationCap, Play, Send, RotateCcw, Download, Upload,
  Lightbulb, ChevronDown, ChevronUp, Clock, Target, AlertCircle,
  GitCompareArrows,
} from "lucide-react";
import { Assignment } from "../types/assignment";
import {
  AttemptHistoryEntry, ChallengeAttempt, ChallengeGradingResult, LearningObjective,
} from "../types/challenge";
import { SimulationResult } from "../types/network";
import { resolveHints } from "../utils/challengeHints";
import { parseAssignmentFile, importAssignmentJson, validateAssignmentJson } from "../utils/assignmentJson";
import { EXAMPLE_CHALLENGES } from "../utils/exampleChallenges";
import FeedbackPanel from "../components/FeedbackPanel";
import SolutionComparePanel from "../components/SolutionComparePanel";

// ── Difficulty chip ───────────────────────────────────────────────────────────

const DIFF_COLOR: Record<string, string> = {
  beginner:     "chip--green",
  intermediate: "chip--amber",
  advanced:     "chip--red",
};

// ── Objective chip ────────────────────────────────────────────────────────────

const ObjectiveChip: React.FC<{ obj: LearningObjective }> = ({ obj }) => (
  <span className="challenge-obj-chip">{obj}</span>
);

// ── Answer forms (per challenge type) ────────────────────────────────────────

interface AnswerFormProps {
  challengeType: string;
  answers: Record<string, unknown>;
  simResult: SimulationResult | null;
  onChange: (key: string, val: unknown) => void;
}

const AnswerForm: React.FC<AnswerFormProps> = ({ challengeType, answers, simResult, onChange }) => {
  if (challengeType === "IDENTIFY_CONGESTED_LINKS") {
    return (
      <div className="challenge-answer-form">
        <label className="challenge-answer-label">Congested link ID(s)</label>
        <input
          className="challenge-answer-input"
          type="text"
          placeholder="e.g. v-t  (comma-separate multiple)"
          value={(answers.congestedLinks as string) ?? ""}
          onChange={(e) => onChange("congestedLinks", e.target.value)}
        />
        {simResult && simResult.linkResults.some((l) => l.isCongested) && (
          <div className="challenge-answer-hint">
            Sim result: {simResult.linkResults.filter((l) => l.isCongested).map((l) => l.linkId).join(", ")} shown in red.
          </div>
        )}
      </div>
    );
  }

  if (challengeType === "COMPUTE_DV_TABLE") {
    return (
      <div className="challenge-answer-form">
        <label className="challenge-answer-label">Shortest path cost (A → D)</label>
        <input
          className="challenge-answer-input"
          type="number"
          placeholder="e.g. 30"
          value={(answers.pathCost as string) ?? ""}
          onChange={(e) => onChange("pathCost", e.target.value)}
        />
        <label className="challenge-answer-label" style={{ marginTop: 8 }}>Next-hop node label</label>
        <input
          className="challenge-answer-input"
          type="text"
          placeholder="e.g. B"
          value={(answers.nextHop as string) ?? ""}
          onChange={(e) => onChange("nextHop", e.target.value)}
        />
        {simResult?.distanceVectorTable && (
          <div className="challenge-answer-hint">
            DV table available — check the right panel for routing entries.
          </div>
        )}
      </div>
    );
  }

  if (challengeType === "REDUCE_CONGESTION" || challengeType === "FIND_ECMP_WEIGHTS") {
    const util = simResult?.maxUtilization;
    return (
      <div className="challenge-answer-form">
        <p className="challenge-answer-hint">
          Adjust link weights in the canvas, then click <strong>Run Attempt</strong>.
          The max utilization is captured automatically from the simulation result.
        </p>
        {util !== undefined && (
          <div className={`challenge-util-display ${util <= 1.0 ? "challenge-util-display--ok" : "challenge-util-display--bad"}`}>
            Current max utilization: <strong>{(util * 100).toFixed(1)}%</strong>
            {util <= 1.0
              ? " ✓ within target"
              : ` — target ≤ ${((simResult ? 1.0 : 100)).toFixed(0)}%`}
          </div>
        )}
      </div>
    );
  }

  if (challengeType === "COMPUTE_ECMP_SPLIT") {
    return (
      <div className="challenge-answer-form">
        <label className="challenge-answer-label">Traffic share for each path (0–1, comma-separated)</label>
        <input
          className="challenge-answer-input"
          type="text"
          placeholder="e.g. 0.5, 0.5  (one value per path)"
          value={(answers.trafficSharesRaw as string) ?? ""}
          onChange={(e) => {
            const vals = e.target.value.split(",").map((s) => parseFloat(s.trim())).filter((n) => !isNaN(n));
            onChange("trafficSharesRaw", e.target.value);
            // Attempt to parse demand key; for simplicity key=demand0,demand1,...
            const splits: Record<string, number> = {};
            vals.forEach((v, i) => { splits[`path${i}`] = v; });
            onChange("trafficSplits", splits);
          }}
        />
        <p className="challenge-answer-hint">Enter one traffic share per equal-cost path (e.g. 0.5 for 50%).</p>
      </div>
    );
  }

  if (challengeType === "PREDICT_SHORTEST_PATH") {
    return (
      <div className="challenge-answer-form">
        <label className="challenge-answer-label">Shortest path (node IDs or labels, comma-separated)</label>
        <input
          className="challenge-answer-input"
          type="text"
          placeholder="e.g. A, B, C, D"
          value={(answers.predictedPath as string) ?? ""}
          onChange={(e) => onChange("predictedPath", e.target.value)}
        />
      </div>
    );
  }

  return (
    <div className="challenge-answer-form">
      <p className="challenge-answer-hint">Run the simulation, then observe the results panel.</p>
    </div>
  );
};

// ── Attempt history row ───────────────────────────────────────────────────────

const HistoryRow: React.FC<{ entry: AttemptHistoryEntry }> = ({ entry }) => (
  <div className={`challenge-history-row ${entry.isCorrect ? "challenge-history-row--pass" : ""}`}>
    <span className="challenge-history-num">#{entry.attemptNumber}</span>
    <span className="challenge-history-score">{entry.score}/{entry.maxScore}</span>
    {entry.maxUtilization !== undefined && (
      <span className="challenge-history-util">
        {(entry.maxUtilization * 100).toFixed(1)}% util
      </span>
    )}
    {entry.hintsUsed > 0 && (
      <span className="challenge-history-hints">{entry.hintsUsed}h</span>
    )}
    <span className="challenge-history-time">
      {new Date(entry.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
    </span>
  </div>
);

// ── Import screen (when no assignment loaded) ─────────────────────────────────

const ChallengeImportScreen: React.FC<{ onLoad: (a: Assignment) => void }> = ({ onLoad }) => {
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  const handleFile = async (file: File) => {
    setError(null);
    try {
      const raw = await parseAssignmentFile(file);
      const result = validateAssignmentJson(raw);
      if (!result.valid) { setError(result.errors[0]); return; }
      onLoad(importAssignmentJson(raw));
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <div className="challenge-import-screen">
      <div className="challenge-import-icon"><Target size={28} /></div>
      <h3 className="challenge-import-title">Challenge Mode</h3>
      <p className="challenge-import-desc">
        Import a challenge assignment JSON or start from a built-in example.
      </p>

      <label
        className={`student-drop-zone${dragging ? " student-drop-zone--drag" : ""}`}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => { e.preventDefault(); setDragging(false); if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]); }}
      >
        <Upload size={20} />
        <span>Drop challenge JSON here or click to browse</span>
        <input type="file" accept=".json" style={{ display: "none" }}
          onChange={(e) => { if (e.target.files?.[0]) handleFile(e.target.files[0]); }} />
      </label>

      {error && <div className="student-import-error"><AlertCircle size={13} /> {error}</div>}

      <div className="challenge-built-in-label">Or start from a built-in challenge</div>
      <div className="challenge-built-in-cards">
        {EXAMPLE_CHALLENGES.map((ch) => (
          <button key={ch.assignmentId} className="challenge-built-in-card" onClick={() => onLoad(ch)}>
            <span className={`chip ${DIFF_COLOR[ch.challengeConfig?.difficulty ?? "beginner"]}`}>
              {ch.challengeConfig?.difficulty ?? "beginner"}
            </span>
            <span className="challenge-built-in-title">{ch.title}</span>
            <span className="challenge-built-in-topic">{ch.topic.replace("_", " ")}</span>
          </button>
        ))}
      </div>
    </div>
  );
};

// ── Main component ────────────────────────────────────────────────────────────

interface ChallengeWorkspacePageProps {
  assignment: Assignment | null;
  currentAttempt: ChallengeAttempt | null;
  simulationResult: SimulationResult | null;
  gradingResult: ChallengeGradingResult | null;
  attemptHistory: AttemptHistoryEntry[];
  hintsRevealed: number;
  replayMode?: "trace" | "compare" | null;
  onLoadAssignment: (a: Assignment) => void;
  onRunAttempt: () => void;
  onSubmitAttempt: (answers: Record<string, unknown>) => void;
  onResetAttempt: () => void;
  onRevealHint: () => void;
  onClearAssignment: () => void;
  onExportAttempt: () => void;
  onStartReplay?: () => void;
  onStartCompare?: () => void;
  onExitReplay?: () => void;
}

const ChallengeWorkspacePage: React.FC<ChallengeWorkspacePageProps> = ({
  assignment,
  currentAttempt,
  simulationResult,
  gradingResult,
  attemptHistory,
  hintsRevealed,
  replayMode,
  onLoadAssignment,
  onRunAttempt,
  onSubmitAttempt,
  onResetAttempt,
  onRevealHint,
  onClearAssignment,
  onExportAttempt,
  onStartReplay,
  onStartCompare,
  onExitReplay,
}) => {
  const [answers, setAnswers] = useState<Record<string, unknown>>(currentAttempt?.submittedAnswers ?? {});
  const [showHistory, setShowHistory] = useState(false);

  if (!assignment) {
    return <ChallengeImportScreen onLoad={onLoadAssignment} />;
  }

  const config = assignment.challengeConfig;
  const hints = config ? resolveHints(config.challengeType, config.hints) : [];
  const attemptsUsed = attemptHistory.length;
  const attemptsLeft = config ? config.maxAttempts - attemptsUsed : Infinity;
  const exhausted = attemptsLeft <= 0;
  const alreadyCorrect = attemptHistory.some((h) => h.isCorrect);

  const handleAnswerChange = (key: string, val: unknown) => {
    setAnswers((prev) => ({ ...prev, [key]: val }));
  };

  const handleSubmit = () => {
    // For REDUCE_CONGESTION, auto-fill maxUtilization from sim result
    const finalAnswers = { ...answers };
    if (config?.challengeType === "REDUCE_CONGESTION" || config?.challengeType === "FIND_ECMP_WEIGHTS") {
      finalAnswers.maxUtilization = simulationResult?.maxUtilization;
    }
    onSubmitAttempt(finalAnswers);
  };

  const showSolution = (() => {
    if (!config) return false;
    if (config.showOfficialSolution === "immediately") return true;
    if (config.showOfficialSolution === "after_correct" && alreadyCorrect) return true;
    return false;
  })();

  return (
    <div className="challenge-workspace">
      {/* ── Header ── */}
      <div className="challenge-header">
        <div className="challenge-role-badge">
          <GraduationCap size={12} /> Challenge Mode
        </div>
        <button className="student-clear-btn" onClick={onClearAssignment}>
          Change challenge
        </button>
      </div>

      {/* ── Assignment info card ── */}
      <div className="challenge-info-card">
        <div className="challenge-meta-row">
          {config && (
            <span className={`chip ${DIFF_COLOR[config.difficulty]}`}>
              {config.difficulty}
            </span>
          )}
          <span className="chip chip--topic">{assignment.topic.replace("_", " ")}</span>
          {config?.expectedTimeMinutes && (
            <span className="challenge-time-badge">
              <Clock size={10} /> ~{config.expectedTimeMinutes}m
            </span>
          )}
          <span className="challenge-attempts-badge">
            Attempt {attemptsUsed + 1}{config ? ` / ${config.maxAttempts}` : ""}
          </span>
        </div>
        <div className="challenge-title">{assignment.title}</div>
        {config?.learningObjectives && config.learningObjectives.length > 0 && (
          <div className="challenge-objectives">
            {config.learningObjectives.map((obj) => <ObjectiveChip key={obj} obj={obj} />)}
          </div>
        )}
      </div>

      {/* ── Task prompt ── */}
      <div className="challenge-task-section">
        <div className="challenge-section-label">Task</div>
        <p className="challenge-prompt">{assignment.studentTask.prompt}</p>
        {assignment.studentTask.instructions && (
          <div className="challenge-instructions">
            {assignment.studentTask.instructions.split("\n").map((line, i) => (
              <div key={i} className="challenge-instruction-line">{line}</div>
            ))}
          </div>
        )}
        {config && (
          <div className="challenge-goal-card">
            <Target size={11} />
            <span>
              {config.challengeType === "REDUCE_CONGESTION" || config.challengeType === "FIND_ECMP_WEIGHTS"
                ? `Goal: max utilization ≤ ${((config.target.maxUtilizationBelow ?? 1) * 100).toFixed(0)}%`
                : config.challengeType === "IDENTIFY_CONGESTED_LINKS"
                  ? "Goal: identify all congested links"
                  : config.challengeType === "COMPUTE_DV_TABLE"
                    ? "Goal: compute cost and next hop correctly"
                    : config.challengeType === "COMPUTE_ECMP_SPLIT"
                      ? "Goal: compute traffic shares for each path"
                      : "Goal: predict the correct shortest path"
              }
            </span>
            {config.editableFields.length > 0 && (
              <span className="challenge-editable-badge">
                Editable: {config.editableFields.join(", ")}
              </span>
            )}
          </div>
        )}
      </div>

      {/* ── Hints ── */}
      {hints.length > 0 && (
        <div className="challenge-hints-section">
          <div className="challenge-section-label">Hints</div>
          {hints.map((hint, idx) => {
            const revealed = idx < hintsRevealed;
            const isNext = idx === hintsRevealed;
            return (
              <div key={hint.hintId} className="challenge-hint-wrapper">
                {revealed ? (
                  <div className={`challenge-hint-card challenge-hint-card--${hint.level}`}>
                    <div className="challenge-hint-header">
                      <Lightbulb size={11} />
                      <span className="challenge-hint-level">{hint.level.replace("_", " ")}</span>
                      <span className="challenge-hint-title">{hint.title}</span>
                    </div>
                    <p className="challenge-hint-text">{hint.text}</p>
                    {hint.relatedLinkIds.length > 0 && (
                      <div className="challenge-hint-tags">
                        Links: {hint.relatedLinkIds.map((id) => (
                          <span key={id} className="fb-tag fb-tag--link">{id}</span>
                        ))}
                      </div>
                    )}
                  </div>
                ) : isNext ? (
                  <button
                    className="challenge-hint-reveal-btn"
                    onClick={onRevealHint}
                    disabled={alreadyCorrect || exhausted}
                  >
                    <Lightbulb size={12} />
                    Reveal hint {idx + 1}
                    {hint.revealCostPenalty > 0 && (
                      <span className="challenge-hint-penalty">
                        −{hint.revealCostPenalty}pts
                      </span>
                    )}
                  </button>
                ) : null}
              </div>
            );
          })}
        </div>
      )}

      {/* ── Answer form ── */}
      {!exhausted && !alreadyCorrect && (
        <div className="challenge-answer-section">
          <div className="challenge-section-label">Your answer</div>
          {config && (
            <AnswerForm
              challengeType={config.challengeType}
              answers={answers}
              simResult={simulationResult}
              onChange={handleAnswerChange}
            />
          )}
        </div>
      )}

      {/* ── Feedback ── */}
      {gradingResult && (
        <div className="challenge-feedback-section">
          <div className="challenge-section-label">Feedback</div>
          <FeedbackPanel
            result={gradingResult}
            officialSolution={assignment.expectedSolution?.explanation}
            showOfficialSolution={showSolution}
          />

          {/* Replay / compare entry points */}
          <div className="replay-actions">
            {(simulationResult?.traceEvents.length ?? 0) > 0 && onStartReplay && (
              <button
                className={`btn-sm ${gradingResult.isCorrect ? "btn-primary" : "btn-secondary"}`}
                onClick={onStartReplay}
                title="Step through the solution trace in the right panel"
              >
                <Play size={12} /> Replay Solution
              </button>
            )}
            {onStartCompare && (
              <button
                className={`btn-sm ${gradingResult.isCorrect ? "btn-secondary" : "btn-primary"}`}
                onClick={onStartCompare}
                title="Compare your answer with the correct answer"
              >
                <GitCompareArrows size={12} /> Compare with Correct
              </button>
            )}
          </div>

          {/* Replay trace active banner */}
          {replayMode === "trace" && (
            <div className="replay-trace-banner">
              <Play size={11} />
              Solution replay active — step through in the right panel
              {onExitReplay && (
                <button onClick={onExitReplay}>Exit replay</button>
              )}
            </div>
          )}

          {/* Inline comparison panel */}
          {replayMode === "compare" && onExitReplay && (
            <SolutionComparePanel result={gradingResult} onClose={onExitReplay} />
          )}
        </div>
      )}

      {/* ── Actions ── */}
      <div className="challenge-actions">
        <button
          className="btn-primary btn-sm"
          onClick={onRunAttempt}
          disabled={exhausted && !alreadyCorrect}
        >
          <Play size={13} /> Run Attempt
        </button>
        <button
          className="btn-secondary btn-sm"
          onClick={handleSubmit}
          disabled={!simulationResult || exhausted || alreadyCorrect}
          title={!simulationResult ? "Run the simulation first" : exhausted ? "No attempts left" : ""}
        >
          <Send size={13} /> Submit Attempt
        </button>
        <button className="btn-secondary btn-sm" onClick={onResetAttempt}>
          <RotateCcw size={13} /> Reset
        </button>
        <button className="btn-secondary btn-sm" onClick={onExportAttempt}>
          <Download size={13} /> Export
        </button>
      </div>

      {exhausted && !alreadyCorrect && (
        <div className="challenge-exhausted-notice">
          <AlertCircle size={12} /> Maximum attempts reached. Export your work and ask your teacher.
        </div>
      )}

      {alreadyCorrect && (
        <div className="challenge-success-notice">
          Challenge complete! Well done.
        </div>
      )}

      {/* ── Attempt history ── */}
      {attemptHistory.length > 0 && (
        <div className="challenge-history">
          <button
            className="challenge-history-toggle"
            onClick={() => setShowHistory((p) => !p)}
          >
            <span>Attempt history ({attemptHistory.length})</span>
            {showHistory ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
          </button>
          {showHistory && (
            <div className="challenge-history-list">
              {[...attemptHistory].reverse().map((entry) => (
                <HistoryRow key={entry.attemptNumber} entry={entry} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default ChallengeWorkspacePage;
