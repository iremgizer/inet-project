import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Network, Waypoints, GitBranch, BarChart3, CheckCircle2, BookOpen, Clock, GraduationCap, Target, ChevronLeft, ChevronRight, LogOut } from "lucide-react";
import ReactFlowCanvas from "./ReactFlowCanvas";
import MetricsPanel from "./MetricsPanel";
import RoutingTablePanel from "./RoutingTablePanel";
import TraceTimeline from "./TraceTimeline";
import InspectorDrawer from "./InspectorDrawer";
import SavedRunsDrawer from "./SavedRunsDrawer";
import CanvasToolbar from "./CanvasToolbar";
import LandingPage from "../pages/LandingPage";
import TeacherDashboard from "../pages/TeacherDashboard";
import StudentDashboard from "../pages/StudentDashboard";
import NetworkBuilderPage from "../pages/NetworkBuilderPage";
import TrafficConfigurationPage from "../pages/TrafficConfigurationPage";
import AlgorithmSelectionPage from "../pages/AlgorithmSelectionPage";
import SimulationStudioPage from "../pages/SimulationStudioPage";
import TeacherWorkspacePage from "../pages/TeacherWorkspacePage";
import StudentWorkspacePage from "../pages/StudentWorkspacePage";
import ChallengeWorkspacePage from "../pages/ChallengeWorkspacePage";
import JsonHelpModal from "./JsonHelpModal";
import { useToast } from "./Toast";
import { UserRole } from "../utils/demoAuth";
import { AssignedWork } from "../types/classroom";
import { DEMO_STUDENTS } from "../utils/demoUsers";
import { loadAssignedWorks, saveAssignedWorks, loadCurrentStudentId, saveCurrentStudentId } from "../utils/classroomStorage";
import { exportAssignmentPdf } from "../utils/pdfExport";
import { simulateNetwork, listSavedRuns, getSavedRun, deleteSavedRun, listAssignments, saveAssignment, getAssignment, gradeAttempt } from "../api/simulationApi";
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
  SimulationResult,
  TopologyType,
  TrafficDemandInput,
} from "../types/network";

export type WorkflowStep = 0 | 1 | 2 | 3 | 4;

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

  // ── Trace playback ────────────────────────────────────────────────────────
  const [isTraceMode, setIsTraceMode] = useState(false);
  const [activeStepIndex, setActiveStepIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackSpeedMs, setPlaybackSpeedMs] = useState(900);

  // ── Saved runs ────────────────────────────────────────────────────────────
  const [savedRuns, setSavedRuns] = useState<SavedSimulationSummary[]>([]);
  const [savedRunsOpen, setSavedRunsOpen] = useState(false);

  // ── Canvas ───────────────────────────────────────────────────────────────
  const [fitViewTrigger, setFitViewTrigger] = useState(0);

  // ── Connect mode ──────────────────────────────────────────────────────────
  const [connectSourceId, setConnectSourceId] = useState<string | null>(null);
  const [centerNodeRequest, setCenterNodeRequest] = useState<{ id: string; nonce: number } | null>(null);
  const [prefillDemandSource, setPrefillDemandSource] = useState<string | null>(null);

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
  const traceEvents = simulationResult?.traceEvents ?? [];
  const currentTraceEvent = isTraceMode ? (traceEvents[activeStepIndex] ?? null) : null;
  const linkResults = simulationResult?.linkResults ?? [];
  const pathResults = simulationResult?.pathResults ?? [];

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
  }, [toast]);

  const handleDeleteLink = useCallback((id: string) => {
    if (!lockedFieldsRef.current.canEditLinks) { toast("Link editing is locked by the teacher.", "info"); return; }
    setNetwork((prev) => ({ ...prev, links: prev.links.filter((l) => l.id !== id) }));
    setSelectedType(null);
    setSelectedId(null);
    setSimulationResult(null);
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
  }, [toast]);

  const handleDeleteDemand = useCallback((id: string) => {
    if (!lockedFieldsRef.current.canEditDemands) { toast("Traffic demands are locked by the teacher.", "info"); return; }
    setNetwork((prev) => ({ ...prev, demands: prev.demands.filter((d) => d.id !== id) }));
    setSimulationResult(null);
  }, [toast]);

  const handleGenerateTopology = useCallback((net: NetworkInput) => {
    setNetwork(net);
    setSimulationResult(null);
    setSelectedType(null);
    setSelectedId(null);
  }, []);

  const handleResetNetwork = useCallback(() => {
    setNetwork(triangleTemplate);
    setAlgorithmConfig(defaultAlgorithmConfig);
    setSimulationResult(null);
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

  const handleCenterNode = useCallback((id: string) => {
    setCenterNodeRequest((prev) => ({ id, nonce: (prev?.nonce ?? 0) + 1 }));
  }, []);

  const handleAddDemandFrom = useCallback((id: string) => {
    setPrefillDemandSource(id);
    setSelectedType(null);
    setSelectedId(null);
    setCurrentStep(2);
  }, []);

  // ── Simulation ────────────────────────────────────────────────────────────

  const handleSimulate = useCallback(async () => {
    setLectureInsight(null);
    setIsRunning(true);
    setIsPlaying(false);
    setIsTraceMode(false);
    try {
      const result = await simulateNetwork({ network, algorithmConfig });
      setSimulationResult(result);
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
          onAlgorithmChange={(a: AlgorithmName) =>
            setAlgorithmConfig((p) => ({ ...p, selectedAlgorithm: a }))
          }
          onThresholdChange={(v) =>
            setAlgorithmConfig((p) => ({ ...p, congestionThreshold: v }))
          }
          onBack={() => setCurrentStep(2)}
          onStartSimulation={handleSimulate}
          canChooseAlgorithm={effectiveLockedFields.canChooseAlgorithm}
        />
      );
    return (
      <SimulationStudioPage
        result={simulationResult}
        isTraceMode={isTraceMode}
        currentTraceEvent={currentTraceEvent}
        activeStepIndex={activeStepIndex}
        totalSteps={traceEvents.length}
        onEnableTrace={() => { setIsTraceMode(true); setActiveStepIndex(0); }}
        onDisableTrace={() => { setIsTraceMode(false); setIsPlaying(false); }}
        onBack={() => setCurrentStep(3)}
        lectureInsight={lectureInsight}
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
      const health = await fetch("http://localhost:8000/health").then((r) => r.json());
      if (!health.mongoAvailable) { toast("MongoDB is not running — cannot seed.", "error"); return; }
      await fetch("http://localhost:8000/seed-demo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(EXAMPLE_CHALLENGES),
      });
      await refreshSavedAssignments(); // eslint-disable-line
      toast("Demo assignments seeded to MongoDB.", "success");
    } catch {
      toast("Seed failed. Is the backend running?", "error");
    }
  }, [toast]); // eslint-disable-line

  const handleStartReplay = useCallback(() => {
    setIsTraceMode(true);
    setActiveStepIndex(0);
    setIsPlaying(false);
    setReplayMode("trace");
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
      />
      <RoutingTablePanel entries={simulationResult?.distanceVectorTable} />
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
            {stages.map(({ step, label, icon: Icon, hint }) => {
              const isDone   = currentStep > step;
              const isActive = currentStep === step;
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
        style={{ gridTemplateColumns: wsGridCols(appMode, leftCollapsed, showRight) }}
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

          <ReactFlowCanvas
            network={network}
            currentTraceEvent={currentTraceEvent}
            linkResults={linkResults}
            pathResults={pathResults}
            isSimulated={!!simulationResult}
            isTraceMode={isTraceMode}
            readonly={currentStep === 0}
            canEditNodes={effectiveLockedFields.canEditNodes}
            canEditLinks={effectiveLockedFields.canEditLinks}
            fitViewTrigger={fitViewTrigger}
            connectSourceId={connectSourceId}
            centerNodeRequest={centerNodeRequest}
            gradingHighlightLinks={challengeGradingResult?.highlightedLinks}
            gradingHighlightNodes={challengeGradingResult?.highlightedNodes}
            onMoveNode={handleMoveNode}
            onAddLink={handleAddLink}
            onDeleteNode={handleDeleteNode}
            onDeleteLink={handleDeleteLink}
            onSelectNode={handleSelectNode}
            onSelectLink={handleSelectLink}
            onCompleteConnect={handleCompleteConnect}
            onCancelConnect={handleCancelConnect}
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
          <aside className="ws-right">
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

function wsGridCols(mode: AppMode, lc: boolean, showRight: boolean): string {
  const lw = lc ? "48px" : mode === "teacher" ? "minmax(560px, 50%)" : "300px";
  if (mode === "teacher" || !showRight) return `${lw} 1fr`;
  return `${lw} 1fr 280px`;
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
