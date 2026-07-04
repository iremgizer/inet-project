import React, { useState } from "react";
import { Upload, Play, CheckCircle2, Download, GraduationCap, AlertCircle, GitCompareArrows } from "lucide-react";
import { Assignment, GradingResult, StudentSubmission, TaskType } from "../types/assignment";
import { SimulationResult } from "../types/network";
import {
  createSubmissionTemplate, downloadSubmissionJson, downloadSubmissionTemplate,
  gradeSubmission, parseAssignmentFile, importAssignmentJson, validateAssignmentJson,
} from "../utils/assignmentJson";

interface StudentWorkspacePageProps {
  assignment: Assignment | null;
  submission: StudentSubmission | null;
  simulationResult: SimulationResult | null;
  gradingResult: GradingResult | null;
  hasTraceEvents?: boolean;
  onLoadAssignment: (a: Assignment) => void;
  onRunSimulation: () => void;
  onSubmitAnswers: (answers: Record<string, unknown>) => void;
  onExportSubmission: () => void;
  onClearAssignment: () => void;
  onStartReplay?: () => void;
}

// ── Import screen ─────────────────────────────────────────────────────────────

const ImportScreen: React.FC<{
  onLoad: (a: Assignment) => void;
}> = ({ onLoad }) => {
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  const handleFile = async (file: File) => {
    setError(null);
    try {
      const raw = await parseAssignmentFile(file);
      const result = validateAssignmentJson(raw);
      if (!result.valid) {
        setError(result.errors[0]);
        return;
      }
      onLoad(importAssignmentJson(raw));
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <div className="student-import-screen">
      <div className="student-import-icon">
        <GraduationCap size={28} />
      </div>
      <h3 className="student-import-title">Student Mode</h3>
      <p className="student-import-desc">
        Import an assignment JSON file provided by your teacher to begin.
      </p>

      <label
        className={`student-drop-zone${dragging ? " student-drop-zone--drag" : ""}`}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          const file = e.dataTransfer.files[0];
          if (file) handleFile(file);
        }}
      >
        <Upload size={20} />
        <span>Drop assignment JSON here or click to browse</span>
        <input
          type="file"
          accept=".json"
          style={{ display: "none" }}
          onChange={(e) => { if (e.target.files?.[0]) handleFile(e.target.files[0]); }}
        />
      </label>

      {error && (
        <div className="student-import-error">
          <AlertCircle size={13} /> {error}
        </div>
      )}

      <p className="student-import-hint">
        Ask your teacher for the assignment <code>.json</code> file, or open Teacher Mode to create one.
      </p>
    </div>
  );
};

// ── Answer forms ──────────────────────────────────────────────────────────────

interface AnswerFormProps {
  taskType: TaskType;
  answers: Record<string, unknown>;
  onChange: (k: string, v: unknown) => void;
  simulationResult: SimulationResult | null;
}

const AnswerForm: React.FC<AnswerFormProps> = ({ taskType, answers, onChange, simulationResult }) => {
  if (taskType === "IDENTIFY_CONGESTED_LINKS") {
    return (
      <div className="student-answer-form">
        <label className="student-answer-label">Congested link ID(s)</label>
        <input
          className="student-answer-input"
          type="text"
          placeholder="e.g. v-t  (comma-separate multiple)"
          value={(answers.congestedLinks as string) ?? ""}
          onChange={(e) => onChange("congestedLinks", e.target.value)}
        />
        {simulationResult && simulationResult.linkResults.some((l) => l.isCongested) && (
          <div className="student-answer-hint">
            Hint: {simulationResult.linkResults.filter((l) => l.isCongested).map((l) => l.linkId).join(", ")} marked congested in results.
          </div>
        )}
      </div>
    );
  }

  if (taskType === "COMPUTE_DV_TABLE") {
    return (
      <div className="student-answer-form">
        <label className="student-answer-label">Shortest path cost (A → D)</label>
        <input
          className="student-answer-input"
          type="number"
          placeholder="e.g. 30"
          value={(answers.pathCost as string) ?? ""}
          onChange={(e) => onChange("pathCost", e.target.value)}
        />
        <label className="student-answer-label" style={{ marginTop: 8 }}>Next-hop node label</label>
        <input
          className="student-answer-input"
          type="text"
          placeholder="e.g. B"
          value={(answers.nextHop as string) ?? ""}
          onChange={(e) => onChange("nextHop", e.target.value)}
        />
        {simulationResult?.distanceVectorTable && (
          <div className="student-answer-hint">
            DV table loaded — check the right panel for routing entries.
          </div>
        )}
      </div>
    );
  }

  if (taskType === "REDUCE_MAX_UTILIZATION") {
    const maxUtil = simulationResult?.maxUtilization;
    return (
      <div className="student-answer-form">
        <p className="student-answer-hint">
          Adjust link weights on the canvas, then run your solution. The max utilization from the
          simulation result will be auto-captured.
        </p>
        {maxUtil !== undefined && (
          <div className="student-answer-captured">
            Current max utilization: <strong>{(maxUtil * 100).toFixed(1)}%</strong>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="student-answer-form">
      <p className="student-answer-hint">
        Run the simulation, then observe the results panel on the right. Manual answer entry is not
        required for this task type.
      </p>
    </div>
  );
};

// ── Grading result display ────────────────────────────────────────────────────

const GradingDisplay: React.FC<{ result: GradingResult }> = ({ result }) => (
  <div className={`student-grading${result.passed ? " student-grading--pass" : " student-grading--fail"}`}>
    <div className="student-grading-score">
      {result.passed ? <CheckCircle2 size={15} /> : <AlertCircle size={15} />}
      <span>{result.score} / {result.maxScore}</span>
      <span className="student-grading-label">{result.passed ? "Correct" : "Incorrect"}</span>
    </div>
    <p className="student-grading-feedback">{result.feedback}</p>
  </div>
);

// ── Main component ────────────────────────────────────────────────────────────

const StudentWorkspacePage: React.FC<StudentWorkspacePageProps> = ({
  assignment,
  submission,
  simulationResult,
  gradingResult,
  hasTraceEvents = false,
  onLoadAssignment,
  onRunSimulation,
  onSubmitAnswers,
  onExportSubmission,
  onClearAssignment,
  onStartReplay,
}) => {
  const [studentName, setStudentName] = useState(submission?.studentName ?? "");
  const [answers, setAnswers] = useState<Record<string, unknown>>(submission?.submittedAnswers ?? {});
  const [localGrading, setLocalGrading] = useState<GradingResult | null>(gradingResult);

  if (!assignment) {
    return <ImportScreen onLoad={onLoadAssignment} />;
  }

  const { studentTask } = assignment;

  const handleAnswerChange = (key: string, value: unknown) => {
    setAnswers((prev) => ({ ...prev, [key]: value }));
    setLocalGrading(null);
  };

  const handleCheckAnswer = () => {
    if (!submission) return;
    const filled = { ...submission, studentName, submittedAnswers: answers };
    const result = gradeSubmission(filled, assignment);
    setLocalGrading(result);
    onSubmitAnswers(answers);
  };

  const handleExport = () => {
    if (submission) {
      const filled = { ...submission, studentName, submittedAnswers: answers };
      downloadSubmissionJson(filled);
    } else {
      downloadSubmissionTemplate(assignment, studentName);
    }
    onExportSubmission();
  };

  // Auto-fill max utilization for REDUCE_MAX_UTILIZATION tasks
  const effectiveAnswers =
    studentTask.taskType === "REDUCE_MAX_UTILIZATION" && simulationResult
      ? { ...answers, maxUtilization: simulationResult.maxUtilization }
      : answers;

  return (
    <div className="student-workspace">
      {/* ── Assignment header ── */}
      <div className="student-header">
        <div className="student-role-badge">
          <GraduationCap size={12} /> Student Mode
        </div>
        <button className="student-clear-btn" onClick={onClearAssignment} title="Load a different assignment">
          Change assignment
        </button>
      </div>

      {/* ── Assignment info ── */}
      <div className="student-assignment-card">
        <div className="student-assignment-meta">
          <span className="student-topic-chip">{assignment.topic.replace("_", " ")}</span>
          <span className="student-mode-chip">{assignment.mode}</span>
        </div>
        <div className="student-assignment-title">{assignment.title}</div>
        {assignment.course && <div className="student-course">{assignment.course}</div>}
        {assignment.description && (
          <p className="student-description">{assignment.description}</p>
        )}
      </div>

      {/* ── Task prompt ── */}
      <div className="student-task-section">
        <div className="student-task-label">Your task</div>
        <p className="student-task-prompt">{studentTask.prompt}</p>

        {studentTask.instructions && (
          <div className="student-instructions">
            {studentTask.instructions.split("\n").map((line, i) => (
              <div key={i} className="student-instruction-line">{line}</div>
            ))}
          </div>
        )}

        {studentTask.answerFormatDescription && (
          <p className="student-format-hint">{studentTask.answerFormatDescription}</p>
        )}
      </div>

      {/* ── Answer form ── */}
      <div className="student-answer-section">
        <div className="student-task-label">Your answer</div>
        <AnswerForm
          taskType={studentTask.taskType}
          answers={effectiveAnswers}
          onChange={handleAnswerChange}
          simulationResult={simulationResult}
        />
      </div>

      {/* ── Grading result ── */}
      {localGrading && <GradingDisplay result={localGrading} />}

      {/* ── Replay entry point ── */}
      {localGrading && (
        <div className="replay-actions">
          {hasTraceEvents && onStartReplay && (
            <button
              className={`btn-sm ${localGrading.passed ? "btn-primary" : "btn-secondary"}`}
              onClick={onStartReplay}
              title="Step through the simulation trace in the right panel"
            >
              <Play size={12} /> Replay Solution
            </button>
          )}
          {localGrading.details && (
            <span className="replay-actions-hint">
              <GitCompareArrows size={11} /> See expected answers in the grading details below
            </span>
          )}
        </div>
      )}

      {/* ── Student name ── */}
      <div className="student-name-row">
        <label className="student-name-label">Your name</label>
        <input
          className="student-name-input"
          type="text"
          placeholder="Enter your name (optional)"
          value={studentName}
          onChange={(e) => setStudentName(e.target.value)}
        />
      </div>

      {/* ── Action buttons ── */}
      <div className="student-actions">
        <button className="btn-primary btn-sm" onClick={onRunSimulation}>
          <Play size={13} /> Run My Solution
        </button>
        <button className="btn-secondary btn-sm" onClick={handleCheckAnswer} disabled={!submission}
          title={!submission ? "Run simulation first" : undefined}>
          <CheckCircle2 size={13} /> Check Answer
        </button>
        <button className="btn-secondary btn-sm" onClick={handleExport}>
          <Download size={13} /> Export Submission
        </button>
      </div>

      {!assignment.expectedSolution && (
        <p className="student-no-grading-note">
          Submit your work to your teacher — auto-grading not configured.
        </p>
      )}
    </div>
  );
};

export default StudentWorkspacePage;
