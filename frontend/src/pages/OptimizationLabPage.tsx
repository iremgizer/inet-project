import React, { useEffect, useMemo, useState } from "react";
import { ArrowLeft, ChevronDown, ChevronUp, FlaskConical, History, Play } from "lucide-react";
import { AlgorithmConfig, NetworkInput, SimulationResult } from "../types/network";
import { OptimizationHistoryEntry, OptimizationLabMode, OptimizationRunRecord, SearchSpaceEstimate } from "../types/optimization";
import { OPTIMIZATION_MODE_INFO } from "../utils/optimizationExplanations";
import { projectOptimizationResult } from "../utils/optimizationProjection";
import { DEFAULT_SETTINGS, OptimizationSettings } from "../utils/optimizationSettings";
import { estimateSearchSpace } from "../api/optimizationApi";
import OptimizationCard from "../components/OptimizationCard";
import OptimizationSettingsPanel from "../components/OptimizationSettingsPanel";

const MODES: Exclude<OptimizationLabMode, "CURRENT">[] = ["OPT", "WPO", "LWO", "JOINT"];

interface OptimizationLabPageProps {
  network: NetworkInput;
  algorithmConfig: AlgorithmConfig;
  currentSimulationResult: SimulationResult | null;
  runRecords: Partial<Record<Exclude<OptimizationLabMode, "CURRENT">, OptimizationRunRecord>>;
  runningModes: Set<Exclude<OptimizationLabMode, "CURRENT">>;
  selectedMode: OptimizationLabMode | null;
  history: OptimizationHistoryEntry[];
  onBack: () => void;
  onRun: (mode: Exclude<OptimizationLabMode, "CURRENT">, settings: OptimizationSettings) => void;
  onRunAll: (settings: OptimizationSettings) => void;
  runAllProgress: { index: number; total: number; mode: Exclude<OptimizationLabMode, "CURRENT"> } | null;
  onSelectForView: (mode: OptimizationLabMode | null) => void;
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
  history,
  onBack,
  onRun,
  onRunAll,
  runAllProgress,
  onSelectForView,
}) => {
  const [showHistory, setShowHistory] = useState(false);
  const [showComparisonDock, setShowComparisonDock] = useState(true);
  const [settings, setSettings] = useState<OptimizationSettings>(DEFAULT_SETTINGS);

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

  // Compact optimizer comparison lives in a fixed canvas-corner dock.
  const [pairA, setPairA] = useState<Exclude<OptimizationLabMode, "CURRENT"> | "">("");
  const [pairB, setPairB] = useState<Exclude<OptimizationLabMode, "CURRENT"> | "">("");
  const pairResultA = pairA ? runRecords[pairA]?.result ?? null : null;
  const pairResultB = pairB ? runRecords[pairB]?.result ?? null : null;
  const pairMluDelta = pairResultA && pairResultB ? pairResultA.mlu - pairResultB.mlu : null;
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
    runtimeMs: number | null;
    status: string;
  }
  const overviewRows = useMemo<OverviewRow[]>(() => {
    const rows: OverviewRow[] = [];
    if (currentSimulationResult) {
      rows.push({
        key: "CURRENT",
        label: "Current",
        mlu: currentSimulationResult.maxUtilization,
        runtimeMs: null,
        status: currentSimulationResult.algorithm,
      });
    }
    for (const mode of MODES) {
      const result = runRecords[mode]?.result;
      if (!result) continue;
      rows.push({
        key: mode,
        label: OPTIMIZATION_MODE_INFO[mode].shortLabel,
        mlu: result.mlu,
        runtimeMs: result.solverRuntime,
        status: result.status,
      });
    }
    return rows;
  }, [currentSimulationResult, runRecords]);

  return (
    <div className="opt-lab">
      <div className="opt-lab-header">
        <button className="btn-secondary btn-sm" onClick={onBack}>
          <ArrowLeft size={13} /> Back
        </button>
        <div className="opt-lab-title">
          <FlaskConical size={15} />
          <span>Optimization Lab</span>
        </div>
      </div>

      {network.demands.length === 0 ? (
        <p className="opt-lab-empty-hint">Add at least one traffic demand before optimizing.</p>
      ) : (
        <>
          <OptimizationSettingsPanel settings={settings} onChange={setSettings} />

          {currentSimulationResult && (
            <div className="opt-current-summary">
              Current {currentSimulationResult.algorithm} · MLU {fmtPct(currentSimulationResult.maxUtilization)}
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
                onRun={() => onRun(mode, settings)}
                onView={() => onSelectForView(selectedMode === mode ? null : mode)}
              />
            ))}
          </div>

          {(overviewRows.length > 1 || availablePairModes.length >= 2) && (
            <section className={`opt-lab-comparison-dock${showComparisonDock ? " is-open" : ""}`} aria-label="Optimization results comparison">
              <button className="opt-lab-dock-toggle" onClick={() => setShowComparisonDock((open) => !open)}>
                <span>Results comparison</span>
                <span className="opt-lab-dock-count">{availablePairModes.length} run{availablePairModes.length === 1 ? "" : "s"}</span>
                {showComparisonDock ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
              </button>
              {showComparisonDock && (
                <div className="opt-lab-dock-content">
                  {overviewRows.length > 1 && (
                    <div className="opt-overview-table-wrap">
                      <table className="opt-overview-table">
                        <thead><tr><th>Mode</th><th>MLU</th><th>Time</th><th>Status</th><th></th></tr></thead>
                        <tbody>
                          {overviewRows.map((row) => (
                            <tr key={row.key} className={selectedMode === row.key ? "opt-overview-row--selected" : ""}>
                              <td><strong>{row.label}</strong></td>
                              <td className={row.mlu > 1 ? "text-danger" : ""}>{fmtPct(row.mlu)}</td>
                              <td>{row.runtimeMs === null ? "—" : row.runtimeMs < 1 ? "<1 ms" : `${row.runtimeMs.toFixed(1)} ms`}</td>
                              <td>{row.status}</td>
                              <td><button className="btn-secondary btn-sm" onClick={() => onSelectForView(selectedMode === row.key ? null : row.key)}>View</button></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                  {availablePairModes.length >= 2 && (
                    <div className="opt-pair-panel">
                      <strong>Compare optimizers</strong>
                      <div className="opt-pair-selectors">
                        <select aria-label="First optimizer" className="sr-select-fallback" value={pairA} onChange={(e) => setPairA(e.target.value as typeof pairA)}>
                          <option value="">Choose…</option>
                          {availablePairModes.map((m) => <option key={m} value={m}>{OPTIMIZATION_MODE_INFO[m].shortLabel}</option>)}
                        </select>
                        <span>vs</span>
                        <select aria-label="Second optimizer" className="sr-select-fallback" value={pairB} onChange={(e) => setPairB(e.target.value as typeof pairB)}>
                          <option value="">Choose…</option>
                          {availablePairModes.map((m) => <option key={m} value={m}>{OPTIMIZATION_MODE_INFO[m].shortLabel}</option>)}
                        </select>
                      </div>
                      {pairA && pairB && pairA === pairB && <p className="opt-card-hint">Choose two different optimizers.</p>}
                      {pairResultA && pairResultB && pairA !== pairB && (
                        <p className="opt-pair-result">
                          {fmtPct(pairResultA.mlu)} <span>→</span> {fmtPct(pairResultB.mlu)}
                          <strong className={pairMluDelta !== null && pairMluDelta > 0 ? "text-success" : pairMluDelta !== null && pairMluDelta < 0 ? "text-danger" : ""}>
                            {pairMluDelta === null || Math.abs(pairMluDelta) < 1e-9 ? "Same MLU" : `${pairMluDelta > 0 ? "−" : "+"}${fmtPct(Math.abs(pairMluDelta))}`}
                          </strong>
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )}
            </section>
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
