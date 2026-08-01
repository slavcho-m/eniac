import { useState } from "react";
import { Badge, Button, DiffSummaryChip, DiffViewer, FeedbackForm, MarkdownText, PromptInput, SectionLabel } from "@/components";
import { approveAmendment, getTaskAmendment, rejectAmendment } from "@/lib/api";
import { useAsync } from "@/hooks/useAsync";
import { parseDiff } from "@/lib/parseDiff";

interface AmendmentPanelProps {
  taskId: string;
  onApproved: () => void;
  onRunStarted: (runId: string, assistant?: string) => void;
}

export function AmendmentPanel({ taskId, onApproved, onRunStarted }: AmendmentPanelProps) {
  const { data: amendment, refetch } = useAsync(() => getTaskAmendment(taskId), [taskId]);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [feedback, setFeedback] = useState("");
  const [showFeedbackForm, setShowFeedbackForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!amendment) return null;

  const assistantLabel = amendment.source === "review" ? "Review" : "Mastermind";

  async function handleAnswerOrReject() {
    const trimmed = feedback.trim();
    if (!trimmed || !amendment) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = await rejectAmendment(taskId, trimmed);
      setFeedback("");
      setShowFeedbackForm(false);
      onRunStarted(result.run_id, assistantLabel);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send.");
      setSubmitting(false);
    }
  }

  async function handleApprove() {
    setSubmitting(true);
    setError(null);
    try {
      await approveAmendment(taskId);
      onApproved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to approve.");
      setSubmitting(false);
    }
  }

  if (amendment.kind === "clarification") {
    return (
      <div style={{ border: "1px solid var(--border-hairline)", borderRadius: "var(--radius-card)", padding: 16 }}>
        <SectionLabel>The {assistantLabel} needs more information</SectionLabel>
        <ul style={{ margin: "10px 0 0", paddingLeft: 18, color: "var(--text-secondary)", fontSize: "var(--text-body)" }}>
          {amendment.questions.map((q) => (
            <li key={q}>{q}</li>
          ))}
        </ul>
        {error ? <p style={{ color: "var(--error)", fontSize: "var(--text-body)" }}>{error}</p> : null}
        <div style={{ marginTop: 12 }}>
          <PromptInput
            placeholder="Answer…"
            value={feedback}
            onChange={setFeedback}
            onSubmit={handleAnswerOrReject}
            disabled={submitting}
          />
        </div>
      </div>
    );
  }

  const parsedFiles = amendment.diff ? parseDiff(amendment.diff) : [];
  const activeFile = parsedFiles.find((file) => file.filename === selectedFile) ?? parsedFiles[0];

  return (
    <div style={{ border: "1px solid var(--border-hairline)", borderRadius: "var(--radius-card)", padding: 16 }}>
      <SectionLabel>Proposed Task Changes ({assistantLabel})</SectionLabel>
      <div style={{ marginTop: 10 }}>
        <MarkdownText>{amendment.reasoning}</MarkdownText>
      </div>

      {amendment.new_tasks.length > 0 ? (
        <div style={{ marginTop: 12 }}>
          <SectionLabel>New Tasks</SectionLabel>
          <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 6 }}>
            {amendment.new_tasks.map((item) => (
              <div key={item.slug} style={{ fontSize: "var(--text-body)" }}>
                <span style={{ color: "var(--text-primary)" }}>{item.slug}</span>{" "}
                <span style={{ color: "var(--text-tertiary)" }}>({item.assistant})</span>
                {item.depends_on?.length ? (
                  <span style={{ color: "var(--text-tertiary)" }}> — depends on {item.depends_on.join(", ")}</span>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {amendment.deprecate_item_ids.length > 0 ? (
        <div style={{ marginTop: 12 }}>
          <SectionLabel>Deprecating</SectionLabel>
          <div style={{ marginTop: 6, display: "flex", gap: 6, flexWrap: "wrap" }}>
            {amendment.deprecate_item_ids.map((itemId) => (
              <Badge key={itemId} variant="deprecated">
                {itemId}
              </Badge>
            ))}
          </div>
        </div>
      ) : null}

      {parsedFiles.length > 1 ? (
        <div style={{ display: "flex", gap: 12, marginTop: 12, overflowX: "auto", paddingBottom: 4 }}>
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

      {error ? <p style={{ color: "var(--error)", fontSize: "var(--text-body)" }}>{error}</p> : null}

      <div style={{ marginTop: 16, borderTop: "1px solid var(--border-hairline)", paddingTop: 16 }}>
        {showFeedbackForm ? (
          <FeedbackForm
            placeholder="Describe what should change about this proposal…"
            value={feedback}
            onChange={setFeedback}
            onSubmit={handleAnswerOrReject}
            onCancel={() => {
              setShowFeedbackForm(false);
              refetch();
            }}
            disabled={submitting}
          />
        ) : (
          <div style={{ display: "flex", gap: 12 }}>
            <Button variant="primary" onClick={handleApprove} disabled={submitting}>
              Approve Task Changes
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
