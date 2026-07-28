import { useEffect, useState } from "react";
import {
  AssistantPicker,
  Badge,
  Button,
  DiffSummaryChip,
  DiffViewer,
  MarkdownText,
  PromptInput,
  SectionLabel,
  StatusBanner,
} from "@/components";
import type { BadgeVariant } from "@/components";
import { approveAssistant, getTaskDiff, reviewArtifact } from "@/lib/api";
import { parseDiff } from "@/lib/parseDiff";
import type { Task, TaskItem, TaskItemStatus } from "@/types/api";
import { InFlightView } from "./InFlightView";

const BADGE_BY_ITEM_STATUS: Record<TaskItemStatus, { variant: BadgeVariant; label: string }> = {
  pending: { variant: "neutral", label: "Pending" },
  in_progress: { variant: "info", label: "In Progress" },
  awaiting_review: { variant: "warning", label: "Awaiting Review" },
  done: { variant: "success", label: "Done" },
  blocked: { variant: "error", label: "Blocked" },
  deprecated: { variant: "deprecated", label: "Deprecated" },
};

interface ExecutionViewProps {
  task: Task;
  items: TaskItem[] | undefined;
  onRefetch: () => void;
  onRunStarted: (runId: string, assistant?: string) => void;
}

// What diff is currently shown: the item awaiting the user's decision ("actionable" — the
// only mode with Approve/Reject controls), a past item's own stored diff replayed read-only
// ("item"), or every item's changes combined ("all", fetched on demand from the backend
// since — unlike a single item's diff — it isn't cached on any TaskItem already in hand).
type ViewMode = { kind: "actionable" } | { kind: "item"; itemId: string } | { kind: "all" };

export function ExecutionView({ task, items, onRefetch, onRunStarted }: ExecutionViewProps) {
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>({ kind: "actionable" });
  const [allDiff, setAllDiff] = useState<string | null>(null);
  const [allDiffLoading, setAllDiffLoading] = useState(false);
  const [allDiffError, setAllDiffError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState("");
  const [showFeedbackForm, setShowFeedbackForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  const mastermind = task.masterminds?.[0];
  const inProgress = items?.find((item) => item.status === "in_progress");
  const awaitingReview = items?.find((item) => item.status === "awaiting_review");
  const blocked = items?.find((item) => item.status === "blocked");
  const actionable = awaitingReview ?? blocked;
  const nextPending = items?.find((item) => item.status === "pending");
  const hasAnyDiff = items?.some((item) => item.latest_run?.diff) ?? false;

  // A later item's diff can touch files an earlier item already changed — reset back to
  // reviewing whichever item actually needs a decision whenever that target changes, so a
  // stale historical/combined view doesn't linger in front of the Approve/Reject controls.
  useEffect(() => {
    setViewMode({ kind: "actionable" });
    setSelectedFile(null);
  }, [actionable?.item_id]);

  const viewedItem = viewMode.kind === "item" ? items?.find((item) => item.item_id === viewMode.itemId) : undefined;

  const viewedDiff =
    viewMode.kind === "all" ? allDiff : viewMode.kind === "item" ? (viewedItem?.latest_run?.diff ?? null) : (actionable?.latest_run?.diff ?? null);

  const parsedFiles = viewedDiff ? parseDiff(viewedDiff) : [];
  const activeFile = parsedFiles.find((file) => file.filename === selectedFile) ?? parsedFiles[0];

  const headerLabel =
    viewMode.kind === "all"
      ? "All Changes"
      : viewMode.kind === "item"
        ? viewedItem?.slug
        : actionable
          ? `${blocked ? "Blocked" : "Review"}: ${actionable.slug}`
          : null;

  const summaryText =
    viewMode.kind === "item"
      ? viewedItem?.latest_run?.summary
      : viewMode.kind === "actionable" && !blocked
        ? awaitingReview?.latest_run?.summary
        : undefined;

  function selectItemRow(item: TaskItem) {
    if (item.item_id === actionable?.item_id) {
      setViewMode({ kind: "actionable" });
    } else if (item.latest_run?.diff) {
      setViewMode({ kind: "item", itemId: item.item_id });
    }
    setSelectedFile(null);
  }

  async function handleViewAll() {
    setViewMode({ kind: "all" });
    setSelectedFile(null);
    setAllDiffError(null);
    setAllDiffLoading(true);
    try {
      const result = await getTaskDiff(task.id);
      setAllDiff(result.diff);
    } catch (err) {
      setAllDiffError(err instanceof Error ? err.message : "Failed to load combined diff.");
    } finally {
      setAllDiffLoading(false);
    }
  }

  async function handleRunAssistant(override?: string) {
    setSubmitting(true);
    setError(null);
    try {
      const result = await approveAssistant(task.id, override);
      onRunStarted(result.run_id, override ?? nextPending?.assistant);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start Assistant.");
      setSubmitting(false);
    }
  }

  function handleConfirmOverride(assistant: string) {
    setPickerOpen(false);
    void handleRunAssistant(assistant);
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
        onRunStarted(result.run_id, actionable?.assistant);
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
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <SectionLabel>Task Items</SectionLabel>
            {hasAnyDiff ? (
              <Button variant="secondary" onClick={handleViewAll} disabled={allDiffLoading}>
                {viewMode.kind === "all" ? "Viewing All Changes" : "View All Changes"}
              </Button>
            ) : null}
          </div>
          <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 6 }}>
            {(items ?? []).map((item) => {
              const clickable = item.item_id === actionable?.item_id || Boolean(item.latest_run?.diff);
              const active =
                (viewMode.kind === "actionable" && item.item_id === actionable?.item_id) ||
                (viewMode.kind === "item" && viewMode.itemId === item.item_id);
              return (
                <button
                  key={item.item_id}
                  type="button"
                  onClick={clickable ? () => selectItemRow(item) : undefined}
                  disabled={!clickable}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    background: "none",
                    border: "none",
                    padding: "2px 0",
                    font: "inherit",
                    textAlign: "left",
                    cursor: clickable ? "pointer" : "default",
                    opacity: clickable ? (active ? 1 : 0.85) : 0.6,
                  }}
                >
                  <Badge variant={BADGE_BY_ITEM_STATUS[item.status].variant}>
                    {BADGE_BY_ITEM_STATUS[item.status].label}
                  </Badge>
                  <span style={{ fontSize: "var(--text-body)", color: "var(--text-primary)" }}>{item.slug}</span>
                  <span style={{ fontSize: "var(--text-hint)", color: "var(--text-tertiary)" }}>
                    {item.assistant}
                  </span>
                  {item.repo !== "." ? (
                    <span style={{ fontSize: "var(--text-hint)", color: "var(--text-tertiary)" }}>
                      {item.repo}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        </div>

        {error ? (
          <p style={{ color: "var(--error)", margin: 0, fontSize: "var(--text-body)" }}>{error}</p>
        ) : null}

        {inProgress ? (
          <InFlightView
            label={`${inProgress.assistant} Assistant working on ${inProgress.slug}…`}
            onRefetch={onRefetch}
            runId={inProgress.latest_run?.id}
            assistantLabel={inProgress.assistant}
          />
        ) : null}

        {headerLabel ? (
          <div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <SectionLabel>{headerLabel}</SectionLabel>
              {viewMode.kind !== "actionable" ? (
                <Button variant="ghost" onClick={() => setViewMode({ kind: "actionable" })}>
                  Back to Review
                </Button>
              ) : null}
            </div>

            {viewMode.kind === "actionable" && blocked ? (
              <div style={{ marginTop: 8 }}>
                <StatusBanner variant="error">{blocked.blocked_reason}</StatusBanner>
              </div>
            ) : null}

            {summaryText ? (
              <div style={{ marginTop: 8 }}>
                <MarkdownText>{summaryText}</MarkdownText>
              </div>
            ) : null}

            {viewMode.kind === "all" && allDiffLoading ? (
              <p style={{ marginTop: 12, color: "var(--text-tertiary)", fontSize: "var(--text-body)" }}>
                Loading…
              </p>
            ) : null}

            {viewMode.kind === "all" && allDiffError ? (
              <p style={{ marginTop: 12, color: "var(--error)", fontSize: "var(--text-body)" }}>{allDiffError}</p>
            ) : null}

            {!allDiffLoading && !(viewMode.kind === "actionable" && blocked) && parsedFiles.length === 0 ? (
              <p style={{ marginTop: 12, color: "var(--text-tertiary)", fontSize: "var(--text-body)" }}>
                No file changes were made.
              </p>
            ) : null}

            {parsedFiles.length > 1 ? (
              <div
                style={{
                  display: "flex",
                  gap: 12,
                  marginTop: 8,
                  marginBottom: 12,
                  overflowX: "auto",
                  paddingBottom: 4,
                }}
              >
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
          <div style={{ display: "flex", gap: 12 }}>
            <Button variant="primary" onClick={() => void handleRunAssistant()} disabled={submitting}>
              {submitting ? "Starting…" : `Run ${nextPending.assistant} Assistant`}
            </Button>
            {mastermind ? (
              <Button variant="secondary" onClick={() => setPickerOpen(true)} disabled={submitting}>
                Change Assistant
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>

      {mastermind && nextPending ? (
        <AssistantPicker
          open={pickerOpen}
          onClose={() => setPickerOpen(false)}
          mastermind={mastermind}
          currentAssistant={nextPending.assistant}
          onConfirm={handleConfirmOverride}
          confirming={submitting}
        />
      ) : null}

      {actionable && viewMode.kind === "actionable" ? (
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
