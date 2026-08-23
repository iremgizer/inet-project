import React, { useState } from "react";
import { ChevronDown, ChevronUp, Plus, X, MousePointerClick, Check } from "lucide-react";
import {
  LinkInput,
  NodeInput,
  TEPolicyType,
  TrafficDemandInput,
  TrafficEngineeringPolicy,
} from "../types/network";
import TermHint from "./TermHint";

export interface TEPolicyDraft {
  type: TEPolicyType;
  demandId: string | null; // null = all demands
  linkId: string | null;
  nodeId: string | null;
}

interface TEPolicyEditorProps {
  policies: TrafficEngineeringPolicy[];
  demands: TrafficDemandInput[];
  links: LinkInput[];
  nodes: NodeInput[];
  draft: TEPolicyDraft | null;
  isSelecting: boolean;
  onOpenDraft: () => void;
  onCancelDraft: () => void;
  onUpdateDraft: (patch: Partial<TEPolicyDraft>) => void;
  onStartGraphSelect: () => void;
  onStopGraphSelect: () => void;
  onCommitDraft: () => void;
  onRemovePolicy: (policyId: string) => void;
  // Additional, more direct graph-first flow for link policies (Prefer/Avoid/
  // Forbid): click a link first, then pick the type from a popup on the
  // canvas. The dropdown-based draft flow above remains fully available.
  teQuickSelectActive: boolean;
  onStartTEQuickLinkSelect: () => void;
}

const POLICY_LABELS: Record<TEPolicyType, string> = {
  PREFER_LINK: "Prefer link",
  AVOID_LINK: "Avoid link",
  FORBID_LINK: "Forbid link",
  REQUIRE_WAYPOINT: "Require waypoint",
};

const POLICY_KIND: Record<TEPolicyType, "hard" | "soft"> = {
  FORBID_LINK: "hard",
  REQUIRE_WAYPOINT: "hard",
  AVOID_LINK: "soft",
  PREFER_LINK: "soft",
};

const TEPolicyEditor: React.FC<TEPolicyEditorProps> = ({
  policies,
  demands,
  links,
  nodes,
  draft,
  isSelecting,
  onOpenDraft,
  onCancelDraft,
  onUpdateDraft,
  onStartGraphSelect,
  onStopGraphSelect,
  onCommitDraft,
  onRemovePolicy,
  teQuickSelectActive,
  onStartTEQuickLinkSelect,
}) => {
  const [open, setOpen] = useState(false);

  const nodeLabel = (id: string) => nodes.find((n) => n.id === id)?.label ?? id;
  const linkLabel = (id: string) => {
    const link = links.find((l) => l.id === id);
    return link ? `${nodeLabel(link.source)}–${nodeLabel(link.target)}` : id;
  };
  const demandLabel = (id: string | null | undefined) => {
    if (!id) return "All demands";
    const d = demands.find((dm) => dm.id === id);
    return d ? `${nodeLabel(d.source)} → ${nodeLabel(d.target)}` : id;
  };

  const isWaypointType = draft?.type === "REQUIRE_WAYPOINT";
  const draftTargetSet = isWaypointType ? !!draft?.nodeId : !!draft?.linkId;
  const draftTargetLabel = draft ? (isWaypointType ? (draft.nodeId ? nodeLabel(draft.nodeId) : null) : (draft.linkId ? linkLabel(draft.linkId) : null)) : null;

  return (
    <div className="te-editor">
      <button className="collapse-toggle te-editor-toggle" onClick={() => setOpen((p) => !p)}>
        {open ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
        Traffic Engineering Policies
        {policies.length > 0 && <span className="te-editor-count">{policies.length}</span>}
        <TermHint
          term="Traffic Engineering Policy"
          shortDefinition="Routing intent — prefer, avoid, or forbid a link, or require a waypoint — separate from a link's own cost."
          example="Forbid link B–D: the route search never considers it, for the demand(s) it applies to."
        />
      </button>

      {open && (
        <div className="te-editor-body">
          {policies.length === 0 && !draft && (
            <p className="te-empty-hint">No policies yet — routing follows plain link cost only.</p>
          )}

          {policies.length > 0 && (
            <ul className="te-policy-list">
              {policies.map((p) => (
                <li key={p.policyId} className={`te-policy-item te-policy-item--${POLICY_KIND[p.type]}`}>
                  <span className={`te-policy-kind-dot te-policy-kind-dot--${POLICY_KIND[p.type]}`} />
                  <span className="te-policy-text">
                    <strong>{POLICY_LABELS[p.type]}</strong>{" "}
                    {p.type === "REQUIRE_WAYPOINT" ? nodeLabel(p.nodeId ?? "") : linkLabel(p.linkId ?? "")}
                  </span>
                  <span className="te-policy-scope">{demandLabel(p.demandId)}</span>
                  <button
                    className="icon-btn danger te-policy-remove"
                    onClick={() => onRemovePolicy(p.policyId)}
                    title="Remove policy"
                    aria-label="Remove policy"
                  >
                    <X size={12} />
                  </button>
                </li>
              ))}
            </ul>
          )}

          {!draft ? (
            <div className="te-add-row">
              <button className="te-add-btn" onClick={onOpenDraft}>
                <Plus size={13} /> Add policy
              </button>
              <button
                className={`te-quick-btn${teQuickSelectActive ? " te-quick-btn--active" : ""}`}
                onClick={onStartTEQuickLinkSelect}
                disabled={teQuickSelectActive}
              >
                <MousePointerClick size={13} /> {teQuickSelectActive ? "Selecting…" : "Select on Graph"}
              </button>
            </div>
          ) : (
            <div className="te-draft-form">
              <div className="te-draft-row">
                <label className="te-draft-field">
                  <span>Policy type</span>
                  <select
                    className="select-input"
                    value={draft.type}
                    onChange={(e) => onUpdateDraft({ type: e.target.value as TEPolicyType, linkId: null, nodeId: null })}
                  >
                    {(Object.keys(POLICY_LABELS) as TEPolicyType[]).map((t) => (
                      <option key={t} value={t}>{POLICY_LABELS[t]}</option>
                    ))}
                  </select>
                </label>
                <label className="te-draft-field">
                  <span>Applies to</span>
                  <select
                    className="select-input"
                    value={draft.demandId ?? ""}
                    onChange={(e) => onUpdateDraft({ demandId: e.target.value || null })}
                  >
                    <option value="">All demands</option>
                    {demands.map((d) => (
                      <option key={d.id} value={d.id}>{demandLabel(d.id)}</option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="te-draft-row">
                <label className="te-draft-field te-draft-field--wide">
                  <span>{isWaypointType ? "Waypoint node" : "Link"}</span>
                  <select
                    className="select-input"
                    value={(isWaypointType ? draft.nodeId : draft.linkId) ?? ""}
                    onChange={(e) =>
                      isWaypointType
                        ? onUpdateDraft({ nodeId: e.target.value || null })
                        : onUpdateDraft({ linkId: e.target.value || null })
                    }
                  >
                    <option value="">{isWaypointType ? "Select a node…" : "Select a link…"}</option>
                    {isWaypointType
                      ? nodes.map((n) => <option key={n.id} value={n.id}>{n.label}</option>)
                      : links.map((l) => <option key={l.id} value={l.id}>{linkLabel(l.id)}</option>)}
                  </select>
                </label>
                <button
                  className={`te-graph-select-btn${isSelecting ? " te-graph-select-btn--active" : ""}`}
                  onClick={() => (isSelecting ? onStopGraphSelect() : onStartGraphSelect())}
                  type="button"
                >
                  {isSelecting ? <><Check size={13} /> Done</> : <><MousePointerClick size={13} /> Pick on graph</>}
                </button>
              </div>

              {isSelecting && (
                <p className="te-selecting-hint">
                  Click a {isWaypointType ? "node" : "link"} on the graph · Esc to stop
                </p>
              )}
              {!isSelecting && draftTargetSet && (
                <p className="te-selected-hint">Selected: {draftTargetLabel}</p>
              )}

              <div className="te-draft-actions">
                <button className="btn-secondary btn-sm" onClick={onCancelDraft}>Cancel</button>
                <button className="btn-primary btn-sm" onClick={onCommitDraft} disabled={!draftTargetSet}>
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

export default TEPolicyEditor;
