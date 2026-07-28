import { useState } from "react";
import { Button, Dialog, PromptInput } from "@/components";
import { consultMastermind } from "@/lib/api";

interface ConsultMastermindDialogProps {
  open: boolean;
  onClose: () => void;
  taskId: string;
  onRunStarted: (runId: string, assistant?: string) => void;
}

export function ConsultMastermindDialog({ open, onClose, taskId, onRunStarted }: ConsultMastermindDialogProps) {
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSend() {
    const trimmed = message.trim();
    if (!trimmed) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = await consultMastermind(taskId, trimmed);
      setMessage("");
      onClose();
      onRunStarted(result.run_id, "Mastermind");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to consult Mastermind.");
      setSubmitting(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Consult Mastermind"
      size="large"
      footer={
        <Button variant="secondary" onClick={onClose} disabled={submitting}>
          Cancel
        </Button>
      }
    >
      <p style={{ margin: "0 0 16px", color: "var(--text-secondary)", fontSize: "var(--text-body)" }}>
        Ask the Mastermind to revisit the plan — add new task items, or flag existing ones for
        re-implementation. Nothing changes until you approve what it proposes.
      </p>
      <PromptInput
        value={message}
        onChange={setMessage}
        onSubmit={handleSend}
        placeholder="What needs to change?"
        disabled={submitting}
      />
      {error ? (
        <p style={{ color: "var(--error)", fontSize: "var(--text-body)", marginTop: 12 }}>{error}</p>
      ) : null}
    </Dialog>
  );
}
