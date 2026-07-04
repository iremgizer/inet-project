import React from "react";
import { X, CheckCircle2, XCircle, MinusCircle, Info } from "lucide-react";
import { ChallengeGradingResult } from "../types/challenge";

interface SolutionComparePanelProps {
  result: ChallengeGradingResult;
  onClose: () => void;
}

const SolutionComparePanel: React.FC<SolutionComparePanelProps> = ({ result, onClose }) => {
  const compareItems = result.feedbackItems.filter(
    (item) => item.expectedValue !== undefined || item.receivedValue !== undefined,
  );

  const hasHighlights = result.highlightedLinks.length > 0;

  return (
    <div className="compare-panel">
      <div className="compare-panel-header">
        <span className="compare-panel-title">Solution Comparison</span>
        <button className="compare-panel-close" onClick={onClose} aria-label="Close comparison">
          <X size={13} />
        </button>
      </div>

      {hasHighlights && (
        <div className="compare-graph-note">
          <Info size={11} />
          Graph:{" "}
          <span className="compare-legend-correct">■ correct</span>
          {" · "}
          <span className="compare-legend-wrong">■ wrong</span>
          {" · "}
          <span className="compare-legend-missed">■ missed</span>
        </div>
      )}

      {compareItems.length > 0 ? (
        <div className="compare-items">
          {compareItems.map((item, i) => (
            <div key={i} className={`compare-item compare-item--${item.type}`}>
              <div className="compare-item-title">
                {item.type === "success" ? (
                  <CheckCircle2 size={12} />
                ) : item.type === "error" ? (
                  <XCircle size={12} />
                ) : (
                  <MinusCircle size={12} />
                )}
                {item.title}
              </div>
              <div className="compare-values">
                {item.receivedValue !== undefined && (
                  <div className="compare-value compare-value--student">
                    <span className="compare-value-label">Your answer</span>
                    <span className="compare-value-data">{String(item.receivedValue)}</span>
                  </div>
                )}
                {item.expectedValue !== undefined && (
                  <div className="compare-value compare-value--expected">
                    <span className="compare-value-label">Correct answer</span>
                    <span className="compare-value-data">{String(item.expectedValue)}</span>
                  </div>
                )}
              </div>
              {item.formula && (
                <div className="compare-formula">{item.formula}</div>
              )}
              {item.workedExample && (
                <pre className="compare-worked">{item.workedExample}</pre>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="compare-no-values">
          <p>See the feedback cards above for details on what was correct and incorrect.</p>
          {result.highlightedLinks.length > 0 && (
            <p>Links are highlighted on the graph with color-coded status.</p>
          )}
        </div>
      )}

      <div className="compare-summary-row">
        Score: <strong>{result.score}/{result.maxScore}</strong> — {result.isCorrect ? "Correct" : "Incorrect"}
      </div>
    </div>
  );
};

export default SolutionComparePanel;
