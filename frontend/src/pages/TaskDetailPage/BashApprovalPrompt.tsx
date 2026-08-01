import { useState } from "react";
import { Button, PromptInput, TextInput } from "@/components";
import { decideBashApproval } from "@/lib/api";
import type { BashApproval } from "@/types/api";
import styles from "./BashApprovalPrompt.module.css";

const STOP_BASH_SUFFIX =
  "\n\n(Do not attempt any further Bash commands for this task item — proceed without further " +
  "verification, or report yourself blocked if you cannot proceed without it.)";

interface BashApprovalPromptProps {
  approval: BashApproval;
  assistantLabel?: string;
  onResolved: () => void;
}

type Mode = "actions" | "allowlist" | "feedback";

export function BashApprovalPrompt({ approval, assistantLabel, onResolved }: BashApprovalPromptProps) {
  const [mode, setMode] = useState<Mode>("actions");
  const [pattern, setPattern] = useState(approval.command);
  const [feedback, setFeedback] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function decide(decision: "approve" | "deny", allowlistPattern?: string, feedbackText?: string) {
    setSubmitting(true);
    try {
      await decideBashApproval(approval.id, decision, allowlistPattern, feedbackText);
      onResolved();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <p className={styles.summary}>
        {assistantLabel ? `The ${assistantLabel} Assistant` : "This run"} needs approval to run the
        following command:
      </p>
      <code className={styles.command}>{approval.command}</code>

      {mode === "actions" ? (
        <div className={styles.actions}>
          <Button variant="primary" disabled={submitting} onClick={() => decide("approve")}>
            Approve
          </Button>
          <Button variant="secondary" disabled={submitting} onClick={() => setMode("allowlist")}>
            Approve & Allowlist
          </Button>
          <Button variant="destructive" disabled={submitting} onClick={() => setMode("feedback")}>
            Reject
          </Button>
        </div>
      ) : null}

      {mode === "allowlist" ? (
        <div className={styles.allowlistForm}>
          <TextInput value={pattern} onChange={(e) => setPattern(e.target.value)} />
          <Button
            variant="primary"
            disabled={submitting || !pattern.trim()}
            onClick={() => decide("approve", pattern.trim())}
          >
            Confirm
          </Button>
          <Button variant="secondary" disabled={submitting} onClick={() => setMode("actions")}>
            Cancel
          </Button>
        </div>
      ) : null}

      {mode === "feedback" ? (
        <div className={styles.feedbackForm}>
          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <Button variant="secondary" disabled={submitting} onClick={() => setMode("actions")}>
              Cancel
            </Button>
          </div>
          <PromptInput
            placeholder="Why are you rejecting this command?"
            value={feedback}
            onChange={setFeedback}
            onSubmit={() => decide("deny", undefined, feedback.trim())}
            disabled={submitting}
          />
          <div className={styles.actions}>
            <Button
              variant="secondary"
              disabled={submitting || !feedback.trim()}
              onClick={() => decide("deny", undefined, feedback.trim())}
            >
              Send & Try Again
            </Button>
            <Button
              variant="secondary"
              disabled={submitting || !feedback.trim()}
              onClick={() => decide("deny", undefined, feedback.trim() + STOP_BASH_SUFFIX)}
            >
              Send & Stop Using Bash
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
