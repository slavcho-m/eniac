import type {
  AssistantInfo,
  BashAllowlistEntry,
  BashApproval,
  Mastermind,
  Project,
  Run,
  Task,
  TaskAmendment,
  TaskFile,
  TaskItem,
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

// --- Projects ---

export function createProject(name: string, workspacePath?: string): Promise<Project> {
  return request("/projects", {
    method: "POST",
    body: JSON.stringify({ name, workspace_path: workspacePath }),
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

export function deleteProject(
  projectId: string,
  deletePpm: boolean,
): Promise<{ id: string; deleted: true }> {
  return request(`/projects/${projectId}?confirm=true&delete_ppm=${deletePpm}`, { method: "DELETE" });
}

// --- Tasks ---

export function createTask(projectId: string, prompt: string): Promise<{ task_id: string; run_id: string }> {
  return request(`/projects/${projectId}/tasks`, {
    method: "POST",
    body: JSON.stringify({ prompt }),
  });
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

export function respondToTask(taskId: string, answer: string): Promise<{ task_id: string; run_id: string }> {
  return request(`/tasks/${taskId}/respond`, {
    method: "POST",
    body: JSON.stringify({ answer }),
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
