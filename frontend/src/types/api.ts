// Mirrors the actual backend response shapes — see backend/app/main.py's
// _serialize_project / _serialize_task, and backend/app/db.py's schema.
// Keep in sync by hand; the backend has no OpenAPI/codegen step in v1.

export interface Project {
  id: string;
  workspace_path: string | null;
  created_at: string;
}

export type TaskStatus =
  | "running"
  | "awaiting_clarification"
  | "context_ready"
  | "investigating"
  | "awaiting_requirements_clarification"
  | "requirements_ready"
  | "planning_tasks"
  | "awaiting_tasks_clarification"
  | "tasks_ready"
  | "completed"
  | "failed";

export type Mastermind = "frontend" | "backend" | "devops" | "architect";

export interface Task {
  id: string;
  project_id: string;
  prompt: string;
  status: TaskStatus;
  feature_slug: string | null;
  masterminds: Mastermind[] | null;
  context_confirmed_at: string | null;
  requirements_approved_at: string | null;
  tasks_approved_at: string | null;
  pending_questions: string[] | null;
  error: string | null;
}

export type TaskItemStatus = "pending" | "in_progress" | "awaiting_review" | "done" | "blocked";

export interface TaskItemLatestRun {
  id: string;
  status: RunStatus;
  diff: string | null;
  summary: string | null;
}

export interface TaskItem {
  item_id: string;
  slug: string;
  description: string;
  assistant: string;
  status: TaskItemStatus;
  blocked_reason: string | null;
  latest_run: TaskItemLatestRun | null;
}

export type RunStage = "context" | "requirements" | "tasks" | "execution";
export type RunStatus = "running" | "completed" | "failed";

export interface Run {
  id: string;
  task_id: string;
  stage: RunStage;
  item_id: string | null;
  status: RunStatus;
  diff: string | null;
  summary: string | null;
}

export type TaskFileStatus = "approved" | "awaiting_approval" | "draft";

export interface TaskFile {
  name: string;
  path: string;
  status: TaskFileStatus;
  modified_at: string | null;
}

export interface AssistantInfo {
  name: string;
  configured: boolean;
}
