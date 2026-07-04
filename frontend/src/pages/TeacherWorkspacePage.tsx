import React, { useState } from "react";
import {
  BookOpen, Download, Eye, Plus, Save, Upload, ChevronDown, ChevronUp,
} from "lucide-react";
import {
  Assignment, AssignmentMode, AssignmentSummary, AssignmentTopic, LockedFields, TaskType,
} from "../types/assignment";
import {
  ChallengeConfig, ChallengeType, ChallengeDifficulty, EditableField,
  LearningObjective, SolutionVisibility, Hint,
} from "../types/challenge";
import { AlgorithmName, NetworkInput } from "../types/network";
import {
  defaultGradingRules, defaultLockedFields, defaultStudentTask,
  downloadAssignmentJson, downloadExampleAssignmentJson,
  validateAssignmentJson,
} from "../utils/assignmentJson";
import { getDefaultHints } from "../utils/challengeHints";
import { EXAMPLE_ASSIGNMENTS } from "../utils/exampleAssignments";
import { EXAMPLE_CHALLENGES } from "../utils/exampleChallenges";

interface TeacherWorkspacePageProps {
  draft: Partial<Assignment>;
  currentLabNetwork: NetworkInput;
  savedAssignments: AssignmentSummary[];
  onDraftChange: (updates: Partial<Assignment>) => void;
  onSave: () => void;
  onExport: () => void;
  onPreviewAsStudent: () => void;
  onNewDraft: () => void;
  onLoadExampleTemplate: (a: Assignment) => void;
  onImportAssignmentFile: (file: File) => void;
}

const TOPICS: { value: AssignmentTopic; label: string }[] = [
  { value: "ECMP",                label: "ECMP" },
  { value: "DISTANCE_VECTOR",     label: "Distance Vector" },
  { value: "SEGMENT_ROUTING",     label: "Segment Routing" },
  { value: "TRAFFIC_ENGINEERING", label: "Traffic Engineering" },
];

const MODES: { value: AssignmentMode; label: string }[] = [
  { value: "lecture",   label: "Lecture" },
  { value: "exercise",  label: "Exercise" },
  { value: "challenge", label: "Challenge" },
];

const TASK_TYPES: { value: TaskType; label: string }[] = [
  { value: "IDENTIFY_CONGESTED_LINKS",  label: "Identify Congested Links" },
  { value: "COMPUTE_DV_TABLE",          label: "Compute DV Routing Table" },
  { value: "SET_LINK_WEIGHTS",          label: "Set Link Weights" },
  { value: "COMPUTE_PATH_COSTS",        label: "Compute Path Costs" },
  { value: "COMPUTE_ECMP_SPLIT",        label: "Compute ECMP Traffic Split" },
  { value: "REDUCE_MAX_UTILIZATION",    label: "Reduce Max Utilization" },
];

const ALL_ALGORITHMS: AlgorithmName[] = ["ECMP", "DISTANCE_VECTOR", "SEGMENT_ROUTING"];

const CHALLENGE_TYPES: { value: ChallengeType; label: string }[] = [
  { value: "IDENTIFY_CONGESTED_LINKS", label: "Identify Congested Links" },
  { value: "REDUCE_CONGESTION",        label: "Reduce Congestion" },
  { value: "FIND_ECMP_WEIGHTS",        label: "Find ECMP Weights" },
  { value: "COMPUTE_ECMP_SPLIT",       label: "Compute ECMP Split" },
  { value: "COMPUTE_DV_TABLE",         label: "Compute DV Table" },
  { value: "PREDICT_SHORTEST_PATH",    label: "Predict Shortest Path" },
];

const DIFFICULTIES: ChallengeDifficulty[] = ["beginner", "intermediate", "advanced"];

const SOLUTION_VISIBILITY: { value: SolutionVisibility; label: string }[] = [
  { value: "after_correct", label: "After correct answer" },
  { value: "immediately",   label: "Immediately" },
  { value: "never",         label: "Never" },
  { value: "after_deadline",label: "After deadline" },
];

const EDITABLE_FIELDS: { value: EditableField; label: string }[] = [
  { value: "weights",    label: "Link weights" },
  { value: "capacities", label: "Link capacities" },
  { value: "demands",    label: "Traffic demands" },
  { value: "topology",   label: "Topology (nodes/links)" },
  { value: "algorithm",  label: "Algorithm choice" },
];

const ALL_OBJECTIVES: LearningObjective[] = [
  "ECMP", "Distance Vector", "Congestion", "Shortest Path",
  "Link Weights", "Capacity", "Traffic Engineering",
];

function defaultChallengeConfig(type: ChallengeType = "IDENTIFY_CONGESTED_LINKS"): ChallengeConfig {
  return {
    challengeType: type,
    difficulty: "beginner",
    learningObjectives: [],
    expectedTimeMinutes: 15,
    maxAttempts: 3,
    showOfficialSolution: "after_correct",
    editableFields: [],
    target: {},
    hints: getDefaultHints(type),
  };
}

// ── Section wrapper ───────────────────────────────────────────────────────────

const Section: React.FC<{
  title: string;
  children: React.ReactNode;
  collapsible?: boolean;
  defaultOpen?: boolean;
}> = ({ title, children, collapsible = false, defaultOpen = true }) => {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="teacher-section">
      <button
        className={`teacher-section-header${collapsible ? " teacher-section-header--toggle" : ""}`}
        onClick={collapsible ? () => setOpen((p) => !p) : undefined}
        disabled={!collapsible}
      >
        <span className="teacher-section-title">{title}</span>
        {collapsible && (open ? <ChevronUp size={13} /> : <ChevronDown size={13} />)}
      </button>
      {open && <div className="teacher-section-body">{children}</div>}
    </div>
  );
};

// ── Main component ────────────────────────────────────────────────────────────

const TeacherWorkspacePage: React.FC<TeacherWorkspacePageProps> = ({
  draft,
  currentLabNetwork,
  savedAssignments,
  onDraftChange,
  onSave,
  onExport,
  onPreviewAsStudent,
  onNewDraft,
  onLoadExampleTemplate,
  onImportAssignmentFile,
}) => {
  const [networkMode, setNetworkMode] = useState<"none" | "use-lab" | "paste">("none");
  const [networkPasteText, setNetworkPasteText] = useState("");
  const [networkPasteError, setNetworkPasteError] = useState<string | null>(null);
  const [showValidation, setShowValidation] = useState(false);

  const locked: LockedFields = draft.lockedFields ?? defaultLockedFields();
  const task = draft.studentTask ?? defaultStudentTask();
  const rules = draft.gradingRules ?? defaultGradingRules();

  const validation = validateAssignmentJson(draft);

  const handleToggleAlgorithm = (alg: AlgorithmName) => {
    const current = draft.allowedAlgorithms ?? [];
    const next = current.includes(alg) ? current.filter((a) => a !== alg) : [...current, alg];
    if (next.length > 0) onDraftChange({ allowedAlgorithms: next });
  };

  const handleUseLabNetwork = () => {
    onDraftChange({ starterNetwork: currentLabNetwork });
    setNetworkMode("use-lab");
    setNetworkPasteError(null);
  };

  const handlePasteNetwork = () => {
    try {
      const parsed = JSON.parse(networkPasteText);
      onDraftChange({ starterNetwork: parsed });
      setNetworkPasteError(null);
    } catch {
      setNetworkPasteError("Invalid JSON — could not parse network.");
    }
  };

  const hasNetwork = (draft.starterNetwork?.nodes?.length ?? 0) > 0;

  return (
    <div className="teacher-workspace">
      {/* ── Left sidebar: form ── */}
      <div className="teacher-form">

        {/* Header */}
        <div className="teacher-form-header">
          <div className="teacher-role-badge">
            <BookOpen size={12} /> Teacher Mode
          </div>
          <div className="teacher-form-actions">
            <button className="btn-secondary btn-sm" onClick={onNewDraft} title="New assignment">
              <Plus size={13} /> New
            </button>
            <label className="btn-secondary btn-sm" title="Import assignment JSON" style={{ cursor: "pointer" }}>
              <Upload size={13} /> Import
              <input
                type="file"
                accept=".json"
                style={{ display: "none" }}
                onChange={(e) => { if (e.target.files?.[0]) onImportAssignmentFile(e.target.files[0]); }}
              />
            </label>
          </div>
        </div>

        {/* Example templates */}
        <div className="teacher-templates">
          <div className="teacher-templates-label">Start from example (exercises)</div>
          <div className="teacher-template-cards">
            {EXAMPLE_ASSIGNMENTS.map((ex) => (
              <button
                key={ex.assignmentId}
                className="teacher-template-card"
                onClick={() => onLoadExampleTemplate(ex)}
              >
                <span className="teacher-template-topic">{ex.topic.replace("_", " ")}</span>
                <span className="teacher-template-title">{ex.title}</span>
              </button>
            ))}
          </div>
          <div className="teacher-templates-label" style={{ marginTop: 8 }}>Start from example (challenges)</div>
          <div className="teacher-template-cards">
            {EXAMPLE_CHALLENGES.map((ex) => (
              <button
                key={ex.assignmentId}
                className="teacher-template-card teacher-template-card--challenge"
                onClick={() => onLoadExampleTemplate(ex)}
              >
                <span className="teacher-template-topic">
                  {ex.challengeConfig?.difficulty ?? ""} · {ex.topic.replace("_", " ")}
                </span>
                <span className="teacher-template-title">{ex.title}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="teacher-divider" />

        {/* ── Section 1: Basic info ── */}
        <Section title="Basic Info">
          <div className="teacher-field">
            <label>Title *</label>
            <input
              type="text"
              value={draft.title ?? ""}
              placeholder="e.g. ECMP Triangle: Find the Congested Link"
              onChange={(e) => onDraftChange({ title: e.target.value })}
            />
          </div>
          <div className="teacher-field">
            <label>Course</label>
            <input
              type="text"
              value={draft.course ?? ""}
              placeholder="e.g. Network Algorithms 101"
              onChange={(e) => onDraftChange({ course: e.target.value })}
            />
          </div>
          <div className="teacher-field-row">
            <div className="teacher-field">
              <label>Topic *</label>
              <select
                value={draft.topic ?? "ECMP"}
                onChange={(e) => onDraftChange({ topic: e.target.value as AssignmentTopic })}
              >
                {TOPICS.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </div>
            <div className="teacher-field">
              <label>Mode</label>
              <select
                value={draft.mode ?? "exercise"}
                onChange={(e) => onDraftChange({ mode: e.target.value as AssignmentMode })}
              >
                {MODES.map((m) => (
                  <option key={m.value} value={m.value}>{m.label}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="teacher-field">
            <label>Description</label>
            <textarea
              rows={2}
              value={draft.description ?? ""}
              placeholder="Brief description of the assignment for students."
              onChange={(e) => onDraftChange({ description: e.target.value })}
            />
          </div>
        </Section>

        {/* ── Section 2: Starter network ── */}
        <Section title="Starter Network">
          <div className="teacher-network-status">
            {hasNetwork ? (
              <span className="teacher-network-ok">
                ✓ {draft.starterNetwork!.nodes.length}N · {draft.starterNetwork!.links.length}L loaded
              </span>
            ) : (
              <span className="teacher-network-empty">No network set</span>
            )}
          </div>
          <div className="teacher-network-actions">
            <button
              className={`btn-secondary btn-sm${networkMode === "use-lab" ? " btn-active" : ""}`}
              onClick={handleUseLabNetwork}
            >
              Copy from Lab canvas
            </button>
            <button
              className={`btn-secondary btn-sm${networkMode === "paste" ? " btn-active" : ""}`}
              onClick={() => setNetworkMode(networkMode === "paste" ? "none" : "paste")}
            >
              Paste JSON
            </button>
          </div>
          {networkMode === "paste" && (
            <div className="teacher-paste-area">
              <textarea
                rows={5}
                placeholder='{"nodes":[...], "links":[...], ...}'
                value={networkPasteText}
                onChange={(e) => setNetworkPasteText(e.target.value)}
              />
              {networkPasteError && <div className="teacher-error">{networkPasteError}</div>}
              <button className="btn-primary btn-sm" onClick={handlePasteNetwork}>
                Apply Network JSON
              </button>
            </div>
          )}
          <p className="teacher-field-hint">
            Build a network in the <strong>Lab</strong> tab, then click "Copy from Lab canvas" to use it here.
          </p>
        </Section>

        {/* ── Section 3: Allowed algorithms ── */}
        <Section title="Allowed Algorithms">
          <div className="teacher-algo-checks">
            {ALL_ALGORITHMS.map((alg) => (
              <label key={alg} className="teacher-check-row">
                <input
                  type="checkbox"
                  checked={(draft.allowedAlgorithms ?? []).includes(alg)}
                  onChange={() => handleToggleAlgorithm(alg)}
                />
                {alg.replace("_", " ")}
              </label>
            ))}
          </div>
        </Section>

        {/* ── Section 4: Locked fields ── */}
        <Section title="What Students Can Edit">
          {(
            [
              ["canEditNodes",      "Nodes"],
              ["canEditLinks",      "Links"],
              ["canEditWeights",    "Weights"],
              ["canEditCapacities", "Capacities"],
              ["canEditDemands",    "Demands"],
              ["canChooseAlgorithm","Algorithm"],
            ] as [keyof LockedFields, string][]
          ).map(([key, label]) => (
            <label key={key} className="teacher-check-row">
              <input
                type="checkbox"
                checked={locked[key]}
                onChange={(e) => onDraftChange({ lockedFields: { ...locked, [key]: e.target.checked } })}
              />
              {label}
            </label>
          ))}
        </Section>

        {/* ── Section 5: Task definition ── */}
        <Section title="Student Task">
          <div className="teacher-field">
            <label>Task type *</label>
            <select
              value={task.taskType}
              onChange={(e) => onDraftChange({ studentTask: { ...task, taskType: e.target.value as TaskType } })}
            >
              {TASK_TYPES.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </div>
          <div className="teacher-field">
            <label>Prompt *</label>
            <textarea
              rows={3}
              placeholder="The main question or task shown to students."
              value={task.prompt}
              onChange={(e) => onDraftChange({ studentTask: { ...task, prompt: e.target.value } })}
            />
          </div>
          <div className="teacher-field">
            <label>Step-by-step instructions</label>
            <textarea
              rows={3}
              placeholder={"1. Do this.\n2. Then this.\n3. Enter your answer."}
              value={task.instructions}
              onChange={(e) => onDraftChange({ studentTask: { ...task, instructions: e.target.value } })}
            />
          </div>
          <div className="teacher-field">
            <label>Answer format hint</label>
            <input
              type="text"
              placeholder='e.g. "Enter the link ID (e.g. v-t)"'
              value={task.answerFormatDescription}
              onChange={(e) => onDraftChange({ studentTask: { ...task, answerFormatDescription: e.target.value } })}
            />
          </div>
        </Section>

        {/* ── Section 6: Expected solution (collapsible) ── */}
        <Section title="Expected Solution" collapsible defaultOpen={false}>
          <p className="teacher-field-hint">
            Fill in the expected answer. Used for auto-grading when students submit.
          </p>
          <div className="teacher-field">
            <label>Congested link IDs (comma-separated)</label>
            <input
              type="text"
              placeholder="e.g. v-t"
              value={(draft.expectedSolution?.congestedLinks ?? []).join(", ")}
              onChange={(e) => {
                const ids = e.target.value.split(",").map((s) => s.trim()).filter(Boolean);
                onDraftChange({ expectedSolution: { ...(draft.expectedSolution ?? {}), congestedLinks: ids } });
              }}
            />
          </div>
          <div className="teacher-field">
            <label>Max utilization target (0–∞)</label>
            <input
              type="number"
              min={0}
              step={0.1}
              placeholder="e.g. 1.0"
              value={draft.expectedSolution?.maxUtilizationTarget ?? ""}
              onChange={(e) => {
                const v = parseFloat(e.target.value);
                onDraftChange({ expectedSolution: { ...(draft.expectedSolution ?? {}), maxUtilizationTarget: isNaN(v) ? undefined : v } });
              }}
            />
          </div>
          <div className="teacher-field">
            <label>Explanation / solution notes</label>
            <textarea
              rows={2}
              placeholder="Shown to students after submission or as a hint."
              value={draft.expectedSolution?.explanation ?? ""}
              onChange={(e) => onDraftChange({ expectedSolution: { ...(draft.expectedSolution ?? {}), explanation: e.target.value } })}
            />
          </div>
        </Section>

        {/* ── Section 7: Grading rules (collapsible) ── */}
        <Section title="Grading Rules" collapsible defaultOpen={false}>
          <div className="teacher-field-row">
            <div className="teacher-field">
              <label>Max score</label>
              <input
                type="number"
                min={1}
                value={rules.maxScore}
                onChange={(e) => onDraftChange({ gradingRules: { ...rules, maxScore: Math.max(1, +e.target.value) } })}
              />
            </div>
            <div className="teacher-field">
              <label>Tolerance</label>
              <input
                type="number"
                min={0}
                step={0.001}
                value={rules.tolerance}
                onChange={(e) => onDraftChange({ gradingRules: { ...rules, tolerance: +e.target.value } })}
              />
            </div>
          </div>
          <label className="teacher-check-row">
            <input
              type="checkbox"
              checked={rules.requireExactLinks}
              onChange={(e) => onDraftChange({ gradingRules: { ...rules, requireExactLinks: e.target.checked } })}
            />
            Require exactly matching link set
          </label>
          <label className="teacher-check-row">
            <input
              type="checkbox"
              checked={rules.allowEquivalentWeights}
              onChange={(e) => onDraftChange({ gradingRules: { ...rules, allowEquivalentWeights: e.target.checked } })}
            />
            Accept alternate valid solutions
          </label>
        </Section>

        {/* ── Section 8: Challenge Configuration (only when mode = challenge) ── */}
        {draft.mode === "challenge" && (() => {
          const cfg: ChallengeConfig = draft.challengeConfig ?? defaultChallengeConfig();
          const updateCfg = (updates: Partial<ChallengeConfig>) =>
            onDraftChange({ challengeConfig: { ...cfg, ...updates } });

          return (
            <Section title="Challenge Settings" collapsible defaultOpen={false}>
              <div className="teacher-field-row">
                <div className="teacher-field">
                  <label>Challenge type *</label>
                  <select
                    value={cfg.challengeType}
                    onChange={(e) => {
                      const t = e.target.value as ChallengeType;
                      updateCfg({ challengeType: t, hints: getDefaultHints(t) });
                    }}
                  >
                    {CHALLENGE_TYPES.map((ct) => (
                      <option key={ct.value} value={ct.value}>{ct.label}</option>
                    ))}
                  </select>
                </div>
                <div className="teacher-field">
                  <label>Difficulty</label>
                  <select
                    value={cfg.difficulty}
                    onChange={(e) => updateCfg({ difficulty: e.target.value as ChallengeDifficulty })}
                  >
                    {DIFFICULTIES.map((d) => (
                      <option key={d} value={d}>{d.charAt(0).toUpperCase() + d.slice(1)}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="teacher-field-row">
                <div className="teacher-field">
                  <label>Expected time (min)</label>
                  <input
                    type="number" min={1} value={cfg.expectedTimeMinutes}
                    onChange={(e) => updateCfg({ expectedTimeMinutes: Math.max(1, +e.target.value) })}
                  />
                </div>
                <div className="teacher-field">
                  <label>Max attempts</label>
                  <input
                    type="number" min={1} max={20} value={cfg.maxAttempts}
                    onChange={(e) => updateCfg({ maxAttempts: Math.max(1, +e.target.value) })}
                  />
                </div>
              </div>

              <div className="teacher-field">
                <label>Show official solution</label>
                <select
                  value={cfg.showOfficialSolution}
                  onChange={(e) => updateCfg({ showOfficialSolution: e.target.value as SolutionVisibility })}
                >
                  {SOLUTION_VISIBILITY.map((sv) => (
                    <option key={sv.value} value={sv.value}>{sv.label}</option>
                  ))}
                </select>
              </div>

              <div className="teacher-field">
                <label>What students can edit</label>
                {EDITABLE_FIELDS.map(({ value, label }) => (
                  <label key={value} className="teacher-check-row">
                    <input
                      type="checkbox"
                      checked={cfg.editableFields.includes(value)}
                      onChange={(e) => {
                        const next = e.target.checked
                          ? [...cfg.editableFields, value]
                          : cfg.editableFields.filter((f) => f !== value);
                        updateCfg({ editableFields: next });
                      }}
                    />
                    {label}
                  </label>
                ))}
              </div>

              <div className="teacher-field">
                <label>Learning objectives</label>
                <div className="teacher-algo-checks">
                  {ALL_OBJECTIVES.map((obj) => (
                    <label key={obj} className="teacher-check-row">
                      <input
                        type="checkbox"
                        checked={cfg.learningObjectives.includes(obj)}
                        onChange={(e) => {
                          const next = e.target.checked
                            ? [...cfg.learningObjectives, obj]
                            : cfg.learningObjectives.filter((o) => o !== obj);
                          updateCfg({ learningObjectives: next });
                        }}
                      />
                      {obj}
                    </label>
                  ))}
                </div>
              </div>

              {/* Target conditions */}
              <div className="teacher-field">
                <label>Target: max utilization below (0–∞)</label>
                <input
                  type="number" min={0} step={0.1}
                  placeholder="e.g. 1.0"
                  value={cfg.target.maxUtilizationBelow ?? ""}
                  onChange={(e) => {
                    const v = parseFloat(e.target.value);
                    updateCfg({ target: { ...cfg.target, maxUtilizationBelow: isNaN(v) ? undefined : v } });
                  }}
                />
              </div>
              <div className="teacher-field">
                <label>Target: expected congested link IDs (comma-separated)</label>
                <input
                  type="text"
                  placeholder="e.g. v-t"
                  value={(cfg.target.congestedLinks ?? []).join(", ")}
                  onChange={(e) => {
                    const ids = e.target.value.split(",").map((s) => s.trim()).filter(Boolean);
                    updateCfg({ target: { ...cfg.target, congestedLinks: ids } });
                  }}
                />
              </div>

              {/* Hint manager */}
              <div className="teacher-field">
                <label>Hints ({cfg.hints.length})</label>
                <p className="teacher-field-hint">
                  Default hints are auto-generated based on challenge type. Customise them below.
                </p>
                {cfg.hints.map((hint, idx) => (
                  <div key={hint.hintId} className="teacher-hint-row">
                    <div className="teacher-hint-idx">#{idx + 1} {hint.level.replace("_", " ")}</div>
                    <input
                      type="text"
                      className="teacher-hint-title-input"
                      value={hint.title}
                      placeholder="Hint title"
                      onChange={(e) => {
                        const next = cfg.hints.map((h, i) => i === idx ? { ...h, title: e.target.value } : h);
                        updateCfg({ hints: next });
                      }}
                    />
                    <textarea
                      rows={2}
                      value={hint.text}
                      placeholder="Hint text"
                      onChange={(e) => {
                        const next = cfg.hints.map((h, i) => i === idx ? { ...h, text: e.target.value } : h);
                        updateCfg({ hints: next });
                      }}
                    />
                    <div className="teacher-hint-penalty-row">
                      <label>Point penalty:</label>
                      <input
                        type="number" min={0} max={100}
                        value={hint.revealCostPenalty}
                        onChange={(e) => {
                          const next = cfg.hints.map((h, i) =>
                            i === idx ? { ...h, revealCostPenalty: Math.min(100, Math.max(0, +e.target.value)) } : h,
                          );
                          updateCfg({ hints: next });
                        }}
                      />
                      <button
                        className="btn-secondary btn-sm"
                        onClick={() => updateCfg({ hints: cfg.hints.filter((_, i) => i !== idx) })}
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                ))}
                <button
                  className="btn-secondary btn-sm"
                  style={{ marginTop: 6 }}
                  onClick={() => {
                    const newHint: Hint = {
                      hintId: `hint-${Date.now()}`,
                      level: "conceptual",
                      title: "",
                      text: "",
                      relatedNodeIds: [],
                      relatedLinkIds: [],
                      revealCostPenalty: 0,
                    };
                    updateCfg({ hints: [...cfg.hints, newHint] });
                  }}
                >
                  + Add hint
                </button>
                <button
                  className="btn-secondary btn-sm"
                  style={{ marginLeft: 6, marginTop: 6 }}
                  onClick={() => updateCfg({ hints: getDefaultHints(cfg.challengeType) })}
                >
                  Reset to defaults
                </button>
              </div>
            </Section>
          );
        })()}

        {/* ── Validation + actions ── */}
        {showValidation && !validation.valid && (
          <div className="teacher-validation-errors">
            {validation.errors.map((e, i) => (
              <div key={i} className="teacher-error">⚠ {e}</div>
            ))}
          </div>
        )}

        <div className="teacher-bottom-actions">
          <button
            className="btn-secondary btn-sm"
            onClick={() => { setShowValidation(true); onExport(); }}
          >
            <Download size={13} /> Export JSON
          </button>
          <button
            className="btn-secondary btn-sm"
            onClick={onPreviewAsStudent}
            title="Switch to Student mode to preview this assignment"
          >
            <Eye size={13} /> Preview as Student
          </button>
          <button
            className="btn-primary btn-sm"
            onClick={() => { setShowValidation(true); if (validation.valid) onSave(); }}
          >
            <Save size={13} /> Save Assignment
          </button>
        </div>

        <div className="teacher-hint-footer">
          <button className="teacher-hint-link" onClick={downloadExampleAssignmentJson}>
            Download example assignment JSON
          </button>
        </div>

      </div>

      {/* ── Right panel: saved assignments list ── */}
      <div className="teacher-saved-panel">
        <div className="teacher-saved-title">Saved assignments</div>
        {savedAssignments.length === 0 ? (
          <div className="teacher-saved-empty">
            No assignments saved yet.<br />
            Start MongoDB to persist assignments between sessions.
          </div>
        ) : (
          <ul className="teacher-saved-list">
            {savedAssignments.map((a) => (
              <li key={a.assignmentId} className="teacher-saved-item">
                <div className="teacher-saved-info">
                  <span className="teacher-saved-topic">{a.topic.replace("_", " ")}</span>
                  <span className="teacher-saved-name">{a.title}</span>
                  {a.course && <span className="teacher-saved-course">{a.course}</span>}
                </div>
                <span className="teacher-saved-mode">{a.mode}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
};

export default TeacherWorkspacePage;
