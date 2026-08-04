import { X } from "lucide-react";
import { useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { AppShell, Badge, Button, ModeSelect, PromptInput, SectionLabel } from "@/components";
import type { TaskMode } from "@/components";
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
  const [prompt, setPrompt] = useState("");
  const [mode, setMode] = useState<TaskMode>("ship");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingTask | null>(null);
  const [refreshRunId, setRefreshRunId] = useState<string | null>(null);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const { images, handleFilesSelected, removeImage, imagePaths, imagesStillUploading } =
    useImageAttachments(projectId);
  const fileInputRef = useRef<HTMLInputElement>(null);

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
      const result = await createTask(projectId, trimmed, selectedNode ?? undefined, imagePaths, mode);
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
                <ModeSelect value={mode} onChange={setMode} disabled={submitting || imagesStillUploading} />
              }
              disabled={submitting || imagesStillUploading}
            />
          </div>
        </div>
      )}
    </AppShell>
  );
}
