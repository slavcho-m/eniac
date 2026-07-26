import { useState } from "react";
import { PromptInput, StatusBanner } from "@/components";
import { respondToTask } from "@/lib/api";
import type { Task } from "@/types/api";

interface ClarificationViewProps {
  task: Task;
  onRunStarted: (runId: string) => void;
}

export function ClarificationView({ task, onRunStarted }: ClarificationViewProps) {
  const [answer, setAnswer] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    const trimmed = answer.trim();
    if (!trimmed) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = await respondToTask(task.id, trimmed);
      setAnswer("");
      onRunStarted(result.run_id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send response.");
      setSubmitting(false);
    }
  }

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", gap: 16 }}>
      <StatusBanner variant="warning">Waiting on your answer</StatusBanner>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {/* index-as-key: questions are a static, ordered, position-only list */}
        {(task.pending_questions ?? []).map((question, i) => (
          // eslint-disable-next-line react/no-array-index-key
          <p key={i} style={{ margin: 0, color: "var(--text-primary)", fontSize: "var(--text-body)" }}>
            {question}
          </p>
        ))}
      </div>

      {error ? (
        <p style={{ color: "var(--error)", margin: 0, fontSize: "var(--text-body)" }}>{error}</p>
      ) : null}

      <div style={{ marginTop: "auto" }}>
        <PromptInput
          placeholder="Type your answer…"
          value={answer}
          onChange={setAnswer}
          onSubmit={handleSubmit}
          disabled={submitting}
        />
      </div>
    </div>
  );
}
