import { jsPDF } from "jspdf";
import type { Assignment } from "../types/assignment";

export function exportAssignmentPdf(
  assignment: Partial<Assignment> & { title: string },
  options: { includeAnswer?: boolean } = {}
): void {
  const { includeAnswer = false } = options;
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const margin = 20;
  const maxWidth = 170;
  let y = margin;

  const lineH = (sizePt: number) => sizePt * 0.42;

  const newPageIfNeeded = (needed: number) => {
    if (y + needed > 272) {
      doc.addPage();
      y = margin;
    }
  };

  const addHeading = (text: string, sizePt: number) => {
    newPageIfNeeded(lineH(sizePt) + 6);
    doc.setFontSize(sizePt);
    doc.setFont("helvetica", "bold");
    doc.text(text, margin, y);
    y += lineH(sizePt) + 5;
  };

  const addBody = (text: string, sizePt = 11) => {
    doc.setFontSize(sizePt);
    doc.setFont("helvetica", "normal");
    const lines = doc.splitTextToSize(text, maxWidth) as string[];
    const blockH = lines.length * lineH(sizePt) + 2;
    newPageIfNeeded(blockH);
    doc.text(lines, margin, y);
    y += blockH;
  };

  const gap = (h = 5) => { y += h; };

  // Teacher-version banner
  if (includeAnswer) {
    doc.setFillColor(255, 235, 235);
    doc.rect(0, 0, 210, 11, "F");
    doc.setFontSize(8);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(180, 0, 0);
    doc.text("TEACHER VERSION — contains expected solution. Do not distribute to students.", margin, 7);
    doc.setTextColor(0, 0, 0);
    y = 18;
  }

  // Title
  addHeading(assignment.title || "Untitled", 18);

  // Meta row
  const meta: string[] = [];
  if (assignment.course) meta.push(`Course: ${assignment.course}`);
  if (assignment.topic) meta.push(`Topic: ${assignment.topic}`);
  if (assignment.mode) meta.push(`Mode: ${assignment.mode}`);
  if (meta.length) { addBody(meta.join("   ·   "), 10); gap(4); }

  // Overview
  if (assignment.description) {
    addHeading("Overview", 13);
    addBody(assignment.description);
    gap();
  }

  // Task prompt
  if (assignment.studentTask?.prompt) {
    addHeading("Task", 13);
    addBody(assignment.studentTask.prompt);
    gap();
  }

  // Instructions
  if (assignment.studentTask?.instructions) {
    addHeading("Instructions", 13);
    assignment.studentTask.instructions
      .split("\n")
      .filter((l) => l.trim())
      .forEach((l) => addBody(l));
    gap();
  }

  // Starter network summary
  if (assignment.starterNetwork) {
    const n = assignment.starterNetwork;
    addHeading("Starter Network", 13);
    addBody(
      `Topology: ${n.topologyType}   ·   Nodes: ${n.nodes?.length ?? 0}   ·   Links: ${n.links?.length ?? 0}   ·   Demands: ${n.demands?.length ?? 0}`
    );
    gap();
  }

  // Allowed algorithms
  if (assignment.allowedAlgorithms?.length) {
    addBody(`Allowed algorithms: ${assignment.allowedAlgorithms.join(", ")}`);
    gap();
  }

  // Task type
  if (assignment.studentTask?.taskType) {
    addBody(`Task type: ${assignment.studentTask.taskType}`);
    gap();
  }

  // Answer format
  if (assignment.studentTask?.answerFormatDescription) {
    addHeading("Answer format", 13);
    addBody(assignment.studentTask.answerFormatDescription);
    gap();
  }

  // Expected solution (teacher version only)
  if (includeAnswer && assignment.expectedSolution) {
    gap(6);
    addHeading("Expected Solution", 13);
    const sol = JSON.stringify(assignment.expectedSolution, null, 2).slice(0, 1200);
    addBody(sol, 9);
    if (assignment.gradingRules) {
      gap(3);
      addBody(`Max score: ${assignment.gradingRules.maxScore ?? 100}`, 10);
    }
  }

  // Footer on every page
  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(160, 160, 160);
    doc.text(
      `Network Algorithm Lab  ·  ${new Date().toLocaleDateString()}  ·  Page ${i} of ${pageCount}`,
      margin,
      291
    );
    doc.setTextColor(0, 0, 0);
  }

  doc.save(`${(assignment.title || "assignment").replace(/\s+/g, "_")}.pdf`);
}
