import { ActivityCard, TerminalLog } from "@/components";
import type { TerminalLogLine } from "@/components";
import { useRunStream } from "@/hooks/useRunStream";

interface LiveRunViewProps {
  runId: string;
  onFinished: () => void;
}

export function LiveRunView({ runId, onFinished }: LiveRunViewProps) {
  const { output, done } = useRunStream(runId, onFinished);

  const lines: TerminalLogLine[] = output
    .split("\n")
    .filter(Boolean)
    .map((text) => ({ kind: "command" as const, text }));

  return (
    <ActivityCard title={done ? "Finishing up…" : "Working…"} defaultExpanded collapsible={false}>
      {lines.length > 0 ? (
        <TerminalLog lines={lines} />
      ) : (
        <p style={{ margin: 0, color: "var(--text-tertiary)", fontSize: "var(--text-body)" }}>
          Agent output will stream here during this run.
        </p>
      )}
    </ActivityCard>
  );
}
