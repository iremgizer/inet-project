import React from "react";
import { ViewportPortal } from "@xyflow/react";
import { X } from "lucide-react";
import { LinkInput, NodeInput } from "../types/network";

export type TEQuickLinkPolicyType = "PREFER_LINK" | "AVOID_LINK" | "FORBID_LINK";

interface TEQuickPolicyPopupProps {
  link: LinkInput;
  nodes: NodeInput[];
  onChoose: (type: TEQuickLinkPolicyType) => void;
  onCancel: () => void;
}

const OPTIONS: { type: TEQuickLinkPolicyType; label: string }[] = [
  { type: "PREFER_LINK", label: "Prefer this link" },
  { type: "AVOID_LINK", label: "Avoid this link" },
  { type: "FORBID_LINK", label: "Forbid this link" },
];

/** Quick, graph-first way to create a link policy — click a link, then pick a
 * type from this floating popup. This is an additional, more direct
 * interaction on top of the existing dropdown-based "Add policy" form in
 * TEPolicyEditor, not a replacement for it. Positioned via React Flow's
 * ViewportPortal (same technique PacketToken uses) so it stays pinned to the
 * link's midpoint through pan/zoom. */
const TEQuickPolicyPopup: React.FC<TEQuickPolicyPopupProps> = ({ link, nodes, onChoose, onCancel }) => {
  const nodeLabel = (id: string) => nodes.find((n) => n.id === id)?.label ?? id;
  const sourceNode = nodes.find((n) => n.id === link.source);
  const targetNode = nodes.find((n) => n.id === link.target);
  if (!sourceNode || !targetNode) return null;

  const midX = (sourceNode.x + targetNode.x) / 2;
  const midY = (sourceNode.y + targetNode.y) / 2;

  return (
    <ViewportPortal>
      <div
        className="te-quick-popup"
        style={{ transform: `translate(${midX}px, ${midY}px) translate(-50%, -50%)` }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="te-quick-popup-header">
          <div>
            <div className="te-quick-popup-title">Traffic Engineering Policy</div>
            <div className="te-quick-popup-subtitle">{nodeLabel(link.source)} – {nodeLabel(link.target)}</div>
          </div>
          <button className="te-quick-popup-close" onClick={onCancel} aria-label="Cancel">
            <X size={12} />
          </button>
        </div>
        {OPTIONS.map((opt) => (
          <button key={opt.type} className="te-quick-popup-option" onClick={() => onChoose(opt.type)}>
            <span className="te-quick-popup-radio" aria-hidden="true" />
            {opt.label}
          </button>
        ))}
      </div>
    </ViewportPortal>
  );
};

export default TEQuickPolicyPopup;
