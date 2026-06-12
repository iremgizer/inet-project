import React from "react";

interface TraceControlsProps {
  activeStepIndex: number;
  totalSteps: number;
  isPlaying: boolean;
  playbackSpeedMs: number;
  onStepBack: () => void;
  onStepForward: () => void;
  onPlay: () => void;
  onPause: () => void;
  onReset: () => void;
  onSpeedChange: (value: number) => void;
}

const TraceControls: React.FC<TraceControlsProps> = ({
  activeStepIndex,
  totalSteps,
  isPlaying,
  playbackSpeedMs,
  onStepBack,
  onStepForward,
  onPlay,
  onPause,
  onReset,
  onSpeedChange,
}) => {
  const disabled = totalSteps === 0;
  return (
    <div className="panel trace-controls">
      <h3>Trace Player</h3>
      <div className="trace-buttons">
        <button onClick={onStepBack} disabled={disabled || activeStepIndex <= 0}>Back</button>
        {isPlaying ? (
          <button onClick={onPause} disabled={disabled}>Pause</button>
        ) : (
          <button onClick={onPlay} disabled={disabled}>Play</button>
        )}
        <button onClick={onStepForward} disabled={disabled || activeStepIndex >= totalSteps - 1}>Forward</button>
        <button onClick={onReset} disabled={disabled}>Reset Trace</button>
      </div>
      <div className="trace-progress">
        Step {totalSteps ? activeStepIndex + 1 : 0} / {totalSteps}
      </div>
      <label>
        Speed
        <input
          type="range"
          min="300"
          max="2000"
          step="100"
          value={playbackSpeedMs}
          onChange={(event) => onSpeedChange(Number(event.target.value))}
        />
      </label>
    </div>
  );
};

export default TraceControls;
