import { useState } from "react";
import { Button, StatusBanner } from "@/components";
import { retryTask } from "@/lib/api";
import type { Task } from "@/types/api";

interface TerminalStateViewProps {
  task: Task;
  onRunStarted: (runId: string) => void;
}

export function TerminalStateView({ task, onRunStarted }: TerminalStateViewProps) {
  const [retrying, setRetrying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (task.status === "completed") {
    return <StatusBanner variant="success">All task items complete.</StatusBanner>;
  }

  async function handleRetry() {
    setRetrying(true);
    setError(null);
    try {
      const result = await retryTask(task.id);
      onRunStarted(result.run_id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to retry.");
      setRetrying(false);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <StatusBanner variant="error">{task.error ?? "This task failed."}</StatusBanner>
      {error ? (
        <p style={{ color: "var(--error)", margin: 0, fontSize: "var(--text-body)" }}>{error}</p>
      ) : null}
      <div>
        <Button variant="primary" onClick={handleRetry} disabled={retrying}>
          {retrying ? "Retrying…" : "Retry"}
        </Button>
      </div>
    </div>
  );
}
