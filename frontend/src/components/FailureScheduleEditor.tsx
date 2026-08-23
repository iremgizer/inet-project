import React, { useState } from "react";
import { ChevronDown, ChevronUp, Plus, X, PowerOff } from "lucide-react";
import { LinkInput, NodeInput, SimulationFailureEvent } from "../types/network";
import TermHint from "./TermHint";

interface FailureScheduleEditorProps {
  schedule: SimulationFailureEvent[];
  links: LinkInput[];
  nodes: NodeInput[];
  onAdd: (linkId: string, triggerValue: number) => void;
  onRemove: (eventId: string) => void;
}

/** "Failure Scenario" — schedule one or more links to fail *during* the run
 * about to start, at a given trace step (PR 6, Part 1), rather than editing
 * a link's operationalStatus before running (PR 5's Link Inspector control).
 * Collapsed by default, same pattern as TEPolicyEditor. */
const FailureScheduleEditor: React.FC<FailureScheduleEditorProps> = ({
  schedule,
  links,
  nodes,
  onAdd,
  onRemove,
}) => {
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [draftLinkId, setDraftLinkId] = useState("");
  const [draftStep, setDraftStep] = useState("4");

  const nodeLabel = (id: string) => nodes.find((n) => n.id === id)?.label ?? id;
  const linkLabel = (id: string) => {
    const link = links.find((l) => l.id === id);
    return link ? `${nodeLabel(link.source)}–${nodeLabel(link.target)}` : id;
  };

  const stepNum = Number(draftStep);
  const stepValid = Number.isInteger(stepNum) && stepNum >= 0;

  const handleAdd = () => {
    if (!draftLinkId || !stepValid) return;
    onAdd(draftLinkId, stepNum);
    setDraftLinkId("");
    setDraftStep("4");
    setAdding(false);
  };

  return (
    <div className="te-editor">
      <button className="collapse-toggle te-editor-toggle" onClick={() => setOpen((p) => !p)}>
        {open ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
        Failure Scenario
        {schedule.length > 0 && <span className="te-editor-count">{schedule.length}</span>}
        <TermHint
          term="Scheduled link failure"
          shortDefinition="A link that starts UP and fails partway through the run, at a chosen trace step — watch routing recompute live during replay."
          example="Fail link B–D at step 4: steps 0–4 show the baseline route; right after, B–D goes down and traffic reroutes."
        />
      </button>

      {open && (
        <div className="te-editor-body">
          {schedule.length === 0 && !adding && (
            <p className="te-empty-hint">No scheduled failures — every link stays up for the whole run.</p>
          )}

          {schedule.length > 0 && (
            <ul className="te-policy-list">
              {schedule.map((f) => (
                <li key={f.eventId} className="te-policy-item te-policy-item--down">
                  <span className="te-policy-kind-dot te-policy-kind-dot--down" />
                  <span className="te-policy-text">
                    <strong>{linkLabel(f.linkId)}</strong> fails at step {f.triggerValue}
                  </span>
                  <button
                    className="icon-btn danger te-policy-remove"
                    onClick={() => onRemove(f.eventId)}
                    title="Remove scheduled failure"
                    aria-label="Remove scheduled failure"
                  >
                    <X size={12} />
                  </button>
                </li>
              ))}
            </ul>
          )}

          {!adding ? (
            <div className="te-add-row">
              <button className="te-add-btn" onClick={() => setAdding(true)} disabled={links.length === 0}>
                <Plus size={13} /> Add link failure
              </button>
            </div>
          ) : (
            <div className="te-draft-form">
              <div className="te-draft-row">
                <label className="te-draft-field te-draft-field--wide">
                  <span>Link</span>
                  <select
                    className="select-input"
                    value={draftLinkId}
                    onChange={(e) => setDraftLinkId(e.target.value)}
                  >
                    <option value="">Select a link…</option>
                    {links.map((l) => <option key={l.id} value={l.id}>{linkLabel(l.id)}</option>)}
                  </select>
                </label>
                <label className="te-draft-field">
                  <span>Fail at step</span>
                  <input
                    className="number-input number-input--sm"
                    type="number"
                    min="0"
                    step="1"
                    value={draftStep}
                    onChange={(e) => setDraftStep(e.target.value)}
                  />
                </label>
              </div>
              <p className="te-selecting-hint">
                <PowerOff size={12} /> The exact step count depends on the network and demands — pick a rough
                point mid-run; a step number beyond the trace simply never fires.
              </p>
              <div className="te-draft-actions">
                <button className="btn-secondary btn-sm" onClick={() => setAdding(false)}>Cancel</button>
                <button className="btn-primary btn-sm" onClick={handleAdd} disabled={!draftLinkId || !stepValid}>
                  Add
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default FailureScheduleEditor;
