import { useState } from "react";
import { Button, FeedbackForm, StatusBanner } from "@/components";
import {
  approveRequirements,
  approveTasks,
  confirmContext,
  rejectContext,
  rejectRequirements,
  rejectTasks,
} from "@/lib/api";
import type { Task } from "@/types/api";

export type ConfirmStage = "context" | "requirements" | "tasks";

const LABEL_BY_STAGE: Record<ConfirmStage, { banner: string; button: string; feedbackPlaceholder: string }> = {
  context: {
    banner: "Awaiting your approval on context.md",
    button: "Confirm & Continue",
    feedbackPlaceholder: "Describe what should change about this context/plan…",
  },
  requirements: {
    banner: "Awaiting your approval on requirements.md",
    button: "Approve Requirements",
    feedbackPlaceholder: "Describe what should change about these requirements…",
  },
  tasks: {
    banner: "Awaiting your approval on tasks.md",
    button: "Approve Tasks",
    feedbackPlaceholder: "Describe what should change about this task breakdown…",
  },
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

const REJECT_ACTION_BY_STAGE: Record<ConfirmStage, (taskId: string, feedback: string) => Promise<{ run_id: string }>> = {
  context: rejectContext,
  requirements: rejectRequirements,
  tasks: rejectTasks,
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
  const [showFeedbackForm, setShowFeedbackForm] = useState(false);
  const [feedback, setFeedback] = useState("");
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

  async function handleReject() {
    const trimmed = feedback.trim();
    if (!trimmed) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = await REJECT_ACTION_BY_STAGE[stage](task.id, trimmed);
      setFeedback("");
      setShowFeedbackForm(false);
      onRunStarted(result.run_id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to reject.");
      setSubmitting(false);
    }
  }

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", gap: 16 }}>
      <StatusBanner variant="warning">{label.banner}</StatusBanner>
      {error ? (
        <p style={{ color: "var(--error)", margin: 0, fontSize: "var(--text-body)" }}>{error}</p>
      ) : null}
      <div style={{ marginTop: "auto" }}>
        {showFeedbackForm ? (
          <FeedbackForm
            placeholder={label.feedbackPlaceholder}
            value={feedback}
            onChange={setFeedback}
            onSubmit={handleReject}
            onCancel={() => {
              setShowFeedbackForm(false);
              setFeedback("");
              setError(null);
            }}
            disabled={submitting}
          />
        ) : (
          <div style={{ display: "flex", gap: 12 }}>
            <Button variant="primary" onClick={handleConfirm} disabled={submitting}>
              {submitting ? "Working…" : label.button}
            </Button>
            <Button variant="destructive" onClick={() => setShowFeedbackForm(true)} disabled={submitting}>
              Reject
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
