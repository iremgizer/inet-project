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
