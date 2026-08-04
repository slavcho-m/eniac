import { X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { AgentSelect, AppShell, Badge, Button, ModeSelect, PromptInput, SectionLabel } from "@/components";
import type { AgentBackend, TaskMode } from "@/components";
import { useAgentAvailability } from "@/hooks/useAgentAvailability";
import { useImageAttachments } from "@/hooks/useImageAttachments";
import { useProject } from "@/hooks/useProject";
import { Sidebar } from "@/layout/Sidebar";
import { ApiError, createTask, refreshProjectContext } from "@/lib/api";
import { FilesPanel } from "../TaskDetailPage/FilesPanel";
import { LiveRunView } from "../TaskDetailPage/LiveRunView";
import { RepoGraph } from "./RepoGraph";

interface PendingTask {
  taskId: string;
  runId: string;
}

// Submitting a task navigates away to the new task's detail page (see handleRunFinished
// below) -- ProjectPage unmounts, so plain useState alone forgets the user's last pick the
// moment they start their next task. Persisted across that remount (and across reloads)
// rather than lifted into some longer-lived context: this is the only place agent gets
// chosen, so there's nothing else that would need to share the value.
const AGENT_STORAGE_KEY = "eniac.lastAgent";

function readStoredAgent(): AgentBackend {
  return localStorage.getItem(AGENT_STORAGE_KEY) === "codex" ? "codex" : "claude";
}

/**
 * Route: "/projects/:projectId" — the entry point for the whole pipeline: the user's raw
 * prompt is where every Task starts (per ARCHITECTURE.md §3, step 1). Everything downstream
 * of this (requirements.md, tasks.md, execution) is agent-authored / user-approved, but this
 * first submission is the one thing that's genuinely the user's to write.
 *
 * For an orchestrator project (workspace_path wraps multiple child repos — see
 * runs.discover_repos), a RepoGraph is shown above the prompt: picking a node scopes the
 * task to that one child repo (?node= query param, so it survives a refresh); leaving
 * nothing selected creates an orchestrator-root task instead, for anything cross-cutting.
 */
export function ProjectPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { data: project, refetch: refetchProject } = useProject(projectId);
  const { data: agentAvailability } = useAgentAvailability();
  const [prompt, setPrompt] = useState("");
  const [mode, setMode] = useState<TaskMode>("ship");
  const [agent, setAgentState] = useState<AgentBackend>(readStoredAgent);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingTask | null>(null);
  const [refreshRunId, setRefreshRunId] = useState<string | null>(null);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const { images, handleFilesSelected, removeImage, imagePaths, imagesStillUploading } =
    useImageAttachments(projectId);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // The user's stored preference is only worth writing back on an actual pick -- a
  // temporary availability-driven fallback (below) isn't a real choice, and shouldn't
  // clobber e.g. a genuine "codex" preference just because codex happened to be
  // unavailable on this one visit.
  function selectAgent(next: AgentBackend) {
    setAgentState(next);
    localStorage.setItem(AGENT_STORAGE_KEY, next);
  }

  // The stored/default agent is only a reasonable pick once we actually know what's
  // authenticated on this machine — corrects away from it the moment availability loads,
  // so a user with only one CLI logged in never lands on a submit button wired to the one
  // that's guaranteed to fail. Uses setAgentState (not selectAgent): this is a temporary
  // fallback for the current visit, not a new preference to persist. Deliberately excludes
  // `agent` itself from deps: a one-time correction against fresh availability data, not a
  // loop that should re-fire every time the selection changes — AgentSelect already
  // prevents picking a disabled option by hand.
  useEffect(() => {
    if (!agentAvailability || agentAvailability[agent]) return;
    const fallback = (["claude", "codex"] as const).find((candidate) => agentAvailability[candidate]);
    if (fallback) setAgentState(fallback);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentAvailability]);

  const noAgentAvailable =
    agentAvailability != null && !agentAvailability.claude && !agentAvailability.codex;
  const unavailableAgents: Partial<Record<AgentBackend, string>> = agentAvailability
    ? {
        ...(!agentAvailability.claude && { claude: "Not authenticated — run `claude auth login`" }),
        ...(!agentAvailability.codex && { codex: "Not authenticated — run `codex login`" }),
      }
    : {};

  const selectedNode = searchParams.get("node");

  function selectNode(node: string | null) {
    setSearchParams(node ? { node } : {});
  }

  async function handleSubmit() {
    if (!projectId) return;
    const trimmed = prompt.trim();
    if (!trimmed || imagesStillUploading) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = await createTask(projectId, trimmed, selectedNode ?? undefined, imagePaths, mode, agent);
      setPending({ taskId: result.task_id, runId: result.run_id });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to create task.");
      setSubmitting(false);
    }
  }

  function handleRunFinished() {
    if (pending) void navigate(`/projects/${projectId}/tasks/${pending.taskId}`);
  }

  async function handleRefreshContext() {
    if (!projectId) return;
    setRefreshError(null);
    try {
      const { run_id } = await refreshProjectContext(projectId);
      setRefreshRunId(run_id);
    } catch (err) {
      setRefreshError(err instanceof ApiError ? err.message : "Failed to start refresh.");
    }
  }

  function handleRefreshFinished() {
    setRefreshRunId(null);
    refetchProject();
  }

  const scopeLabel = selectedNode ? ` in ${selectedNode}` : "";

  return (
    <AppShell left={<Sidebar />} right={<FilesPanel projectId={projectId} />} defaultRightCollapsed>
      {pending ? (
        <LiveRunView runId={pending.runId} onFinished={handleRunFinished} />
      ) : refreshRunId ? (
        <LiveRunView runId={refreshRunId} onFinished={handleRefreshFinished} />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
          <div>
            <SectionLabel>New Task</SectionLabel>
            <p style={{ color: "var(--text-secondary)", fontSize: "var(--text-body)", marginTop: 6 }}>
              Describe what you&apos;d like Eniac to help with{scopeLabel}.
            </p>
          </div>

          {project ? (
            <div
              style={{
                marginTop: 16,
                paddingTop: 16,
                borderTop: "1px solid var(--border-hairline)",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
              }}
            >
              <div>
                <p style={{ margin: 0, color: "var(--text-secondary)", fontSize: "var(--text-body)" }}>
                  {project.context_refreshed_at
                    ? `Project context last refreshed ${new Date(project.context_refreshed_at).toLocaleString()}.`
                    : "Project context never refreshed — Masterminds and Assistants have no project-wide layout/conventions reference yet."}
                </p>
                {project.tasks_completed_since_context_refresh >= 3 ? (
                  <p style={{ margin: "4px 0 0", color: "var(--warning)", fontSize: "var(--text-body)" }}>
                    {project.tasks_completed_since_context_refresh} tasks completed since the last refresh — it
                    may be out of date.
                  </p>
                ) : null}
                {refreshError ? (
                  <p style={{ margin: "4px 0 0", color: "var(--error)", fontSize: "var(--text-body)" }}>
                    {refreshError}
                  </p>
                ) : null}
              </div>
              <Button variant="secondary" onClick={handleRefreshContext}>
                Refresh Context
              </Button>
            </div>
          ) : null}

          {project?.is_orchestrator ? (
            <div style={{ marginTop: 24 }}>
              <RepoGraph
                rootLabel={project.id}
                repos={project.repos}
                selected={selectedNode}
                onSelect={selectNode}
              />
            </div>
          ) : null}

          <div
            style={{
              marginTop: "auto",
              display: "flex",
              flexDirection: "column",
              gap: 12,
            }}
          >
            {error ? (
              <p style={{ color: "var(--error)", margin: 0, fontSize: "var(--text-body)" }}>{error}</p>
            ) : null}
            {noAgentAvailable ? (
              <p style={{ color: "var(--error)", margin: 0, fontSize: "var(--text-body)" }}>
                Neither Claude nor Codex is authenticated on this machine — run{" "}
                <code>claude auth login</code> or <code>codex login</code> and reload before
                starting a task.
              </p>
            ) : null}
            {images.length > 0 ? (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {images.map((img) => (
                  <Badge key={img.id} variant={img.error ? "error" : "neutral"} title={img.error}>
                    {img.filename}
                    {img.uploading ? "…" : null}
                    <button
                      type="button"
                      onClick={() => removeImage(img.id)}
                      aria-label={`Remove ${img.filename}`}
                      style={{
                        display: "inline-flex",
                        background: "none",
                        border: "none",
                        color: "inherit",
                        cursor: "pointer",
                        padding: 0,
                        marginLeft: 2,
                      }}
                    >
                      <X size={11} strokeWidth={2} />
                    </button>
                  </Badge>
                ))}
              </div>
            ) : null}
            {images.some((img) => img.error) ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                {images
                  .filter((img) => img.error)
                  .map((img) => (
                    <p
                      key={img.id}
                      style={{ color: "var(--error)", margin: 0, fontSize: "var(--text-body)" }}
                    >
                      {img.filename}: {img.error}
                    </p>
                  ))}
              </div>
            ) : null}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              hidden
              onChange={(e) => {
                handleFilesSelected(e.target.files);
                e.target.value = "";
              }}
            />
            <PromptInput
              placeholder="Add a Stripe webhook handler that validates signatures, updates order status, and writes an audit log entry for every event."
              value={prompt}
              onChange={setPrompt}
              onSubmit={handleSubmit}
              onAttach={() => fileInputRef.current?.click()}
              onDropFiles={handleFilesSelected}
              modeSelect={
                <>
                  <ModeSelect
                    value={mode}
                    onChange={setMode}
                    disabled={submitting || imagesStillUploading || noAgentAvailable}
                  />
                  <AgentSelect
                    value={agent}
                    onChange={selectAgent}
                    disabled={submitting || imagesStillUploading}
                    unavailable={unavailableAgents}
                  />
                </>
              }
              disabled={submitting || imagesStillUploading || noAgentAvailable}
            />
          </div>
        </div>
      )}
    </AppShell>
  );
}
