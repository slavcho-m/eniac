import type {
  AgentBackend,
  AssistantInfo,
  BashAllowlistEntry,
  BashApproval,
  Mastermind,
  Project,
  ProjectContextFile,
  Run,
  Task,
  TaskAmendment,
  TaskFile,
  TaskItem,
  TaskMode,
  TaskRun,
  WorkspaceCheckResult,
} from "@/types/api";

const BASE_URL = import.meta.env.VITE_BACKEND_URL;

export class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${BASE_URL}${path}`, {
    headers: init?.body ? { "content-type": "application/json" } : undefined,
    ...init,
  });

  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null);
    const detail =
      body && typeof body === "object" && "detail" in body && typeof body.detail === "string"
        ? body.detail
        : response.statusText;
    throw new ApiError(response.status, detail);
  }

  // ponytail: no runtime schema validation (zod etc.) — the backend response shape is
  // trusted as-is, matching types/api.ts by hand. Add validation if the backend ever
  // becomes a less-trusted boundary (e.g. a public API), not needed for a local tool
  // talking to its own backend.
  // eslint-disable-next-line typescript/no-unsafe-type-assertion
  return response.json() as Promise<T>;
}

// --- Agents ---

export function getAgentAvailability(): Promise<Record<AgentBackend, boolean>> {
  return request("/agents/availability");
}

// --- Workspace ---
// Project-independent — both work on a raw path, so they're usable before a project
// exists (NewProjectPage) as well as when editing one (ProjectSettingsDialog).

export function validateWorkspace(path: string): Promise<WorkspaceCheckResult> {
  return request("/workspace/validate", { method: "POST", body: JSON.stringify({ path }) });
}

export function initWorkspaceGit(path: string): Promise<WorkspaceCheckResult> {
  return request("/workspace/init-git", { method: "POST", body: JSON.stringify({ path }) });
}

// --- Projects ---

export function createProject(
  name: string,
  workspacePath?: string,
  description?: string,
): Promise<Project> {
  return request("/projects", {
    method: "POST",
    body: JSON.stringify({ name, workspace_path: workspacePath, description }),
  });
}

export function listProjects(): Promise<Project[]> {
  return request("/projects");
}

export function getProject(projectId: string): Promise<Project> {
  return request(`/projects/${projectId}`);
}

export function updateProject(projectId: string, workspacePath: string | null): Promise<Project> {
  return request(`/projects/${projectId}`, {
    method: "PATCH",
    body: JSON.stringify({ workspace_path: workspacePath }),
  });
}

export function refreshProjectContext(projectId: string): Promise<{ run_id: string }> {
  return request(`/projects/${projectId}/refresh-context`, { method: "POST" });
}

export function getProjectContextFiles(projectId: string): Promise<ProjectContextFile[]> {
  return request(`/projects/${projectId}/context-files`);
}

export function deleteProjectContextFile(projectId: string, path: string): Promise<{ path: string; deleted: true }> {
  return request(`/projects/${projectId}/context-files?path=${encodeURIComponent(path)}`, { method: "DELETE" });
}

export function deleteProject(
  projectId: string,
  deletePpm: boolean,
): Promise<{ id: string; deleted: true }> {
  return request(`/projects/${projectId}?confirm=true&delete_ppm=${deletePpm}`, { method: "DELETE" });
}

// --- Tasks ---

export function createTask(
  projectId: string,
  prompt: string,
  repoScope?: string,
  imagePaths?: string[],
  mode?: TaskMode,
  agent?: AgentBackend,
): Promise<{ task_id: string; run_id: string }> {
  return request(`/projects/${projectId}/tasks`, {
    method: "POST",
    body: JSON.stringify({ prompt, repo_scope: repoScope, image_paths: imagePaths, mode, agent }),
  });
}

// Bypasses the shared `request()` helper — it force-sets `content-type: application/json`,
// which breaks a multipart boundary. The browser sets its own header for FormData bodies.
export async function uploadProjectImage(projectId: string, file: File): Promise<{ path: string }> {
  const formData = new FormData();
  formData.append("file", file);
  const response = await fetch(`${BASE_URL}/projects/${projectId}/images`, {
    method: "POST",
    body: formData,
  });
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null);
    const detail =
      body && typeof body === "object" && "detail" in body && typeof body.detail === "string"
        ? body.detail
        : response.statusText;
    throw new ApiError(response.status, detail);
  }
  return response.json();
}

export function getTask(taskId: string): Promise<Task> {
  return request(`/tasks/${taskId}`);
}

export function listProjectTasks(projectId: string): Promise<Task[]> {
  return request(`/projects/${projectId}/tasks`);
}

export function deleteTask(taskId: string): Promise<{ id: string; deleted: true }> {
  return request(`/tasks/${taskId}`, { method: "DELETE" });
}

// --- Task lifecycle actions ---

export function respondToTask(
  taskId: string,
  answer: string,
  imagePaths?: string[],
): Promise<{ task_id: string; run_id: string }> {
  return request(`/tasks/${taskId}/respond`, {
    method: "POST",
    body: JSON.stringify({ answer, image_paths: imagePaths }),
  });
}

export function retryTask(taskId: string): Promise<{ task_id: string; run_id: string }> {
  return request(`/tasks/${taskId}/retry`, { method: "POST" });
}

export function confirmContext(
  taskId: string,
): Promise<{ task_id: string; context_confirmed_at: string; run_id: string }> {
  return request(`/tasks/${taskId}/confirm-context`, { method: "POST" });
}

export function approveRequirements(
  taskId: string,
): Promise<{ task_id: string; requirements_approved_at: string; run_id: string }> {
  return request(`/tasks/${taskId}/approve-requirements`, { method: "POST" });
}

export function approveTasks(taskId: string): Promise<{ task_id: string; tasks_approved_at: string }> {
  return request(`/tasks/${taskId}/approve-tasks`, { method: "POST" });
}

export function rejectContext(taskId: string, feedback: string): Promise<{ task_id: string; run_id: string }> {
  return request(`/tasks/${taskId}/reject-context`, {
    method: "POST",
    body: JSON.stringify({ feedback }),
  });
}

export function rejectRequirements(taskId: string, feedback: string): Promise<{ task_id: string; run_id: string }> {
  return request(`/tasks/${taskId}/reject-requirements`, {
    method: "POST",
    body: JSON.stringify({ feedback }),
  });
}

export function rejectTasks(taskId: string, feedback: string): Promise<{ task_id: string; run_id: string }> {
  return request(`/tasks/${taskId}/reject-tasks`, {
    method: "POST",
    body: JSON.stringify({ feedback }),
  });
}

export function approvePatch(taskId: string): Promise<{ task_id: string; status: string }> {
  return request(`/tasks/${taskId}/approve-patch`, { method: "POST" });
}

export function rejectPatch(taskId: string, feedback: string): Promise<{ task_id: string; run_id: string }> {
  return request(`/tasks/${taskId}/reject-patch`, {
    method: "POST",
    body: JSON.stringify({ feedback }),
  });
}

export function getPatchReview(taskId: string): Promise<{ diff: string; summary: string | null }> {
  return request(`/tasks/${taskId}/patch-review`);
}

export function approveAssistant(
  taskId: string,
  assistant?: string,
): Promise<{ task_id: string; item_id: string; assistant: string; run_id: string }> {
  return request(`/tasks/${taskId}/approve-assistant`, {
    method: "POST",
    body: assistant ? JSON.stringify({ assistant }) : undefined,
  });
}

export function reviewArtifact(
  taskId: string,
  approved: boolean,
  feedback?: string,
): Promise<{ task_id: string; item_id: string; status: string; task_completed?: boolean; run_id?: string }> {
  return request(`/tasks/${taskId}/review-artifact`, {
    method: "POST",
    body: JSON.stringify({ approved, feedback }),
  });
}

// --- Task-list amendments ---

export function getTaskAmendment(taskId: string): Promise<TaskAmendment> {
  return request(`/tasks/${taskId}/amendment`);
}

export function approveAmendment(
  taskId: string,
): Promise<{ task_id: string; new_item_ids: string[]; deprecated_item_ids: string[] }> {
  return request(`/tasks/${taskId}/approve-amendment`, { method: "POST" });
}

export function rejectAmendment(taskId: string, feedback: string): Promise<{ task_id: string; run_id: string }> {
  return request(`/tasks/${taskId}/reject-amendment`, {
    method: "POST",
    body: JSON.stringify({ feedback }),
  });
}

export function consultMastermind(taskId: string, message: string): Promise<{ task_id: string; run_id: string }> {
  return request(`/tasks/${taskId}/consult-mastermind`, {
    method: "POST",
    body: JSON.stringify({ message }),
  });
}

// --- Runs ---

export function getRun(runId: string): Promise<Run> {
  return request(`/runs/${runId}`);
}

export function runStreamUrl(runId: string): string {
  return `${BASE_URL.replace(/^http/, "ws")}/runs/${runId}/stream`;
}

// --- Task items ---

export function getTaskItems(taskId: string): Promise<TaskItem[]> {
  return request(`/tasks/${taskId}/items`);
}

export function getTaskDiff(taskId: string): Promise<{ diff: string }> {
  return request(`/tasks/${taskId}/diff`);
}

export function getTaskRuns(taskId: string): Promise<TaskRun[]> {
  return request(`/tasks/${taskId}/runs`);
}

// --- Files ---

export function getTaskFiles(taskId: string): Promise<TaskFile[]> {
  return request(`/tasks/${taskId}/files`);
}

export function readFile(path: string): Promise<{ path: string; content: string }> {
  return request(`/files?path=${encodeURIComponent(path)}`);
}

export function writeFile(path: string, content: string): Promise<{ path: string; written: true }> {
  return request(`/files?path=${encodeURIComponent(path)}`, {
    method: "PUT",
    body: JSON.stringify({ content }),
  });
}

export function getGettingStarted(): Promise<{ content: string }> {
  return request("/docs/getting-started");
}

/** Absolute (cross-origin, backend-hosted) URL for an image referenced by
 * GETTING_STARTED.md -- used to rewrite the doc's repo-relative `images/foo.jpg` srcs,
 * which otherwise resolve against the frontend's own origin/route, not the backend. */
export function docsImageUrl(filename: string): string {
  return `${BASE_URL}/docs/images/${encodeURIComponent(filename)}`;
}

// --- Agent config ---

export function listMasterminds(): Promise<Mastermind[]> {
  return request("/agents/masterminds");
}

export function listMastermindAssistants(mastermind: string): Promise<AssistantInfo[]> {
  return request(`/agents/masterminds/${mastermind}/assistants`);
}

// --- Bash approvals ---

export function listPendingBashApprovals(): Promise<BashApproval[]> {
  return request("/bash-approvals/pending");
}

export function decideBashApproval(
  approvalId: string,
  decision: "approve" | "deny",
  allowlistPattern?: string,
  feedback?: string,
): Promise<BashApproval> {
  return request(`/bash-approvals/${approvalId}/decide`, {
    method: "POST",
    body: JSON.stringify({ decision, allowlist_pattern: allowlistPattern, feedback }),
  });
}

export function listBashAllowlist(): Promise<BashAllowlistEntry[]> {
  return request("/bash-allowlist");
}

export function addBashAllowlistEntry(pattern: string): Promise<BashAllowlistEntry> {
  return request("/bash-allowlist", {
    method: "POST",
    body: JSON.stringify({ pattern }),
  });
}

export function deleteBashAllowlistEntry(entryId: string): Promise<{ id: string; deleted: true }> {
  return request(`/bash-allowlist/${entryId}`, { method: "DELETE" });
}
