import React, { useEffect, useMemo, useState } from "react";
import { ArrowLeft, FlaskConical, Info, History, GitCompare, Play } from "lucide-react";
import { AlgorithmConfig, NetworkInput, SimulationResult } from "../types/network";
import { OptimizationHistoryEntry, OptimizationLabMode, OptimizationRunRecord, SearchSpaceEstimate } from "../types/optimization";
import { OPTIMIZATION_MODE_INFO, describeCongestionFreeStatus } from "../utils/optimizationExplanations";
import { projectOptimizationResult } from "../utils/optimizationProjection";
import { describeViewOnGraphState } from "../utils/optimizationHighlight";
import { buildComparison, ComparisonMode } from "../utils/comparison";
import { computeResultRelationships } from "../utils/optimizationRelationships";
import { DEFAULT_SETTINGS, OptimizationSettings } from "../utils/optimizationSettings";
import { estimateSearchSpace } from "../api/optimizationApi";
import OptimizationCard from "../components/OptimizationCard";
import OptimizationSettingsPanel from "../components/OptimizationSettingsPanel";
import ComparisonPanel from "../components/ComparisonPanel";
import TermHint from "../components/TermHint";

const MODES: Exclude<OptimizationLabMode, "CURRENT">[] = ["OPT", "WPO", "LWO", "JOINT"];

interface OptimizationLabPageProps {
  network: NetworkInput;
  algorithmConfig: AlgorithmConfig;
  currentSimulationResult: SimulationResult | null;
  runRecords: Partial<Record<Exclude<OptimizationLabMode, "CURRENT">, OptimizationRunRecord>>;
  runningModes: Set<Exclude<OptimizationLabMode, "CURRENT">>;
  selectedMode: OptimizationLabMode | null;
  comparingMode: OptimizationLabMode | null;
  comparisonMode: ComparisonMode;
  history: OptimizationHistoryEntry[];
  onComparisonModeChange: (mode: ComparisonMode) => void;
  onBack: () => void;
  onRun: (mode: Exclude<OptimizationLabMode, "CURRENT">, settings: OptimizationSettings) => void;
  onRunAll: (settings: OptimizationSettings) => void;
  runAllProgress: { index: number; total: number; mode: Exclude<OptimizationLabMode, "CURRENT"> } | null;
  onSelectForView: (mode: OptimizationLabMode | null) => void;
  onCompare: (mode: OptimizationLabMode | null) => void;
  onApply: (mode: Exclude<OptimizationLabMode, "CURRENT">) => void;
}

function fmtPct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

/** The Optimization Lab (Sprint 2 PR5, extended in PR6) — a workflow step,
 * not a standalone application: reachable from the Algorithm step once a
 * topology and demands exist, sitting alongside (not replacing) the normal
 * build → traffic → algorithm → result flow. Every mode here is launched
 * independently by an explicit "Run" click (see OptimizationCard) — nothing
 * on this page calls the optimization backend automatically, except the
 * search-space *preview* (§3, no search runs, read-only estimate). */
const OptimizationLabPage: React.FC<OptimizationLabPageProps> = ({
  network,
  algorithmConfig,
  currentSimulationResult,
  runRecords,
  runningModes,
  selectedMode,
  comparingMode,
  comparisonMode,
  history,
  onComparisonModeChange,
  onBack,
  onRun,
  onRunAll,
  runAllProgress,
  onSelectForView,
  onCompare,
  onApply,
}) => {
  const [showSemantics, setShowSemantics] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [settings, setSettings] = useState<OptimizationSettings>(DEFAULT_SETTINGS);
  const optResult = runRecords.OPT?.result ?? null;

  // ── PR6 §3 — search-space preview. Read-only: no search runs, just the
  //    exact candidate-space size a real run would compute (backend-
  //    computed, via the same code the real optimizers use — see
  //    api/optimizationApi.ts). Re-fetched whenever the network, TE
  //    policies, or weight range change; debounced so editing the weight
  //    range inputs doesn't fire a request per keystroke. ──────────────────
  const [searchSpaceEstimates, setSearchSpaceEstimates] = useState<
    Partial<Record<Exclude<OptimizationLabMode, "CURRENT" | "OPT">, SearchSpaceEstimate>>
  >({});

  useEffect(() => {
    if (network.demands.length === 0) return;
    const timer = window.setTimeout(() => {
      (["WPO", "LWO", "JOINT"] as const).forEach((mode) => {
        estimateSearchSpace({
          network, algorithmConfig, mode,
          minWeight: settings.minWeight, maxWeight: settings.maxWeight,
        })
          .then((estimate) => setSearchSpaceEstimates((prev) => ({ ...prev, [mode]: estimate })))
          .catch(() => { /* preview is best-effort — a failed estimate just leaves the card without one */ });
      });
    }, 350);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [network, algorithmConfig.tePolicies, settings.minWeight, settings.maxWeight]);

  // Reuses Sprint 1's own comparison engine (buildComparison) and
  // ComparisonPanel verbatim (PR5 §4) — the only new code here is
  // projecting an OptimizationResult into the SimulationResult shape
  // buildComparison already expects (see optimizationProjection.ts).
  const comparingResult = comparingMode && comparingMode !== "CURRENT" ? runRecords[comparingMode]?.result ?? null : null;
  const comparingProjection = useMemo(() => {
    if (!comparingResult) return null;
    return projectOptimizationResult(comparingResult, network, algorithmConfig.congestionThreshold);
  }, [comparingResult, network, algorithmConfig.congestionThreshold]);
  const comparison = useMemo(() => {
    if (!currentSimulationResult || !comparingProjection) return null;
    return buildComparison(currentSimulationResult, comparingProjection);
  }, [currentSimulationResult, comparingProjection]);

  // ── "View on graph" explicit feedback (Part F) — derived from the exact
  //    same highlight computation the canvas itself uses (see
  //    optimizationHighlight.ts), so this text can never say something the
  //    canvas doesn't actually show. ──────────────────────────────────────
  const selectedResult =
    selectedMode && selectedMode !== "CURRENT" ? runRecords[selectedMode]?.result ?? null : null;
  const viewOnGraphSummary = useMemo(
    () => (selectedResult ? describeViewOnGraphState(selectedResult, network) : null),
    [selectedResult, network]
  );

  // ── Optimizer vs optimizer comparison (Part J, secondary priority) — a
  //    small, self-contained addition: reuses buildComparison/
  //    projectOptimizationResult exactly as Current-vs-optimizer does
  //    above, just with both sides projected instead of one. Deliberately
  //    does NOT touch canvas ownership/visualizationOwner precedence — this
  //    is a metrics-only comparison, not a new "canvas owner" state, so it
  //    stays cheap and can't conflict with Part K's precedence rules. ─────
  const [pairA, setPairA] = useState<Exclude<OptimizationLabMode, "CURRENT"> | "">("");
  const [pairB, setPairB] = useState<Exclude<OptimizationLabMode, "CURRENT"> | "">("");
  const pairResultA = pairA ? runRecords[pairA]?.result ?? null : null;
  const pairResultB = pairB ? runRecords[pairB]?.result ?? null : null;
  const pairComparison = useMemo(() => {
    if (!pairResultA || !pairResultB) return null;
    const projA = projectOptimizationResult(pairResultA, network, algorithmConfig.congestionThreshold);
    const projB = projectOptimizationResult(pairResultB, network, algorithmConfig.congestionThreshold);
    return buildComparison(projA, projB);
  }, [pairResultA, pairResultB, network, algorithmConfig.congestionThreshold]);
  const availablePairModes = MODES.filter((m) => runRecords[m]?.result);

  // ── Optimization comparison overview (Part I) — Current + every mode
  //    that has actually been run, real values only (never invented). Each
  //    mode's congested-link count is derived via the same
  //    projectOptimizationResult already used for View on graph/Compare —
  //    one projection function, not a second computation of the same
  //    thing. ────────────────────────────────────────────────────────────
  interface OverviewRow {
    key: OptimizationLabMode;
    label: string;
    mlu: number;
    congestedLinks: number;
    improvementVsCurrent: number | null;
    runtimeMs: number | null;
    searchMethod: string | null;
    provenOptimal: boolean | null;
    evaluatedCandidates: number | null;
    status: string;
  }
  const overviewRows = useMemo<OverviewRow[]>(() => {
    const rows: OverviewRow[] = [];
    if (currentSimulationResult) {
      rows.push({
        key: "CURRENT",
        label: "Current",
        mlu: currentSimulationResult.maxUtilization,
        congestedLinks: currentSimulationResult.congestedLinkCount,
        improvementVsCurrent: 0,
        runtimeMs: null,
        searchMethod: null,
        provenOptimal: null,
        evaluatedCandidates: null,
        status: currentSimulationResult.algorithm,
      });
    }
    for (const mode of MODES) {
      const result = runRecords[mode]?.result;
      if (!result) continue;
      const projection = projectOptimizationResult(result, network, algorithmConfig.congestionThreshold);
      rows.push({
        key: mode,
        label: OPTIMIZATION_MODE_INFO[mode].shortLabel,
        mlu: result.mlu,
        congestedLinks: projection.congestedLinkCount,
        improvementVsCurrent: currentSimulationResult ? currentSimulationResult.maxUtilization - result.mlu : null,
        runtimeMs: result.solverRuntime,
        searchMethod: result.searchMethod ?? (mode === "OPT" ? "Linear Programming" : null),
        provenOptimal: result.provenOptimal ?? (mode === "OPT" && result.status === "OPTIMAL" ? true : null),
        evaluatedCandidates: result.evaluatedCandidates ?? null,
        status: result.status,
      });
    }
    return rows;
  }, [currentSimulationResult, runRecords, network, algorithmConfig.congestionThreshold]);

  // ── PR6 §22 — result relationships, from real computed values only ──────
  const relationships = useMemo(
    () => computeResultRelationships(
      runRecords.OPT?.result ?? null,
      runRecords.WPO?.result ?? null,
      runRecords.LWO?.result ?? null,
      runRecords.JOINT?.result ?? null,
    ),
    [runRecords]
  );

  return (
    <div className="opt-lab">
      <div className="opt-lab-header">
        <button className="btn-secondary btn-sm" onClick={onBack}>
          <ArrowLeft size={13} /> Back
        </button>
        <div className="opt-lab-title">
          <FlaskConical size={15} />
          <span>Optimization Lab</span>
          <TermHint
            term="Optimization Lab"
            shortDefinition="Run different optimization strategies against your current topology and demands, compare each against your current routing, and optionally apply a recommendation."
            example="Run Optimal Flow first to see the theoretical best MLU — every other mode's result can then be measured against it."
          />
        </div>
      </div>

      {network.demands.length === 0 ? (
        <p className="opt-lab-empty-hint">Add at least one traffic demand before optimizing.</p>
      ) : (
        <>
          <OptimizationSettingsPanel settings={settings} onChange={setSettings} />

          {/* ── Current Configuration (not a backend call — reflects the
              already-simulated result from the Algorithm/Result step, if
              any) ── */}
          <div className={`opt-card opt-card--current${selectedMode === "CURRENT" ? " opt-card--selected" : ""}`}>
            <div className="opt-card-header">
              <div className="opt-card-title-row">
                <strong>Current Configuration</strong>
                {currentSimulationResult && <span className="badge badge--success">Simulated</span>}
              </div>
            </div>
            {!currentSimulationResult ? (
              <p className="opt-card-hint">
                Run a simulation (previous step) first — every optimization below is measured against it.
              </p>
            ) : (
              <div className="opt-card-body">
                <div className="opt-card-metrics">
                  <div className="metric-cell">
                    <span className="metric-label">Algorithm</span>
                    <strong className="opt-card-small-value">{currentSimulationResult.algorithm}</strong>
                  </div>
                  <div className="metric-cell">
                    <span className="metric-label">MLU</span>
                    <strong className={currentSimulationResult.maxUtilization > 1 ? "text-danger" : ""}>
                      {fmtPct(currentSimulationResult.maxUtilization)}
                    </strong>
                  </div>
                  <div className="metric-cell">
                    <span className="metric-label">Congested links</span>
                    <strong className={currentSimulationResult.congestedLinkCount > 0 ? "text-danger" : ""}>
                      {currentSimulationResult.congestedLinkCount}
                    </strong>
                  </div>
                </div>
                <div className="opt-card-actions">
                  <button
                    className={`btn-secondary btn-sm${selectedMode === "CURRENT" ? " btn-secondary--active" : ""}`}
                    onClick={() => onSelectForView(selectedMode === "CURRENT" ? null : "CURRENT")}
                  >
                    View on graph
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* ── Congestion-free analysis (PR5 §7, polished PR6 §21) — only
              meaningful once OPT has actually been run; never fabricated
              before then. Explicitly distinguishes "OPT > 1" (congestion
              structurally unavoidable) from a solver-level INFEASIBLE
              (no valid routing at all — a different condition, never
              conflated). ── */}
          <div className="panel opt-lab-congestion-panel">
            <h3>Congestion-free analysis</h3>
            {!optResult ? (
              <p className="opt-card-hint">Run Optimal Flow (OPT) to see whether congestion-free routing is even possible here.</p>
            ) : optResult.status === "INFEASIBLE" ? (
              <p className="text-danger">
                No valid routing exists for this configuration (disconnected demand or contradictory constraint) —
                a different condition from congestion, which assumes a routing exists at all.
              </p>
            ) : optResult.status === "ERROR" ? (
              <p className="opt-card-hint">{optResult.message}</p>
            ) : (
              <>
                <p className={describeCongestionFreeStatus(optResult.mlu).possible ? "text-success" : "text-danger"}>
                  {describeCongestionFreeStatus(optResult.mlu).text}
                </p>
                <div className="opt-lab-congestion-compare">
                  <div>
                    <span className="metric-label">Theoretical lower bound (OPT)</span>
                    <strong>{fmtPct(optResult.mlu)}</strong>
                  </div>
                  {currentSimulationResult && (
                    <div>
                      <span className="metric-label">Current algorithm ({currentSimulationResult.algorithm})</span>
                      <strong className={currentSimulationResult.maxUtilization > optResult.mlu ? "text-warning" : ""}>
                        {fmtPct(currentSimulationResult.maxUtilization)}
                      </strong>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>

          {/* ── Result relationships (PR6 §22) — only real computed values. ── */}
          {relationships.length > 0 && (
            <div className="panel opt-lab-relationships-panel">
              <h3>Result relationships</h3>
              {relationships.map((rel) => (
                <div key={rel.label} className="opt-lab-relationship-row">
                  <span className={rel.holds ? "text-success" : "text-danger"}>{rel.holds ? "✓" : "✗"}</span>
                  <strong>{rel.label}</strong>
                  <span className="opt-card-small-value">{rel.detail}</span>
                </div>
              ))}
            </div>
          )}

          {/* ── "View on graph" explicit feedback (Part F) — this is the
              only textual confirmation of what the button did; the canvas
              highlight alone (PR5/PR6) is not always obvious, especially
              when an optimizer found no improvement to show. ── */}
          {viewOnGraphSummary && (
            <div className={`opt-view-summary${viewOnGraphSummary.hasNoVisualChange ? " opt-view-summary--empty" : ""}${viewOnGraphSummary.isTheoretical ? " opt-view-summary--theoretical" : ""}`}>
              <strong>{viewOnGraphSummary.headline}</strong>
              {viewOnGraphSummary.detailLines.map((line, i) => <p key={i}>{line}</p>)}
            </div>
          )}

          {/* ── Comparison mode (Part G) — explicit "Comparing Current vs X"
              banner + Exit control, so entering comparison is never mistaken
              for the ordinary utilization view. Reuses ComparisonPanel/
              buildComparison verbatim — no second comparison engine. ── */}
          {comparingMode && comparingMode !== "CURRENT" && comparingResult && currentSimulationResult && (
            <>
              <div className="opt-comparison-banner">
                <GitCompare size={13} />
                <span>Comparing <strong>Current</strong> vs <strong>{OPTIMIZATION_MODE_INFO[comparingMode].shortLabel}</strong></span>
                <button className="btn-secondary btn-sm" onClick={() => onCompare(null)}>Exit comparison</button>
              </div>
              {comparison && comparison.linkDeltas.length > 0 && comparison.linkDeltas.every((d) => d.status === "UNCHANGED") && (
                <p className="opt-card-hint">No link-level difference from the current configuration.</p>
              )}
              <ComparisonPanel
                baseline={currentSimulationResult}
                current={comparingProjection ?? currentSimulationResult}
                comparison={comparison}
                mode={comparisonMode}
                onModeChange={onComparisonModeChange}
                // No persistent baseline concept in the Lab's own transient,
                // per-card comparison (PR5 §12: recommendations are
                // transient) — this control is inert here by design.
                onSetBaseline={() => {}}
              />
            </>
          )}
          {comparingMode && comparingMode !== "CURRENT" && !currentSimulationResult && (
            <p className="opt-card-hint">Run a simulation first to compare against it.</p>
          )}

          {/* ── Routing semantics overview (PR5 §8) ── */}
          <button className="collapse-toggle" onClick={() => setShowSemantics((p) => !p)}>
            <Info size={12} /> {showSemantics ? "Hide" : "Show"} routing semantics per mode
          </button>
          {showSemantics && (
            <div className="opt-lab-semantics">
              {MODES.map((mode) => (
                <div key={mode} className="opt-lab-semantics-row">
                  <strong>{OPTIMIZATION_MODE_INFO[mode].shortLabel}</strong>
                  <span>{OPTIMIZATION_MODE_INFO[mode].routingSemantics}</span>
                </div>
              ))}
            </div>
          )}

          {/* ── Run All Optimizations (Part H) — sequential, never parallel
              (see WorkflowManager's handleRunAllOptimizations); a compact
              row, not a dominant control, per Part L. ── */}
          <div className="opt-run-all-row">
            <button
              className="btn-secondary btn-sm"
              onClick={() => onRunAll(settings)}
              disabled={runAllProgress !== null || runningModes.size > 0}
            >
              <Play size={13} /> Run All Optimizations
            </button>
            {runAllProgress && (
              <span className="opt-run-all-progress">
                Running {OPTIMIZATION_MODE_INFO[runAllProgress.mode].shortLabel} — {runAllProgress.index}/{runAllProgress.total}
              </span>
            )}
          </div>

          {/* ── Optimization mode cards ── */}
          <div className="opt-lab-cards">
            {MODES.map((mode) => (
              <OptimizationCard
                key={mode}
                mode={mode}
                result={runRecords[mode]?.result ?? null}
                settingsUsed={runRecords[mode]?.settings ?? null}
                currentSettings={settings}
                searchSpaceEstimate={mode === "OPT" ? null : searchSpaceEstimates[mode] ?? null}
                isRunning={runningModes.has(mode)}
                isSelected={selectedMode === mode}
                isComparing={comparingMode === mode}
                canApply={mode !== "OPT"}
                onRun={() => onRun(mode, settings)}
                onView={() => onSelectForView(selectedMode === mode ? null : mode)}
                onCompare={() => onCompare(comparingMode === mode ? null : mode)}
                onApply={() => onApply(mode)}
              />
            ))}
          </div>

          {/* ── Optimization comparison overview (Part I) — appears once at
              least one optimizer has a real result; every row is a real
              computed value, nothing invented. Rows are selectable: picking
              one calls the same View on graph / Compare vs current actions
              the cards above use, without leaving this overview. ── */}
          {overviewRows.length > 1 && (
            <div className="panel opt-overview-panel">
              <h3>Comparison overview</h3>
              <div className="opt-overview-table-wrap">
                <table className="opt-overview-table">
                  <thead>
                    <tr>
                      <th>Mode</th><th>MLU</th><th>Congested</th><th>Vs current</th>
                      <th>Runtime</th><th>Method</th><th>Proven</th><th>Evaluated</th><th>Status</th><th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {overviewRows.map((row) => (
                      <tr
                        key={row.key}
                        className={selectedMode === row.key ? "opt-overview-row--selected" : ""}
                      >
                        <td><strong>{row.label}</strong></td>
                        <td className={row.mlu > 1 ? "text-danger" : ""}>{fmtPct(row.mlu)}</td>
                        <td className={row.congestedLinks > 0 ? "text-danger" : ""}>{row.congestedLinks}</td>
                        <td>
                          {row.improvementVsCurrent === null ? "—" :
                            row.improvementVsCurrent === 0 ? "baseline" :
                            <span className={row.improvementVsCurrent > 0 ? "text-success" : "text-danger"}>
                              {row.improvementVsCurrent > 0 ? "−" : "+"}{fmtPct(Math.abs(row.improvementVsCurrent))}
                            </span>}
                        </td>
                        <td>{row.runtimeMs === null ? "—" : row.runtimeMs < 1 ? "<1 ms" : `${row.runtimeMs.toFixed(1)} ms`}</td>
                        <td className="opt-card-small-value">{row.searchMethod ?? "—"}</td>
                        <td>{row.provenOptimal === null ? "—" : row.provenOptimal ? "Yes" : "No"}</td>
                        <td>{row.evaluatedCandidates?.toLocaleString() ?? "—"}</td>
                        <td>{row.status}</td>
                        <td className="opt-overview-actions">
                          <button className="btn-secondary btn-sm" onClick={() => onSelectForView(selectedMode === row.key ? null : row.key)}>
                            View
                          </button>
                          {row.key !== "CURRENT" && (
                            <button className="btn-secondary btn-sm" onClick={() => onCompare(comparingMode === row.key ? null : row.key)}>
                              Compare
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ── Optimizer vs optimizer comparison (Part J, secondary) —
              only shown once at least two optimizers have real results. ── */}
          {availablePairModes.length >= 2 && (
            <div className="panel opt-pair-panel">
              <h3>Compare two optimizers</h3>
              <div className="opt-pair-selectors">
                <select className="sr-select-fallback" value={pairA} onChange={(e) => setPairA(e.target.value as typeof pairA)}>
                  <option value="">Select…</option>
                  {availablePairModes.map((m) => <option key={m} value={m}>{OPTIMIZATION_MODE_INFO[m].shortLabel}</option>)}
                </select>
                <span>vs</span>
                <select className="sr-select-fallback" value={pairB} onChange={(e) => setPairB(e.target.value as typeof pairB)}>
                  <option value="">Select…</option>
                  {availablePairModes.map((m) => <option key={m} value={m}>{OPTIMIZATION_MODE_INFO[m].shortLabel}</option>)}
                </select>
              </div>
              {pairA && pairB && pairA === pairB && (
                <p className="opt-card-hint">Choose two different modes to compare.</p>
              )}
              {pairComparison && pairA !== pairB && (
                <div className="comparison-summary">
                  <div className="comparison-summary-row">
                    <span className="comparison-summary-label">Max utilization</span>
                    <span className="comparison-summary-value">
                      {OPTIMIZATION_MODE_INFO[pairA as Exclude<OptimizationLabMode, "CURRENT">].shortLabel} {fmtPct(pairComparison.maxUtilizationBefore)}
                      {" → "}
                      {OPTIMIZATION_MODE_INFO[pairB as Exclude<OptimizationLabMode, "CURRENT">].shortLabel} {fmtPct(pairComparison.maxUtilizationAfter)}
                    </span>
                  </div>
                  <div className="comparison-summary-row">
                    <span className="comparison-summary-label">Congested links</span>
                    <span className="comparison-summary-value">{pairComparison.congestedLinksBefore} → {pairComparison.congestedLinksAfter}</span>
                  </div>
                  <div className="comparison-summary-row">
                    <span className="comparison-summary-label">Routes changed</span>
                    <span className="comparison-summary-value">{pairComparison.routeChanges.length}</span>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── PR6 §15 — session-only experiment history (never persisted). ── */}
          {history.length > 0 && (
            <>
              <button className="collapse-toggle" onClick={() => setShowHistory((p) => !p)}>
                <History size={12} /> {showHistory ? "Hide" : "Show"} experiment history ({history.length})
              </button>
              {showHistory && (
                <div className="opt-lab-history">
                  <table className="opt-lab-history-table">
                    <thead>
                      <tr>
                        <th>Mode</th><th>Budget</th><th>Method</th><th>Runtime</th><th>MLU</th><th>Proven optimal</th>
                      </tr>
                    </thead>
                    <tbody>
                      {history.map((entry) => (
                        <tr key={entry.id}>
                          <td>{entry.mode}</td>
                          <td>{entry.budget.toLocaleString()}</td>
                          <td>{entry.searchMethod ?? "LP"}</td>
                          <td>{entry.runtimeMs < 1 ? "<1 ms" : `${entry.runtimeMs.toFixed(1)} ms`}</td>
                          <td>{(entry.mlu * 100).toFixed(1)}%</td>
                          <td>{entry.provenOptimal === null ? "—" : entry.provenOptimal ? "Yes" : "No"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
};

export default OptimizationLabPage;
