import { useState } from "react";
import { Badge, Button, DiffSummaryChip, DiffViewer, PromptInput, SectionLabel, StatusBanner } from "@/components";
import type { BadgeVariant } from "@/components";
import { approveAssistant, reviewArtifact } from "@/lib/api";
import { parseDiff } from "@/lib/parseDiff";
import type { Task, TaskItem, TaskItemStatus } from "@/types/api";
import { InFlightView } from "./InFlightView";

const BADGE_BY_ITEM_STATUS: Record<TaskItemStatus, { variant: BadgeVariant; label: string }> = {
  pending: { variant: "neutral", label: "Pending" },
  in_progress: { variant: "info", label: "In Progress" },
  awaiting_review: { variant: "warning", label: "Awaiting Review" },
  done: { variant: "success", label: "Done" },
  blocked: { variant: "error", label: "Blocked" },
};

interface ExecutionViewProps {
  task: Task;
  items: TaskItem[] | undefined;
  onRefetch: () => void;
  onRunStarted: (runId: string) => void;
}

/**
 * No Override Assistant picker yet — that needs a dropdown/modal pattern this component
 * library doesn't have (deliberately not building one just for this), so items run with
 * their Mastermind-recommended Assistant only. Approve-assistant's override param is
 * already there on the backend whenever this gets built.
 */
export function ExecutionView({ task, items, onRefetch, onRunStarted }: ExecutionViewProps) {
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [feedback, setFeedback] = useState("");
  const [showFeedbackForm, setShowFeedbackForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const inProgress = items?.find((item) => item.status === "in_progress");
  const awaitingReview = items?.find((item) => item.status === "awaiting_review");
  const blocked = items?.find((item) => item.status === "blocked");
  const actionable = awaitingReview ?? blocked;
  const nextPending = items?.find((item) => item.status === "pending");
  const parsedFiles = actionable?.latest_run?.diff ? parseDiff(actionable.latest_run.diff) : [];
  const activeFile = parsedFiles.find((file) => file.filename === selectedFile) ?? parsedFiles[0];

  async function handleRunAssistant() {
    setSubmitting(true);
    setError(null);
    try {
      const result = await approveAssistant(task.id);
      onRunStarted(result.run_id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start Assistant.");
      setSubmitting(false);
    }
  }

  async function handleApprove() {
    setSubmitting(true);
    setError(null);
    try {
      await reviewArtifact(task.id, true);
      setSelectedFile(null);
      onRefetch();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to approve.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleReject() {
    const trimmed = feedback.trim();
    if (!trimmed) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = await reviewArtifact(task.id, false, trimmed);
      setFeedback("");
      setShowFeedbackForm(false);
      setSelectedFile(null);
      if (result.run_id) {
        onRunStarted(result.run_id);
      } else {
        onRefetch();
        setSubmitting(false);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to reject.");
      setSubmitting(false);
    }
  }

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <div style={{ flex: 1, overflowY: "auto", minHeight: 0, display: "flex", flexDirection: "column", gap: 20 }}>
        <div>
          <SectionLabel>Task Items</SectionLabel>
          <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 6 }}>
            {(items ?? []).map((item) => (
              <div key={item.item_id} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <Badge variant={BADGE_BY_ITEM_STATUS[item.status].variant}>
                  {BADGE_BY_ITEM_STATUS[item.status].label}
                </Badge>
                <span style={{ fontSize: "var(--text-body)", color: "var(--text-primary)" }}>{item.slug}</span>
                <span style={{ fontSize: "var(--text-hint)", color: "var(--text-tertiary)" }}>
                  {item.assistant}
                </span>
              </div>
            ))}
          </div>
        </div>

        {error ? (
          <p style={{ color: "var(--error)", margin: 0, fontSize: "var(--text-body)" }}>{error}</p>
        ) : null}

        {inProgress ? (
          <InFlightView
            label={`${inProgress.assistant} Assistant working on ${inProgress.slug}…`}
            onRefetch={onRefetch}
          />
        ) : null}

        {actionable ? (
          <div>
            <SectionLabel>{blocked ? "Blocked" : "Review"}: {actionable.slug}</SectionLabel>

            {blocked ? (
              <div style={{ marginTop: 8 }}>
                <StatusBanner variant="error">{blocked.blocked_reason}</StatusBanner>
              </div>
            ) : null}

            {!blocked && awaitingReview?.latest_run?.summary ? (
              <p style={{ marginTop: 8, color: "var(--text-secondary)", fontSize: "var(--text-body)" }}>
                {awaitingReview.latest_run.summary}
              </p>
            ) : null}

            {!blocked && parsedFiles.length === 0 ? (
              <p style={{ marginTop: 12, color: "var(--text-tertiary)", fontSize: "var(--text-body)" }}>
                No file changes were made.
              </p>
            ) : null}

            {parsedFiles.length > 1 ? (
              <div style={{ display: "flex", gap: 12, marginTop: 8, marginBottom: 12 }}>
                {parsedFiles.map((file) => (
                  <DiffSummaryChip
                    key={file.filename}
                    kind={file.kind}
                    filename={file.filename}
                    added={file.added}
                    removed={file.removed}
                    selected={file.filename === activeFile?.filename}
                    onClick={() => setSelectedFile(file.filename)}
                  />
                ))}
              </div>
            ) : null}

            {activeFile ? (
              <div style={{ marginTop: 12 }}>
                <DiffViewer filename={activeFile.filename} lines={activeFile.lines} />
              </div>
            ) : null}
          </div>
        ) : null}

        {!inProgress && !actionable && nextPending ? (
          <div>
            <Button variant="primary" onClick={handleRunAssistant} disabled={submitting}>
              {submitting ? "Starting…" : `Run ${nextPending.assistant} Assistant`}
            </Button>
          </div>
        ) : null}
      </div>

      {actionable ? (
        <div style={{ flexShrink: 0, borderTop: "1px solid var(--border-hairline)", marginTop: 16, paddingTop: 16 }}>
          {showFeedbackForm ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <PromptInput
                placeholder={
                  blocked
                    ? "Tell the Assistant how to proceed…"
                    : "Describe what needs fixing before this goes back to the Assistant…"
                }
                value={feedback}
                onChange={setFeedback}
                onSubmit={handleReject}
                disabled={submitting}
              />
              <div>
                <Button variant="secondary" onClick={() => setShowFeedbackForm(false)} disabled={submitting}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <div style={{ display: "flex", gap: 12 }}>
              <Button variant="primary" onClick={handleApprove} disabled={submitting}>
                {blocked ? "Mark as Done" : "Approve & Apply Changes"}
              </Button>
              <Button
                variant={blocked ? "secondary" : "destructive"}
                onClick={() => setShowFeedbackForm(true)}
                disabled={submitting}
              >
                {blocked ? "Send Guidance" : "Reject"}
              </Button>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
