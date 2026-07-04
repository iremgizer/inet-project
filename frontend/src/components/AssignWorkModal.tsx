import React, { useState } from "react";
import { X, Users, User, Calendar } from "lucide-react";
import { AssignedWork } from "../types/classroom";
import { DEMO_STUDENTS } from "../utils/demoUsers";

interface AssignWorkModalProps {
  open: boolean;
  workType: "assignment" | "challenge";
  workId: string;
  workTitle: string;
  workTopic?: string;
  workMode?: string;
  onAssign: (work: AssignedWork) => void;
  onClose: () => void;
}

const AssignWorkModal: React.FC<AssignWorkModalProps> = ({
  open,
  workType,
  workId,
  workTitle,
  workTopic,
  workMode,
  onAssign,
  onClose,
}) => {
  const [assignAll, setAssignAll] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [dueDate, setDueDate] = useState("");

  if (!open) return null;

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const handleAssign = () => {
    const assignedTo: AssignedWork["assignedTo"] = assignAll ? "all" : Array.from(selected);
    if (!assignAll && (assignedTo as string[]).length === 0) return;
    onAssign({
      assignedWorkId: `aw-${Date.now()}`,
      workType,
      workId,
      workTitle,
      workTopic,
      workMode,
      assignedTo,
      assignedAt: new Date().toISOString(),
      dueDate: dueDate || undefined,
    });
    onClose();
  };

  const today = new Date().toISOString().split("T")[0];

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box assign-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title">
            <Users size={15} /> Assign to students
          </div>
          <button className="icon-btn" onClick={onClose} title="Close">
            <X size={15} />
          </button>
        </div>

        <div className="assign-modal-body">
          <div className="assign-work-meta">
            <span className="assign-work-type">{workType}</span>
            <span className="assign-work-title">{workTitle}</span>
            {workTopic && <span className="assign-work-topic">{workTopic}</span>}
          </div>

          <div className="assign-section">
            <label className="assign-toggle-row">
              <input
                type="checkbox"
                checked={assignAll}
                onChange={(e) => { setAssignAll(e.target.checked); setSelected(new Set()); }}
              />
              <Users size={12} />
              <span>Assign to all students ({DEMO_STUDENTS.length})</span>
            </label>
          </div>

          {!assignAll && (
            <div className="assign-student-list">
              {DEMO_STUDENTS.map((s) => (
                <label key={s.studentId} className="assign-student-row">
                  <input
                    type="checkbox"
                    checked={selected.has(s.studentId)}
                    onChange={() => toggle(s.studentId)}
                  />
                  <User size={12} />
                  <span className="assign-student-name">{s.name}</span>
                  <span className="assign-student-id">{s.studentId}</span>
                </label>
              ))}
            </div>
          )}

          <div className="assign-due-row">
            <label className="assign-due-label">
              <Calendar size={12} />
              Due date
              <span className="assign-due-optional">(optional)</span>
            </label>
            <input
              type="date"
              className="assign-due-input"
              value={dueDate}
              min={today}
              onChange={(e) => setDueDate(e.target.value)}
            />
          </div>

          <div className="assign-actions">
            <button className="btn-secondary btn-sm" onClick={onClose}>Cancel</button>
            <button
              className="btn-primary btn-sm"
              onClick={handleAssign}
              disabled={!assignAll && selected.size === 0}
            >
              Assign
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AssignWorkModal;
