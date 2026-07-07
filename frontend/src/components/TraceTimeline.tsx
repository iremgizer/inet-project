import React from "react";
import { SkipBack, SkipForward, Play, Pause, RotateCcw, ChevronDown, ChevronUp } from "lucide-react";
import { SimulationTraceEvent, NetworkInput, SimulationResult } from "../types/network";
import TraceStepPanel from "./TraceStepPanel";

interface TraceTimelineProps {
  events: SimulationTraceEvent[];
  activeIndex: number;
  isPlaying: boolean;
  speedMs: number;
  network?: NetworkInput;
  simulationResult?: SimulationResult | null;
  onStep: (index: number) => void;
  onBack: () => void;
  onForward: () => void;
  onPlay: () => void;
  onPause: () => void;
  onReset: () => void;
  onSpeedChange: (ms: number) => void;
  onShowFullTable?: () => void;
}

const TraceTimeline: React.FC<TraceTimelineProps> = ({
  events,
  activeIndex,
  isPlaying,
  speedMs,
  network,
  simulationResult,
  onStep,
  onBack,
  onForward,
  onPlay,
  onPause,
  onReset,
  onSpeedChange,
  onShowFullTable,
}) => {
  const [showSpeed, setShowSpeed] = React.useState(false);
  const total = events.length;
  const atStart = activeIndex <= 0;
  const atEnd = activeIndex >= total - 1;
  const disabled = total === 0;
  const currentEvent = events[activeIndex] ?? null;
  const progress = total > 0 ? ((activeIndex + 1) / total) * 100 : 0;

  return (
    <div className="trace-timeline">
      {/* Progress rail */}
      <div className="tl-progress">
        <div className="tl-progress-fill" style={{ width: `${progress}%` }} />
      </div>

      {/* Controls row */}
      <div className="tl-controls">
        <button
          className="icon-btn"
          onClick={onReset}
          disabled={disabled || atStart}
          title="Reset to start"
          aria-label="Reset trace"
        >
          <RotateCcw size={13} />
        </button>
        <button
          className="icon-btn"
          onClick={onBack}
          disabled={disabled || atStart}
          title="Previous step"
          aria-label="Previous step"
        >
          <SkipBack size={13} />
        </button>
        <button
          className="icon-btn icon-btn--play"
          onClick={isPlaying ? onPause : onPlay}
          disabled={disabled || (!isPlaying && atEnd)}
          title={isPlaying ? "Pause" : "Play"}
          aria-label={isPlaying ? "Pause playback" : "Play trace"}
        >
          {isPlaying ? <Pause size={15} /> : <Play size={15} />}
        </button>
        <button
          className="icon-btn"
          onClick={onForward}
          disabled={disabled || atEnd}
          title="Next step"
          aria-label="Next step"
        >
          <SkipForward size={13} />
        </button>

        <span className="tl-counter">
          {total > 0 ? activeIndex + 1 : 0} / {total}
        </span>

        <span className="tl-autoplay-label">
          {isPlaying ? `Auto: ${speedMs / 1000}s/step` : `${speedMs / 1000}s/step`}
        </span>
        <button
          className="icon-btn"
          onClick={() => setShowSpeed((p) => !p)}
          title="Change auto-play speed"
          aria-label="Change playback speed"
          style={{ marginLeft: "auto" }}
        >
          {showSpeed ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
        </button>
      </div>

      {/* Speed presets */}
      {showSpeed && (
        <div className="tl-speed">
          <span className="muted" style={{ fontSize: "0.75rem" }}>Auto-play speed</span>
          <div className="tl-speed-presets">
            {[5000, 10000, 30000, 60000].map((ms) => (
              <button
                key={ms}
                className={`tl-speed-btn${speedMs === ms ? " tl-speed-btn--active" : ""}`}
                onClick={() => onSpeedChange(ms)}
                aria-pressed={speedMs === ms}
              >
                {ms / 1000}s
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Mini step dots */}
      {total <= 30 && (
        <div className="tl-dots" role="tablist" aria-label="Trace steps">
          {events.map((_, i) => (
            <button
              key={i}
              className={`tl-dot ${i === activeIndex ? "tl-dot--active" : i < activeIndex ? "tl-dot--done" : ""}`}
              onClick={() => onStep(i)}
              role="tab"
              aria-selected={i === activeIndex}
              aria-label={`Step ${i + 1}`}
              title={events[i]?.title ?? `Step ${i + 1}`}
            />
          ))}
        </div>
      )}

      {/* Current step card */}
      {currentEvent && network && (
        <TraceStepPanel
          event={currentEvent}
          network={network}
          result={simulationResult ?? null}
          dvTable={simulationResult?.distanceVectorTable}
          onShowFullTable={onShowFullTable}
        />
      )}
      {currentEvent && !network && (
        <div className="tl-step-card">
          <div className="tl-step-title">{currentEvent.title}</div>
          <p className="tl-step-desc">{currentEvent.description}</p>
          {currentEvent.explanationText && (
            <p className="tl-step-explain">{currentEvent.explanationText}</p>
          )}
          {(currentEvent.costCalculation || currentEvent.formulaText) && (
            <details className="tl-formula-details">
              <summary>Show formula</summary>
              {currentEvent.costCalculation && (
                <pre className="formula-block">{currentEvent.costCalculation}</pre>
              )}
              {currentEvent.formulaText && (
                <pre className="formula-block">{currentEvent.formulaText}</pre>
              )}
            </details>
          )}
        </div>
      )}
    </div>
  );
};

export default TraceTimeline;
