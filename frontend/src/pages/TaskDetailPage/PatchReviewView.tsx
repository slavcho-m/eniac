import { useState } from "react";
import { Button, DiffSummaryChip, DiffViewer, FeedbackForm, MarkdownText, SectionLabel } from "@/components";
import { approvePatch, rejectPatch } from "@/lib/api";
import { usePatchReview } from "@/hooks/usePatchReview";
import { parseDiff } from "@/lib/parseDiff";
import type { Task } from "@/types/api";

interface PatchReviewViewProps {
  task: Task;
  onRefetch: () => void;
  onRunStarted: (runId: string, assistant?: string) => void;
}

export function PatchReviewView({ task, onRefetch, onRunStarted }: PatchReviewViewProps) {
  const { data: review } = usePatchReview(task.id);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [feedback, setFeedback] = useState("");
  const [showFeedbackForm, setShowFeedbackForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const parsedFiles = review?.diff ? parseDiff(review.diff) : [];
  const activeFile = parsedFiles.find((file) => file.filename === selectedFile) ?? parsedFiles[0];

  async function handleApprove() {
    setSubmitting(true);
    setError(null);
    try {
      await approvePatch(task.id);
      onRefetch();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to approve.");
      setSubmitting(false);
    }
  }

  async function handleReject() {
    const trimmed = feedback.trim();
    if (!trimmed) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = await rejectPatch(task.id, trimmed);
      setFeedback("");
      setShowFeedbackForm(false);
      onRunStarted(result.run_id, "Patch");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to reject.");
      setSubmitting(false);
    }
  }

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <div style={{ flex: 1, overflowY: "auto", minHeight: 0, display: "flex", flexDirection: "column", gap: 20 }}>
        <SectionLabel>Ready for Review</SectionLabel>

        {error ? <p style={{ color: "var(--error)", margin: 0, fontSize: "var(--text-body)" }}>{error}</p> : null}

        {review?.summary ? (
          <div>
            <MarkdownText>{review.summary}</MarkdownText>
          </div>
        ) : null}

        {parsedFiles.length === 0 ? (
          <p style={{ color: "var(--text-tertiary)", fontSize: "var(--text-body)" }}>No file changes were made.</p>
        ) : null}

        {parsedFiles.length > 1 ? (
          <div style={{ display: "flex", gap: 12, overflowX: "auto", paddingBottom: 4 }}>
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

        {activeFile ? <DiffViewer filename={activeFile.filename} lines={activeFile.lines} /> : null}
      </div>

      <div style={{ flexShrink: 0, borderTop: "1px solid var(--border-hairline)", marginTop: 16, paddingTop: 16 }}>
        {showFeedbackForm ? (
          <FeedbackForm
            placeholder="Describe what needs fixing before this goes back to the Patch agent…"
            value={feedback}
            onChange={setFeedback}
            onSubmit={handleReject}
            onCancel={() => setShowFeedbackForm(false)}
            disabled={submitting}
          />
        ) : (
          <div style={{ display: "flex", gap: 12 }}>
            <Button variant="primary" onClick={handleApprove} disabled={submitting}>
              Approve
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
