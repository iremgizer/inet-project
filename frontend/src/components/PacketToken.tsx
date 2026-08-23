import React, { useEffect, useState } from "react";
import { ViewportPortal } from "@xyflow/react";
import { motion } from "motion/react";
import { NodeInput } from "../types/network";

interface PacketTokenProps {
  node: NodeInput;
  label: string;
}

/** Educational animation token for Segment Routing replay — NOT a packet-level
 * simulator. It represents the active demand moving along the already-computed
 * route, one trace step at a time. Position is driven by plain CSS transitions
 * on the wrapper (React Flow's ViewportPortal keeps it correctly pinned to flow
 * coordinates through pan/zoom); `motion` only adds a small arrival pulse on
 * top, reusing the dependency the project already ships instead of adding a
 * new one. If `prefers-reduced-motion` is set, the pulse is skipped. */
const PacketToken: React.FC<PacketTokenProps> = ({ node, label }) => {
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduceMotion(mq.matches);
    const onChange = () => setReduceMotion(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  return (
    <ViewportPortal>
      <div
        className="rf-packet-token-wrap"
        style={{ transform: `translate(${node.x}px, ${node.y}px)` }}
      >
        <motion.div
          key={node.id}
          className="rf-packet-token"
          initial={reduceMotion ? false : { scale: 0.55, opacity: 0.5 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={reduceMotion ? { duration: 0 } : { type: "spring", stiffness: 320, damping: 24 }}
          title={`Active demand: ${label}`}
        >
          <span className="rf-packet-token-label">{label}</span>
        </motion.div>
      </div>
    </ViewportPortal>
  );
};

export default PacketToken;
