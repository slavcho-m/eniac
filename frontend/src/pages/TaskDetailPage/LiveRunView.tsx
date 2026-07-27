import { ActivityCard, TerminalLog } from "@/components";
import type { TerminalLogLine } from "@/components";
import { useRunStream } from "@/hooks/useRunStream";
import { usePendingBashApprovals } from "@/hooks/usePendingBashApprovals";
import { BashApprovalPrompt } from "./BashApprovalPrompt";

interface LiveRunViewProps {
  runId: string;
  onFinished: () => void;
  assistantLabel?: string;
}

export function LiveRunView({ runId, onFinished, assistantLabel }: LiveRunViewProps) {
  const { output, done } = useRunStream(runId, onFinished);
  const { approvals, refetch } = usePendingBashApprovals();
  const pendingForThisRun = approvals.find((approval) => approval.run_id === runId);

  const lines: TerminalLogLine[] = output
    .split("\n")
    .filter(Boolean)
    .map((text) => ({ kind: "command" as const, text }));

  return (
    <ActivityCard title={done ? "Finishing up…" : "Working…"} defaultExpanded collapsible={false}>
      {pendingForThisRun ? (
        <BashApprovalPrompt approval={pendingForThisRun} assistantLabel={assistantLabel} onResolved={refetch} />
      ) : lines.length > 0 ? (
        <TerminalLog lines={lines} />
      ) : (
        <p style={{ margin: 0, color: "var(--text-tertiary)", fontSize: "var(--text-body)" }}>
          Agent output will stream here during this run.
        </p>
      )}
    </ActivityCard>
  );
}
