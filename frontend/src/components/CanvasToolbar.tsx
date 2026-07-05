import React, { useRef } from "react";
import { Plus, LayoutDashboard, Minimize2, Upload, Download, FileJson, RotateCcw } from "lucide-react";

interface CanvasToolbarProps {
  onAddNode: () => void;
  onAutoLayout: () => void;
  onFitView: () => void;
  onImportJson: (file: File) => void;
  onExportJson: () => void;
  onDownloadExample: () => void;
  onReset: () => void;
  canEditNodes?: boolean;
}

const CanvasToolbar: React.FC<CanvasToolbarProps> = ({
  onAddNode,
  onAutoLayout,
  onFitView,
  onImportJson,
  onExportJson,
  onDownloadExample,
  onReset,
  canEditNodes = true,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      onImportJson(file);
      e.target.value = "";
    }
  };

  return (
    <div className="canvas-toolbar">
      {/* Build group */}
      <div className="canvas-toolbar-group">
        <button
          className="ctb-btn ctb-btn--primary"
          onClick={onAddNode}
          title={canEditNodes ? "Add node" : "Locked by teacher"}
          disabled={!canEditNodes}
        >
          <Plus size={14} />
          <span>Add node</span>
        </button>
        <button className="ctb-btn" onClick={onAutoLayout} title="Auto layout">
          <LayoutDashboard size={14} />
          <span>Layout</span>
        </button>
        <button className="ctb-btn" onClick={onFitView} title="Fit view">
          <Minimize2 size={14} />
        </button>
      </div>

      <div className="canvas-toolbar-sep" />

      {/* JSON group */}
      <div className="canvas-toolbar-group">
        <button className="ctb-btn" onClick={() => fileInputRef.current?.click()} title="Import JSON topology">
          <Upload size={14} />
          <span>Import</span>
        </button>
        <button className="ctb-btn" onClick={onExportJson} title="Export current topology as JSON">
          <Download size={14} />
          <span>Export</span>
        </button>
        <button className="ctb-btn" onClick={onDownloadExample} title="Download example JSON">
          <FileJson size={14} />
        </button>
      </div>

      <div className="canvas-toolbar-sep" />

      {/* Reset */}
      <button className="ctb-btn ctb-btn--danger" onClick={onReset} title="Reset to triangle example">
        <RotateCcw size={14} />
      </button>

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".json,application/json"
        style={{ display: "none" }}
        onChange={handleFileChange}
      />
    </div>
  );
};

export default CanvasToolbar;
