import React, {
  createContext,
  useCallback,
  useEffect,
  useMemo,
  useRef,
} from "react";
import {
  ReactFlow,
  Controls,
  Background,
  MiniMap,
  Panel,
  useNodesState,
  useEdgesState,
  addEdge,
  Connection,
  Edge,
  Node,
  NodeChange,
  EdgeChange,
  MarkerType,
  BackgroundVariant,
  ConnectionMode,
  applyNodeChanges,
  applyEdgeChanges,
  useReactFlow,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import NetworkNode from "./NetworkNode";
import NetworkEdge, { NetworkEdgeData } from "./NetworkEdge";
import GraphLegend from "./GraphLegend";
import {
  LinkInput,
  LinkResult,
  NetworkInput,
  NodeInput,
  PathResult,
  SimulationTraceEvent,
} from "../types/network";
import { buildDemandColorMap } from "../utils/graphVisuals";

// ── Simulation overlay context ────────────────────────────────────────────────

export interface SimulationOverlayContextType {
  highlightedNodeIds: Set<string>;
  highlightedLinkIds: Set<string>;
  linkResults: Map<string, LinkResult>;
  currentLinkLoads: Record<string, number>;
  pathColor: string | null;
  pathResults: PathResult[];
  demandColorMap: Map<string, string>;
  activeDemandId: string | null;
  isTraceMode: boolean;
  isSimulated: boolean;
  hoveredNodeId: string | null;
  setHoveredNodeId: (id: string | null) => void;
  connectSourceId: string | null;
  network: NetworkInput;
  gradingLinkStatus: Map<string, "correct" | "wrong" | "missed">;
  gradingNodeIds: Set<string>;
}

const EMPTY_NETWORK: NetworkInput = { nodes: [], links: [], demands: [], topologyType: "custom", isDirected: false };

export const SimulationOverlayContext =
  createContext<SimulationOverlayContextType>({
    highlightedNodeIds: new Set(),
    highlightedLinkIds: new Set(),
    linkResults: new Map(),
    currentLinkLoads: {},
    pathColor: null,
    pathResults: [],
    demandColorMap: new Map(),
    activeDemandId: null,
    isTraceMode: false,
    isSimulated: false,
    hoveredNodeId: null,
    setHoveredNodeId: () => {},
    connectSourceId: null,
    network: EMPTY_NETWORK,
    gradingLinkStatus: new Map(),
    gradingNodeIds: new Set(),
  });

// ── Converters ────────────────────────────────────────────────────────────────

function toRFNode(node: NodeInput): Node {
  return {
    id: node.id,
    position: { x: node.x, y: node.y },
    data: { label: node.label },
    type: "networkNode",
  };
}

function toRFEdge(link: LinkInput, isDirected: boolean): Edge {
  return {
    id: link.id,
    source: link.source,
    target: link.target,
    data: { weight: link.weight, capacity: link.capacity } satisfies NetworkEdgeData,
    type: "networkEdge",
    markerEnd: isDirected
      ? { type: MarkerType.ArrowClosed, width: 14, height: 14 }
      : undefined,
  };
}

// Fingerprint only on structure+labels+weights (NOT positions).
function networkFingerprint(network: NetworkInput): string {
  const nodes = network.nodes
    .map((n) => `${n.id}:${n.label}`)
    .sort()
    .join("|");
  const links = network.links
    .map((l) => `${l.id}:${l.source}:${l.target}:${l.weight}:${l.capacity}`)
    .sort()
    .join("|");
  return `${nodes}$$${links}$$${network.isDirected}`;
}

// ── Custom types ──────────────────────────────────────────────────────────────

const nodeTypes = { networkNode: NetworkNode };
const edgeTypes = { networkEdge: NetworkEdge };

// ── Props ─────────────────────────────────────────────────────────────────────

interface ReactFlowCanvasProps {
  network: NetworkInput;
  currentTraceEvent: SimulationTraceEvent | null;
  linkResults: LinkResult[];
  pathResults: PathResult[];
  isSimulated: boolean;
  isTraceMode: boolean;
  readonly?: boolean;
  canEditNodes?: boolean;
  canEditLinks?: boolean;
  fitViewTrigger?: number;
  connectSourceId?: string | null;
  centerNodeRequest?: { id: string; nonce: number } | null;
  gradingHighlightLinks?: { linkId: string; status: "correct" | "wrong" | "missed" }[];
  gradingHighlightNodes?: string[];
  onMoveNode: (id: string, x: number, y: number) => void;
  onAddLink: (source: string, target: string) => void;
  onDeleteNode: (id: string) => void;
  onDeleteLink: (id: string) => void;
  onSelectNode: (id: string | null) => void;
  onSelectLink: (id: string | null) => void;
  onCompleteConnect?: (targetId: string) => void;
  onCancelConnect?: () => void;
  onAddNodeShortcut?: () => void;
}

// ── Inner canvas (needs ReactFlowProvider context) ────────────────────────────

const InnerCanvas: React.FC<ReactFlowCanvasProps> = ({
  network,
  currentTraceEvent,
  linkResults,
  pathResults,
  isSimulated,
  isTraceMode,
  readonly = false,
  canEditNodes = true,
  canEditLinks = true,
  fitViewTrigger,
  connectSourceId = null,
  centerNodeRequest,
  gradingHighlightLinks,
  gradingHighlightNodes,
  onMoveNode,
  onAddLink,
  onDeleteNode,
  onDeleteLink,
  onSelectNode,
  onSelectLink,
  onCompleteConnect,
  onCancelConnect,
  onAddNodeShortcut,
}) => {
  const { fitView } = useReactFlow();
  const [nodes, setNodes] = useNodesState<Node>(network.nodes.map(toRFNode));
  const [edges, setEdges] = useEdgesState<Edge>(
    network.links.map((l) => toRFEdge(l, network.isDirected))
  );
  const [hoveredNodeId, setHoveredNodeId] = React.useState<string | null>(null);

  // Re-sync from NetworkInput when structure/labels/weights change.
  const fingerprint = networkFingerprint(network);
  const prevFingerprintRef = useRef<string>(fingerprint);

  useEffect(() => {
    if (fingerprint !== prevFingerprintRef.current) {
      prevFingerprintRef.current = fingerprint;
      setNodes(network.nodes.map(toRFNode));
      setEdges(network.links.map((l) => toRFEdge(l, network.isDirected)));
    }
  }, [fingerprint, network, setNodes, setEdges]);

  // Fit view on first mount, when the topology is replaced, or when fitViewTrigger changes.
  const prevNodeCountRef = useRef(network.nodes.length);
  const prevFitTriggerRef = useRef(fitViewTrigger ?? 0);
  useEffect(() => {
    const nodeCountChanged = network.nodes.length !== prevNodeCountRef.current;
    const triggerChanged = (fitViewTrigger ?? 0) !== prevFitTriggerRef.current;
    if (nodeCountChanged || triggerChanged) {
      prevNodeCountRef.current = network.nodes.length;
      prevFitTriggerRef.current = fitViewTrigger ?? 0;
      setTimeout(() => fitView({ padding: 0.15, duration: 300 }), 50);
    }
  }, [network.nodes.length, fitViewTrigger, fitView]);

  // Center on specific node when requested
  const prevCenterNonceRef = useRef<number>(-1);
  useEffect(() => {
    if (!centerNodeRequest) return;
    if (centerNodeRequest.nonce === prevCenterNonceRef.current) return;
    prevCenterNonceRef.current = centerNodeRequest.nonce;
    fitView({ nodes: [{ id: centerNodeRequest.id }], duration: 400, padding: 0.5 });
  }, [centerNodeRequest, fitView]);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.key === "f" || e.key === "F") {
        e.preventDefault();
        fitView({ padding: 0.15, duration: 300 });
      }
      if (e.key === "Escape") {
        if (connectSourceId) {
          onCancelConnect?.();
        } else {
          onSelectNode(null);
          onSelectLink(null);
        }
      }
      if ((e.key === "a" || e.key === "A") && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        onAddNodeShortcut?.();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [fitView, onSelectNode, onSelectLink, onAddNodeShortcut, connectSourceId, onCancelConnect]);

  // ── Simulation overlay context value ─────────────────────────────────────

  const stableSetHoveredNodeId = useCallback((id: string | null) => {
    setHoveredNodeId(id);
  }, []);

  const overlay = useMemo<SimulationOverlayContextType>(() => {
    const linkResultMap = new Map<string, LinkResult>();
    for (const r of linkResults) linkResultMap.set(r.linkId, r);

    const gradingLinkStatus = new Map<string, "correct" | "wrong" | "missed">();
    for (const hl of gradingHighlightLinks ?? []) gradingLinkStatus.set(hl.linkId, hl.status);
    const gradingNodeIds = new Set<string>(gradingHighlightNodes ?? []);

    const demandColorMap = buildDemandColorMap(pathResults);

    if (isTraceMode && currentTraceEvent) {
      const activeDemandId = currentTraceEvent.activeDemandId ?? null;
      const tracePath = activeDemandId
        ? (demandColorMap.get(activeDemandId) ?? currentTraceEvent.pathColor ?? null)
        : (currentTraceEvent.pathColor ?? null);
      return {
        highlightedNodeIds: new Set(currentTraceEvent.highlightedNodes),
        highlightedLinkIds: new Set(currentTraceEvent.highlightedLinks),
        linkResults: linkResultMap,
        currentLinkLoads: currentTraceEvent.currentLinkLoads ?? {},
        pathColor: tracePath,
        pathResults,
        demandColorMap,
        activeDemandId,
        isTraceMode: true,
        isSimulated,
        hoveredNodeId,
        setHoveredNodeId: stableSetHoveredNodeId,
        connectSourceId,
        network,
        gradingLinkStatus,
        gradingNodeIds,
      };
    }
    return {
      highlightedNodeIds: new Set(),
      highlightedLinkIds: new Set(),
      linkResults: linkResultMap,
      currentLinkLoads: {},
      pathColor: null,
      pathResults,
      demandColorMap,
      activeDemandId: null,
      isTraceMode: false,
      isSimulated,
      hoveredNodeId,
      setHoveredNodeId: stableSetHoveredNodeId,
      connectSourceId,
      network,
      gradingLinkStatus,
      gradingNodeIds,
    };
  }, [currentTraceEvent, linkResults, pathResults, isSimulated, isTraceMode, hoveredNodeId, stableSetHoveredNodeId, connectSourceId, network, gradingHighlightLinks, gradingHighlightNodes]);

  // ── RF callbacks ──────────────────────────────────────────────────────────

  const handleNodesChange = useCallback(
    (changes: NodeChange[]) => {
      setNodes((prev) => applyNodeChanges(changes, prev));
    },
    [setNodes]
  );

  const handleEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      setEdges((prev) => applyEdgeChanges(changes, prev));
    },
    [setEdges]
  );

  const handleConnect = useCallback(
    (connection: Connection) => {
      if (!connection.source || !connection.target) return;
      if (connection.source === connection.target) return;
      onAddLink(connection.source, connection.target);
      // RF edge will be added when NetworkInput fingerprint changes (via useEffect)
    },
    [onAddLink]
  );

  const handleNodeDragStop = useCallback(
    (_event: unknown, node: Node) => {
      onMoveNode(node.id, node.position.x, node.position.y);
    },
    [onMoveNode]
  );

  const handleNodesDelete = useCallback(
    (deleted: Node[]) => {
      deleted.forEach((n) => onDeleteNode(n.id));
    },
    [onDeleteNode]
  );

  const handleEdgesDelete = useCallback(
    (deleted: Edge[]) => {
      deleted.forEach((e) => onDeleteLink(e.id));
    },
    [onDeleteLink]
  );

  const handleNodeClick = useCallback(
    (_event: unknown, node: Node) => {
      if (connectSourceId) {
        if (node.id !== connectSourceId) {
          onCompleteConnect?.(node.id);
        }
        return;
      }
      onSelectNode(node.id);
    },
    [connectSourceId, onCompleteConnect, onSelectNode]
  );

  const handleEdgeClick = useCallback(
    (_event: unknown, edge: Edge) => {
      if (connectSourceId) {
        onCancelConnect?.();
        return;
      }
      onSelectLink(edge.id);
    },
    [connectSourceId, onCancelConnect, onSelectLink]
  );

  const handlePaneClick = useCallback(() => {
    if (connectSourceId) {
      onCancelConnect?.();
      return;
    }
    onSelectNode(null);
    onSelectLink(null);
  }, [connectSourceId, onCancelConnect, onSelectNode, onSelectLink]);

  return (
    <SimulationOverlayContext.Provider value={overlay}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={handleNodesChange}
        onEdgesChange={handleEdgesChange}
        onConnect={handleConnect}
        onNodeDragStop={handleNodeDragStop}
        onNodesDelete={handleNodesDelete}
        onEdgesDelete={handleEdgesDelete}
        onNodeClick={handleNodeClick}
        onEdgeClick={handleEdgeClick}
        onPaneClick={handlePaneClick}
        connectionMode={ConnectionMode.Loose}
        deleteKeyCode="Delete"
        fitView
        fitViewOptions={{ padding: 0.15 }}
        nodesDraggable={!readonly && canEditNodes}
        nodesConnectable={!readonly && canEditLinks}
        elementsSelectable={!readonly}
        minZoom={0.15}
        maxZoom={3}
        defaultEdgeOptions={{ type: "networkEdge" }}
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={20}
          size={1}
          color="#d1d5db"
        />
        <Controls showInteractive={false} />
        <MiniMap
          nodeColor={() => "#94a3b8"}
          maskColor="rgba(248,249,252,0.7)"
          style={{ bottom: 60, right: 12 }}
          pannable
          zoomable
        />
        <Panel position="bottom-left">
          <GraphLegend />
        </Panel>
      </ReactFlow>
    </SimulationOverlayContext.Provider>
  );
};

// ── Public wrapper (provides ReactFlow context) ───────────────────────────────

import { ReactFlowProvider } from "@xyflow/react";

const ReactFlowCanvas: React.FC<ReactFlowCanvasProps> = (props) => (
  <ReactFlowProvider>
    <InnerCanvas {...props} />
  </ReactFlowProvider>
);

export default ReactFlowCanvas;
