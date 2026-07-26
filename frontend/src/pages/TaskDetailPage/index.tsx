import { useState } from "react";
import { useParams } from "react-router-dom";
import { AppShell, SectionLabel } from "@/components";
import { useTask } from "@/hooks/useTask";
import { useTaskFiles } from "@/hooks/useTaskFiles";
import { useTaskItems } from "@/hooks/useTaskItems";
import { Sidebar } from "@/layout/Sidebar";
import type { Task, TaskItem } from "@/types/api";
import { ClarificationView } from "./ClarificationView";
import { ConfirmGateView } from "./ConfirmGateView";
import { ExecutionView } from "./ExecutionView";
import { FilesPanel } from "./FilesPanel";
import { InFlightView } from "./InFlightView";
import { LiveRunView } from "./LiveRunView";
import { TerminalStateView } from "./TerminalStateView";

function renderStage(
  task: Task,
  items: TaskItem[] | undefined,
  onRefetch: () => void,
  onRunStarted: (runId: string) => void,
) {
  switch (task.status) {
    case "running":
      return <InFlightView label="Supervisor is thinking…" onRefetch={onRefetch} />;
    case "awaiting_clarification":
    case "awaiting_requirements_clarification":
    case "awaiting_tasks_clarification":
      return <ClarificationView task={task} onRunStarted={onRunStarted} />;
    case "context_ready":
      return (
        <ConfirmGateView task={task} stage="context" onRefetch={onRefetch} onRunStarted={onRunStarted} />
      );
    case "investigating":
      return <InFlightView label="Mastermind is investigating…" onRefetch={onRefetch} />;
    case "requirements_ready":
      return (
        <ConfirmGateView task={task} stage="requirements" onRefetch={onRefetch} onRunStarted={onRunStarted} />
      );
    case "planning_tasks":
      return <InFlightView label="Breaking work into task items…" onRefetch={onRefetch} />;
    case "tasks_ready":
      return task.tasks_approved_at ? (
        <ExecutionView task={task} items={items} onRefetch={onRefetch} onRunStarted={onRunStarted} />
      ) : (
        <ConfirmGateView task={task} stage="tasks" onRefetch={onRefetch} onRunStarted={onRunStarted} />
      );
    case "completed":
    case "failed":
      return <TerminalStateView task={task} onRunStarted={onRunStarted} />;
    default:
      return null;
  }
}

/** Route: "/projects/:projectId/tasks/:taskId" — the state machine driven by task.status. */
export function TaskDetailPage() {
  const { taskId } = useParams<{ taskId: string }>();
  const { data: task, loading, error, refetch } = useTask(taskId);
  const { data: items, refetch: refetchItems } = useTaskItems(taskId);
  const { data: files, refetch: refetchFiles } = useTaskFiles(taskId);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);

  function refetchAll() {
    refetch();
    refetchItems();
    refetchFiles();
  }

  function handleRunFinished() {
    setActiveRunId(null);
    refetchAll();
  }

  return (
    <AppShell
      left={<Sidebar refreshKey={task?.status} />}
      right={taskId ? <FilesPanel files={files} /> : null}
    >
      {loading && !task ? <p style={{ color: "var(--text-secondary)" }}>Loading…</p> : null}
      {error ? <p style={{ color: "var(--error)" }}>{error.message}</p> : null}
      {task ? (
        <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
          <SectionLabel>Task</SectionLabel>
          <p style={{ fontSize: "var(--text-label)", color: "var(--text-primary)", marginTop: 6 }}>
            {task.prompt}
          </p>
          <div style={{ marginTop: 16, flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
            {activeRunId ? (
              <LiveRunView runId={activeRunId} onFinished={handleRunFinished} />
            ) : (
              renderStage(task, items, refetchAll, setActiveRunId)
            )}
          </div>
        </div>
      ) : null}
    </AppShell>
  );
}
