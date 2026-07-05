import React, { useEffect } from "react";
import { X } from "lucide-react";
import NodeDetailPanel from "./NodeDetailPanel";
import LinkDetailPanel from "./LinkDetailPanel";
import { LinkInput, NetworkInput, NodeInput, SimulationResult } from "../types/network";
import { LockedFields } from "../types/assignment";

interface InspectorDrawerProps {
  selectedNode: NodeInput | null;
  selectedLink: LinkInput | null;
  network: NetworkInput;
  simulationResult: SimulationResult | null;
  lockedFields: LockedFields;
  onClose: () => void;
  onUpdateNode: (id: string, update: Partial<NodeInput>) => void;
  onDeleteNode: (id: string) => void;
  onUpdateLink: (id: string, update: Partial<LinkInput>) => void;
  onDeleteLink: (id: string) => void;
  onStartConnect?: (id: string) => void;
  onAddDemandFrom?: (id: string) => void;
  onCenterNode?: (id: string) => void;
  onSelectLink: (linkId: string | null) => void;
}

const InspectorDrawer: React.FC<InspectorDrawerProps> = ({
  selectedNode,
  selectedLink,
  network,
  simulationResult,
  lockedFields,
  onClose,
  onUpdateNode,
  onDeleteNode,
  onUpdateLink,
  onDeleteLink,
  onStartConnect,
  onAddDemandFrom,
  onCenterNode,
  onSelectLink,
}) => {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Nothing selected — render nothing
  if (!selectedNode && !selectedLink) return null;

  return (
    <div className="inspector-drawer" role="complementary" aria-label="Inspector">
      <button
        className="inspector-close-btn"
        onClick={onClose}
        aria-label="Close inspector"
        title="Close (Esc)"
      >
        <X size={15} />
      </button>

      {/* Link takes priority when both are set (allows link-row click to switch focus) */}
      {selectedLink ? (
        <LinkDetailPanel
          link={selectedLink}
          network={network}
          result={simulationResult}
          onUpdate={onUpdateLink}
          onDelete={onDeleteLink}
          canEditLinks={lockedFields.canEditLinks}
          canEditWeights={lockedFields.canEditWeights}
          canEditCapacities={lockedFields.canEditCapacities}
        />
      ) : selectedNode ? (
        <NodeDetailPanel
          node={selectedNode}
          network={network}
          result={simulationResult}
          onUpdate={onUpdateNode}
          onDelete={onDeleteNode}
          onStartConnect={onStartConnect}
          onAddDemandFrom={onAddDemandFrom}
          onCenterNode={onCenterNode}
          onSelectLink={(id) => onSelectLink(id)}
          canEditNodes={lockedFields.canEditNodes}
          canEditWeights={lockedFields.canEditWeights}
          canEditCapacities={lockedFields.canEditCapacities}
          onUpdateLink={onUpdateLink}
          onDeleteLink={onDeleteLink}
        />
      ) : null}
    </div>
  );
};

export default InspectorDrawer;
