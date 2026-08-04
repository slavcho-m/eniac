import { X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Badge, MarkdownText, PromptInput, SectionLabel } from "@/components";
import { useImageAttachments } from "@/hooks/useImageAttachments";
import { useRunStream } from "@/hooks/useRunStream";
import { useTaskRuns } from "@/hooks/useTaskRuns";
import { respondToTask } from "@/lib/api";
import type { Task } from "@/types/api";

interface DiscussionViewProps {
  task: Task;
  activeRunId: string | null;
  onRunStarted: (runId: string) => void;
  onRunFinished: () => void;
}

/** Discuss mode's task-detail view: a scrollable message thread + composer, in place of the
 * requirements/tasks pipeline UI every other mode uses. History comes from GET /tasks/:id/runs
 * (each Run row is one turn); the in-flight turn streams live via the same useRunStream hook
 * LiveRunView uses elsewhere, rendered as one more bubble instead of a separate view. */
export function DiscussionView({ task, activeRunId, onRunStarted, onRunFinished }: DiscussionViewProps) {
  const { data: turns, refetch } = useTaskRuns(task.id);
  const [draft, setDraft] = useState("");
  const [pendingPrompt, setPendingPrompt] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { images, handleFilesSelected, removeImage, reset: resetImages, imagePaths, imagesStillUploading } =
    useImageAttachments(task.project_id);

  function handleRunDone() {
    setPendingPrompt(null);
    onRunFinished();
    refetch();
  }

  const { output } = useRunStream(activeRunId, handleRunDone);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [turns, output]);

  async function handleSubmit() {
    const trimmed = draft.trim();
    if (!trimmed || submitting || imagesStillUploading) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = await respondToTask(task.id, trimmed, imagePaths);
      setPendingPrompt(trimmed);
      setDraft("");
      resetImages();
      onRunStarted(result.run_id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send message.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", gap: 12, minHeight: 0 }}>
      <div
        ref={scrollRef}
        style={{ flex: 1, minHeight: 0, overflowY: "auto", display: "flex", flexDirection: "column", gap: 20 }}
      >
        {(turns ?? []).map((turn) => (
          <div key={turn.run_id} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div>
              <SectionLabel>You</SectionLabel>
              <p
                style={{
                  margin: "6px 0 0",
                  color: "var(--text-primary)",
                  fontSize: "var(--text-body)",
                  whiteSpace: "pre-wrap",
                }}
              >
                {turn.prompt}
              </p>
            </div>
            <div>
              <SectionLabel>Eniac</SectionLabel>
              {turn.reply ? (
                <MarkdownText>{turn.reply}</MarkdownText>
              ) : (
                <p style={{ margin: "6px 0 0", color: "var(--error)", fontSize: "var(--text-body)" }}>
                  Something went wrong on this turn.
                </p>
              )}
            </div>
          </div>
        ))}

        {activeRunId ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {pendingPrompt ? (
              <div>
                <SectionLabel>You</SectionLabel>
                <p
                  style={{
                    margin: "6px 0 0",
                    color: "var(--text-primary)",
                    fontSize: "var(--text-body)",
                    whiteSpace: "pre-wrap",
                  }}
                >
                  {pendingPrompt}
                </p>
              </div>
            ) : null}
            <div>
              <SectionLabel>Eniac</SectionLabel>
              {output ? (
                <MarkdownText>{output}</MarkdownText>
              ) : (
                <p style={{ margin: "6px 0 0", color: "var(--text-tertiary)", fontSize: "var(--text-body)" }}>
                  Thinking…
                </p>
              )}
            </div>
          </div>
        ) : null}
      </div>

      {error ? <p style={{ color: "var(--error)", margin: 0, fontSize: "var(--text-body)" }}>{error}</p> : null}

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
              <p key={img.id} style={{ color: "var(--error)", margin: 0, fontSize: "var(--text-body)" }}>
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
        placeholder="Reply…"
        value={draft}
        onChange={setDraft}
        onSubmit={handleSubmit}
        onAttach={() => fileInputRef.current?.click()}
        onDropFiles={handleFilesSelected}
        disabled={submitting || imagesStillUploading || activeRunId !== null}
      />
    </div>
  );
}
