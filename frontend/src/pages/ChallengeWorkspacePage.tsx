import React, { useState } from "react";
import {
  GraduationCap, Play, Send, RotateCcw, Download, Upload,
  Lightbulb, ChevronDown, ChevronUp, Clock, Target, AlertCircle,
  GitCompareArrows, CheckCircle2, X, BookOpen,
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

// ── Field map: teacher → student UI ──────────────────────────────────────────
// title                              → quiz header
// challengeConfig.difficulty         → difficulty badge
// challengeConfig.expectedTimeMinutes→ time badge
// challengeConfig.learningObjectives → topic chips
// studentTask.prompt                 → Question card
// studentTask.instructions           → "How to solve" collapsible
// challengeConfig.target             → Goal card
// challengeConfig.hints              → Hints section (locked / revealed)
// studentTask.answerFormatDescription→ answer helper text
// challengeConfig.editableFields     → "You can edit" note in Goal card
// expectedSolution.explanation       → shown after correct (Official solution)

// ── Constants ─────────────────────────────────────────────────────────────────

const DIFF_COLOR: Record<string, string> = {
  beginner:     "chip--green",
  intermediate: "chip--amber",
  advanced:     "chip--red",
};

const STEP_LABELS = ["Read", "Run", "Answer", "Submit", "Learn"] as const;

// ── Progress rail ─────────────────────────────────────────────────────────────

const ProgressRail: React.FC<{ phase: number }> = ({ phase }) => (
  <div className="cqv-rail">
    {STEP_LABELS.map((label, i) => (
      <React.Fragment key={label}>
        <div className={`cqv-rail-step${i <= phase ? " cqv-rail-step--done" : ""}${i === phase ? " cqv-rail-step--active" : ""}`}>
          <div className="cqv-rail-dot">
            {i < phase ? <CheckCircle2 size={9} /> : <span>{i + 1}</span>}
          </div>
          <span className="cqv-rail-label">{label}</span>
        </div>
        {i < STEP_LABELS.length - 1 && (
          <div className={`cqv-rail-connector${i < phase ? " cqv-rail-connector--done" : ""}`} />
        )}
      </React.Fragment>
    ))}
  </div>
);

// ── Objective chip ────────────────────────────────────────────────────────────

const ObjectiveChip: React.FC<{ obj: LearningObjective }> = ({ obj }) => (
  <span className="cqv-obj-chip">{obj}</span>
);

// ── Goal text ─────────────────────────────────────────────────────────────────

function goalText(type: string, target: Record<string, unknown>): string {
  switch (type) {
    case "REDUCE_CONGESTION":
    case "FIND_ECMP_WEIGHTS":
      return `Achieve max link utilization ≤ ${(((target.maxUtilizationBelow as number) ?? 1) * 100).toFixed(0)}%`;
    case "IDENTIFY_CONGESTED_LINKS":
      return "Identify all links where traffic load exceeds capacity";
    case "COMPUTE_DV_TABLE":
      return "Compute the correct path cost and next hop from the routing table";
    case "COMPUTE_ECMP_SPLIT":
      return "Compute the traffic share for each equal-cost path";
    case "PREDICT_SHORTEST_PATH":
      return "Predict the correct shortest path through the network";
    default:
      return "Complete the challenge";
  }
}

// ── Hint card ─────────────────────────────────────────────────────────────────

type HintState = "locked" | "next" | "revealed";

const HintCard: React.FC<{
  hint: ReturnType<typeof resolveHints>[0];
  state: HintState;
  index: number;
  onReveal: () => void;
  disabled: boolean;
}> = ({ hint, state, index, onReveal, disabled }) => {
  if (state === "revealed") {
    return (
      <div className={`cqv-hint-card cqv-hint-card--revealed cqv-hint-card--${hint.level}`}>
        <div className="cqv-hint-header">
          <Lightbulb size={11} className="cqv-hint-icon" />
          <span className="cqv-hint-num">Hint {index + 1}</span>
          <span className="cqv-hint-level">{hint.level.replace("_", " ")}</span>
        </div>
        <p className="cqv-hint-title">{hint.title}</p>
        <p className="cqv-hint-text">{hint.text}</p>
        {hint.relatedLinkIds.length > 0 && (
          <div className="cqv-hint-tags">
            Links: {hint.relatedLinkIds.map(id => (
              <span key={id} className="fb-tag fb-tag--link">{id}</span>
            ))}
          </div>
        )}
      </div>
    );
  }

  if (state === "next") {
    return (
      <button className="cqv-hint-unlock" onClick={onReveal} disabled={disabled}>
        <Lightbulb size={11} />
        <span>Reveal hint {index + 1} — {hint.title}</span>
        {hint.revealCostPenalty > 0 && (
          <span className="cqv-hint-cost">−{hint.revealCostPenalty}pts</span>
        )}
      </button>
    );
  }

  return (
    <div className="cqv-hint-locked">
      <Lightbulb size={10} />
      <span>Hint {index + 1}</span>
    </div>
  );
};

// ── Answer forms ──────────────────────────────────────────────────────────────

interface AnswerFormProps {
  challengeType: string;
  answers: Record<string, unknown>;
  simResult: SimulationResult | null;
  assignment: Assignment;
  onChange: (key: string, val: unknown) => void;
}

const AnswerForm: React.FC<AnswerFormProps> = ({
  challengeType, answers, simResult, assignment, onChange,
}) => {
  const links = assignment.starterNetwork.links;
  const nodes = assignment.starterNetwork.nodes;

  // ── Identify Congested Links: checkbox list ──────────────────────────────────
  if (challengeType === "IDENTIFY_CONGESTED_LINKS") {
    const selectedIds: string[] = (() => {
      const raw = answers.congestedLinks;
      if (Array.isArray(raw)) return raw as string[];
      if (typeof raw === "string") return raw.split(",").map(s => s.trim()).filter(Boolean);
      return [];
    })();

    const toggle = (id: string) => {
      const next = selectedIds.includes(id)
        ? selectedIds.filter(l => l !== id)
        : [...selectedIds, id];
      onChange("congestedLinks", next);
    };

    return (
      <div className="cqv-icl-form">
        <p className="cqv-answer-helper">Select the links you believe are congested — where load exceeds capacity:</p>
        <div className="cqv-link-checks">
          {links.map(link => {
            const isSelected = selectedIds.includes(link.id);
            const simLink = simResult?.linkResults.find(l => l.linkId === link.id);
            const fromLabel = nodes.find(n => n.id === link.source)?.label ?? link.source;
            const toLabel   = nodes.find(n => n.id === link.target)?.label ?? link.target;
            return (
              <label
                key={link.id}
                className={`cqv-link-option${isSelected ? " cqv-link-option--selected" : ""}`}
              >
                <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={() => toggle(link.id)}
                />
                <span className="cqv-link-label">{fromLabel} → {toLabel}</span>
                <span className="cqv-link-id">({link.id})</span>
                {simResult && simLink && (
                  <span className={`cqv-link-util${simLink.isCongested ? " cqv-link-util--over" : ""}`}>
                    {(simLink.utilization * 100).toFixed(0)}%
                  </span>
                )}
              </label>
            );
          })}
        </div>
        {simResult?.linkResults.some(l => l.isCongested) && (
          <p className="cqv-answer-helper cqv-answer-helper--hint">
            Congested links appear red/orange on the canvas and in the Results panel.
          </p>
        )}
      </div>
    );
  }

  // ── Compute DV Table: structured inputs ──────────────────────────────────────
  if (challengeType === "COMPUTE_DV_TABLE") {
    const target = assignment.challengeConfig?.target;
    const expected = target?.expectedDVEntries ?? [];
    const src = expected[0] ? (nodes.find(n => n.id === expected[0].nodeId)?.label ?? expected[0].nodeId) : null;
    const dst = expected[0] ? (nodes.find(n => n.id === expected[0].destinationId)?.label ?? expected[0].destinationId) : null;

    return (
      <div className="cqv-dv-form">
        {src && dst && (
          <p className="cqv-answer-helper">
            Compute the shortest path from <strong>{src}</strong> to <strong>{dst}</strong>:
          </p>
        )}
        <div className="cqv-dv-row">
          <div className="cqv-dv-field">
            <label className="cqv-field-label">Total path cost</label>
            <input
              className="cqv-input"
              type="number"
              placeholder="e.g. 30"
              value={(answers.pathCost as string) ?? ""}
              onChange={e => onChange("pathCost", e.target.value)}
            />
          </div>
          <div className="cqv-dv-field">
            <label className="cqv-field-label">Next-hop node</label>
            <input
              className="cqv-input"
              type="text"
              placeholder="e.g. B"
              value={(answers.nextHop as string) ?? ""}
              onChange={e => onChange("nextHop", e.target.value)}
            />
          </div>
        </div>
        {simResult?.distanceVectorTable && (
          <p className="cqv-answer-helper cqv-answer-helper--hint">
            The Routing Table panel on the right shows the DV entries — use it to verify.
          </p>
        )}
        {assignment.studentTask.answerFormatDescription && (
          <p className="cqv-answer-helper">{assignment.studentTask.answerFormatDescription}</p>
        )}
      </div>
    );
  }

  // ── Reduce Congestion / Find ECMP Weights: utilization feedback ───────────────
  if (challengeType === "REDUCE_CONGESTION" || challengeType === "FIND_ECMP_WEIGHTS") {
    const util = simResult?.maxUtilization;
    const targetUtil = assignment.challengeConfig?.target.maxUtilizationBelow ?? 1.0;

    return (
      <div className="cqv-util-form">
        <p className="cqv-answer-helper">
          Adjust link weights in the canvas, then click <strong>Run simulation</strong> to check utilization.
        </p>
        {util !== undefined ? (
          <div className={`cqv-util-bar${util <= targetUtil ? " cqv-util-bar--ok" : " cqv-util-bar--bad"}`}>
            <div className="cqv-util-bar-info">
              <span className="cqv-util-bar-label">Max utilization</span>
              <span className="cqv-util-bar-target">target ≤ {(targetUtil * 100).toFixed(0)}%</span>
            </div>
            <div className="cqv-util-bar-value">
              {util <= targetUtil && <CheckCircle2 size={13} />}
              <strong>{(util * 100).toFixed(1)}%</strong>
            </div>
          </div>
        ) : (
          <div className="cqv-util-pending">Run simulation to see current max utilization</div>
        )}
      </div>
    );
  }

  // ── Compute ECMP Split ────────────────────────────────────────────────────────
  if (challengeType === "COMPUTE_ECMP_SPLIT") {
    const paths = simResult?.pathResults.flatMap((pr, di) =>
      pr.paths.map((p, pi) => ({ key: `path${di * 10 + pi}`, label: p.nodes.join(" → "), share: p.trafficShare }))
    ) ?? [];

    return (
      <div className="cqv-ecmp-form">
        <p className="cqv-answer-helper">
          Enter the traffic share (0–1) for each equal-cost path. ECMP splits demand equally among shortest paths.
        </p>
        {paths.length > 0 ? (
          <div className="cqv-ecmp-paths">
            {paths.map((path, i) => {
              const splits = (answers.trafficSplits as Record<string, number>) ?? {};
              return (
                <div key={path.key} className="cqv-ecmp-path-row">
                  <span className="cqv-ecmp-path-label">Path {i + 1}: {path.label}</span>
                  <input
                    className="cqv-input cqv-input--narrow"
                    type="number"
                    step="0.01"
                    min="0"
                    max="1"
                    placeholder="0.5"
                    value={splits[path.key] ?? ""}
                    onChange={e => {
                      const v = parseFloat(e.target.value);
                      const next = { ...splits, [path.key]: isNaN(v) ? undefined : v } as Record<string, number>;
                      onChange("trafficSplits", next);
                      onChange("trafficSharesRaw", Object.values(next).join(", "));
                    }}
                  />
                </div>
              );
            })}
          </div>
        ) : (
          <div className="cqv-ecmp-paths">
            <p className="cqv-answer-helper cqv-answer-helper--hint">Run simulation first — paths will appear here.</p>
            <input
              className="cqv-input"
              type="text"
              placeholder="e.g. 0.5, 0.5  (one share per path)"
              value={(answers.trafficSharesRaw as string) ?? ""}
              onChange={e => {
                const vals = e.target.value.split(",").map(s => parseFloat(s.trim())).filter(n => !isNaN(n));
                onChange("trafficSharesRaw", e.target.value);
                const splits: Record<string, number> = {};
                vals.forEach((v, i) => { splits[`path${i}`] = v; });
                onChange("trafficSplits", splits);
              }}
            />
          </div>
        )}
      </div>
    );
  }

  // ── Predict Shortest Path ─────────────────────────────────────────────────────
  if (challengeType === "PREDICT_SHORTEST_PATH") {
    return (
      <div className="cqv-path-form">
        <label className="cqv-field-label">
          Shortest path — enter node labels separated by commas or arrows
        </label>
        <input
          className="cqv-input"
          type="text"
          placeholder="e.g. A, B, C, D  or  A → B → C → D"
          value={(answers.predictedPath as string) ?? ""}
          onChange={e => onChange("predictedPath", e.target.value)}
        />
        {assignment.studentTask.answerFormatDescription && (
          <p className="cqv-answer-helper">{assignment.studentTask.answerFormatDescription}</p>
        )}
      </div>
    );
  }

  return (
    <p className="cqv-answer-helper">Run the simulation, then observe the results in the right panel.</p>
  );
};

// ── Attempt history row ───────────────────────────────────────────────────────

const HistoryRow: React.FC<{ entry: AttemptHistoryEntry }> = ({ entry }) => (
  <div className={`cqv-history-row${entry.isCorrect ? " cqv-history-row--pass" : ""}`}>
    <span className="cqv-history-num">#{entry.attemptNumber}</span>
    <span className="cqv-history-score">{entry.score}/{entry.maxScore}</span>
    {entry.maxUtilization !== undefined && (
      <span className="cqv-history-util">{(entry.maxUtilization * 100).toFixed(1)}%</span>
    )}
    {entry.hintsUsed > 0 && <span className="cqv-history-hints">{entry.hintsUsed}h</span>}
    <span className="cqv-history-time">
      {new Date(entry.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
    </span>
  </div>
);

// ── Import / start screen ─────────────────────────────────────────────────────

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
        onDragOver={e => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={e => { e.preventDefault(); setDragging(false); if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]); }}
      >
        <Upload size={20} />
        <span>Drop challenge JSON here or click to browse</span>
        <input type="file" accept=".json" style={{ display: "none" }}
          onChange={e => { if (e.target.files?.[0]) handleFile(e.target.files[0]); }} />
      </label>

      {error && <div className="student-import-error"><AlertCircle size={13} /> {error}</div>}

      <div className="challenge-built-in-label">Or start from a built-in challenge</div>
      <div className="challenge-built-in-cards">
        {EXAMPLE_CHALLENGES.map(ch => (
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
  const [answers, setAnswers] = useState<Record<string, unknown>>(
    currentAttempt?.submittedAnswers ?? {},
  );
  const [showInstructions, setShowInstructions] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  if (!assignment) return <ChallengeImportScreen onLoad={onLoadAssignment} />;

  const config = assignment.challengeConfig;
  const hints = config ? resolveHints(config.challengeType, config.hints) : [];
  const attemptsUsed = attemptHistory.length;
  const attemptsLeft = config ? config.maxAttempts - attemptsUsed : Infinity;
  const exhausted = attemptsLeft <= 0;
  const alreadyCorrect = attemptHistory.some(h => h.isCorrect);

  // Quiz phase: 0=Read, 1=Run(unused slot), 2=Answer, 3=Submit(unused), 4=Learn
  const quizPhase: number = gradingResult ? 4 : simulationResult ? 2 : 0;

  const showSolution = (() => {
    if (!config) return false;
    if (config.showOfficialSolution === "immediately") return true;
    if (config.showOfficialSolution === "after_correct" && alreadyCorrect) return true;
    return false;
  })();

  const handleAnswerChange = (key: string, val: unknown) => {
    setAnswers(prev => ({ ...prev, [key]: val }));
  };

  const handleSubmit = () => {
    const finalAnswers = { ...answers };
    if (
      config?.challengeType === "REDUCE_CONGESTION" ||
      config?.challengeType === "FIND_ECMP_WEIGHTS"
    ) {
      finalAnswers.maxUtilization = simulationResult?.maxUtilization;
    }
    onSubmitAttempt(finalAnswers);
  };

  const hasTrace = (simulationResult?.traceEvents.length ?? 0) > 0;

  return (
    <div className="cqv-panel">

      {/* ── Header ── */}
      <div className="cqv-header">
        <div className="cqv-header-top">
          <div className="cqv-role-badge"><GraduationCap size={11} /> Challenge</div>
          <button className="cqv-change-btn" onClick={onClearAssignment}>Change</button>
        </div>
        <h2 className="cqv-title">{assignment.title}</h2>
        <div className="cqv-badges">
          {config && (
            <span className={`chip ${DIFF_COLOR[config.difficulty]}`}>{config.difficulty}</span>
          )}
          <span className="chip chip--topic">{assignment.topic.replace("_", " ")}</span>
          {config?.expectedTimeMinutes && (
            <span className="cqv-time-badge">
              <Clock size={10} /> ~{config.expectedTimeMinutes}m
            </span>
          )}
          <span className="cqv-attempts-badge">
            {attemptsLeft === Infinity
              ? "Unlimited attempts"
              : `${attemptsLeft} attempt${attemptsLeft !== 1 ? "s" : ""} left`}
          </span>
        </div>
        {config?.learningObjectives && config.learningObjectives.length > 0 && (
          <div className="cqv-objectives">
            {config.learningObjectives.map(obj => <ObjectiveChip key={obj} obj={obj} />)}
          </div>
        )}
      </div>

      {/* ── Progress rail ── */}
      <ProgressRail phase={quizPhase} />

      {/* ── Question card ── */}
      <div className="cqv-question-card">
        <div className="cqv-card-eyebrow">Question</div>
        <p className="cqv-question-text">{assignment.studentTask.prompt}</p>
      </div>

      {/* ── Goal card ── */}
      {config && (
        <div className="cqv-goal-card">
          <Target size={12} className="cqv-goal-icon" />
          <div className="cqv-goal-body">
            <div className="cqv-card-eyebrow">Goal</div>
            <p className="cqv-goal-text">
              {goalText(config.challengeType, config.target as Record<string, unknown>)}
            </p>
            {config.editableFields.length > 0 && (
              <div className="cqv-editable-note">
                You can edit: {config.editableFields.join(", ")}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── How to solve (collapsible) ── */}
      {assignment.studentTask.instructions && (
        <div className="cqv-collapsible">
          <button
            className="cqv-collapsible-btn"
            onClick={() => setShowInstructions(p => !p)}
          >
            <BookOpen size={11} />
            <span>How to solve</span>
            {showInstructions ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
          </button>
          {showInstructions && (
            <div className="cqv-collapsible-body">
              {assignment.studentTask.instructions.split("\n").map((line, i) => (
                <div key={i} className="cqv-instruction-line">{line}</div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Hints ── */}
      {hints.length > 0 && (
        <div className="cqv-hints-section">
          <div className="cqv-section-label">
            Hints <span className="cqv-hint-counter">({hintsRevealed}/{hints.length} revealed)</span>
          </div>
          {hints.map((hint, idx) => {
            const state: HintState =
              idx < hintsRevealed ? "revealed"
              : idx === hintsRevealed ? "next"
              : "locked";
            return (
              <HintCard
                key={hint.hintId}
                hint={hint}
                state={state}
                index={idx}
                onReveal={onRevealHint}
                disabled={alreadyCorrect || exhausted}
              />
            );
          })}
        </div>
      )}

      {/* ── Run simulation ── */}
      <div className="cqv-run-section">
        <button
          className="btn-primary cqv-run-btn"
          onClick={onRunAttempt}
          disabled={exhausted && !alreadyCorrect}
        >
          <Play size={13} /> Run simulation
        </button>
        {!simulationResult && !gradingResult && (
          <p className="cqv-run-hint">Run to see how traffic flows through the network</p>
        )}
        {simulationResult && !gradingResult && (
          <p className="cqv-run-ok">
            <CheckCircle2 size={11} /> Simulation complete — enter your answer below
          </p>
        )}
      </div>

      {/* ── Answer card ── */}
      {!exhausted && !alreadyCorrect && (
        <div className={`cqv-answer-card${!simulationResult ? " cqv-answer-card--inactive" : ""}`}>
          <div className="cqv-card-eyebrow">Your answer</div>
          {!simulationResult ? (
            <div className="cqv-answer-gate">
              <AlertCircle size={12} /> Run simulation first to activate answer input
            </div>
          ) : (
            config && (
              <AnswerForm
                challengeType={config.challengeType}
                answers={answers}
                simResult={simulationResult}
                assignment={assignment}
                onChange={handleAnswerChange}
              />
            )
          )}
        </div>
      )}

      {/* ── Submit / Reset ── */}
      {!exhausted && !alreadyCorrect && (
        <div className="cqv-submit-row">
          <button
            className="btn-primary cqv-submit-btn"
            onClick={handleSubmit}
            disabled={!simulationResult}
            title={!simulationResult ? "Run simulation first" : ""}
          >
            <Send size={13} /> Submit answer
          </button>
          <button className="btn-secondary btn-sm" onClick={onResetAttempt}>
            <RotateCcw size={12} /> Reset
          </button>
        </div>
      )}

      {/* ── Status notices ── */}
      {exhausted && !alreadyCorrect && (
        <div className="cqv-notice cqv-notice--exhausted">
          <AlertCircle size={12} /> All attempts used. Export your work and ask your teacher for review.
        </div>
      )}
      {alreadyCorrect && (
        <div className="cqv-notice cqv-notice--success">
          <CheckCircle2 size={12} /> Challenge complete — well done!
        </div>
      )}

      {/* ── Result card ── */}
      {gradingResult && (
        <div className={`cqv-result-card${gradingResult.isCorrect ? " cqv-result-card--correct" : " cqv-result-card--incorrect"}`}>
          <div className="cqv-result-header">
            <div className={`cqv-result-icon${gradingResult.isCorrect ? " cqv-result-icon--correct" : " cqv-result-icon--incorrect"}`}>
              {gradingResult.isCorrect ? <CheckCircle2 size={18} /> : <X size={18} />}
            </div>
            <div className="cqv-result-body">
              <div className="cqv-result-verdict">
                {gradingResult.isCorrect ? "Correct!" : "Not quite"}
              </div>
              <div className="cqv-result-score-line">
                {gradingResult.score} / {gradingResult.maxScore} pts
                <span className="cqv-result-pct">({gradingResult.percentage}%)</span>
                {gradingResult.hintsUsed > 0 && (
                  <span className="cqv-result-hints-note">
                    · {gradingResult.hintsUsed} hint{gradingResult.hintsUsed > 1 ? "s" : ""} used
                  </span>
                )}
              </div>
            </div>
          </div>

          <FeedbackPanel
            result={gradingResult}
            officialSolution={assignment.expectedSolution?.explanation}
            showOfficialSolution={showSolution}
          />

          {/* Replay / compare buttons */}
          <div className="cqv-result-actions">
            {hasTrace && onStartReplay && (
              <button
                className={`btn-sm ${gradingResult.isCorrect ? "btn-primary" : "btn-secondary"}`}
                onClick={onStartReplay}
              >
                <Play size={12} /> Replay solution
              </button>
            )}
            {onStartCompare && (
              <button
                className={`btn-sm ${gradingResult.isCorrect ? "btn-secondary" : "btn-primary"}`}
                onClick={onStartCompare}
              >
                <GitCompareArrows size={12} /> Compare with correct
              </button>
            )}
          </div>

          {/* Replay active banner */}
          {replayMode === "trace" && (
            <div className="cqv-replay-banner">
              <Play size={11} /> Replay active — step through in the right panel
              {onExitReplay && (
                <button className="cqv-replay-exit" onClick={onExitReplay}>Exit</button>
              )}
            </div>
          )}

          {/* Inline compare panel */}
          {replayMode === "compare" && onExitReplay && (
            <SolutionComparePanel result={gradingResult} onClose={onExitReplay} />
          )}
        </div>
      )}

      {/* ── Footer ── */}
      <div className="cqv-footer">
        <button className="btn-secondary btn-xs" onClick={onExportAttempt}>
          <Download size={11} /> Export attempt
        </button>
        {attemptHistory.length > 0 && (
          <button className="cqv-history-toggle" onClick={() => setShowHistory(p => !p)}>
            History ({attemptHistory.length})
            {showHistory ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
          </button>
        )}
      </div>

      {showHistory && (
        <div className="cqv-history-list">
          {[...attemptHistory].reverse().map(entry => (
            <HistoryRow key={entry.attemptNumber} entry={entry} />
          ))}
        </div>
      )}
    </div>
  );
};

export default ChallengeWorkspacePage;
