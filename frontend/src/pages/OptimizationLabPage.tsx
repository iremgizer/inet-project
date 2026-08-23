import React, { useEffect, useMemo, useState } from "react";
import { ArrowLeft, FlaskConical, Info, History } from "lucide-react";
import { AlgorithmConfig, NetworkInput, SimulationResult } from "../types/network";
import { OptimizationHistoryEntry, OptimizationLabMode, OptimizationRunRecord, SearchSpaceEstimate } from "../types/optimization";
import { OPTIMIZATION_MODE_INFO, describeCongestionFreeStatus } from "../utils/optimizationExplanations";
import { projectOptimizationResult } from "../utils/optimizationProjection";
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

          {/* ── Comparison view (PR5 §4) — reuses ComparisonPanel/
              buildComparison verbatim; only shown once a mode's result is
              being actively compared. ── */}
          {comparingMode && comparingMode !== "CURRENT" && comparingResult && currentSimulationResult && (
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
