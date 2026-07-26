import { useState } from "react";
import { Button, StatusBanner } from "@/components";
import { approveRequirements, approveTasks, confirmContext } from "@/lib/api";
import type { Task } from "@/types/api";

export type ConfirmStage = "context" | "requirements" | "tasks";

const LABEL_BY_STAGE: Record<ConfirmStage, { banner: string; button: string }> = {
  context: { banner: "Awaiting your approval on context.md", button: "Confirm & Continue" },
  requirements: { banner: "Awaiting your approval on requirements.md", button: "Approve Requirements" },
  tasks: { banner: "Awaiting your approval on tasks.md", button: "Approve Tasks" },
};

// approve-tasks doesn't auto-start anything (no next run until the user separately
// approves an Assistant for the first task item), so it has no run_id to stream —
// wrapped to resolve to `{}` (a valid value of `{ run_id?: string }`) instead of its
// own unrelated shape, so all three actions share one call signature here.
const ACTION_BY_STAGE: Record<ConfirmStage, (taskId: string) => Promise<{ run_id?: string }>> = {
  context: confirmContext,
  requirements: approveRequirements,
  tasks: (taskId) => approveTasks(taskId).then(() => ({})),
};

interface ConfirmGateViewProps {
  task: Task;
  stage: ConfirmStage;
  onRefetch: () => void;
  onRunStarted: (runId: string) => void;
}

export function ConfirmGateView({ task, stage, onRefetch, onRunStarted }: ConfirmGateViewProps) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const label = LABEL_BY_STAGE[stage];

  async function handleConfirm() {
    setSubmitting(true);
    setError(null);
    try {
      const result = await ACTION_BY_STAGE[stage](task.id);
      // The backend sets context_confirmed_at/requirements_approved_at synchronously,
      // before the next run even starts — refetch immediately so FilesPanel (rendered
      // independently in AppShell's right column, not occluded by LiveRunView) reflects
      // that right away instead of staying stale for the whole run's duration.
      onRefetch();
      if (result.run_id) {
        onRunStarted(result.run_id);
      } else {
        setSubmitting(false);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to confirm.");
      setSubmitting(false);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <StatusBanner variant="warning">{label.banner}</StatusBanner>
      {error ? (
        <p style={{ color: "var(--error)", margin: 0, fontSize: "var(--text-body)" }}>{error}</p>
      ) : null}
      <div>
        <Button variant="primary" onClick={handleConfirm} disabled={submitting}>
          {submitting ? "Working…" : label.button}
        </Button>
      </div>
    </div>
  );
}
