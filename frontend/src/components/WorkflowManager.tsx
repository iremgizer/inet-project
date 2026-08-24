import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Network, Waypoints, GitBranch, BarChart3, CheckCircle2, BookOpen, Clock, GraduationCap, Target, ChevronLeft, ChevronRight, LogOut, FlaskConical } from "lucide-react";
import ReactFlowCanvas from "./ReactFlowCanvas";
import MetricsPanel from "./MetricsPanel";
import RoutingTablePanel from "./RoutingTablePanel";
import SegmentListPanel from "./SegmentListPanel";
import { TEPolicyDraft } from "./TEPolicyEditor";
import { TEQuickLinkPolicyType } from "./TEQuickPolicyPopup";
import TraceTimeline from "./TraceTimeline";
import InspectorDrawer from "./InspectorDrawer";
import SavedRunsDrawer from "./SavedRunsDrawer";
import CanvasToolbar from "./CanvasToolbar";
import LandingPage from "../pages/LandingPage";
import TeacherDashboard from "../pages/TeacherDashboard";
import StudentDashboard from "../pages/StudentDashboard";
import DemoScenarioDashboard from "../pages/DemoScenarioDashboard";
import NetworkBuilderPage from "../pages/NetworkBuilderPage";
import TrafficConfigurationPage from "../pages/TrafficConfigurationPage";
import AlgorithmSelectionPage from "../pages/AlgorithmSelectionPage";
import SimulationStudioPage from "../pages/SimulationStudioPage";
import OptimizationLabPage from "../pages/OptimizationLabPage";
import TeacherWorkspacePage from "../pages/TeacherWorkspacePage";
import StudentWorkspacePage from "../pages/StudentWorkspacePage";
import ChallengeWorkspacePage from "../pages/ChallengeWorkspacePage";
import JsonHelpModal from "./JsonHelpModal";
import { useToast } from "./Toast";
import { UserRole } from "../utils/demoAuth";
import { AssignedWork } from "../types/classroom";
import { DEMO_STUDENTS, DEMO_STUDENT_ID } from "../utils/demoUsers";
import { loadAssignedWorks, saveAssignedWorks, loadCurrentStudentId, saveCurrentStudentId } from "../utils/classroomStorage";
import { exportAssignmentPdf } from "../utils/pdfExport";
import { simulateNetwork, listSavedRuns, getSavedRun, deleteSavedRun, listAssignments, saveAssignment, getAssignment, getAssignmentForStudent, seedDemoScenarios, seedDemoAssignments, getBackendHealth, gradeAttempt } from "../api/simulationApi";
import { runOptimization } from "../api/optimizationApi";
import { OptimizationHistoryEntry, OptimizationLabMode, OptimizationRunRecord } from "../types/optimization";
import { projectOptimizationResult } from "../utils/optimizationProjection";
import { buildOptimizationHighlightEvent } from "../utils/optimizationHighlight";
import { resolveVisualizationOwner } from "../utils/optimizationVisualState";
import { OptimizationSettings } from "../utils/optimizationSettings";
import { triangleTemplate } from "../utils/topologyTemplates";
import { applyAutoLayout } from "../utils/generatedTopologies";
import {
  downloadTopologyJson,
  downloadExampleTopologyJson,
  importTopologyJson,
  parseTopologyFile,
  validateTopologyJson,
} from "../utils/topologyJson";
import {
  downloadAssignmentJson,
  importAssignmentJson,
  newAssignmentDraft,
  parseAssignmentFile,
  validateAssignmentJson,
  createSubmissionTemplate,
} from "../utils/assignmentJson";
import { gradeChallenge } from "../utils/challengeGrading";
import { resolveHints } from "../utils/challengeHints";
import { deriveSegmentRoutingDisplayState } from "../utils/segmentRoutingTrace";
import { deriveDownLinkIdsAtStep } from "../utils/failureReplay";
import { buildComparison, ComparisonMode, LinkComparisonEntry } from "../utils/comparison";
import { buildCustomDistributionsFromResult } from "../utils/trafficDistribution";
import { EXAMPLE_CHALLENGES } from "../utils/exampleChallenges";
import {
  ensureDemoClassroomData, resetDemoClassroomData,
  loadDemoAssignedWorks, loadDemoAssignmentSummaries,
} from "../utils/demoClassroomSeed";
import { saveChallengeAttempt } from "../api/simulationApi";
import { LectureExample } from "../utils/lectureExamples";
import {
  AppMode,
  Assignment,
  AssignmentSummary,
  GradingResult,
  LockedFields,
  StudentSubmission,
} from "../types/assignment";
import {
  AttemptHistoryEntry,
  ChallengeAttempt,
  ChallengeGradingResult,
} from "../types/challenge";
import {
  AlgorithmConfig,
  AlgorithmName,
  LinkInput,
  NetworkInput,
  NodeInput,
  SavedSimulationSummary,
  SegmentRoutingPolicy,
  SimulationResult,
  TopologyType,
  TrafficDemandInput,
  TrafficDistributionMode,
  TrafficEngineeringPolicy,
} from "../types/network";

export type WorkflowStep = 0 | 1 | 2 | 3 | 4 | 5;

const defaultAlgorithmConfig: AlgorithmConfig = {
  selectedAlgorithm: "ECMP",
  algorithmType: "real_world_heuristic",
  objective: "minimize_max_utilization",
  congestionThreshold: 1.0,
};

const makeId = (prefix: string) =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? `${prefix}-${crypto.randomUUID()}`
    : `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;

const stages = [
  { step: 1 as WorkflowStep, label: "Design",    icon: Network,    hint: "Build your network on the canvas" },
  { step: 2 as WorkflowStep, label: "Traffic",   icon: Waypoints,  hint: "Define source→destination flows" },
  { step: 3 as WorkflowStep, label: "Algorithm", icon: GitBranch,  hint: "Choose a routing algorithm" },
  { step: 4 as WorkflowStep, label: "Result",    icon: BarChart3,  hint: "See simulation results" },
] as const;

const WorkflowManager: React.FC = () => {
  const { toast } = useToast();

  // ── Core state ────────────────────────────────────────────────────────────
  const [currentStep, setCurrentStep] = useState<WorkflowStep>(0);
  const [network, setNetwork] = useState<NetworkInput>({ nodes: [], links: [], demands: [], topologyType: "custom", isDirected: false });
  const [algorithmConfig, setAlgorithmConfig] = useState<AlgorithmConfig>(defaultAlgorithmConfig);

  // ── Selection ─────────────────────────────────────────────────────────────
  const [selectedType, setSelectedType] = useState<"node" | "link" | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // ── Simulation ────────────────────────────────────────────────────────────
  const [simulationResult, setSimulationResult] = useState<SimulationResult | null>(null);
  const [isRunning, setIsRunning] = useState(false);

  // ── Before/After comparison (PR 6, Part 2) ─────────────────────────────────
  // `baselineResult` is set automatically on the FIRST successful run and
  // never overwritten automatically afterward — only an explicit "Set
  // current as baseline" click (or a structural edit that invalidates it,
  // see the handlers below) changes it. `simulationResult` above doubles as
  // "current" throughout; comparison is available whenever both are set and
  // distinct (see ComparisonPanel).
  const [baselineResult, setBaselineResult] = useState<SimulationResult | null>(null);
  const [comparisonMode, setComparisonMode] = useState<ComparisonMode>("after");

  // ── Optimization Lab (Sprint 2, PR5, extended PR6) ──────────────────────
  // Results are transient (PR5 §12): cached in memory only, keyed per mode
  // so each of the four optimizers is launched independently and its own
  // result survives switching between cards — never persisted, never part
  // of topology JSON, cleared whenever a recommendation is actually applied
  // (see handleApplyOptimization) since the network they were computed
  // against no longer matches. PR6: each cached entry also keeps the
  // OptimizationSettings that actually produced it (budget/weight-range/
  // timeout), distinct from whatever the settings panel currently reads —
  // needed so a card can honestly report "weight range used: 1-7" even
  // after a student changes the panel to 1-5 without re-running.
  const [optimizationRunRecords, setOptimizationRunRecords] = useState<
    Partial<Record<Exclude<OptimizationLabMode, "CURRENT">, OptimizationRunRecord>>
  >({});
  const [optimizationRunning, setOptimizationRunning] = useState<Set<Exclude<OptimizationLabMode, "CURRENT">>>(
    () => new Set()
  );
  // PR6 §15 — session-only experiment history (never persisted to MongoDB
  // or anywhere else; cleared on every full page reload, same as every
  // other piece of Optimization Lab state).
  const [optimizationHistory, setOptimizationHistory] = useState<OptimizationHistoryEntry[]>([]);
  // Which card currently drives the canvas ("View on graph") — highlights
  // that mode's recommended waypoints/weight-changes/paths via the same
  // trace-event highlighting mechanism trace replay already uses (see
  // utils/optimizationHighlight.ts). null outside the lab or when nothing
  // is selected.
  const [selectedOptimizationMode, setSelectedOptimizationMode] = useState<OptimizationLabMode | null>(null);
  // Which card is being compared against the current simulation result —
  // independent of `selectedOptimizationMode` (a student can view one
  // mode's paths while comparing a different mode's numbers). PR6 §18: this
  // taking precedence over `selectedOptimizationMode` for canvas ownership
  // is now an explicit, named rule — see utils/optimizationVisualState.ts.
  const [comparingOptimizationMode, setComparingOptimizationMode] = useState<OptimizationLabMode | null>(null);
  // The Lab's own before/after/difference toggle — deliberately separate
  // from the step-4 `comparisonMode` above (switching one must never
  // silently change the other's saved position).
  const [optComparisonMode, setOptComparisonMode] = useState<ComparisonMode>("after");

  // ── Trace playback ────────────────────────────────────────────────────────
  const [isTraceMode, setIsTraceMode] = useState(false);
  const [activeStepIndex, setActiveStepIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackSpeedMs, setPlaybackSpeedMs] = useState(30000);
  const [showRoutingTable, setShowRoutingTable] = useState(false);
  const [rightWide, setRightWide] = useState(false);

  // ── Saved runs ────────────────────────────────────────────────────────────
  const [savedRuns, setSavedRuns] = useState<SavedSimulationSummary[]>([]);
  const [savedRunsOpen, setSavedRunsOpen] = useState(false);

  // ── Canvas ───────────────────────────────────────────────────────────────
  const [fitViewTrigger, setFitViewTrigger] = useState(0);

  // ── Connect mode ──────────────────────────────────────────────────────────
  const [connectSourceId, setConnectSourceId] = useState<string | null>(null);
  const [centerNodeRequest, setCenterNodeRequest] = useState<{ id: string; nonce: number } | null>(null);
  const [prefillDemandSource, setPrefillDemandSource] = useState<string | null>(null);

  // ── Segment Routing waypoint-selection mode ──────────────────────────────
  // Mutually exclusive with connect mode (see handleStartConnect /
  // handleStartWaypointSelect below) and with normal node/link selection.
  const [waypointSelectDemandId, setWaypointSelectDemandId] = useState<string | null>(null);

  // ── ECMP traffic distribution mode ────────────────────────────────────────
  // UI-only toggle. "EQUAL" keeps algorithmConfig.trafficDistributions empty
  // (byte-identical to plain ECMP). "CUSTOM" is only materialized into real
  // per-path shares once a fresh ECMP result is available to discover paths
  // from — see handleDistributionModeChange.
  const [distributionMode, setDistributionMode] = useState<TrafficDistributionMode>("EQUAL");

  // ── Traffic Engineering policy draft ──────────────────────────────────────
  // Mutually exclusive with connect mode and waypoint-select mode (each
  // cancels the others on entry). `teDraft` is the in-progress "Add policy"
  // form; `teIsSelecting` is whether a graph click is currently expected to
  // fill its link/node target.
  const [teDraft, setTeDraft] = useState<TEPolicyDraft | null>(null);
  const [teIsSelecting, setTeIsSelecting] = useState(false);

  // ── Traffic Engineering quick-add flow (graph-first) ──────────────────────
  // An additional, more direct way to create a link policy: "Select on
  // Graph" enters link-selection mode with no type chosen yet
  // (`teQuickSelectActive`); once a link is clicked, `teQuickPopupLinkId`
  // holds its id and a floating popup on the canvas offers Prefer/Avoid/
  // Forbid. Mutually exclusive with everything else, including the dropdown
  // draft flow above.
  const [teQuickSelectActive, setTeQuickSelectActive] = useState(false);
  const [teQuickPopupLinkId, setTeQuickPopupLinkId] = useState<string | null>(null);

  // ── Lecture mode ──────────────────────────────────────────────────────────
  const [lectureInsight, setLectureInsight] = useState<string | null>(null);

  // ── Classroom mode ────────────────────────────────────────────────────────
  const [appMode, setAppMode] = useState<AppMode>("lab");
  const [teacherDraft, setTeacherDraft] = useState<Partial<Assignment>>(newAssignmentDraft());
  const [savedAssignments, setSavedAssignments] = useState<AssignmentSummary[]>(
    () => loadDemoAssignmentSummaries()
  );
  const [activeAssignment, setActiveAssignment] = useState<Assignment | null>(null);
  const [activeSubmission, setActiveSubmission] = useState<StudentSubmission | null>(null);
  const [gradingResult, setGradingResult] = useState<GradingResult | null>(null);

  // ── Challenge mode ─────────────────────────────────────────────────────────
  const [currentAttempt, setCurrentAttempt] = useState<ChallengeAttempt | null>(null);
  const [challengeGradingResult, setChallengeGradingResult] = useState<ChallengeGradingResult | null>(null);
  const [attemptHistory, setAttemptHistory] = useState<AttemptHistoryEntry[]>([]);
  const [hintsRevealed, setHintsRevealed] = useState(0);
  const [attemptNumber, setAttemptNumber] = useState(1);

  // ── Solution replay ────────────────────────────────────────────────────────
  const [replayMode, setReplayMode] = useState<"trace" | "compare" | null>(null);

  // ── Panel collapse ────────────────────────────────────────────────────────
  const [leftCollapsed, setLeftCollapsed] = useState(false);

  // ── Home page import ref ──────────────────────────────────────────────────
  const homeImportRef = useRef<HTMLInputElement>(null);

  // ── Auth ──────────────────────────────────────────────────────────────────
  const [userRole, setUserRole] = useState<UserRole | null>(null);
  const [showHelpModal, setShowHelpModal] = useState(false);

  // ── Classroom distribution ─────────────────────────────────────────────────
  const [assignedWorks, setAssignedWorks] = useState<AssignedWork[]>(() => {
    ensureDemoClassroomData();
    const user = loadAssignedWorks();
    const demo = loadDemoAssignedWorks();
    // Merge: demo works first, user-added works appended (dedup by assignedWorkId)
    const seen = new Set(demo.map((w) => w.assignedWorkId));
    return [...demo, ...user.filter((w) => !seen.has(w.assignedWorkId))];
  });
  const [currentStudentId, setCurrentStudentId] = useState<string | null>(() => loadCurrentStudentId());

  // ── Derived ───────────────────────────────────────────────────────────────
  // Comparison mode (PR 6, Part 2) decides which result the canvas/trace
  // reads from: "before" shows the baseline, "after" and "difference" both
  // show current (difference just recolors current's links by comparison
  // status — see ComparisonPanel/NetworkEdge — it doesn't need a second
  // dataset). Reuses the existing single replay system: "before" replays
  // the baseline's own trace, exactly like "after" replays current's.
  const baseDisplayedResult = comparisonMode === "before" && baselineResult ? baselineResult : simulationResult;

  // ── Optimization Lab (PR5, overlay conflict fixed PR6 §18) — canvas data
  //    sourcing ────────────────────────────────────────────────────────
  // Reuses the exact same `linkResults`/`pathResults`/`currentTraceEvent`/
  // `comparisonByLink` props ReactFlowCanvas already consumes for every
  // other step (PR5 §9: "never create another graph viewer") — only *which*
  // SimulationResult-shaped object feeds them changes while the lab is open.
  // `resolveVisualizationOwner` is the single, explicit source of truth for
  // "does the selected card's highlight, or the compared card's difference
  // heatmap, own the canvas right now" — the two can no longer both apply
  // at once (PR5's own documented known limitation).
  const visualizationOwner = currentStep === 5
    ? resolveVisualizationOwner(selectedOptimizationMode, comparingOptimizationMode)
    : "none";
  const isOptLabView = visualizationOwner === "selected";
  const isOptComparingView = visualizationOwner === "comparison";

  const optSelectedResult =
    selectedOptimizationMode && selectedOptimizationMode !== "CURRENT"
      ? optimizationRunRecords[selectedOptimizationMode]?.result ?? null
      : null;
  const optProjection = React.useMemo(() => {
    if (!optSelectedResult) return null;
    return projectOptimizationResult(optSelectedResult, network, algorithmConfig.congestionThreshold);
  }, [optSelectedResult, network, algorithmConfig.congestionThreshold]);
  const optHighlightEvent = React.useMemo(() => {
    if (!optSelectedResult) return null;
    return buildOptimizationHighlightEvent(optSelectedResult);
  }, [optSelectedResult]);

  const optComparingResult =
    comparingOptimizationMode && comparingOptimizationMode !== "CURRENT"
      ? optimizationRunRecords[comparingOptimizationMode]?.result ?? null
      : null;
  const optComparingProjection = React.useMemo(() => {
    if (!optComparingResult) return null;
    return projectOptimizationResult(optComparingResult, network, algorithmConfig.congestionThreshold);
  }, [optComparingResult, network, algorithmConfig.congestionThreshold]);
  const optComparison = React.useMemo(() => {
    if (!simulationResult || !optComparingProjection) return null;
    return buildComparison(simulationResult, optComparingProjection);
  }, [simulationResult, optComparingProjection]);

  const displayedResult = isOptComparingView
    ? (optComparisonMode === "before" ? simulationResult : optComparingProjection)
    : isOptLabView
    ? (selectedOptimizationMode === "CURRENT" ? simulationResult : optProjection)
    : baseDisplayedResult;

  const traceEvents = currentStep === 5 ? [] : displayedResult?.traceEvents ?? [];
  // Comparison owns the canvas => no highlight overlay at all, even if a
  // card is also selected (PR6 §18's chosen precedence, documented in
  // utils/optimizationVisualState.ts).
  const currentTraceEvent = isOptComparingView
    ? null
    : isOptLabView
    ? optHighlightEvent
    : isTraceMode
    ? traceEvents[activeStepIndex] ?? null
    : null;
  const canvasIsTraceMode = (isOptLabView || isOptComparingView) ? !!currentTraceEvent : isTraceMode;
  const linkResults = displayedResult?.linkResults ?? [];
  const pathResults = displayedResult?.pathResults ?? [];

  const baseComparison = React.useMemo(() => {
    if (!baselineResult || !simulationResult || baselineResult === simulationResult) return null;
    return buildComparison(baselineResult, simulationResult);
  }, [baselineResult, simulationResult]);

  const comparison = isOptComparingView ? optComparison : baseComparison;
  const activeComparisonMode = isOptComparingView ? optComparisonMode : comparisonMode;

  // Always computed when a comparison exists — NetworkEdge itself gates use
  // on comparisonMode === "difference"; LinkDetailPanel below reads it in
  // any mode (comparison details are useful in the inspector regardless of
  // which mode the canvas is currently painted in).
  const comparisonByLink = React.useMemo(() => {
    if (!comparison) return null;
    return new Map(comparison.linkDeltas.map((d) => [d.linkId, d]));
  }, [comparison]);

  const activeTableRowKeys = React.useMemo(() => {
    if (!currentTraceEvent?.activeTableRowIds) return [];
    return currentTraceEvent.activeTableRowIds;
  }, [currentTraceEvent]);

  // Segment Routing replay state — frontend-only derivation from the trace
  // events PR 1 already emits (stepType/segmentList/activeSegmentIndex).
  // null for every other algorithm and outside trace mode.
  const srDisplayState = React.useMemo(() => {
    if (!isTraceMode || displayedResult?.algorithm !== "SEGMENT_ROUTING") return null;
    return deriveSegmentRoutingDisplayState(traceEvents, activeStepIndex, network);
  }, [isTraceMode, displayedResult, traceEvents, activeStepIndex, network]);

  // Mid-simulation failure replay (PR 6) — which links are DOWN as of the
  // current replay step, overriding the persistent network.links[].
  // operationalStatus while replaying so stepping backward past a scheduled
  // failure correctly shows the link UP again. null outside trace mode.
  const replayDownLinkIds = React.useMemo(() => {
    if (!isTraceMode) return null;
    return deriveDownLinkIdsAtStep(traceEvents, activeStepIndex);
  }, [isTraceMode, traceEvents, activeStepIndex]);

  // ── Locked fields — all-open in lab/teacher, assignment-driven in student/challenge ──
  const ALL_OPEN: LockedFields = {
    canEditNodes: true, canEditLinks: true, canEditWeights: true,
    canEditCapacities: true, canEditDemands: true, canChooseAlgorithm: true,
  };
  const DEFAULT_LOCKED: LockedFields = {
    canEditNodes: false, canEditLinks: false, canEditWeights: true,
    canEditCapacities: false, canEditDemands: false, canChooseAlgorithm: false,
  };

  const effectiveLockedFields = useMemo<LockedFields>(() => {
    if (appMode === "lab" || appMode === "teacher") return ALL_OPEN;
    return activeAssignment?.lockedFields ?? DEFAULT_LOCKED;
  }, [appMode, activeAssignment]); // eslint-disable-line

  const lockedFieldsRef = useRef<LockedFields>(effectiveLockedFields);
  useEffect(() => { lockedFieldsRef.current = effectiveLockedFields; }, [effectiveLockedFields]);

  // ── Escape to deselect ────────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { setSelectedType(null); setSelectedId(null); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // ── Playback interval ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!isPlaying || traceEvents.length === 0) return;
    const timer = window.setInterval(() => {
      setActiveStepIndex((prev) => {
        if (prev >= traceEvents.length - 1) { setIsPlaying(false); return prev; }
        return prev + 1;
      });
    }, playbackSpeedMs);
    return () => clearInterval(timer);
  }, [isPlaying, playbackSpeedMs, traceEvents.length]);

  // ── Saved runs on mount ───────────────────────────────────────────────────
  useEffect(() => { refreshSavedRuns(); }, []); // eslint-disable-line

  // ── Network operations ────────────────────────────────────────────────────

  const handleAddNode = useCallback(() => {
    if (!lockedFieldsRef.current.canEditNodes) { toast("Node editing is locked by the teacher.", "info"); return; }
    const index = network.nodes.length + 1;
    const newNode: NodeInput = {
      id: makeId("node"),
      label: `N${index}`,
      x: 200 + (index % 5) * 110,
      y: 180 + Math.floor(index / 5) * 110,
      visualType: "node",
    };
    setNetwork((prev) => ({ ...prev, nodes: [...prev.nodes, newNode] }));
  }, [network.nodes.length, toast]);

  const handleDeleteNode = useCallback((id: string) => {
    if (!lockedFieldsRef.current.canEditNodes) { toast("Node editing is locked by the teacher.", "info"); return; }
    setNetwork((prev) => ({
      ...prev,
      nodes: prev.nodes.filter((n) => n.id !== id),
      links: prev.links.filter((l) => l.source !== id && l.target !== id),
      demands: prev.demands.filter((d) => d.source !== id && d.target !== id),
    }));
    setSelectedType(null);
    setSelectedId(null);
    setSimulationResult(null);
    setBaselineResult(null); setOptimizationRunRecords({}); setSelectedOptimizationMode(null); setComparingOptimizationMode(null); // PR5: cached optimization results/selection invalidated by the same structural edit // structural edit (PR 6 comparison invalidation) — node delete
  }, [toast]);

  const handleDeleteLink = useCallback((id: string) => {
    if (!lockedFieldsRef.current.canEditLinks) { toast("Link editing is locked by the teacher.", "info"); return; }
    setNetwork((prev) => ({ ...prev, links: prev.links.filter((l) => l.id !== id) }));
    setSelectedType(null);
    setSelectedId(null);
    setSimulationResult(null);
    setBaselineResult(null); setOptimizationRunRecords({}); setSelectedOptimizationMode(null); setComparingOptimizationMode(null); // PR5: cached optimization results/selection invalidated by the same structural edit // structural edit (PR 6 comparison invalidation) — permanent link delete
  }, [toast]);

  const handleAddLink = useCallback((source: string, target: string) => {
    if (!lockedFieldsRef.current.canEditLinks) { toast("Link editing is locked by the teacher.", "info"); return; }
    const duplicate = network.links.some(
      (l) =>
        (l.source === source && l.target === target) ||
        (!network.isDirected && l.source === target && l.target === source)
    );
    if (duplicate) { toast("That link already exists.", "info"); return; }
    setNetwork((prev) => ({
      ...prev,
      links: [...prev.links, { id: makeId("link"), source, target, weight: 1, capacity: 10 }],
    }));
    setSimulationResult(null);
    setBaselineResult(null); setOptimizationRunRecords({}); setSelectedOptimizationMode(null); setComparingOptimizationMode(null); // PR5: cached optimization results/selection invalidated by the same structural edit // structural edit (PR 6 comparison invalidation) — permanent link add
  }, [network.links, network.isDirected, toast]);

  const handleUpdateNode = useCallback((id: string, update: Partial<NodeInput>) => {
    if (!lockedFieldsRef.current.canEditNodes) { toast("Node editing is locked by the teacher.", "info"); return; }
    setNetwork((prev) => ({
      ...prev,
      nodes: prev.nodes.map((n) => (n.id === id ? { ...n, ...update } : n)),
    }));
  }, [toast]);

  const handleUpdateLink = useCallback((id: string, update: Partial<LinkInput>) => {
    const lf = lockedFieldsRef.current;
    if ("weight" in update && !lf.canEditWeights) { toast("Link weights are locked by the teacher.", "info"); return; }
    if ("capacity" in update && !lf.canEditCapacities) { toast("Link capacities are locked by the teacher.", "info"); return; }
    setNetwork((prev) => ({
      ...prev,
      links: prev.links.map((l) => (l.id === id ? { ...l, ...update } : l)),
    }));
    setSimulationResult(null);
  }, [toast]);

  const handleMoveNode = useCallback((id: string, x: number, y: number) => {
    if (!lockedFieldsRef.current.canEditNodes) return;
    setNetwork((prev) => ({
      ...prev,
      nodes: prev.nodes.map((n) => (n.id === id ? { ...n, x, y } : n)),
    }));
  }, []);

  const handleAddDemand = useCallback((partial: Omit<TrafficDemandInput, "id">) => {
    if (!lockedFieldsRef.current.canEditDemands) { toast("Traffic demands are locked by the teacher.", "info"); return; }
    setNetwork((prev) => ({
      ...prev,
      demands: [...prev.demands, { ...partial, id: makeId("demand") }],
    }));
    setSimulationResult(null);
    setBaselineResult(null); setOptimizationRunRecords({}); setSelectedOptimizationMode(null); setComparingOptimizationMode(null); // PR5: cached optimization results/selection invalidated by the same structural edit // structural edit (PR 6 comparison invalidation) — demand add
  }, [toast]);

  const handleDeleteDemand = useCallback((id: string) => {
    if (!lockedFieldsRef.current.canEditDemands) { toast("Traffic demands are locked by the teacher.", "info"); return; }
    setNetwork((prev) => ({ ...prev, demands: prev.demands.filter((d) => d.id !== id) }));
    setAlgorithmConfig((prev) => ({
      ...prev,
      segmentRoutingPolicies: prev.segmentRoutingPolicies?.some((p) => p.demandId === id)
        ? prev.segmentRoutingPolicies.filter((p) => p.demandId !== id)
        : prev.segmentRoutingPolicies,
      trafficDistributions: prev.trafficDistributions?.some((d) => d.demandId === id)
        ? prev.trafficDistributions.filter((d) => d.demandId !== id)
        : prev.trafficDistributions,
      // A demand-scoped policy (demandId === id) is pruned; a global one
      // (demandId === null) is untouched — it still applies to every
      // remaining demand.
      tePolicies: prev.tePolicies?.some((p) => p.demandId === id)
        ? prev.tePolicies.filter((p) => p.demandId !== id)
        : prev.tePolicies,
    }));
    setSimulationResult(null);
    setBaselineResult(null); setOptimizationRunRecords({}); setSelectedOptimizationMode(null); setComparingOptimizationMode(null); // PR5: cached optimization results/selection invalidated by the same structural edit // structural edit (PR 6 comparison invalidation) — demand delete
  }, [toast]);

  const handleGenerateTopology = useCallback((net: NetworkInput) => {
    setNetwork(net);
    setSimulationResult(null);
    setBaselineResult(null); setOptimizationRunRecords({}); setSelectedOptimizationMode(null); setComparingOptimizationMode(null); // PR5: cached optimization results/selection invalidated by the same structural edit // structural edit (PR 6 comparison invalidation) — topology regeneration
    setSelectedType(null);
    setSelectedId(null);
    // A new topology invalidates any node/link ids referenced by per-demand
    // config from the old one — clear rather than risk a stale waypoint,
    // path-share, or policy reference the backend would (correctly) reject.
    setAlgorithmConfig((prev) => ({ ...prev, segmentRoutingPolicies: [], trafficDistributions: [], tePolicies: [], failureSchedule: [] }));
    setDistributionMode("EQUAL");
    setTeDraft(null);
    setTeIsSelecting(false);
    setTeQuickSelectActive(false);
    setTeQuickPopupLinkId(null);
  }, []);

  const handleResetNetwork = useCallback(() => {
    setNetwork(triangleTemplate);
    setAlgorithmConfig(defaultAlgorithmConfig);
    setDistributionMode("EQUAL");
    setTeDraft(null);
    setTeIsSelecting(false);
    setTeQuickSelectActive(false);
    setTeQuickPopupLinkId(null);
    setSimulationResult(null);
    setBaselineResult(null); setOptimizationRunRecords({}); setSelectedOptimizationMode(null); setComparingOptimizationMode(null); // PR5: cached optimization results/selection invalidated by the same structural edit
    setComparisonMode("after");
    setSelectedType(null);
    setSelectedId(null);
    setActiveStepIndex(0);
    setIsPlaying(false);
    setIsTraceMode(false);
    setLectureInsight(null);
    toast("Reset to triangle example.", "info");
  }, [toast]);

  const handleGoHome = useCallback(() => {
    setCurrentStep(0);
    setNetwork({ nodes: [], links: [], demands: [], topologyType: "custom", isDirected: false });
    setSimulationResult(null);
    setBaselineResult(null); setOptimizationRunRecords({}); setSelectedOptimizationMode(null); setComparingOptimizationMode(null); // PR5: cached optimization results/selection invalidated by the same structural edit
    setOptimizationHistory([]); // full session reset — see handleLogout for the same treatment
    setComparisonMode("after");
    setLectureInsight(null);
    setSelectedType(null);
    setSelectedId(null);
    setIsTraceMode(false);
    setIsPlaying(false);
    setAppMode("lab");
  }, []);

  const handleLogin = useCallback((role: UserRole, studentId?: string) => {
    setUserRole(role);
    if (studentId) {
      setCurrentStudentId(studentId);
      saveCurrentStudentId(studentId);
    }
    setCurrentStep(0);
    setAppMode("lab");
    if (role === "teacher") refreshSavedAssignments(); // eslint-disable-line
  }, []); // eslint-disable-line

  const handleLogout = useCallback(() => {
    setUserRole(null);
    setCurrentStudentId(null);
    saveCurrentStudentId(null);
    setCurrentStep(0);
    setAppMode("lab");
    setNetwork({ nodes: [], links: [], demands: [], topologyType: "custom", isDirected: false });
    setSimulationResult(null);
    setOptimizationRunRecords({}); setSelectedOptimizationMode(null); setComparingOptimizationMode(null);
    setOptimizationHistory([]); // session-only (PR6 §15) — a fresh session starts with a clean log
    setLectureInsight(null);
    setSelectedType(null);
    setSelectedId(null);
    setIsTraceMode(false);
    setIsPlaying(false);
    setActiveAssignment(null);
    setActiveSubmission(null);
    setGradingResult(null);
    setChallengeGradingResult(null);
    setAttemptHistory([]);
    setHintsRevealed(0);
    setAttemptNumber(1);
  }, []);

  const handleGoToLab = useCallback(() => {
    setAppMode("lab");
    setNetwork({ nodes: [], links: [], demands: [], topologyType: "custom", isDirected: false });
    setSimulationResult(null);
    setCurrentStep(1);
  }, []);

  const handleAutoLayout = useCallback(() => {
    setNetwork((prev) => applyAutoLayout(prev));
    setFitViewTrigger((p) => p + 1);
    toast("Auto layout applied.", "info");
  }, [toast]);

  const handleFitView = useCallback(() => setFitViewTrigger((p) => p + 1), []);

  // ── JSON import/export ────────────────────────────────────────────────────

  const handleImportJson = useCallback(async (file: File) => {
    try {
      const raw = await parseTopologyFile(file);
      const validation = validateTopologyJson(raw);
      if (!validation.valid) {
        toast(`Import failed: ${validation.errors[0]}`, "error");
        return;
      }
      const imported = importTopologyJson(raw);
      setNetwork(imported);
      setSimulationResult(null);
      setSelectedType(null);
      setSelectedId(null);
      setFitViewTrigger((p) => p + 1);
      toast(`Imported "${raw.name ?? file.name}" — ${imported.nodes.length}N, ${imported.links.length}L`, "success");
    } catch (err) {
      toast((err as Error).message, "error");
    }
  }, [toast]);

  const handleExportJson = useCallback(() => {
    downloadTopologyJson(network, `${network.topologyType}-topology.json`);
    toast("Topology exported as JSON.", "success");
  }, [network, toast]);

  const handleDownloadExample = useCallback(() => {
    downloadExampleTopologyJson();
    toast("Example JSON downloaded.", "info");
  }, [toast]);

  // ── Selection ─────────────────────────────────────────────────────────────

  const handleSelectNode = useCallback((id: string | null) => {
    setSelectedType(id ? "node" : null);
    setSelectedId(id);
  }, []);

  const handleSelectLink = useCallback((id: string | null) => {
    setSelectedType(id ? "link" : null);
    setSelectedId(id);
  }, []);

  // ── Connect mode ──────────────────────────────────────────────────────────

  const handleStartConnect = useCallback((id: string) => {
    setWaypointSelectDemandId(null); // connect mode, waypoint-select, and TE-policy-select are mutually exclusive
    setTeIsSelecting(false);
    setTeQuickSelectActive(false);
    setTeQuickPopupLinkId(null);
    setConnectSourceId(id);
    setSelectedType(null);
    setSelectedId(null);
  }, []);

  const handleCancelConnect = useCallback(() => {
    setConnectSourceId(null);
  }, []);

  const handleCompleteConnect = useCallback((targetId: string) => {
    if (!connectSourceId) return;
    handleAddLink(connectSourceId, targetId);
    setConnectSourceId(null);
  }, [connectSourceId, handleAddLink]);

  // ── Segment Routing waypoint selection ───────────────────────────────────

  const handleStartWaypointSelect = useCallback((demandId: string) => {
    setConnectSourceId(null); // waypoint-select, connect mode, and TE-policy-select are mutually exclusive
    setTeIsSelecting(false);
    setTeQuickSelectActive(false);
    setTeQuickPopupLinkId(null);
    setSelectedType(null);
    setSelectedId(null);
    setWaypointSelectDemandId(demandId);
  }, []);

  const handleStopWaypointSelect = useCallback(() => {
    setWaypointSelectDemandId(null);
  }, []);

  const handleAddWaypoint = useCallback((demandId: string, nodeId: string) => {
    setAlgorithmConfig((prev) => {
      const policies = prev.segmentRoutingPolicies ?? [];
      const existing = policies.find((p) => p.demandId === demandId);
      const segments = existing?.segments ?? [];
      const updatedSegments = [...segments, nodeId];
      const updatedPolicies: SegmentRoutingPolicy[] = existing
        ? policies.map((p) => (p.demandId === demandId ? { ...p, segments: updatedSegments } : p))
        : [...policies, { demandId, segments: updatedSegments }];
      return { ...prev, segmentRoutingPolicies: updatedPolicies };
    });
    setSimulationResult(null);
  }, []);

  // Same validation for both the graph-click flow and the dropdown fallback
  // in SegmentRoutingEditor — a node clicked on the canvas goes through this
  // before reaching handleAddWaypoint; the dropdown already excludes invalid
  // options structurally, so this mainly guards the graph-click path.
  const handleSelectWaypointNodeFromCanvas = useCallback((nodeId: string) => {
    if (!waypointSelectDemandId) return;
    const demand = network.demands.find((d) => d.id === waypointSelectDemandId);
    if (!demand) { setWaypointSelectDemandId(null); return; }
    if (nodeId === demand.source) {
      toast("Source doesn't need to be added as a waypoint.", "info");
      return;
    }
    if (nodeId === demand.target) {
      toast("Destination is already the final stop — no need to add it.", "info");
      return;
    }
    const existing = (algorithmConfig.segmentRoutingPolicies ?? []).find((p) => p.demandId === waypointSelectDemandId);
    const lastWaypoint = existing?.segments[existing.segments.length - 1];
    if (nodeId === lastWaypoint) {
      toast("That node is already the last waypoint.", "info");
      return;
    }
    handleAddWaypoint(waypointSelectDemandId, nodeId);
    // Stay in selection mode so the student can click several waypoints in a row.
  }, [waypointSelectDemandId, network.demands, algorithmConfig.segmentRoutingPolicies, handleAddWaypoint, toast]);

  const handleRemoveWaypoint = useCallback((demandId: string, index: number) => {
    setAlgorithmConfig((prev) => ({
      ...prev,
      segmentRoutingPolicies: (prev.segmentRoutingPolicies ?? []).map((p) =>
        p.demandId === demandId ? { ...p, segments: p.segments.filter((_, i) => i !== index) } : p
      ),
    }));
    setSimulationResult(null);
  }, []);

  const handleMoveWaypoint = useCallback((demandId: string, index: number, direction: "up" | "down") => {
    setAlgorithmConfig((prev) => ({
      ...prev,
      segmentRoutingPolicies: (prev.segmentRoutingPolicies ?? []).map((p) => {
        if (p.demandId !== demandId) return p;
        const swapWith = direction === "up" ? index - 1 : index + 1;
        if (swapWith < 0 || swapWith >= p.segments.length) return p;
        const segments = [...p.segments];
        [segments[index], segments[swapWith]] = [segments[swapWith], segments[index]];
        return { ...p, segments };
      }),
    }));
    setSimulationResult(null);
  }, []);

  const handleCenterNode = useCallback((id: string) => {
    setCenterNodeRequest((prev) => ({ id, nonce: (prev?.nonce ?? 0) + 1 }));
  }, []);

  const handleAddDemandFrom = useCallback((id: string) => {
    setPrefillDemandSource(id);
    setSelectedType(null);
    setSelectedId(null);
    setCurrentStep(2);
  }, []);

  // ── ECMP traffic distribution ─────────────────────────────────────────────

  const handleDistributionModeChange = useCallback((mode: "EQUAL" | "CUSTOM") => {
    setDistributionMode(mode);
    if (mode === "EQUAL") {
      setAlgorithmConfig((prev) => ({ ...prev, trafficDistributions: [] }));
      return;
    }
    // CUSTOM: only materialize real per-path shares once a fresh ECMP result
    // is available to discover paths from — otherwise leave the array empty
    // (still safe: an empty trafficDistributions list is equal-split by
    // definition, so there is no way to submit a half-configured request).
    if (simulationResult?.algorithm === "ECMP") {
      setAlgorithmConfig((prev) => ({
        ...prev,
        trafficDistributions: buildCustomDistributionsFromResult(network.demands, simulationResult.pathResults),
      }));
    }
  }, [simulationResult, network.demands]);

  const handleDistributionShareChange = useCallback((demandId: string, pathId: string, sharePercent: number) => {
    setAlgorithmConfig((prev) => ({
      ...prev,
      trafficDistributions: (prev.trafficDistributions ?? []).map((d) =>
        d.demandId === demandId
          ? { ...d, paths: d.paths.map((p) => (p.pathId === pathId ? { ...p, share: sharePercent / 100 } : p)) }
          : d
      ),
    }));
  }, []);

  // ── Traffic Engineering policies ──────────────────────────────────────────
  // A policy change can change which paths ECMP discovers for a demand, so
  // any custom traffic distribution becomes potentially stale the moment a
  // policy is added or removed — same safety pattern as topology regeneration
  // in PR 3 (the backend would also correctly reject a genuinely stale
  // distribution, but clearing it here avoids a confusing error for a change
  // the student didn't realize was related).
  const clearStaleDistributions = useCallback(() => {
    setDistributionMode("EQUAL");
    setAlgorithmConfig((prev) => (prev.trafficDistributions?.length ? { ...prev, trafficDistributions: [] } : prev));
  }, []);

  // Shared by both the dropdown draft flow and the graph-first quick-add
  // flow below — one place that checks for a pointless duplicate, appends
  // the policy, and invalidates any now-possibly-stale custom distribution.
  const addTEPolicy = useCallback((policy: Omit<TrafficEngineeringPolicy, "policyId">): boolean => {
    const duplicate = (algorithmConfig.tePolicies ?? []).some((p) =>
      p.type === policy.type &&
      (p.demandId ?? null) === (policy.demandId ?? null) &&
      (p.linkId ?? null) === (policy.linkId ?? null) &&
      (p.nodeId ?? null) === (policy.nodeId ?? null)
    );
    if (duplicate) {
      toast("An identical policy already exists.", "info");
      return false;
    }
    const newPolicy: TrafficEngineeringPolicy = { policyId: makeId("tepolicy"), ...policy };
    setAlgorithmConfig((prev) => ({ ...prev, tePolicies: [...(prev.tePolicies ?? []), newPolicy] }));
    clearStaleDistributions();
    setSimulationResult(null);
    return true;
  }, [algorithmConfig.tePolicies, clearStaleDistributions, toast]);

  const handleOpenTEDraft = useCallback(() => {
    setTeQuickSelectActive(false); // dropdown draft and quick-add are mutually exclusive
    setTeQuickPopupLinkId(null);
    setTeDraft({ type: "AVOID_LINK", demandId: null, linkId: null, nodeId: null });
  }, []);

  const handleCancelTEDraft = useCallback(() => {
    setTeDraft(null);
    setTeIsSelecting(false);
  }, []);

  const handleUpdateTEDraft = useCallback((patch: Partial<TEPolicyDraft>) => {
    setTeDraft((prev) => (prev ? { ...prev, ...patch } : prev));
  }, []);

  const handleStartTEGraphSelect = useCallback(() => {
    // Dropdown-flow "Pick on graph" — mutually exclusive with connect mode,
    // waypoint-select, and the quick-add flow below.
    setConnectSourceId(null);
    setWaypointSelectDemandId(null);
    setTeQuickSelectActive(false);
    setTeQuickPopupLinkId(null);
    setSelectedType(null);
    setSelectedId(null);
    setTeIsSelecting(true);
  }, []);

  const handleStopTEGraphSelect = useCallback(() => {
    setTeIsSelecting(false);
  }, []);

  const handleSelectTEPolicyTargetFromCanvas = useCallback((kind: "node" | "link", id: string) => {
    if (teQuickSelectActive) {
      // Quick-add flow: a link click hands off to the floating popup instead
      // of a form field — REQUIRE_WAYPOINT (node-based) isn't part of this
      // flow, so `kind` is always "link" here by construction.
      if (kind !== "link") return;
      setTeQuickSelectActive(false);
      setTeQuickPopupLinkId(id);
      return;
    }
    if (!teDraft) return;
    const expectsNode = teDraft.type === "REQUIRE_WAYPOINT";
    if ((expectsNode && kind !== "node") || (!expectsNode && kind !== "link")) {
      toast(`Click a ${expectsNode ? "node" : "link"} for this policy type.`, "info");
      return;
    }
    setTeDraft((prev) => (prev ? { ...prev, linkId: expectsNode ? null : id, nodeId: expectsNode ? id : null } : prev));
    setTeIsSelecting(false);
  }, [teQuickSelectActive, teDraft, toast]);

  const handleCommitTEDraft = useCallback(() => {
    if (!teDraft) return;
    const isWaypoint = teDraft.type === "REQUIRE_WAYPOINT";
    const targetId = isWaypoint ? teDraft.nodeId : teDraft.linkId;
    if (!targetId) return;
    const added = addTEPolicy({
      type: teDraft.type,
      demandId: teDraft.demandId,
      linkId: isWaypoint ? null : teDraft.linkId,
      nodeId: isWaypoint ? teDraft.nodeId : null,
      priority: 0,
    });
    if (added) {
      setTeDraft(null);
      setTeIsSelecting(false);
    }
  }, [teDraft, addTEPolicy]);

  const handleRemoveTEPolicy = useCallback((policyId: string) => {
    setAlgorithmConfig((prev) => ({
      ...prev,
      tePolicies: (prev.tePolicies ?? []).filter((p) => p.policyId !== policyId),
    }));
    clearStaleDistributions();
    setSimulationResult(null);
  }, [clearStaleDistributions]);

  // ── Scheduled mid-simulation failures (PR 6, Part 1) ──────────────────────
  // Same invalidation pattern as TE policies above: a scheduled failure can
  // change which paths a demand ends up on partway through the run, so any
  // stale custom ECMP distribution (computed for the pre-schedule path set)
  // is cleared rather than risking a mismatch the backend would otherwise
  // reject. Unlike the Link Inspector's Fail/Restore control (PR 5, applies
  // immediately to the persistent topology), this only takes effect on the
  // *next* simulation run — it schedules an event inside that run's trace.
  const handleAddFailureEvent = useCallback((linkId: string, triggerValue: number) => {
    setAlgorithmConfig((prev) => ({
      ...prev,
      failureSchedule: [
        ...(prev.failureSchedule ?? []),
        { eventId: makeId("failure"), linkId, triggerType: "TRACE_STEP", triggerValue },
      ],
    }));
    clearStaleDistributions();
    setSimulationResult(null);
  }, [clearStaleDistributions]);

  const handleRemoveFailureEvent = useCallback((eventId: string) => {
    setAlgorithmConfig((prev) => ({
      ...prev,
      failureSchedule: (prev.failureSchedule ?? []).filter((f) => f.eventId !== eventId),
    }));
    clearStaleDistributions();
    setSimulationResult(null);
  }, [clearStaleDistributions]);

  // ── Link failure (PR 5) ─────────────────────────────────────────────────
  // Failure/restore is global topology state, gated on the same
  // canEditLinks lock as delete/add link (no new LockedFields field — a
  // student who can't touch links at all shouldn't be able to fail one
  // either). Toggling changes which paths exist, so — same safety pattern
  // as TE policy add/remove above — it invalidates the current result and
  // any custom ECMP distribution rather than risk stale shares being sent
  // to the backend for a path set that may no longer exist. Algorithm
  // selection, demands, and TE policies are all left untouched: a policy on
  // a now-DOWN link simply has no effect until the link is restored.
  const handleToggleLinkOperationalStatus = useCallback((id: string) => {
    if (!lockedFieldsRef.current.canEditLinks) { toast("Link editing is locked by the teacher.", "info"); return; }
    const link = network.links.find((l) => l.id === id);
    if (!link) return;
    const goingDown = (link.operationalStatus ?? "UP") === "UP";
    setNetwork((prev) => ({
      ...prev,
      links: prev.links.map((l) =>
        l.id === id ? { ...l, operationalStatus: goingDown ? "DOWN" : "UP" } : l
      ),
    }));
    clearStaleDistributions();
    setSimulationResult(null);
    toast(
      goingDown
        ? `Link ${id} marked down. Rerun the simulation to see rerouting.`
        : `Link ${id} restored. Rerun the simulation to see routing recompute.`,
      "info"
    );
  }, [network.links, clearStaleDistributions, toast]);

  // ── TE policy — graph-first quick-add flow ────────────────────────────────
  // "Select on Graph" from the editor enters link-selection mode immediately
  // (no policy type chosen yet); once a link is clicked, a floating popup
  // anchored to it lets the student pick Prefer/Avoid/Forbid in one more
  // click. Additional to, not a replacement for, the dropdown draft above.

  const handleStartTEQuickLinkSelect = useCallback(() => {
    setConnectSourceId(null);
    setWaypointSelectDemandId(null);
    setTeDraft(null);
    setTeIsSelecting(false);
    setSelectedType(null);
    setSelectedId(null);
    setTeQuickPopupLinkId(null);
    setTeQuickSelectActive(true);
  }, []);

  const handleCancelTEQuickFlow = useCallback(() => {
    setTeQuickSelectActive(false);
    setTeQuickPopupLinkId(null);
  }, []);

  const handleChooseTEQuickPolicy = useCallback((type: TEQuickLinkPolicyType) => {
    if (!teQuickPopupLinkId) return;
    addTEPolicy({ type, demandId: null, linkId: teQuickPopupLinkId, nodeId: null, priority: 0 });
    setTeQuickPopupLinkId(null);
  }, [teQuickPopupLinkId, addTEPolicy]);

  // ── Simulation ────────────────────────────────────────────────────────────

  const handleSimulate = useCallback(async () => {
    setLectureInsight(null);
    setIsRunning(true);
    setIsPlaying(false);
    setIsTraceMode(false);
    try {
      const result = await simulateNetwork({ network, algorithmConfig });
      setSimulationResult(result);
      // First successful run ever becomes the baseline automatically; every
      // run after that only updates "current" — comparison needs something
      // stable to compare against, and silently moving the baseline on
      // every run would make that impossible. See ComparisonPanel's
      // "Set as baseline" for the explicit override.
      setBaselineResult((prev) => prev ?? result);
      setActiveStepIndex(0);
      setCurrentStep(4);
      refreshSavedRuns();
      const hasCongestion = result.congestedLinkCount > 0;
      toast(
        hasCongestion
          ? `Simulation done — ${result.congestedLinkCount} congested link(s).`
          : "Simulation done — no congestion.",
        hasCongestion ? "error" : "success"
      );
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setIsRunning(false);
    }
  }, [network, algorithmConfig, toast]);

  // Switching TO difference mode while a trace is being replayed would mean
  // replaying a trace that's simultaneously being recolored by comparison
  // status — confusing, and not something the spec asks for ("replay may
  // be disabled or automatically switch to After"). Exiting trace mode is
  // the safest of those two options: the student sees the static heatmap
  // immediately instead of a disabled-looking replay control.
  const handleComparisonModeChange = useCallback((mode: ComparisonMode) => {
    setComparisonMode(mode);
    if (mode === "difference" && isTraceMode) {
      setIsTraceMode(false);
      setIsPlaying(false);
    }
  }, [isTraceMode]);

  // Explicit override (PR 6) — "Set current as baseline" in ComparisonPanel.
  // The only other way baselineResult changes is automatically, on the
  // first successful run (see handleSimulate above) or a structural edit
  // that invalidates it (see the delete/regenerate handlers above).
  const handleSetBaseline = useCallback(() => {
    if (!simulationResult) return;
    setBaselineResult(simulationResult);
    toast("Current result set as baseline.", "info");
  }, [simulationResult, toast]);

  // ── Optimization Lab (Sprint 2, PR5, extended PR6) ──────────────────────
  // Each mode is launched independently, on its own explicit "Run" click —
  // never auto-executed (PR5 §2). No fake data: every card's numbers come
  // straight from a real POST /optimize call (PR5 §11). PR6: `settings`
  // (search budget, weight range, timeout — see OptimizationSettingsPanel)
  // is threaded straight into the request, and every completed run appends
  // one row to the session-only experiment history (PR6 §15).
  const handleRunOptimization = useCallback(async (
    mode: Exclude<OptimizationLabMode, "CURRENT">,
    settings: OptimizationSettings,
  ) => {
    setOptimizationRunning((prev) => new Set(prev).add(mode));
    try {
      const result = await runOptimization({
        network, algorithmConfig, mode,
        maxExactCombinations: settings.maxExactCombinations,
        minWeight: settings.minWeight,
        maxWeight: settings.maxWeight,
        timeLimitSeconds: settings.timeLimitSeconds,
      });
      setOptimizationRunRecords((prev) => ({ ...prev, [mode]: { result, settings } }));
      setOptimizationHistory((prev) => [
        ...prev,
        {
          id: makeId("opt-history"),
          mode,
          budget: settings.maxExactCombinations,
          searchMethod: result.searchMethod ?? null,
          runtimeMs: result.solverRuntime,
          mlu: result.mlu,
          provenOptimal: result.provenOptimal ?? null,
          status: result.status,
          timestamp: Date.now(),
        },
      ]);
      setSelectedOptimizationMode(mode);
      const ok = result.status === "OPTIMAL" || result.status === "FEASIBLE" || result.status === "TIME_LIMIT";
      toast(
        ok ? `${mode} finished — MLU ${(result.mlu * 100).toFixed(1)}%.` : result.message,
        result.status === "OPTIMAL" || result.status === "FEASIBLE" ? "success" : ok ? "info" : "error"
      );
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setOptimizationRunning((prev) => {
        const next = new Set(prev);
        next.delete(mode);
        return next;
      });
    }
  }, [network, algorithmConfig, toast]);

  // Applying a recommendation updates the real network configuration —
  // gated behind OptimizationCard's own explicit "click to confirm" step
  // (PR5 §5: "nothing should be silently overwritten"). WPO/JOINT
  // recommendations only have any effect under Segment Routing (their own
  // routing model — see docs/research/sprint2-mip-architecture-analysis.md
  // §11), so applying one also switches the active algorithm; LWO's weights
  // only matter under ECMP, so applying it switches back. Structural edit,
  // same invalidation pattern as every other network mutation in this file.
  const handleApplyOptimization = useCallback((mode: Exclude<OptimizationLabMode, "CURRENT">) => {
    const result = optimizationRunRecords[mode]?.result;
    if (!result) return;

    const weights = (mode === "LWO" || mode === "JOINT") ? result.recommendedWeights : null;
    if (weights) {
      setNetwork((prev) => ({
        ...prev,
        links: prev.links.map((l) => (weights[l.id] !== undefined ? { ...l, weight: weights[l.id] } : l)),
      }));
    }

    const waypoints = (mode === "WPO" || mode === "JOINT") ? result.recommendedWaypoints : null;
    setAlgorithmConfig((prev) => {
      let next = prev;
      if (waypoints) {
        const touchedDemandIds = new Set(waypoints.map((w) => w.demandId));
        const untouchedPolicies = (prev.segmentRoutingPolicies ?? []).filter((p) => !touchedDemandIds.has(p.demandId));
        const newPolicies: SegmentRoutingPolicy[] = waypoints
          .filter((w) => w.waypointNodeId !== null)
          .map((w) => ({ demandId: w.demandId, segments: [w.waypointNodeId as string] }));
        next = { ...next, segmentRoutingPolicies: [...untouchedPolicies, ...newPolicies] };
      }
      if (mode === "WPO" || mode === "JOINT") next = { ...next, selectedAlgorithm: "SEGMENT_ROUTING" };
      else if (mode === "LWO") next = { ...next, selectedAlgorithm: "ECMP" };
      return next;
    });

    // The network the cached recommendations were computed against no
    // longer matches — clear rather than risk showing a stale card as if
    // it still described the current configuration.
    setSimulationResult(null);
    setBaselineResult(null);
    setOptimizationRunRecords({});
    setSelectedOptimizationMode(null);
    setComparingOptimizationMode(null);
    toast(`Applied the ${mode} recommendation. Rerun the simulation to see the effect.`, "success");
  }, [optimizationRunRecords, toast]);

  // ── Saved runs ────────────────────────────────────────────────────────────

  async function refreshSavedRuns() {
    try { setSavedRuns(await listSavedRuns()); } catch { /* MongoDB offline */ }
  }

  async function refreshSavedAssignments() {
    const demo = loadDemoAssignmentSummaries();
    try {
      const remote = await listAssignments();
      // Merge: demo summaries always present; remote summaries appended (dedup by assignmentId)
      const seen = new Set(demo.map((a) => a.assignmentId));
      setSavedAssignments([...demo, ...remote.filter((a) => !seen.has(a.assignmentId))]);
    } catch {
      setSavedAssignments(demo); // MongoDB offline — show demo only
    }
  }

  // ── Classroom handlers ────────────────────────────────────────────────────

  const handleSaveAssignment = useCallback(async () => {
    const validation = validateAssignmentJson(teacherDraft);
    if (!validation.valid) {
      toast(`Assignment incomplete: ${validation.errors[0]}`, "error");
      return;
    }
    try {
      await saveAssignment(teacherDraft as Assignment);
      await refreshSavedAssignments();
      toast("Assignment saved.", "success");
    } catch (err) {
      toast((err as Error).message, "error");
    }
  }, [teacherDraft, toast]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleExportAssignment = useCallback(() => {
    if (teacherDraft.title) {
      downloadAssignmentJson(teacherDraft as Assignment);
      toast("Assignment JSON exported.", "success");
    } else {
      toast("Add a title before exporting.", "info");
    }
  }, [teacherDraft, toast]);

  const handleImportAssignmentFile = useCallback(async (file: File) => {
    try {
      const raw = await parseAssignmentFile(file);
      const result = validateAssignmentJson(raw);
      if (!result.valid) { toast(`Import failed: ${result.errors[0]}`, "error"); return; }
      setTeacherDraft(importAssignmentJson(raw));
      toast("Assignment imported.", "success");
    } catch (err) {
      toast((err as Error).message, "error");
    }
  }, [toast]);

  const handleLoadStudentAssignment = useCallback((a: Assignment) => {
    setActiveAssignment(a);
    setNetwork(structuredClone(a.starterNetwork));
    setActiveSubmission(createSubmissionTemplate(a));
    setSimulationResult(null);
    setGradingResult(null);
    // Reset challenge state
    setCurrentAttempt(null);
    setChallengeGradingResult(null);
    setAttemptHistory([]);
    setHintsRevealed(0);
    setAttemptNumber(1);
    setCurrentStep(1);
    toast(`${a.mode === "challenge" ? "Challenge" : "Assignment"} "${a.title}" loaded.`, "success");
  }, [toast]); // eslint-disable-line react-hooks/exhaustive-deps

  // Demo Scenario Pack — opens a pre-seeded scenario (topology, demands,
  // algorithm, policies, waypoints, failure schedule all come along
  // together, nested inside starterAlgorithmConfig) via the same
  // student-safe endpoint (/assignments/{id}/student) every other "open an
  // assignment" flow uses. Deliberately does NOT run simulate/optimize —
  // the presenter clicks Run/Optimize themselves, per the Demo Scenario
  // Pack's own design (never auto-run anything expensive on open).
  const handleOpenDemoScenario = useCallback(async (assignmentId: string) => {
    try {
      const a = await getAssignmentForStudent(assignmentId);
      setNetwork(structuredClone(a.starterNetwork));
      if (a.starterAlgorithmConfig) {
        setAlgorithmConfig(structuredClone(a.starterAlgorithmConfig));
      }
      setActiveAssignment(null);
      setSimulationResult(null);
      setGradingResult(null);
      setBaselineResult(null);
      setOptimizationRunRecords({});
      setOptimizationHistory([]);
      setSelectedOptimizationMode(null);
      setComparingOptimizationMode(null);
      setReplayMode(null);
      setIsTraceMode(false);
      setIsPlaying(false);
      setCurrentStep(3); // land on Algorithm — preloaded and ready to Run
      toast(`Demo scenario "${a.title}" loaded.`, "success");
    } catch {
      toast("Could not load demo scenario. Is the backend/MongoDB running? Try Reseed pack.", "error");
    }
  }, [toast]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSwitchMode = useCallback((mode: AppMode) => {
    if (mode !== "challenge") {
      // Leaving challenge mode — clear stale challenge state
      setCurrentAttempt(null);
      setChallengeGradingResult(null);
      setAttemptHistory([]);
      setHintsRevealed(0);
      setAttemptNumber(1);
      if (mode !== "student") setActiveAssignment(null);
    }
    setReplayMode(null);
    setIsTraceMode(false);
    setIsPlaying(false);
    setAppMode(mode);
    if (mode === "teacher") refreshSavedAssignments(); // eslint-disable-line
    if (mode === "challenge") {
      // Reset to import screen when entering challenge mode fresh
      setActiveAssignment(null);
      setSimulationResult(null);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Challenge handlers ─────────────────────────────────────────────────────

  const makeId = (prefix = "id") =>
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? `${prefix}-${crypto.randomUUID()}`
      : `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;

  const buildCurrentAttempt = useCallback(
    (answers: Record<string, unknown> = {}): ChallengeAttempt => ({
      attemptId: makeId("attempt"),
      assignmentId: activeAssignment?.assignmentId ?? "",
      studentName: "",
      attemptNumber,
      submittedNetwork: structuredClone(network),
      submittedAlgorithmConfig: algorithmConfig,
      submittedAnswers: answers,
      createdAt: new Date().toISOString(),
    }),
    [activeAssignment, attemptNumber, network, algorithmConfig], // eslint-disable-line
  );

  const handleRunChallengeAttempt = useCallback(async () => {
    setCurrentAttempt(buildCurrentAttempt());
    await handleSimulate();
  }, [buildCurrentAttempt, handleSimulate]); // eslint-disable-line

  const handleSubmitChallengeAttempt = useCallback(async (answers: Record<string, unknown>) => {
    if (!activeAssignment || !simulationResult) {
      toast("Run the simulation first.", "info");
      return;
    }
    const attempt = buildCurrentAttempt(answers);
    setCurrentAttempt(attempt);

    // Try server-side grading first; fall back to client-side if backend is unreachable.
    let result;
    try {
      result = await gradeAttempt({
        assignmentId: activeAssignment.assignmentId,
        assignment: activeAssignment as unknown as Record<string, unknown>,
        submittedNetwork: network,
        submittedAlgorithmConfig: algorithmConfig,
        submittedAnswers: answers,
        hintsUsed: hintsRevealed,
      });
    } catch {
      toast("Backend unavailable — using local grading.", "info");
      result = gradeChallenge(attempt, activeAssignment, simulationResult, hintsRevealed);
    }

    setChallengeGradingResult(result);

    // Record history entry
    const entry: AttemptHistoryEntry = {
      attemptNumber,
      timestamp: new Date().toISOString(),
      score: result.score,
      maxScore: result.maxScore,
      maxUtilization: simulationResult.maxUtilization,
      congestedLinkCount: simulationResult.congestedLinkCount,
      hintsUsed: hintsRevealed,
      isCorrect: result.isCorrect,
    };
    setAttemptHistory((prev) => [...prev, entry]);

    if (!result.isCorrect) {
      setAttemptNumber((n) => n + 1);
      setHintsRevealed(0);
    }

    // Persist to backend if MongoDB available
    try {
      await saveChallengeAttempt({ ...attempt, gradingScore: result.score, gradingPassed: result.isCorrect, hintsUsed: hintsRevealed });
    } catch { /* MongoDB offline */ }

    toast(result.isCorrect ? `Correct! Score: ${result.score}/${result.maxScore}` : `Incorrect — score: ${result.score}/${result.maxScore}. Try again.`,
      result.isCorrect ? "success" : "error");
  }, [activeAssignment, simulationResult, buildCurrentAttempt, hintsRevealed, attemptNumber, toast]); // eslint-disable-line

  const handleResetChallengeAttempt = useCallback(() => {
    setNetwork(structuredClone(activeAssignment?.starterNetwork ?? network));
    setSimulationResult(null);
    setChallengeGradingResult(null);
    setCurrentAttempt(null);
    setHintsRevealed(0);
    setReplayMode(null);
    setIsTraceMode(false);
    setIsPlaying(false);
    toast("Attempt reset.", "info");
  }, [activeAssignment, network, toast]); // eslint-disable-line

  const handleRevealHint = useCallback(() => {
    if (!activeAssignment?.challengeConfig) return;
    const { challengeType, hints: teacherHints } = activeAssignment.challengeConfig;
    const hints = resolveHints(challengeType, teacherHints);
    if (hintsRevealed < hints.length) {
      setHintsRevealed((n) => n + 1);
      const hint = hints[hintsRevealed];
      toast(`Hint revealed: "${hint.title}"${hint.revealCostPenalty > 0 ? ` (−${hint.revealCostPenalty}pts)` : ""}`, "info");
    }
  }, [activeAssignment, hintsRevealed, toast]);

  const handleExportChallengeAttempt = useCallback(() => {
    if (currentAttempt) {
      const payload = { ...currentAttempt, submittedAlgorithmConfig: algorithmConfig };
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `challenge-attempt-${currentAttempt.attemptId.slice(0, 8)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast("Attempt exported.", "success");
    } else {
      toast("No attempt to export yet.", "info");
    }
  }, [currentAttempt, algorithmConfig, toast]); // eslint-disable-line

  const handleLoadSavedRun = useCallback(async (id: string) => {
    try {
      const run = await getSavedRun(id);
      setNetwork(run.network);
      setAlgorithmConfig(run.algorithmConfig);
      setSimulationResult(run.simulationResult);
      // A freshly loaded run has no comparison history of its own yet — it
      // becomes its own baseline (PR 6), same as the first run of a session.
      setBaselineResult(run.simulationResult);
      setComparisonMode("after");
      setOptimizationRunRecords({}); setSelectedOptimizationMode(null); setComparingOptimizationMode(null);
      setActiveStepIndex(0);
      setIsPlaying(false);
      setIsTraceMode(false);
      setLectureInsight(null);
      setCurrentStep(4);
      toast("Loaded saved run.", "success");
    } catch (err) {
      toast((err as Error).message, "error");
    }
  }, [toast]);

  const handleDeleteSavedRun = useCallback(async (id: string) => {
    try {
      await deleteSavedRun(id);
      await refreshSavedRuns();
      toast("Run deleted.", "info");
    } catch (err) {
      toast((err as Error).message, "error");
    }
  }, [toast]);

  // ── Lecture mode ──────────────────────────────────────────────────────────

  const handleLoadLectureExample = useCallback(async (example: LectureExample) => {
    setNetwork(example.network);
    setAlgorithmConfig(example.algorithmConfig);
    setSelectedType(null);
    setSelectedId(null);
    setSimulationResult(null);
    setIsPlaying(false);
    setIsTraceMode(false);
    setLectureInsight(example.insight);
    setIsRunning(true);

    try {
      // Pass example values directly — don't rely on state that hasn't re-rendered yet
      const result = await simulateNetwork({
        network: example.network,
        algorithmConfig: example.algorithmConfig,
      });
      setSimulationResult(result);
      setActiveStepIndex(0);
      setCurrentStep(4);
      refreshSavedRuns();
      const hasCongestion = result.congestedLinkCount > 0;
      toast(
        hasCongestion
          ? `${example.title} — ${result.congestedLinkCount} congested link${result.congestedLinkCount > 1 ? "s" : ""} as expected.`
          : `${example.title} loaded successfully.`,
        hasCongestion ? "error" : "success",
      );
    } catch (err) {
      toast((err as Error).message, "error");
      setLectureInsight(null);
    } finally {
      setIsRunning(false);
    }
  }, [toast]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Classroom assignment distribution ─────────────────────────────────────

  const handleAssignWork = useCallback((work: AssignedWork) => {
    setAssignedWorks((prev) => {
      const updated = [...prev, work];
      saveAssignedWorks(updated);
      return updated;
    });
    const target =
      work.assignedTo === "all"
        ? "all students"
        : `${(work.assignedTo as string[]).length} student(s)`;
    toast(`Assigned "${work.workTitle}" to ${target}.`, "success");
  }, [toast]);

  const handleExportAssignmentById = useCallback((assignmentId: string) => {
    const local = EXAMPLE_CHALLENGES.find((c) => c.assignmentId === assignmentId);
    if (local) { downloadAssignmentJson(local); toast("Assignment JSON exported.", "success"); return; }
    getAssignment(assignmentId)
      .then((a) => { downloadAssignmentJson(a); toast("Assignment JSON exported.", "success"); })
      .catch(() => toast("Assignment not found. Is MongoDB running?", "error"));
  }, [toast]); // eslint-disable-line

  const handleExportAssignmentPdf = useCallback((assignmentId: string, includeAnswer: boolean) => {
    const local = EXAMPLE_CHALLENGES.find((c) => c.assignmentId === assignmentId);
    if (local) { exportAssignmentPdf(local, { includeAnswer }); toast("PDF exported.", "success"); return; }
    getAssignment(assignmentId)
      .then((a) => { exportAssignmentPdf(a, { includeAnswer }); toast("PDF exported.", "success"); })
      .catch(() => toast("Assignment not found for PDF export. Is MongoDB running?", "error"));
  }, [toast]); // eslint-disable-line

  const handleOpenAssignedWork = useCallback(async (work: AssignedWork) => {
    if (work.workType === "challenge") {
      // Load directly from EXAMPLE_CHALLENGES — no MongoDB needed
      const found = EXAMPLE_CHALLENGES.find((c) => c.assignmentId === work.workId);
      setCurrentAttempt(null);
      setChallengeGradingResult(null);
      setAttemptHistory([]);
      setHintsRevealed(0);
      setAttemptNumber(1);
      setSimulationResult(null);
      setReplayMode(null);
      setIsTraceMode(false);
      setIsPlaying(false);
      if (found) {
        setActiveAssignment(found);
        setNetwork(structuredClone(found.starterNetwork));
        setCurrentStep(1);
        toast(`Opened "${found.title}".`, "success");
      } else {
        setActiveAssignment(null);
      }
      setAppMode("challenge");
    } else {
      // Regular assignment — try MongoDB, fall back with error message
      try {
        const assignment = await getAssignment(work.workId);
        setActiveAssignment(assignment);
        setNetwork(structuredClone(assignment.starterNetwork));
        setActiveSubmission(createSubmissionTemplate(assignment));
        setSimulationResult(null);
        setGradingResult(null);
        setCurrentAttempt(null);
        setChallengeGradingResult(null);
        setAttemptHistory([]);
        setHintsRevealed(0);
        setAttemptNumber(1);
        setCurrentStep(1);
        setAppMode(assignment.mode === "challenge" ? "challenge" : "student");
        toast(`Assignment "${assignment.title}" loaded.`, "success");
      } catch {
        toast("Could not load assignment. Is MongoDB running?", "error");
      }
    }
  }, [toast]); // eslint-disable-line

  // ── Derived for panels ────────────────────────────────────────────────────

  const selectedNode = selectedType === "node"
    ? network.nodes.find((n) => n.id === selectedId) ?? null : null;
  const selectedLink = selectedType === "link"
    ? network.links.find((l) => l.id === selectedId) ?? null : null;

  const topologyStats = useMemo(() => computeTopologyStats(network), [network]);

  // ── Left panel ────────────────────────────────────────────────────────────

  const labPanel = (() => {
    if (currentStep === 1)
      return (
        <NetworkBuilderPage
          network={network}
          topologyStats={topologyStats}
          onGenerateTopology={handleGenerateTopology}
          onBack={() => setCurrentStep(0)}
          onNext={() => setCurrentStep(2)}
        />
      );
    if (currentStep === 2)
      return (
        <TrafficConfigurationPage
          nodes={network.nodes}
          demands={network.demands}
          onAddDemand={handleAddDemand}
          onDeleteDemand={handleDeleteDemand}
          onBack={() => setCurrentStep(1)}
          onNext={() => setCurrentStep(3)}
          initialSource={prefillDemandSource}
          onConsumeInitialSource={() => setPrefillDemandSource(null)}
          canEditDemands={effectiveLockedFields.canEditDemands}
        />
      );
    if (currentStep === 3)
      return (
        <AlgorithmSelectionPage
          algorithmConfig={algorithmConfig}
          isRunning={isRunning}
          onAlgorithmChange={(a: AlgorithmName) => {
            setAlgorithmConfig((p) => ({ ...p, selectedAlgorithm: a }));
            // Comparing results from two different algorithms isn't a
            // meaningful before/after (PR 6) — not the same "scenario"
            // changing, a different routing model entirely.
            setBaselineResult(null); setOptimizationRunRecords({}); setSelectedOptimizationMode(null); setComparingOptimizationMode(null); // PR5: cached optimization results/selection invalidated by the same structural edit
          }}
          onThresholdChange={(v) =>
            setAlgorithmConfig((p) => ({ ...p, congestionThreshold: v }))
          }
          onBack={() => { handleStopWaypointSelect(); setCurrentStep(2); }}
          onStartSimulation={handleSimulate}
          onOpenOptimizationLab={() => setCurrentStep(5)}
          canChooseAlgorithm={effectiveLockedFields.canChooseAlgorithm}
          demands={network.demands}
          nodes={network.nodes}
          links={network.links}
          waypointSelectDemandId={waypointSelectDemandId}
          onStartWaypointSelect={handleStartWaypointSelect}
          onStopWaypointSelect={handleStopWaypointSelect}
          onAddWaypoint={handleAddWaypoint}
          onRemoveWaypoint={handleRemoveWaypoint}
          onMoveWaypoint={handleMoveWaypoint}
          simulationResult={simulationResult}
          distributionMode={distributionMode}
          onDistributionModeChange={handleDistributionModeChange}
          onDistributionShareChange={handleDistributionShareChange}
          tePolicies={algorithmConfig.tePolicies ?? []}
          teDraft={teDraft}
          teIsSelecting={teIsSelecting}
          onOpenTEDraft={handleOpenTEDraft}
          onCancelTEDraft={handleCancelTEDraft}
          onUpdateTEDraft={handleUpdateTEDraft}
          onStartTEGraphSelect={handleStartTEGraphSelect}
          onStopTEGraphSelect={handleStopTEGraphSelect}
          onCommitTEDraft={handleCommitTEDraft}
          onRemoveTEPolicy={handleRemoveTEPolicy}
          teQuickSelectActive={teQuickSelectActive}
          onStartTEQuickLinkSelect={handleStartTEQuickLinkSelect}
          failureSchedule={algorithmConfig.failureSchedule ?? []}
          onAddFailureEvent={handleAddFailureEvent}
          onRemoveFailureEvent={handleRemoveFailureEvent}
        />
      );
    if (currentStep === 5)
      return (
        <OptimizationLabPage
          network={network}
          algorithmConfig={algorithmConfig}
          currentSimulationResult={simulationResult}
          runRecords={optimizationRunRecords}
          runningModes={optimizationRunning}
          selectedMode={selectedOptimizationMode}
          comparingMode={comparingOptimizationMode}
          comparisonMode={optComparisonMode}
          history={optimizationHistory}
          onComparisonModeChange={setOptComparisonMode}
          onBack={() => setCurrentStep(3)}
          onRun={handleRunOptimization}
          onSelectForView={setSelectedOptimizationMode}
          onCompare={setComparingOptimizationMode}
          onApply={handleApplyOptimization}
        />
      );
    return (
      <SimulationStudioPage
        result={simulationResult}
        isTraceMode={isTraceMode}
        currentTraceEvent={currentTraceEvent}
        activeStepIndex={activeStepIndex}
        totalSteps={traceEvents.length}
        onEnableTrace={() => {
          // Difference mode is a static heatmap, not a replay (spec: "do
          // not build a third replay system") — entering trace mode from
          // it falls back to replaying the current ("after") result, the
          // same safe default as a fresh run.
          if (comparisonMode === "difference") setComparisonMode("after");
          setIsTraceMode(true);
          setActiveStepIndex(0);
          setShowRoutingTable(false);
        }}
        onDisableTrace={() => { setIsTraceMode(false); setIsPlaying(false); setShowRoutingTable(false); }}
        onBack={() => setCurrentStep(3)}
        lectureInsight={lectureInsight}
        baselineResult={baselineResult}
        comparison={comparison}
        comparisonMode={comparisonMode}
        onComparisonModeChange={handleComparisonModeChange}
        onSetBaseline={handleSetBaseline}
      />
    );
  })();

  const clearChallengeState = useCallback(() => {
    setActiveAssignment(null);
    setCurrentAttempt(null);
    setChallengeGradingResult(null);
    setAttemptHistory([]);
    setHintsRevealed(0);
    setAttemptNumber(1);
    setSimulationResult(null);
    setReplayMode(null);
    setIsTraceMode(false);
    setIsPlaying(false);
  }, []); // eslint-disable-line

  const handleOpenChallengeById = useCallback((workId: string) => {
    const found = EXAMPLE_CHALLENGES.find((c) => c.assignmentId === workId);
    if (!found) { toast(`Challenge "${workId}" not found in library.`, "error"); return; }
    clearChallengeState();
    setActiveAssignment(found);
    setNetwork(structuredClone(found.starterNetwork));
    setCurrentStep(1);
    setAppMode("challenge");
    toast(`Opened "${found.title}" in Challenge Mode.`, "success");
  }, [clearChallengeState, toast]); // eslint-disable-line

  const handleResetDemoData = useCallback(() => {
    resetDemoClassroomData();
    const demo = loadDemoAssignedWorks();
    const user = loadAssignedWorks();
    const seen = new Set(demo.map((w) => w.assignedWorkId));
    const merged = [...demo, ...user.filter((w) => !seen.has(w.assignedWorkId))];
    setAssignedWorks(merged);
    saveAssignedWorks(user); // keep user-assigned works intact
    setSavedAssignments(loadDemoAssignmentSummaries());
    toast("Demo data reset to defaults.", "success");
  }, [toast]); // eslint-disable-line

  const handleSeedDemoToMongoDB = useCallback(async () => {
    try {
      const health = await getBackendHealth();
      if (!health.mongoAvailable) { toast("MongoDB is not running — cannot seed.", "error"); return; }
      await seedDemoAssignments(EXAMPLE_CHALLENGES);
      await seedDemoScenarios(); // idempotent — safe to call every time this button is clicked
      await refreshSavedAssignments(); // eslint-disable-line
      toast("Demo assignments and scenario pack seeded to MongoDB.", "success");
    } catch {
      toast("Seed failed. Is the backend reachable? (check VITE_BACKEND_URL and backend CORS settings)", "error");
    }
  }, [toast]); // eslint-disable-line

  const handleStartReplay = useCallback(() => {
    setIsTraceMode(true);
    setActiveStepIndex(0);
    setIsPlaying(false);
    setReplayMode("trace");
    setShowRoutingTable(false);
  }, []);

  const handleStartCompare = useCallback(() => {
    setIsTraceMode(false);
    setIsPlaying(false);
    setReplayMode("compare");
  }, []);

  const handleExitReplay = useCallback(() => {
    setReplayMode(null);
    setIsTraceMode(false);
    setIsPlaying(false);
  }, []);

  const leftPanel = appMode === "teacher" ? (
    <TeacherWorkspacePage
      draft={teacherDraft}
      currentLabNetwork={network}
      savedAssignments={savedAssignments}
      onDraftChange={(updates) => setTeacherDraft((p) => ({ ...p, ...updates }))}
      onSave={handleSaveAssignment}
      onExport={handleExportAssignment}
      onPreviewAsStudent={() => {
        if (teacherDraft.title && teacherDraft.starterNetwork) {
          const a = teacherDraft as Assignment;
          handleLoadStudentAssignment(a);
          setAppMode(a.mode === "challenge" ? "challenge" : "student");
        } else {
          toast("Set a title and starter network before previewing.", "info");
        }
      }}
      onNewDraft={() => setTeacherDraft(newAssignmentDraft())}
      onLoadExampleTemplate={(a) => setTeacherDraft(structuredClone(a))}
      onImportAssignmentFile={handleImportAssignmentFile}
    />
  ) : appMode === "challenge" ? (
    <ChallengeWorkspacePage
      assignment={activeAssignment?.mode === "challenge" ? activeAssignment : null}
      currentAttempt={currentAttempt}
      simulationResult={simulationResult}
      gradingResult={challengeGradingResult}
      attemptHistory={attemptHistory}
      hintsRevealed={hintsRevealed}
      replayMode={replayMode}
      onLoadAssignment={handleLoadStudentAssignment}
      onRunAttempt={handleRunChallengeAttempt}
      onSubmitAttempt={handleSubmitChallengeAttempt}
      onResetAttempt={handleResetChallengeAttempt}
      onRevealHint={handleRevealHint}
      onClearAssignment={clearChallengeState}
      onExportAttempt={handleExportChallengeAttempt}
      onStartReplay={handleStartReplay}
      onStartCompare={handleStartCompare}
      onExitReplay={handleExitReplay}
    />
  ) : appMode === "student" ? (
    <StudentWorkspacePage
      assignment={activeAssignment}
      submission={activeSubmission}
      simulationResult={simulationResult}
      gradingResult={gradingResult}
      hasTraceEvents={(simulationResult?.traceEvents.length ?? 0) > 0}
      onLoadAssignment={handleLoadStudentAssignment}
      onRunSimulation={handleSimulate}
      onSubmitAnswers={(answers) => {
        if (activeSubmission) setActiveSubmission((p) => p ? { ...p, submittedAnswers: answers } : p);
      }}
      onExportSubmission={() => toast("Submission exported.", "success")}
      onClearAssignment={() => {
        setActiveAssignment(null);
        setActiveSubmission(null);
        setGradingResult(null);
        setReplayMode(null);
        setIsTraceMode(false);
        setIsPlaying(false);
      }}
      onStartReplay={handleStartReplay}
    />
  ) : labPanel;

  // ── Right panel ───────────────────────────────────────────────────────────

  const traceTimelineEl = (
    <>
      {srDisplayState && <SegmentListPanel srState={srDisplayState} network={network} />}
      <TraceTimeline
        events={traceEvents}
        activeIndex={activeStepIndex}
        isPlaying={isPlaying}
        speedMs={playbackSpeedMs}
        onStep={setActiveStepIndex}
        onBack={() => setActiveStepIndex((p) => Math.max(0, p - 1))}
        onForward={() => setActiveStepIndex((p) => Math.min(traceEvents.length - 1, p + 1))}
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onReset={() => { setActiveStepIndex(0); setIsPlaying(false); }}
        onSpeedChange={setPlaybackSpeedMs}
        network={network}
        simulationResult={simulationResult}
        onShowFullTable={() => setShowRoutingTable(true)}
      />
      <RoutingTablePanel
        entries={simulationResult?.distanceVectorTable}
        network={network}
        activeRowKeys={activeTableRowKeys}
        showModal={showRoutingTable}
        onOpenModal={() => setShowRoutingTable(true)}
        onCloseModal={() => setShowRoutingTable(false)}
      />
    </>
  );

  const rightPanel = (() => {
    if (replayMode === "trace" && isTraceMode) return traceTimelineEl;
    if (currentStep === 4) {
      if (isTraceMode) return traceTimelineEl;
      return <MetricsPanel result={simulationResult} />;
    }
    return null;
  })();

  const showRight = appMode !== "teacher" && currentStep === 4;

  return (
    <div className="app-shell">
      {/* ── Top bar ── */}
      <header className="topbar">
        <button className="topbar-brand" onClick={handleGoHome}>
          <span className="topbar-logo">◈</span>
          <div>
            <div className="topbar-title">Network Lab</div>
            <div className="topbar-sub">Routing visualizer</div>
          </div>
        </button>

        {appMode === "lab" && currentStep > 0 && (
          <nav className="stage-nav" aria-label="Workflow stages">
            {/* PR6 §17 fix: the Optimization Lab (step 5) branches off from
                Algorithm (step 3), not a 5th sequential stage — cluttering
                the stepper with a literal 5th dot would misrepresent it as
                a required, linear step. Instead, the stepper itself keeps
                showing exactly the 4 stages it always has, computed against
                an *effective* step (5 reads as "still at Algorithm" for
                done/active purposes — Design/Traffic read done, Algorithm
                reads active, Result reads neither), and a separate,
                unambiguous "Optimization Lab" indicator appears alongside
                it only while step 5 is actually open. */}
            {stages.map(({ step, label, icon: Icon, hint }) => {
              const effectiveStep = currentStep === 5 ? 3 : currentStep;
              const isDone   = effectiveStep > step;
              const isActive = effectiveStep === step;
              return (
                <button
                  key={step}
                  className={`stage-btn ${isActive ? "stage-btn--active" : ""} ${isDone ? "stage-btn--done" : ""}`}
                  onClick={() => setCurrentStep(step)}
                  aria-current={isActive ? "step" : undefined}
                  title={hint}
                >
                  <span className="stage-icon">
                    {isDone ? <CheckCircle2 size={13} /> : <Icon size={13} />}
                  </span>
                  <span className="stage-label">{label}</span>
                </button>
              );
            })}
            {currentStep === 5 && (
              <span
                className="stage-lab-indicator"
                title="Optimization Lab — branching off from Algorithm. Your Design/Traffic/Algorithm work is unaffected."
              >
                <FlaskConical size={12} /> Optimization Lab
              </span>
            )}
          </nav>
        )}

        {/* ── Mode tabs — role-filtered, hidden at dashboard ── */}
        {userRole && !(appMode === "lab" && currentStep === 0) && (
          <nav className="mode-tabs" aria-label="Application mode">
            <button
              className={`mode-tab${appMode === "lab" ? " mode-tab--active" : ""}`}
              onClick={() => handleSwitchMode("lab")}
            >
              <Network size={12} /> Lab
            </button>
            {userRole === "teacher" && (
              <button
                className={`mode-tab${appMode === "teacher" ? " mode-tab--active" : ""}`}
                onClick={() => handleSwitchMode("teacher")}
              >
                <BookOpen size={12} /> Teacher
              </button>
            )}
            {userRole === "student" && (
              <>
                <button
                  className={`mode-tab${appMode === "student" ? " mode-tab--active" : ""}`}
                  onClick={() => handleSwitchMode("student")}
                >
                  <GraduationCap size={12} /> Student
                </button>
                <button
                  className={`mode-tab${appMode === "challenge" ? " mode-tab--active" : ""}`}
                  onClick={() => handleSwitchMode("challenge")}
                >
                  <Target size={12} /> Challenge
                </button>
              </>
            )}
          </nav>
        )}

        <div className="topbar-actions">
          {userRole && (
            <>
              <button
                className="topbar-action-btn"
                onClick={() => setSavedRunsOpen(true)}
                title="Saved runs"
                aria-label="Open saved runs"
              >
                <Clock size={14} />
                {savedRuns.length > 0 && <span className="topbar-badge">{savedRuns.length}</span>}
              </button>
              <span className="topbar-role-badge">
                {userRole === "teacher" ? <BookOpen size={11} /> : <GraduationCap size={11} />}
                {userRole === "teacher"
                  ? "Teacher"
                  : (DEMO_STUDENTS.find((s) => s.studentId === currentStudentId)?.name?.split(" ")[0] ?? "Student")}
              </span>
              <button className="topbar-logout-btn" onClick={handleLogout} title="Sign out">
                <LogOut size={13} /> Sign out
              </button>
            </>
          )}
          {!userRole && currentStep > 0 && (
            <>
              <span className="topbar-role-badge topbar-role-badge--guest">
                <Network size={11} /> Guest
              </span>
              <button className="topbar-logout-btn" onClick={handleLogout} title="Back to home">
                <LogOut size={13} /> Exit
              </button>
            </>
          )}
        </div>
      </header>

      {/* ── Main content ── */}
      {appMode === "lab" && currentStep === 0 ? (
        <main className="home-fullpage">
          {!userRole ? (
            <LandingPage onLogin={handleLogin} onGuestLab={handleGoToLab} />
          ) : userRole === "teacher" ? (
            <TeacherDashboard
              savedAssignments={savedAssignments}
              assignedWorks={assignedWorks}
              savedRuns={savedRuns}
              onCreateAssignment={() => handleSwitchMode("teacher")}
              onBuildLab={handleGoToLab}
              onLoadLectureExample={handleLoadLectureExample}
              onOpenChallenges={() => handleSwitchMode("challenge")}
              onOpenSavedRuns={() => setSavedRunsOpen(true)}
              onImportJson={() => homeImportRef.current?.click()}
              onDownloadExampleTopology={handleDownloadExample}
              onOpenHelp={() => setShowHelpModal(true)}
              onAssignWork={handleAssignWork}
              onExportAssignmentJson={handleExportAssignmentById}
              onExportAssignmentPdf={handleExportAssignmentPdf}
              onRefreshAssignments={refreshSavedAssignments}
              onOpenChallenge={handleOpenChallengeById}
              onResetDemoData={handleResetDemoData}
              onSeedDemoToMongoDB={handleSeedDemoToMongoDB}
            />
          ) : currentStudentId === DEMO_STUDENT_ID ? (
            <DemoScenarioDashboard onOpenScenario={handleOpenDemoScenario} />
          ) : (
            <StudentDashboard
              assignedWorks={assignedWorks}
              currentStudentId={currentStudentId}
              currentStudentName={DEMO_STUDENTS.find((s) => s.studentId === currentStudentId)?.name ?? null}
              savedRuns={savedRuns}
              onOpenAssignment={() => handleSwitchMode("student")}
              onOpenChallenges={() => handleSwitchMode("challenge")}
              onBuildLab={handleGoToLab}
              onLoadLectureExample={handleLoadLectureExample}
              onOpenSavedRuns={() => setSavedRunsOpen(true)}
              onOpenHelp={() => setShowHelpModal(true)}
              onOpenAssignedWork={handleOpenAssignedWork}
              onOpenChallenge={handleOpenChallengeById}
            />
          )}
          <input
            ref={homeImportRef}
            type="file"
            accept=".json"
            style={{ display: "none" }}
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (file) {
                await handleImportJson(file);
                setCurrentStep(1);
              }
              e.target.value = "";
            }}
          />
        </main>
      ) : (
      <div
        className="workspace"
        style={{ gridTemplateColumns: wsGridCols(appMode, leftCollapsed, showRight, rightWide) }}
      >
        <aside className={`ws-left${leftCollapsed ? " ws-left--collapsed" : ""}`}>
          {!leftCollapsed && leftPanel}
          <button
            className="ws-panel-toggle ws-panel-toggle--left"
            onClick={() => setLeftCollapsed((c) => !c)}
            title={leftCollapsed ? "Expand left panel" : "Collapse left panel"}
          >
            {leftCollapsed ? <ChevronRight size={13} /> : <ChevronLeft size={13} />}
          </button>
        </aside>

        <section className="ws-canvas">
          {currentStep === 1 && (
            <CanvasToolbar
              onAddNode={handleAddNode}
              onAutoLayout={handleAutoLayout}
              onFitView={handleFitView}
              onImportJson={handleImportJson}
              onExportJson={handleExportJson}
              onDownloadExample={handleDownloadExample}
              onReset={handleResetNetwork}
              canEditNodes={effectiveLockedFields.canEditNodes}
            />
          )}

          {currentStep === 1 && network.nodes.length === 0 && (
            <div className="canvas-empty-state">
              <div className="canvas-empty-card">
                <div className="canvas-empty-icon">◈</div>
                <h3>Start designing your network</h3>
                <p>Add a node, load a template, or import a JSON file.</p>
                <div className="canvas-empty-actions">
                  <button className="btn-primary" onClick={handleAddNode}>Add first node</button>
                  <button className="btn-secondary" onClick={handleResetNetwork}>Load triangle</button>
                </div>
              </div>
            </div>
          )}

          {connectSourceId && (
            <div className="connect-mode-banner">
              Click another node to connect · <kbd>Esc</kbd> to cancel
            </div>
          )}

          {waypointSelectDemandId && (() => {
            const d = network.demands.find((dm) => dm.id === waypointSelectDemandId);
            const label = (id: string) => network.nodes.find((n) => n.id === id)?.label ?? id;
            return (
              <div className="connect-mode-banner connect-mode-banner--sr">
                {d ? `Select waypoint for ${label(d.source)} → ${label(d.target)}` : "Select waypoint"} ·{" "}
                <kbd>Esc</kbd> to stop
              </div>
            );
          })()}

          {teIsSelecting && teDraft && (
            <div className="connect-mode-banner connect-mode-banner--te">
              Select a {teDraft.type === "REQUIRE_WAYPOINT" ? "node" : "link"} for this policy ·{" "}
              <kbd>Esc</kbd> to stop
            </div>
          )}

          {teQuickSelectActive && (
            <div className="connect-mode-banner connect-mode-banner--te">
              Select a link on the graph · <kbd>Esc</kbd> to stop
            </div>
          )}

          <ReactFlowCanvas
            network={network}
            currentTraceEvent={currentTraceEvent}
            linkResults={linkResults}
            pathResults={pathResults}
            isSimulated={!!displayedResult}
            isTraceMode={canvasIsTraceMode}
            readonly={currentStep === 0}
            canEditNodes={effectiveLockedFields.canEditNodes}
            canEditLinks={effectiveLockedFields.canEditLinks}
            fitViewTrigger={fitViewTrigger}
            connectSourceId={connectSourceId}
            centerNodeRequest={centerNodeRequest}
            gradingHighlightLinks={challengeGradingResult?.highlightedLinks}
            gradingHighlightNodes={challengeGradingResult?.highlightedNodes}
            waypointSelectDemandId={waypointSelectDemandId}
            srDisplayState={srDisplayState}
            replayDownLinkIds={replayDownLinkIds}
            comparisonMode={activeComparisonMode}
            comparisonByLink={comparisonByLink}
            tePolicySelectMode={
              teQuickSelectActive ? "link" :
              teIsSelecting && teDraft ? (teDraft.type === "REQUIRE_WAYPOINT" ? "node" : "link") : null
            }
            tePolicies={algorithmConfig.tePolicies ?? []}
            teQuickPopupLinkId={teQuickPopupLinkId}
            onMoveNode={handleMoveNode}
            onAddLink={handleAddLink}
            onDeleteNode={handleDeleteNode}
            onDeleteLink={handleDeleteLink}
            onSelectNode={handleSelectNode}
            onSelectLink={handleSelectLink}
            onCompleteConnect={handleCompleteConnect}
            onCancelConnect={handleCancelConnect}
            onSelectWaypointNode={handleSelectWaypointNodeFromCanvas}
            onCancelWaypointSelect={handleStopWaypointSelect}
            onSelectTEPolicyTarget={handleSelectTEPolicyTargetFromCanvas}
            onCancelTEPolicySelect={teQuickSelectActive ? handleCancelTEQuickFlow : handleStopTEGraphSelect}
            onChooseTEQuickPolicy={handleChooseTEQuickPolicy}
            onCancelTEQuickPopup={handleCancelTEQuickFlow}
            onAddNodeShortcut={currentStep === 1 ? handleAddNode : undefined}
          />

          {/* ── Floating inspector drawer ── */}
          <InspectorDrawer
            selectedNode={selectedNode}
            selectedLink={selectedLink}
            network={network}
            simulationResult={simulationResult}
            lockedFields={effectiveLockedFields}
            onClose={() => { setSelectedType(null); setSelectedId(null); }}
            onUpdateNode={handleUpdateNode}
            onDeleteNode={handleDeleteNode}
            onUpdateLink={handleUpdateLink}
            onDeleteLink={handleDeleteLink}
            onToggleLinkOperationalStatus={handleToggleLinkOperationalStatus}
            comparisonByLink={comparisonByLink}
            onStartConnect={currentStep === 1 ? handleStartConnect : undefined}
            onAddDemandFrom={handleAddDemandFrom}
            onCenterNode={handleCenterNode}
            onSelectLink={(id) => { setSelectedType("link"); setSelectedId(id); }}
          />

          {/* Keyboard shortcut hint */}
          {currentStep === 1 && (
            <div className="canvas-shortcuts-hint">
              <kbd>A</kbd> add node · <kbd>F</kbd> fit view · <kbd>Del</kbd> delete selected · <kbd>Esc</kbd> deselect
            </div>
          )}
        </section>

        {showRight && (
          <aside className={`ws-right${rightWide ? " ws-right--wide" : ""}`}>
            <button
              className="ws-right-width-toggle"
              onClick={() => setRightWide((w) => !w)}
              title={rightWide ? "Compact panel" : "Expand panel"}
            >
              {rightWide ? "⟨" : "⟩"}
            </button>
            {rightPanel}
          </aside>
        )}
      </div>
      )}

      {/* ── Saved runs drawer ── */}
      {userRole && (
        <SavedRunsDrawer
          open={savedRunsOpen}
          runs={savedRuns}
          onClose={() => setSavedRunsOpen(false)}
          onRefresh={refreshSavedRuns}
          onLoad={handleLoadSavedRun}
          onDelete={handleDeleteSavedRun}
        />
      )}

      {/* ── JSON help modal ── */}
      <JsonHelpModal
        open={showHelpModal}
        onClose={() => setShowHelpModal(false)}
        onDownloadExampleTopology={handleDownloadExample}
      />
    </div>
  );
};

// ── Panel layout helper ───────────────────────────────────────────────────────

function wsGridCols(mode: AppMode, lc: boolean, showRight: boolean, wide = false): string {
  const lw = lc ? "48px" : mode === "teacher" ? "minmax(560px, 50%)" : "300px";
  if (mode === "teacher" || !showRight) return `${lw} 1fr`;
  return `${lw} 1fr ${wide ? "420px" : "280px"}`;
}

// ── Topology stats ────────────────────────────────────────────────────────────

function computeTopologyStats(network: NetworkInput) {
  const nodeCount = network.nodes.length;
  const linkCount = network.links.length;
  const avgDegree = nodeCount
    ? network.isDirected ? linkCount / nodeCount : (2 * linkCount) / nodeCount
    : 0;
  const maxLinks = network.isDirected
    ? nodeCount * (nodeCount - 1)
    : (nodeCount * (nodeCount - 1)) / 2;
  const density = maxLinks > 0 ? linkCount / maxLinks : 0;
  const components = countComponents(network);
  return { nodeCount, linkCount, avgDegree, density, components };
}

function countComponents(network: NetworkInput) {
  const unvisited = new Set(network.nodes.map((n) => n.id));
  const adj = new Map<string, string[]>();
  network.nodes.forEach((n) => adj.set(n.id, []));
  network.links.forEach((l) => {
    adj.get(l.source)?.push(l.target);
    adj.get(l.target)?.push(l.source);
  });
  let c = 0;
  while (unvisited.size) {
    c++;
    const [start] = unvisited;
    const stack = [start];
    unvisited.delete(start);
    while (stack.length) {
      const n = stack.pop()!;
      for (const nb of adj.get(n) ?? []) {
        if (unvisited.has(nb)) { unvisited.delete(nb); stack.push(nb); }
      }
    }
  }
  return c;
}

const TopologyStatsPanel: React.FC<{
  stats: ReturnType<typeof computeTopologyStats>;
}> = ({ stats }) => {
  const [open, setOpen] = useState(false);
  return (
    <div className="panel">
      <button className="panel-toggle" onClick={() => setOpen((p) => !p)}>
        <span>Topology stats</span>
        <span className="panel-toggle-meta">{stats.nodeCount}N · {stats.linkCount}L</span>
      </button>
      {open && (
        <div className="stat-grid">
          <span>Nodes <strong>{stats.nodeCount}</strong></span>
          <span>Links <strong>{stats.linkCount}</strong></span>
          <span>Avg degree <strong>{stats.avgDegree.toFixed(1)}</strong></span>
          <span>Components <strong>{stats.components}</strong></span>
          <span>Density <strong>{stats.density.toFixed(2)}</strong></span>
        </div>
      )}
    </div>
  );
};

export default WorkflowManager;
