import React, { useState } from "react";
import { ChevronDown, ChevronUp, Settings2 } from "lucide-react";
import {
  BUDGET_PRESETS,
  MAX_ALLOWED_WEIGHT,
  MAX_EXACT_COMBINATIONS_SAFETY_CAP,
  MAX_TIME_LIMIT_SECONDS,
  MIN_ALLOWED_WEIGHT,
  MIN_TIME_LIMIT_SECONDS,
  OptimizationSettings,
  presetForBudget,
  validateOptimizationSettings,
} from "../utils/optimizationSettings";
import TermHint from "./TermHint";

interface OptimizationSettingsPanelProps {
  settings: OptimizationSettings;
  onChange: (settings: OptimizationSettings) => void;
}

/** PR6 §2 — a compact, collapsed-by-default settings section shared by
 * every mode's "Run" action in the Optimization Lab: exact-search budget
 * (with the three named presets + a custom value, §2), weight range (§7,
 * only consumed by LWO/Joint — WPO/OPT simply ignore it), and a wall-clock
 * timeout (§9). The actual numeric value is always visible, never hidden
 * behind just a preset label (§2: "The user should always be able to see
 * the actual numeric value"). */
const OptimizationSettingsPanel: React.FC<OptimizationSettingsPanelProps> = ({ settings, onChange }) => {
  const [expanded, setExpanded] = useState(false);
  const activePreset = presetForBudget(settings.maxExactCombinations);
  const validation = validateOptimizationSettings(settings);

  return (
    <div className="opt-settings-panel">
      <button className="opt-settings-toggle" onClick={() => setExpanded((p) => !p)}>
        <span className="opt-settings-toggle-label">
          <Settings2 size={13} />
          Optimization Settings
          <TermHint
            term="Optimization Settings"
            shortDefinition="Controls how hard each optimizer searches before falling back to a heuristic, and how long it's allowed to run. Applies to whichever mode you Run next."
            example="Raising the search budget lets WPO/LWO/Joint search a bigger space exactly, at the cost of runtime — this is the trade-off the Lab lets you observe directly."
          />
        </span>
        <span className="opt-settings-summary">
          Budget: {settings.maxExactCombinations.toLocaleString()} · Weights: {settings.minWeight}-{settings.maxWeight} ·
          {" "}Timeout: {settings.timeLimitSeconds}s
          {expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
        </span>
      </button>

      {expanded && (
        <div className="opt-settings-body">
          {/* ── Exact search budget ── */}
          <div className="opt-settings-field">
            <span className="opt-settings-field-label">
              Exact Search Budget
              <TermHint
                term="Exact search budget"
                shortDefinition="The most candidate configurations WPO/LWO/Joint will fully enumerate before switching to a faster heuristic. OPT (linear programming) never uses this."
                example="A search space of 78,125 with a budget of 50,000 falls back to a heuristic; raising the budget to 100,000 permits exact enumeration."
              />
            </span>
            <div className="opt-settings-preset-row">
              {BUDGET_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  className={`opt-preset-btn${activePreset === preset.id ? " opt-preset-btn--active" : ""}`}
                  onClick={() => {
                    if (preset.value !== null) onChange({ ...settings, maxExactCombinations: preset.value });
                  }}
                >
                  {preset.label}
                  {preset.value !== null && <span className="opt-preset-btn-value">{preset.value.toLocaleString()}</span>}
                </button>
              ))}
            </div>
            <label className="opt-settings-numeric-row">
              <span>Actual value</span>
              <input
                type="number"
                className="number-input number-input--sm"
                min={1}
                max={MAX_EXACT_COMBINATIONS_SAFETY_CAP}
                value={settings.maxExactCombinations}
                onChange={(e) => onChange({ ...settings, maxExactCombinations: Number(e.target.value) })}
              />
              <span className="opt-settings-cap-hint">server cap: {MAX_EXACT_COMBINATIONS_SAFETY_CAP.toLocaleString()}</span>
            </label>
          </div>

          {/* ── Weight range ── */}
          <div className="opt-settings-field">
            <span className="opt-settings-field-label">
              Weight Range
              <TermHint
                term="Weight range"
                shortDefinition="The integer link-weight values LWO/Joint are allowed to choose from. Wider ranges grow the search space fast: N links over a range of size R gives R^N combinations."
                example="6 links, range 1-5: 5^6 = 15,625 combinations. Same links, range 1-10: 10^6 = 1,000,000 — a 64x larger search space from doubling the range."
              />
            </span>
            <div className="opt-settings-numeric-row">
              <label>
                <span>Min</span>
                <input
                  type="number"
                  className="number-input number-input--sm"
                  min={MIN_ALLOWED_WEIGHT}
                  max={settings.maxWeight}
                  value={settings.minWeight}
                  onChange={(e) => onChange({ ...settings, minWeight: Number(e.target.value) })}
                />
              </label>
              <label>
                <span>Max</span>
                <input
                  type="number"
                  className="number-input number-input--sm"
                  min={settings.minWeight}
                  max={MAX_ALLOWED_WEIGHT}
                  value={settings.maxWeight}
                  onChange={(e) => onChange({ ...settings, maxWeight: Number(e.target.value) })}
                />
              </label>
              <span className="opt-settings-cap-hint">only affects LWO / Joint</span>
            </div>
          </div>

          {/* ── Timeout ── */}
          <div className="opt-settings-field">
            <span className="opt-settings-field-label">
              Timeout (seconds)
              <TermHint
                term="Optimization timeout"
                shortDefinition="A wall-clock safety limit. If reached before a search finishes, the best result found so far is returned, clearly marked as not proven optimal."
                example={`Default ${MIN_TIME_LIMIT_SECONDS}-${MAX_TIME_LIMIT_SECONDS}s range. A search that would otherwise take minutes stops early and reports TIME_LIMIT instead of hanging.`}
              />
            </span>
            <label className="opt-settings-numeric-row">
              <input
                type="number"
                className="number-input number-input--sm"
                min={MIN_TIME_LIMIT_SECONDS}
                max={MAX_TIME_LIMIT_SECONDS}
                value={settings.timeLimitSeconds}
                onChange={(e) => onChange({ ...settings, timeLimitSeconds: Number(e.target.value) })}
              />
              <span className="opt-settings-cap-hint">allowed: {MIN_TIME_LIMIT_SECONDS}-{MAX_TIME_LIMIT_SECONDS}s</span>
            </label>
          </div>

          {!validation.valid && (
            <div className="opt-settings-errors">
              {validation.errors.map((err, i) => <div key={i}>{err}</div>)}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default OptimizationSettingsPanel;
