import React, { useCallback, useRef, useState } from "react";
import { Upload, FileJson, AlertTriangle, CheckCircle2, X, Download } from "lucide-react";
import { parseTopologyFile, validateTopologyJson, importTopologyJson, downloadExampleTopologyJson } from "../utils/topologyJson";
import type { NetworkInput } from "../types/network";

interface JsonImportZoneProps {
  onImport: (network: NetworkInput, name: string) => void;
  onClose: () => void;
}

interface ParsedPreview {
  name: string;
  nodes: number;
  links: number;
  demands: number;
  network: NetworkInput;
}

const JsonImportZone: React.FC<JsonImportZoneProps> = ({ onImport, onClose }) => {
  const fileRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [preview, setPreview] = useState<ParsedPreview | null>(null);

  const processFile = useCallback(async (file: File) => {
    setErrors([]);
    setPreview(null);

    if (!file.name.endsWith(".json") && file.type !== "application/json") {
      setErrors(["File must be a .json file."]);
      return;
    }

    try {
      const raw = await parseTopologyFile(file);
      const validation = validateTopologyJson(raw);
      if (!validation.valid) {
        setErrors(validation.errors);
        return;
      }
      const network = importTopologyJson(raw);
      setPreview({
        name: raw.name ?? file.name.replace(".json", ""),
        nodes: network.nodes.length,
        links: network.links.length,
        demands: network.demands.length,
        network,
      });
    } catch (err) {
      setErrors([(err as Error).message]);
    }
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      const file = e.dataTransfer.files[0];
      if (file) processFile(file);
    },
    [processFile]
  );

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) processFile(file);
      e.target.value = "";
    },
    [processFile]
  );

  const handleApply = () => {
    if (preview) {
      onImport(preview.network, preview.name);
      onClose();
    }
  };

  return (
    <div className="json-zone">
      <div className="json-zone-header">
        <div className="json-zone-title">
          <FileJson size={14} />
          Import topology JSON
        </div>
        <button className="icon-btn" onClick={onClose} aria-label="Close">
          <X size={13} />
        </button>
      </div>

      {/* Drop zone */}
      {!preview && (
        <div
          className={`drop-zone ${isDragging ? "drop-zone--active" : ""}`}
          onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}
          onClick={() => fileRef.current?.click()}
          role="button"
          tabIndex={0}
          aria-label="Drop JSON file here or click to browse"
          onKeyDown={(e) => e.key === "Enter" && fileRef.current?.click()}
        >
          <Upload size={22} className="drop-zone-icon" />
          <div className="drop-zone-text">
            {isDragging ? "Drop to import" : "Drop JSON here"}
          </div>
          <div className="drop-zone-sub">or click to browse</div>
          <input
            ref={fileRef}
            type="file"
            accept=".json,application/json"
            style={{ display: "none" }}
            onChange={handleFileChange}
          />
        </div>
      )}

      {/* Errors */}
      {errors.length > 0 && (
        <div className="json-errors">
          <div className="json-errors-header">
            <AlertTriangle size={13} />
            Validation failed
          </div>
          <ul className="json-error-list">
            {errors.map((e, i) => <li key={i}>{e}</li>)}
          </ul>
          <button className="btn-secondary btn-sm" onClick={() => setErrors([])}>
            Try again
          </button>
        </div>
      )}

      {/* Preview */}
      {preview && (
        <div className="json-preview">
          <div className="json-preview-header">
            <CheckCircle2 size={14} />
            <span>Ready to import</span>
          </div>
          <div className="json-preview-name">{preview.name}</div>
          <div className="json-preview-stats">
            <div className="json-stat"><strong>{preview.nodes}</strong> nodes</div>
            <div className="json-stat"><strong>{preview.links}</strong> links</div>
            <div className="json-stat"><strong>{preview.demands}</strong> demands</div>
          </div>
          <p className="json-preview-warn">
            This will replace the current network.
          </p>
          <div className="json-preview-actions">
            <button className="btn-secondary btn-sm" onClick={() => setPreview(null)}>
              Cancel
            </button>
            <button className="btn-primary btn-sm" onClick={handleApply}>
              Apply import
            </button>
          </div>
        </div>
      )}

      {/* Footer */}
      <div className="json-zone-footer">
        <button className="collapse-toggle" onClick={downloadExampleTopologyJson}>
          <Download size={12} /> Download example JSON
        </button>
      </div>
    </div>
  );
};

export default JsonImportZone;
