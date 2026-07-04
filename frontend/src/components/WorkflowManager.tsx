import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Network, Waypoints, GitBranch, BarChart3, CheckCircle2, BookOpen, Clock, GraduationCap, Target, ChevronLeft, ChevronRight } from "lucide-react";
import ReactFlowCanvas from "./ReactFlowCanvas";
import MetricsPanel from "./MetricsPanel";
import RoutingTablePanel from "./RoutingTablePanel";
import TraceTimeline from "./TraceTimeline";
import NodeDetailPanel from "./NodeDetailPanel";
import LinkDetailPanel from "./LinkDetailPanel";
import SavedRunsDrawer from "./SavedRunsDrawer";
import CanvasToolbar from "./CanvasToolbar";
import WelcomePage from "../pages/WelcomePage";
import NetworkBuilderPage from "../pages/NetworkBuilderPage";
import TrafficConfigurationPage from "../pages/TrafficConfigurationPage";
import AlgorithmSelectionPage from "../pages/AlgorithmSelectionPage";
import SimulationStudioPage from "../pages/SimulationStudioPage";
import TeacherWorkspacePage from "../pages/TeacherWorkspacePage";
import StudentWorkspacePage from "../pages/StudentWorkspacePage";
import ChallengeWorkspacePage from "../pages/ChallengeWorkspacePage";
import { useToast } from "./Toast";
import { simulateNetwork, listSavedRuns, getSavedRun, deleteSavedRun, listAssignments, saveAssignment } from "../api/simulationApi";
import { triangleTemplate } from "../utils/topologyTemplates";
import { applyAutoLayout, generateRandomTopology, generateTopology, RandomGraphConfig, TopologySize } from "../utils/generatedTopologies";
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
import { saveChallengeAttempt } from "../api/simulationApi";
import { LectureExample } from "../utils/lectureExamples";
import {
  AppMode,
  Assignment,
  AssignmentSummary,
  GradingResult,
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

  // ── Topology picker ───────────────────────────────────────────────────────
  const [topologySize, setTopologySize] = useState<TopologySize>("small");
  const [randomConfig, setRandomConfig] = useState<RandomGraphConfig>({
    nodeCount: 8, linkCount: 12, weight: 1, capacity: 10, connected: true,
  });

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
  const [savedAssignments, setSavedAssignments] = useState<AssignmentSummary[]>([]);
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
  const [rightCollapsed, setRightCollapsed] = useState(false);

  // ── Home page import ref ──────────────────────────────────────────────────
  const homeImportRef = useRef<HTMLInputElement>(null);

  // ── Derived ───────────────────────────────────────────────────────────────
  const traceEvents = simulationResult?.traceEvents ?? [];
  const currentTraceEvent = isTraceMode ? (traceEvents[activeStepIndex] ?? null) : null;
  const linkResults = simulationResult?.linkResults ?? [];

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
    const index = network.nodes.length + 1;
    const newNode: NodeInput = {
      id: makeId("node"),
      label: `N${index}`,
      x: 200 + (index % 5) * 110,
      y: 180 + Math.floor(index / 5) * 110,
      visualType: "node",
    };
    setNetwork((prev) => ({ ...prev, nodes: [...prev.nodes, newNode] }));
  }, [network.nodes.length]);

  const handleDeleteNode = useCallback((id: string) => {
    setNetwork((prev) => ({
      ...prev,
      nodes: prev.nodes.filter((n) => n.id !== id),
      links: prev.links.filter((l) => l.source !== id && l.target !== id),
      demands: prev.demands.filter((d) => d.source !== id && d.target !== id),
    }));
    setSelectedType(null);
    setSelectedId(null);
    setSimulationResult(null);
  }, []);

  const handleDeleteLink = useCallback((id: string) => {
    setNetwork((prev) => ({ ...prev, links: prev.links.filter((l) => l.id !== id) }));
    setSelectedType(null);
    setSelectedId(null);
    setSimulationResult(null);
  }, []);

  const handleAddLink = useCallback((source: string, target: string) => {
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
    setNetwork((prev) => ({
      ...prev,
      nodes: prev.nodes.map((n) => (n.id === id ? { ...n, ...update } : n)),
    }));
  }, []);

  const handleUpdateLink = useCallback((id: string, update: Partial<LinkInput>) => {
    setNetwork((prev) => ({
      ...prev,
      links: prev.links.map((l) => (l.id === id ? { ...l, ...update } : l)),
    }));
    setSimulationResult(null);
  }, []);

  const handleMoveNode = useCallback((id: string, x: number, y: number) => {
    setNetwork((prev) => ({
      ...prev,
      nodes: prev.nodes.map((n) => (n.id === id ? { ...n, x, y } : n)),
    }));
  }, []);

  const handleAddDemand = useCallback((partial: Omit<TrafficDemandInput, "id">) => {
    setNetwork((prev) => ({
      ...prev,
      demands: [...prev.demands, { ...partial, id: makeId("demand") }],
    }));
    setSimulationResult(null);
  }, []);

  const handleDeleteDemand = useCallback((id: string) => {
    setNetwork((prev) => ({ ...prev, demands: prev.demands.filter((d) => d.id !== id) }));
    setSimulationResult(null);
  }, []);

  const handleLoadTopology = useCallback(() => {
    try {
      const generated = network.topologyType === "random"
        ? generateRandomTopology(randomConfig)
        : generateTopology(network.topologyType, topologySize);
      setNetwork(generated);
      const label = network.topologyType === "random"
        ? `random (${generated.nodes.length}N · ${generated.links.length}L)`
        : `${network.topologyType} (${topologySize})`;
      toast(`Loaded ${label}.`, "success");
      setSimulationResult(null);
      setSelectedType(null);
      setSelectedId(null);
    } catch (err) {
      toast((err as Error).message, "error");
    }
  }, [network.topologyType, topologySize, randomConfig, toast]);

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

  const handleSelectAndLoadTopology = useCallback((type: TopologyType) => {
    try {
      const generated = generateTopology(type, topologySize);
      setNetwork(generated);
      toast(`Loaded ${type} (${topologySize}).`, "success");
      setSimulationResult(null);
      setSelectedType(null);
      setSelectedId(null);
    } catch (err) {
      toast((err as Error).message, "error");
    }
  }, [topologySize, toast]);

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
    try { setSavedAssignments(await listAssignments()); } catch { /* MongoDB offline */ }
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
    const result = gradeChallenge(attempt, activeAssignment, simulationResult, hintsRevealed);
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
          topologySize={topologySize}
          topologyStats={topologyStats}
          randomConfig={randomConfig}
          onTopologyChange={(t) => setNetwork((p) => ({ ...p, topologyType: t as TopologyType }))}
          onTopologySizeChange={setTopologySize}
          onLoadTopology={handleLoadTopology}
          onSelectAndLoad={handleSelectAndLoadTopology}
          onRandomConfigChange={setRandomConfig}
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
    // Solution replay trace takes priority over node/link selection panels
    if (replayMode === "trace" && isTraceMode) return traceTimelineEl;

    if (selectedNode)
      return (
        <NodeDetailPanel
          node={selectedNode}
          network={network}
          result={simulationResult}
          onUpdate={handleUpdateNode}
          onDelete={handleDeleteNode}
          onStartConnect={currentStep === 1 ? handleStartConnect : undefined}
          onAddDemandFrom={handleAddDemandFrom}
          onCenterNode={handleCenterNode}
        />
      );
    if (selectedLink)
      return (
        <LinkDetailPanel
          link={selectedLink}
          network={network}
          result={simulationResult}
          onUpdate={handleUpdateLink}
          onDelete={handleDeleteLink}
        />
      );

    if (currentStep === 4) {
      if (isTraceMode) return traceTimelineEl;
      return <MetricsPanel result={simulationResult} />;
    }

    return <TopologyStatsPanel stats={topologyStats} />;
  })();

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

        {/* ── Mode tabs ── */}
        <nav className="mode-tabs" aria-label="Application mode">
          <button
            className={`mode-tab${appMode === "lab" ? " mode-tab--active" : ""}`}
            onClick={() => handleSwitchMode("lab")}
          >
            <Network size={12} /> Lab
          </button>
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
          <button
            className={`mode-tab${appMode === "teacher" ? " mode-tab--active" : ""}`}
            onClick={() => handleSwitchMode("teacher")}
          >
            <BookOpen size={12} /> Teacher
          </button>
        </nav>

        <div className="topbar-actions">
          <button
            className="topbar-action-btn"
            onClick={() => setSavedRunsOpen(true)}
            title="Saved runs"
            aria-label="Open saved runs"
          >
            <Clock size={14} />
            {savedRuns.length > 0 && <span className="topbar-badge">{savedRuns.length}</span>}
          </button>
        </div>
      </header>

      {/* ── Main content ── */}
      {appMode === "lab" && currentStep === 0 ? (
        <main className="home-fullpage">
          <WelcomePage
            savedRuns={savedRuns}
            onBuildNetwork={() => {
              setNetwork({ nodes: [], links: [], demands: [], topologyType: "custom", isDirected: false });
              setCurrentStep(1);
            }}
            onLoadSavedRun={handleLoadSavedRun}
            onOpenSavedRuns={() => setSavedRunsOpen(true)}
            onLoadLectureExample={handleLoadLectureExample}
            onImportJson={() => homeImportRef.current?.click()}
            onSwitchMode={handleSwitchMode}
          />
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
        style={{ gridTemplateColumns: wsGridCols(appMode, leftCollapsed, rightCollapsed) }}
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
            isSimulated={!!simulationResult}
            isTraceMode={isTraceMode}
            readonly={currentStep === 0}
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

          {/* Keyboard shortcut hint */}
          {currentStep === 1 && (
            <div className="canvas-shortcuts-hint">
              <kbd>A</kbd> add node · <kbd>F</kbd> fit view · <kbd>Del</kbd> delete selected · <kbd>Esc</kbd> deselect
            </div>
          )}
        </section>

        {appMode !== "teacher" && (
          <aside className={`ws-right${rightCollapsed ? " ws-right--collapsed" : ""}`}>
            {!rightCollapsed && rightPanel}
            <button
              className="ws-panel-toggle ws-panel-toggle--right"
              onClick={() => setRightCollapsed((c) => !c)}
              title={rightCollapsed ? "Expand right panel" : "Collapse right panel"}
            >
              {rightCollapsed ? <ChevronLeft size={13} /> : <ChevronRight size={13} />}
            </button>
          </aside>
        )}
      </div>
      )}

      {/* ── Saved runs drawer ── */}
      <SavedRunsDrawer
        open={savedRunsOpen}
        runs={savedRuns}
        onClose={() => setSavedRunsOpen(false)}
        onRefresh={refreshSavedRuns}
        onLoad={handleLoadSavedRun}
        onDelete={handleDeleteSavedRun}
      />
    </div>
  );
};

// ── Panel layout helper ───────────────────────────────────────────────────────

function wsGridCols(mode: AppMode, lc: boolean, rc: boolean): string {
  const lw = lc ? "48px" : mode === "teacher" ? "minmax(560px, 50%)" : "300px";
  if (mode === "teacher") return `${lw} 1fr`;
  const rw = rc ? "48px" : "280px";
  return `${lw} 1fr ${rw}`;
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
