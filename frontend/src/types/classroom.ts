export interface DemoStudent {
  studentId: string;
  name: string;
}

export interface AssignedWork {
  assignedWorkId: string;
  workType: "assignment" | "challenge";
  workId: string;
  workTitle: string;
  workTopic?: string;
  workMode?: string;
  assignedTo: string[] | "all";
  assignedAt: string;
  dueDate?: string;
}

export interface StudentWorkStatus {
  studentId: string;
  assignedWorkId: string;
  status: "not_started" | "in_progress" | "submitted" | "checked";
  score?: number;
  submittedAt?: string;
  attempts: number;
  hintsUsed?: number;
}
