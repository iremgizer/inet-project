// ── Circle-boundary edge anchoring ──────────────────────────────────────────
//
// Root cause this fixes: NetworkNode renders 4 fixed handles (Top/Right/
// Bottom/Left), all `type="source"`, no `type="target"` handles at all, and
// ReactFlowCanvas's toRFEdge() never sets an edge's sourceHandle/
// targetHandle. Without an explicit handle, React Flow's own connection-
// point resolution doesn't know which of the 4 fixed handles actually faces
// the other node — so the sourceX/sourceY/targetX/targetY an edge receives
// don't represent "the point on the node's own circle facing its neighbor,"
// they represent whichever fixed handle React Flow happened to resolve,
// independent of the neighbor's real direction. That's what produced edges
// entering/exiting a node from the wrong side, or visually cutting into the
// node's circular body instead of touching its rim, especially for diagonal
// connections in compact layouts.
//
// The fix is React Flow's own documented "floating edge" pattern: don't
// resolve a handle at all for the *visual* path — compute each node's
// current center (via useInternalNode in NetworkEdge.tsx) and the point
// where the straight line between the two centers crosses each node's own
// circular boundary, then draw the edge between those two points. This
// generalizes to every direction (horizontal, vertical, diagonal, any
// arbitrary angle) with the same formula — no per-topology special-casing,
// no arbitrary CSS offset.

export interface Point {
  x: number;
  y: number;
}

/** Matches .rf-node's CSS: width:54px; height:54px; border-radius:50% —
 * global box-sizing:border-box means the border is included in that 54px,
 * so the rendered circle's true radius is exactly half of it. */
export const NODE_RADIUS = 27;

/** Where the straight line between two circular nodes' CENTERS crosses each
 * node's own circular boundary — the points an edge should actually start/
 * end at. Pure vector math: normalize the center-to-center direction, then
 * step outward from each center by that node's own radius along it (and
 * inward, from the target's perspective, since the direction points away
 * from source).
 *
 * Degenerate case: coincident centers (distance 0, e.g. before layout has
 * been applied) have no meaningful direction — anchors both ends at their
 * own center rather than dividing by zero or producing NaN. This can only
 * ever show as a single point, never a stray line, so it fails safely. */
export function computeCircleEdgeAnchors(
  sourceCenter: Point,
  sourceRadius: number,
  targetCenter: Point,
  targetRadius: number,
): { source: Point; target: Point } {
  const dx = targetCenter.x - sourceCenter.x;
  const dy = targetCenter.y - sourceCenter.y;
  const distance = Math.sqrt(dx * dx + dy * dy);

  if (distance === 0) {
    return { source: { ...sourceCenter }, target: { ...targetCenter } };
  }

  const ux = dx / distance;
  const uy = dy / distance;

  return {
    source: { x: sourceCenter.x + ux * sourceRadius, y: sourceCenter.y + uy * sourceRadius },
    target: { x: targetCenter.x - ux * targetRadius, y: targetCenter.y - uy * targetRadius },
  };
}

/** Edge-length-aware label offset (Part 4) — a short edge in a compact
 * topology gets a proportionally smaller perpendicular offset than a long
 * one, so a short edge's label doesn't sit disproportionately far from its
 * own line (which is what pushes it toward a neighboring edge/node's label
 * in a dense layout). Deterministic and geometry-derived, not a collision
 * detector: every edge computes its own offset from its own length only,
 * with no awareness of any other edge. */
export function computeLabelPerpendicularOffset(
  sourceX: number, sourceY: number, targetX: number, targetY: number,
  maxOffset = 11,
): { perpX: number; perpY: number } {
  const dx = targetX - sourceX;
  const dy = targetY - sourceY;
  const edgeLen = Math.sqrt(dx * dx + dy * dy) || 1;
  const offset = Math.min(maxOffset, edgeLen * 0.22);
  return {
    perpX: (-dy / edgeLen) * offset,
    perpY: (dx / edgeLen) * offset,
  };
}
