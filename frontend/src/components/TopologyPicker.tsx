import React from "react";
import { X } from "lucide-react";
import { TopologyType } from "../types/network";
import { getTopologyPreview, TopologySize } from "../utils/generatedTopologies";

interface Template {
  type: TopologyType;
  label: string;
  tagline: string;
  useCase: string;
  icon: string;
}

const TEMPLATES: Template[] = [
  {
    type: "triangle",
    label: "Triangle",
    tagline: "3 nodes, 3 links",
    useCase: "Best for ECMP equal-cost demonstrations.",
    icon: "△",
  },
  {
    type: "ring",
    label: "Ring",
    tagline: "N nodes in a cycle",
    useCase: "Good for alternate path experiments.",
    icon: "○",
  },
  {
    type: "mesh",
    label: "Mesh",
    tagline: "Dense interconnection",
    useCase: "Good for congestion and path diversity.",
    icon: "⬡",
  },
  {
    type: "fat-tree",
    label: "Fat-Tree",
    tagline: "Hierarchical data center",
    useCase: "Good for data center routing with ECMP.",
    icon: "⊤",
  },
  {
    type: "custom",
    label: "Custom",
    tagline: "Start from scratch",
    useCase: "Draw your own network on the canvas.",
    icon: "✦",
  },
];

const SIZES: TopologySize[] = ["small", "medium", "large"];

interface TopologyPickerProps {
  selected: TopologyType;
  size: TopologySize;
  onSelect: (type: TopologyType) => void;
  onSizeChange: (size: TopologySize) => void;
  onLoad: () => void;
  onClose: () => void;
}

const TopologyPicker: React.FC<TopologyPickerProps> = ({
  selected,
  size,
  onSelect,
  onSizeChange,
  onLoad,
  onClose,
}) => {
  const preview = getTopologyPreview(selected, size);

  return (
    <div className="topo-picker">
      <div className="topo-picker-header">
        <span className="topo-picker-title">Load template</span>
        <button className="icon-btn" onClick={onClose} aria-label="Close">
          <X size={13} />
        </button>
      </div>

      <div className="topo-grid">
        {TEMPLATES.map((t) => (
          <button
            key={t.type}
            className={`topo-card ${selected === t.type ? "topo-card--selected" : ""}`}
            onClick={() => onSelect(t.type)}
            aria-pressed={selected === t.type}
          >
            <div className="topo-card-icon">{t.icon}</div>
            <div className="topo-card-label">{t.label}</div>
            <div className="topo-card-tagline">{t.tagline}</div>
          </button>
        ))}
      </div>

      {/* Selected template detail */}
      <div className="topo-detail">
        <p className="topo-detail-usecase">
          {TEMPLATES.find((t) => t.type === selected)?.useCase}
        </p>
        {selected !== "custom" && (
          <>
            <div className="topo-size-row">
              {SIZES.map((s) => {
                const p = getTopologyPreview(selected, s);
                return (
                  <button
                    key={s}
                    className={`topo-size-btn ${size === s ? "topo-size-btn--active" : ""}`}
                    onClick={() => onSizeChange(s)}
                    aria-pressed={size === s}
                  >
                    <span className="topo-size-label">{s.charAt(0).toUpperCase() + s.slice(1)}</span>
                    <span className="topo-size-count">{p.nodes}N · {p.links}L</span>
                  </button>
                );
              })}
            </div>
            <div className="topo-preview-tag">
              Preview: <strong>{preview.nodes}</strong> nodes, <strong>{preview.links}</strong> links
            </div>
          </>
        )}
        <button
          className="btn-primary"
          style={{ width: "100%", justifyContent: "center" }}
          onClick={onLoad}
          disabled={selected === "custom"}
        >
          Load {TEMPLATES.find((t) => t.type === selected)?.label}
        </button>
        {selected === "custom" && (
          <p className="muted" style={{ fontSize: "0.75rem", textAlign: "center" }}>
            Use the canvas toolbar to add nodes and draw links.
          </p>
        )}
      </div>
    </div>
  );
};

export default TopologyPicker;
