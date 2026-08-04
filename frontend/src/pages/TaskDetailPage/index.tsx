import { useState } from "react";
import { MessageSquarePlus } from "lucide-react";
import { useParams } from "react-router-dom";
import { AgentSelect, AppShell, ModeSelect, SectionLabel } from "@/components";
import { useTask } from "@/hooks/useTask";
import { useTaskFiles } from "@/hooks/useTaskFiles";
import { useTaskItems } from "@/hooks/useTaskItems";
import { Sidebar } from "@/layout/Sidebar";
import type { Task, TaskItem } from "@/types/api";
import { AmendmentPanel } from "./AmendmentPanel";
import { ClarificationView } from "./ClarificationView";
import { ConfirmGateView } from "./ConfirmGateView";
import { ConsultMastermindDialog } from "./ConsultMastermindDialog";
import styles from "./ConsultMastermindButton.module.css";
import { DiscussionView } from "./DiscussionView";
import { ExecutionView } from "./ExecutionView";
import { FilesPanel } from "./FilesPanel";
import { InFlightView } from "./InFlightView";
import { LiveRunView } from "./LiveRunView";
import { MastermindProgress } from "./MastermindProgress";
import { PatchReviewView } from "./PatchReviewView";
import { TerminalStateView } from "./TerminalStateView";

function mastermindLabel(task: Task): string {
  if (!task.current_mastermind) return "Mastermind";
  return `${task.current_mastermind.charAt(0).toUpperCase()}${task.current_mastermind.slice(1)} Mastermind`;
}

function renderStage(
  task: Task,
  items: TaskItem[] | undefined,
  onRefetch: () => void,
  onRunStarted: (runId: string, assistant?: string) => void,
) {
  switch (task.status) {
    case "running":
      return (
        <InFlightView
          label={task.mode === "patch" ? "Patch agent is investigating…" : "Supervisor is thinking…"}
          onRefetch={onRefetch}
        />
      );
    case "awaiting_clarification":
    case "awaiting_requirements_clarification":
    case "awaiting_tasks_clarification":
      return <ClarificationView task={task} onRunStarted={onRunStarted} />;
    case "context_ready":
      return (
        <ConfirmGateView task={task} stage="context" onRefetch={onRefetch} onRunStarted={onRunStarted} />
      );
    case "investigating":
      return <InFlightView label={`${mastermindLabel(task)} is investigating…`} onRefetch={onRefetch} />;
    case "requirements_ready":
      return (
        <ConfirmGateView task={task} stage="requirements" onRefetch={onRefetch} onRunStarted={onRunStarted} />
      );
    case "planning_tasks":
      return (
        <InFlightView label={`${mastermindLabel(task)} is breaking work into task items…`} onRefetch={onRefetch} />
      );
    case "tasks_ready":
      return task.tasks_approved_at ? (
        <ExecutionView task={task} items={items} onRefetch={onRefetch} onRunStarted={onRunStarted} />
      ) : (
        <ConfirmGateView task={task} stage="tasks" onRefetch={onRefetch} onRunStarted={onRunStarted} />
      );
    case "patch_ready":
      return <PatchReviewView task={task} onRefetch={onRefetch} onRunStarted={onRunStarted} />;
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
  const [activeRunAssistant, setActiveRunAssistant] = useState<string | undefined>(undefined);
  const [consultOpen, setConsultOpen] = useState(false);

  function refetchAll() {
    refetch();
    refetchItems();
    refetchFiles();
  }

  function handleRunFinished() {
    setActiveRunId(null);
    setActiveRunAssistant(undefined);
    refetchAll();
  }

  function handleRunStarted(runId: string, assistant?: string) {
    setActiveRunId(runId);
    setActiveRunAssistant(assistant);
  }

  return (
    <AppShell
      left={<Sidebar refreshKey={task?.status} />}
      right={taskId ? <FilesPanel files={files} projectId={task?.project_id} /> : null}
    >
      {loading && !task ? <p style={{ color: "var(--text-secondary)" }}>Loading…</p> : null}
      {error ? <p style={{ color: "var(--error)" }}>{error.message}</p> : null}
      {task ? (
        <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <SectionLabel>Task</SectionLabel>
              <p style={{ fontSize: "var(--text-label)", color: "var(--text-primary)", marginTop: 6 }}>
                {task.title ?? task.feature_slug ?? task.prompt}
              </p>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
              <ModeSelect
                value={task.mode}
                onChange={() => {}}
                disabled
                title="Mode is locked in once a task starts and can't be changed"
              />
              <AgentSelect
                value={task.agent}
                onChange={() => {}}
                disabled
                title="Agent is locked in once a task starts and can't be changed"
              />
              {task.tasks_approved_at ? (
                <button
                  type="button"
                  className={styles.button}
                  onClick={() => setConsultOpen(true)}
                  aria-label="Consult Mastermind"
                  title="Consult Mastermind"
                >
                  <MessageSquarePlus size={16} strokeWidth={1.75} />
                </button>
              ) : null}
            </div>
          </div>

          {task.masterminds && task.masterminds.length > 1 ? (
            <div style={{ marginTop: 16 }}>
              <MastermindProgress task={task} />
            </div>
          ) : null}

          {task.has_pending_amendment ? (
            <div style={{ marginTop: 16 }}>
              <AmendmentPanel taskId={task.id} onApproved={refetchAll} onRunStarted={handleRunStarted} />
            </div>
          ) : null}

          <div style={{ marginTop: 16, flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
            {task.mode === "discuss" ? (
              <DiscussionView
                task={task}
                activeRunId={activeRunId}
                onRunStarted={handleRunStarted}
                onRunFinished={handleRunFinished}
              />
            ) : activeRunId ? (
              <LiveRunView
                runId={activeRunId}
                onFinished={handleRunFinished}
                assistantLabel={activeRunAssistant}
              />
            ) : (
              renderStage(task, items, refetchAll, handleRunStarted)
            )}
          </div>

          <ConsultMastermindDialog
            open={consultOpen}
            onClose={() => setConsultOpen(false)}
            taskId={task.id}
            onRunStarted={handleRunStarted}
          />
        </div>
      ) : null}
    </AppShell>
  );
}
