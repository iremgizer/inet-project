import React from "react";
import { X, FileJson, ArrowRight, Download } from "lucide-react";

interface JsonHelpModalProps {
  open: boolean;
  onClose: () => void;
  onDownloadExampleTopology: () => void;
}

const SCHEMA_FILES = [
  { label: "topology.schema.json", path: "frontend/src/schemas/topology.schema.json" },
  { label: "assignment.schema.json", path: "frontend/src/schemas/assignment.schema.json" },
  { label: "submission.schema.json", path: "frontend/src/schemas/submission.schema.json" },
];

const JsonHelpModal: React.FC<JsonHelpModalProps> = ({
  open,
  onClose,
  onDownloadExampleTopology,
}) => {
  if (!open) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box json-help-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title">
            <FileJson size={16} /> How JSON files work
          </div>
          <button className="icon-btn" onClick={onClose} title="Close">
            <X size={15} />
          </button>
        </div>

        <div className="json-help-body">
          {/* Workflow */}
          <div className="json-help-section">
            <div className="json-help-section-title">Assignment workflow</div>
            <div className="json-help-flow">
              <div className="json-help-step json-help-step--teacher">
                <div className="json-help-step-role">Teacher</div>
                <div className="json-help-step-action">Creates <code>assignment.json</code> in Teacher Workspace</div>
                <div className="json-help-step-note">Share this file with students (email, Moodle, etc.)</div>
              </div>
              <div className="json-help-arrow"><ArrowRight size={14} /></div>
              <div className="json-help-step json-help-step--student">
                <div className="json-help-step-role">Student</div>
                <div className="json-help-step-action">Imports <code>assignment.json</code> via My Assignments</div>
                <div className="json-help-step-note">Solves the task on the canvas, runs the simulation</div>
              </div>
              <div className="json-help-arrow"><ArrowRight size={14} /></div>
              <div className="json-help-step json-help-step--student">
                <div className="json-help-step-role">Student</div>
                <div className="json-help-step-action">Exports <code>submission.json</code></div>
                <div className="json-help-step-note">Sends it back to the teacher</div>
              </div>
            </div>
          </div>

          {/* Key point */}
          <div className="json-help-callout">
            Students do not write JSON manually — they use the app to solve the task and click
            <strong> Export Submission</strong> to save their work.
          </div>

          {/* Schema files */}
          <div className="json-help-section">
            <div className="json-help-section-title">Schema files</div>
            <p className="json-help-p">
              The following JSON Schema files define the format for each file type.
              They are used internally by the app to validate imported files.
            </p>
            <ul className="json-help-schema-list">
              {SCHEMA_FILES.map((s) => (
                <li key={s.label} className="json-help-schema-item">
                  <code>{s.label}</code>
                  <span className="json-help-schema-path">{s.path}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* Downloads */}
          <div className="json-help-section">
            <div className="json-help-section-title">Download examples</div>
            <div className="json-help-downloads">
              <button className="btn-secondary btn-sm" onClick={onDownloadExampleTopology}>
                <Download size={12} /> Example topology JSON
              </button>
              <span className="json-help-download-note">
                Use <strong>Create Assignment → Export JSON</strong> in Teacher Workspace to get a full assignment example.
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default JsonHelpModal;
