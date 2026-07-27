import { useEffect, useRef } from "react";
import { ActivityCard } from "@/components";
import { usePendingBashApprovals } from "@/hooks/usePendingBashApprovals";
import { BashApprovalPrompt } from "./BashApprovalPrompt";

interface InFlightViewProps {
  label: string;
  onRefetch: () => void;
  /** When set, also watches for a Bash approval pending on this run — covers the case
   * where a page refresh lost the live WebSocket (`activeRunId` is in-memory-only) while
   * an Assistant is genuinely blocked waiting on a human decision, not just "still working". */
  runId?: string;
  assistantLabel?: string;
}

/**
 * Shown for a run that's in flight with no live WebSocket attached — e.g. after a page
 * refresh, since `activeRunId` (TaskDetailPage) is in-memory-only and doesn't survive
 * a reload. Polls in the background so the page advances on its own — no manual action
 * needed.
 */
export function InFlightView({ label, onRefetch, runId, assistantLabel }: InFlightViewProps) {
  const onRefetchRef = useRef(onRefetch);
  onRefetchRef.current = onRefetch;

  useEffect(() => {
    const id = setInterval(() => onRefetchRef.current(), 3000);
    return () => clearInterval(id);
  }, []);

  const { approvals, refetch } = usePendingBashApprovals();
  const pending = runId ? approvals.find((approval) => approval.run_id === runId) : undefined;

  return (
    <ActivityCard title={label} defaultExpanded={Boolean(pending)} collapsible={!pending}>
      {pending ? (
        <BashApprovalPrompt approval={pending} assistantLabel={assistantLabel} onResolved={refetch} />
      ) : undefined}
    </ActivityCard>
  );
}
