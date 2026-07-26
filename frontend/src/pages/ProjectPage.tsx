import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { AppShell, PromptInput, SectionLabel } from "@/components";
import { Sidebar } from "@/layout/Sidebar";
import { ApiError, createTask } from "@/lib/api";
import { LiveRunView } from "./TaskDetailPage/LiveRunView";

interface PendingTask {
  taskId: string;
  runId: string;
}

/**
 * Route: "/projects/:projectId" — the entry point for the whole pipeline: the user's raw
 * prompt is where every Task starts (per ARCHITECTURE.md §3, step 1). Everything downstream
 * of this (requirements.md, tasks.md, execution) is agent-authored / user-approved, but this
 * first submission is the one thing that's genuinely the user's to write.
 */
export function ProjectPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const [prompt, setPrompt] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingTask | null>(null);

  async function handleSubmit() {
    if (!projectId) return;
    const trimmed = prompt.trim();
    if (!trimmed) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = await createTask(projectId, trimmed);
      setPending({ taskId: result.task_id, runId: result.run_id });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to create task.");
      setSubmitting(false);
    }
  }

  function handleRunFinished() {
    if (pending) void navigate(`/projects/${projectId}/tasks/${pending.taskId}`);
  }

  return (
    <AppShell left={<Sidebar />}>
      {pending ? (
        <LiveRunView runId={pending.runId} onFinished={handleRunFinished} />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
          <div>
            <SectionLabel>New Task</SectionLabel>
            <p style={{ color: "var(--text-secondary)", fontSize: "var(--text-body)", marginTop: 6 }}>
              Describe what you&apos;d like Eniac to help with in {projectId}.
            </p>
          </div>
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
            <PromptInput
              placeholder="Add a Stripe webhook handler that validates signatures, updates order status, and writes an audit log entry for every event."
              value={prompt}
              onChange={setPrompt}
              onSubmit={handleSubmit}
              disabled={submitting}
            />
          </div>
        </div>
      )}
    </AppShell>
  );
}
