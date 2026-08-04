// Mirrors the actual backend response shapes — see backend/app/main.py's
// _serialize_project / _serialize_task, and backend/app/db.py's schema.
// Keep in sync by hand; the backend has no OpenAPI/codegen step in v1.

import type { TaskMode } from "@/components/ModeSelect/ModeSelect";

export interface Project {
  id: string;
  workspace_path: string | null;
  description: string | null;
  created_at: string;
  /** True when workspace_path scans as an orchestrator directory (repos.length > 1 or a
   * single non-root child repo) rather than a single git repo — see backend's
   * runs.discover_repos. */
  is_orchestrator: boolean;
  /** Discovered child repos, relative to workspace_path. ["."] for an ordinary single-repo
   * project (workspace_path itself is the repo), [] if no workspace_path is set. */
  repos: string[];
  context_refreshed_at: string | null;
  /** Completed tasks since context_refreshed_at (or ever, if never refreshed) — backs the
   * "context may be stale" nudge in ProjectSettingsDialog. */
  tasks_completed_since_context_refresh: number;
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
  | "awaiting_reply"
  | "completed"
  | "failed";

export type Mastermind = "frontend" | "backend" | "devops" | "architect";

export interface Task {
  id: string;
  project_id: string;
  prompt: string;
  status: TaskStatus;
  /** "discuss" tasks skip the whole Supervisor/Mastermind pipeline below — see
   * TaskDetailPage's mode branch, which renders DiscussionView instead of renderStage. */
  mode: TaskMode;
  /** Short LLM-generated sidebar label, filled in async shortly after task creation — see
   * useProjectTasks' polling. Null until it resolves (or forever, if generation failed). */
  title: string | null;
  feature_slug: string | null;
  /** Every mastermind the Supervisor recommended, in the order they run. Only the first
   * entry runs at a time -- see current_mastermind for which one that is right now. */
  masterminds: Mastermind[] | null;
  /** Whichever mastermind is actively driving this task right now (masterminds[index] on
   * the backend). Null iff masterminds is null. Use this, not masterminds[0], anywhere
   * that needs "the" mastermind -- a multi-mastermind task cycles through more than one. */
  current_mastermind: Mastermind | null;
  /** Masterminds already completed their pass, in order, each with its own
   * requirements/tasks approval timestamps -- current_mastermind's own approval state
   * lives in requirements_approved_at/tasks_approved_at below until it too advances. */
  mastermind_history: {
    mastermind: Mastermind;
    requirements_approved_at: string | null;
    tasks_approved_at: string | null;
    completed_at: string;
  }[];
  context_confirmed_at: string | null;
  requirements_approved_at: string | null;
  tasks_approved_at: string | null;
  pending_questions: string[] | null;
  error: string | null;
  has_pending_amendment: boolean;
  /** Null for an ordinary/orchestrator-root task; a relative path (matching one of the
   * owning Project's `repos`) if this task was created scoped to one child repo. */
  repo_scope: string | null;
  image_count: number;
  created_at: string;
}

/** One turn of a Discuss-mode conversation — see GET /tasks/:id/runs. `reply` is null for
 * a turn that failed (status "failed") or hasn't completed yet ("running", though that one
 * is filtered out server-side — the in-flight turn is shown live via its own run stream). */
export interface TaskRun {
  run_id: string;
  prompt: string;
  reply: string | null;
  status: "completed" | "failed";
  created_at: string;
}

export type TaskItemStatus =
  | "pending"
  | "in_progress"
  | "awaiting_review"
  | "done"
  | "blocked"
  | "deprecated";

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
  deprecated_reason: string | null;
  depends_on: string[];
  /** Which child repo this item targets, relative to the project's workspace_path.
   * "." for the ordinary case (single-repo project, or a node-scoped task) -- only a real
   * value on an orchestrator-root task whose Mastermind assigned items across repos. */
  repo: string;
  /** Which mastermind's plan produced this item -- null for an item predating this field. */
  mastermind: Mastermind | null;
  latest_run: TaskItemLatestRun | null;
}

export type RunStage = "context" | "requirements" | "tasks" | "execution" | "consultation";
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

export type ContextFileStatus = "populated" | "empty";

export interface ProjectContextFile {
  name: string;
  path: string;
  status: ContextFileStatus;
  modified_at: string | null;
  /** "." for the project/workspace root, or a child repo's relative path for an
   * orchestrator project's per-repo context files. */
  repo: string;
}

export interface AssistantInfo {
  name: string;
  configured: boolean;
}

export type BashApprovalStatus = "pending" | "approved" | "denied" | "allowlisted";

export interface BashApproval {
  id: string;
  run_id: string | null;
  task_id: string | null;
  command: string;
  cwd: string | null;
  status: BashApprovalStatus;
  created_at: string;
  decided_at: string | null;
  feedback: string | null;
}

export interface BashAllowlistEntry {
  id: string;
  pattern: string;
  created_at: string;
}

export type AmendmentSource = "review" | "mastermind";

export interface NewTaskProposal {
  slug: string;
  description: string;
  assistant: string;
  depends_on?: string[];
}

interface AmendmentBase {
  task_id: string;
  source: AmendmentSource;
  origin_item_id: string | null;
  resume_session_id: string;
}

export interface AmendmentClarification extends AmendmentBase {
  kind: "clarification";
  questions: string[];
}

export interface AmendmentProposal extends AmendmentBase {
  kind: "proposal";
  new_tasks: NewTaskProposal[];
  deprecate_item_ids: string[];
  reasoning: string;
  diff: string;
}

export type TaskAmendment = AmendmentClarification | AmendmentProposal;
