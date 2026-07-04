import { NetworkInput } from "../types/network";

export const triangleTemplate: NetworkInput = {
  nodes: [
    { id: "u", label: "u", x: 150, y: 200 },
    { id: "v", label: "v", x: 350, y: 350 },
    { id: "t", label: "t", x: 550, y: 200 },
  ],
  links: [
    { id: "u-t", source: "u", target: "t", capacity: 1.0, weight: 2.0 },
    { id: "u-v", source: "u", target: "v", capacity: 1.0, weight: 1.0 },
    { id: "v-t", source: "v", target: "t", capacity: 1.0, weight: 1.0 },
  ],
  demands: [{ id: "d1", source: "u", target: "t", amount: 1.5 }],
  topologyType: "triangle",
  isDirected: false,
};

export const topologyOptions = [
  { value: "custom",    label: "Custom" },
  { value: "triangle",  label: "Triangle" },
  { value: "ring",      label: "Ring" },
  { value: "mesh",      label: "Mesh" },
  { value: "fat-tree",  label: "Clos Fat-Tree" },
  { value: "grid",      label: "Grid" },
  { value: "path",      label: "Path Graph" },
  { value: "cycle",     label: "Cycle" },
  { value: "random",    label: "Random" },
  { value: "line",      label: "Line" },
];
