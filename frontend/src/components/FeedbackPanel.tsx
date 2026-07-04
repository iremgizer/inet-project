import React, { useState } from "react";
import { CheckCircle2, AlertCircle, AlertTriangle, Info, ChevronDown, ChevronUp } from "lucide-react";
import { ChallengeGradingResult, FeedbackItem } from "../types/challenge";

// ── Single feedback card ───────────────────────────────────────────────────────

const ICONS = {
  success: <CheckCircle2 size={13} />,
  error:   <AlertCircle size={13} />,
  warning: <AlertTriangle size={13} />,
  info:    <Info size={13} />,
};

const FeedbackCard: React.FC<{ item: FeedbackItem }> = ({ item }) => {
  const [expanded, setExpanded] = useState(false);
  const hasDetails = !!(item.explanation || item.formula || item.workedExample);

  return (
    <div className={`fb-card fb-card--${item.type}`}>
      <div className="fb-card-header">
        <span className={`fb-icon fb-icon--${item.type}`}>{ICONS[item.type]}</span>
        <span className="fb-card-title">{item.title}</span>
        {hasDetails && (
          <button
            className="fb-expand-btn"
            onClick={() => setExpanded((p) => !p)}
            aria-label={expanded ? "Collapse" : "Expand"}
          >
            {expanded ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
          </button>
        )}
      </div>
      <p className="fb-card-message">{item.message}</p>
      {expanded && (
        <div className="fb-card-details">
          {item.explanation && (
            <p className="fb-detail-text">{item.explanation}</p>
          )}
          {item.formula && (
            <div className="fb-formula">
              <span className="fb-formula-label">Formula:</span> {item.formula}
            </div>
          )}
          {item.workedExample && (
            <div className="fb-worked-example">
              <div className="fb-formula-label">Worked example:</div>
              <pre className="fb-code">{item.workedExample}</pre>
            </div>
          )}
          {(item.expectedValue !== undefined || item.receivedValue !== undefined) && (
            <div className="fb-compare">
              {item.expectedValue !== undefined && (
                <span className="fb-compare-expected">
                  Expected: <strong>{String(item.expectedValue)}</strong>
                </span>
              )}
              {item.receivedValue !== undefined && (
                <span className="fb-compare-received">
                  Got: <strong>{String(item.receivedValue)}</strong>
                </span>
              )}
            </div>
          )}
          {(item.relatedLinkIds.length > 0 || item.relatedNodeIds.length > 0) && (
            <div className="fb-related">
              {item.relatedNodeIds.length > 0 && (
                <span className="fb-related-nodes">
                  Nodes: {item.relatedNodeIds.map((id) => (
                    <span key={id} className="fb-tag fb-tag--node">{id}</span>
                  ))}
                </span>
              )}
              {item.relatedLinkIds.length > 0 && (
                <span className="fb-related-links">
                  Links: {item.relatedLinkIds.map((id) => (
                    <span key={id} className="fb-tag fb-tag--link">{id}</span>
                  ))}
                </span>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

// ── Link highlight legend ─────────────────────────────────────────────────────

const HighlightLegend: React.FC<{
  links: ChallengeGradingResult["highlightedLinks"];
}> = ({ links }) => {
  if (links.length === 0) return null;
  const correct = links.filter((l) => l.status === "correct");
  const wrong   = links.filter((l) => l.status === "wrong");
  const missed  = links.filter((l) => l.status === "missed");

  return (
    <div className="fb-highlight-legend">
      {correct.length > 0 && (
        <div className="fb-legend-row fb-legend-row--correct">
          <span className="fb-legend-dot" /> Correct: {correct.map((l) => l.linkId).join(", ")}
        </div>
      )}
      {wrong.length > 0 && (
        <div className="fb-legend-row fb-legend-row--wrong">
          <span className="fb-legend-dot" /> Incorrect: {wrong.map((l) => l.linkId).join(", ")}
        </div>
      )}
      {missed.length > 0 && (
        <div className="fb-legend-row fb-legend-row--missed">
          <span className="fb-legend-dot" /> Missed: {missed.map((l) => l.linkId).join(", ")}
        </div>
      )}
    </div>
  );
};

// ── Score badge ───────────────────────────────────────────────────────────────

const ScoreBadge: React.FC<{ result: ChallengeGradingResult }> = ({ result }) => (
  <div className={`fb-score-badge ${result.isCorrect ? "fb-score-badge--pass" : "fb-score-badge--fail"}`}>
    <div className="fb-score-value">
      {result.isCorrect ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
      <span>{result.score} / {result.maxScore}</span>
      <span className="fb-score-pct">({result.percentage}%)</span>
    </div>
    {result.hintsUsed > 0 && (
      <span className="fb-hints-used">
        {result.hintsUsed} hint{result.hintsUsed > 1 ? "s" : ""} used
      </span>
    )}
  </div>
);

// ── Main panel ────────────────────────────────────────────────────────────────

interface FeedbackPanelProps {
  result: ChallengeGradingResult;
  officialSolution?: string | null;
  showOfficialSolution?: boolean;
}

const FeedbackPanel: React.FC<FeedbackPanelProps> = ({
  result,
  officialSolution,
  showOfficialSolution = false,
}) => {
  return (
    <div className="fb-panel">
      <ScoreBadge result={result} />

      <p className="fb-summary">{result.summary}</p>

      {result.highlightedLinks.length > 0 && (
        <HighlightLegend links={result.highlightedLinks} />
      )}

      <div className="fb-items">
        {result.feedbackItems.map((item, i) => (
          <FeedbackCard key={i} item={item} />
        ))}
      </div>

      {result.nextSuggestion && (
        <div className="fb-next-suggestion">
          <Info size={12} /> {result.nextSuggestion}
        </div>
      )}

      {showOfficialSolution && officialSolution && (
        <div className="fb-official-solution">
          <div className="fb-official-solution-label">Official solution</div>
          <p className="fb-official-solution-text">{officialSolution}</p>
        </div>
      )}
    </div>
  );
};

export default FeedbackPanel;
