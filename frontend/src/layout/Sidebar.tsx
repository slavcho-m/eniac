import { CheckSquare, Plus } from "lucide-react";
import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Button, ConfirmDialog, NavListItem, ProjectSwitcher, SectionLabel } from "@/components";
import { useProjects } from "@/hooks/useProjects";
import { useProjectTasks } from "@/hooks/useProjectTasks";
import { deleteTask } from "@/lib/api";
import type { TaskStatus } from "@/types/api";
import { DeleteProjectDialog } from "./DeleteProjectDialog";
import { ProjectSettingsDialog } from "./ProjectSettingsDialog";

interface SidebarProps {
  /** Bump to force the task list to refetch — e.g. pass task.status from TaskDetailPage
   * so an in-place status change elsewhere on the page updates this list too. */
  refreshKey?: unknown;
}

const TASK_STATUS_LABEL: Record<TaskStatus, string> = {
  running: "Running",
  awaiting_clarification: "Awaiting Clarification",
  context_ready: "Context Ready",
  investigating: "Investigating",
  awaiting_requirements_clarification: "Awaiting Requirements",
  requirements_ready: "Requirements Ready",
  planning_tasks: "Planning Tasks",
  awaiting_tasks_clarification: "Awaiting Tasks",
  tasks_ready: "Tasks Ready",
  completed: "Completed",
  failed: "Failed",
};

export function Sidebar({ refreshKey }: SidebarProps) {
  const { projectId, taskId } = useParams<{ projectId?: string; taskId?: string }>();
  const navigate = useNavigate();
  const { data: projects, refetch: refetchProjects } = useProjects();
  const { data: tasks, refetch: refetchTasks } = useProjectTasks(projectId, refreshKey);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [deleteProjectOpen, setDeleteProjectOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; label: string } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const currentProject = projects?.find((p) => p.id === projectId);

  function closeDeleteDialog() {
    setDeleteTarget(null);
    setDeleteError(null);
  }

  async function handleConfirmDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteTask(deleteTarget.id);
      refetchTasks();
      if (taskId === deleteTarget.id) {
        void navigate(`/projects/${projectId}`);
      }
      setDeleteTarget(null);
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : "Failed to delete task.");
    } finally {
      setDeleting(false);
    }
  }

  const deleteMessage = deleteTarget ? `Delete "${deleteTarget.label}"? This cannot be undone.` : "";

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <Button
        variant="secondary"
        icon={<Plus size={14} strokeWidth={1.75} />}
        onClick={() => navigate("/new-project")}
      >
        New Project
      </Button>

      <div style={{ marginTop: 8, display: "flex", justifyContent: "center" }}>
        <Button variant="link" onClick={() => navigate("/")}>
          View All Projects
        </Button>
      </div>

      <div style={{ marginTop: 4, borderTop: "1px solid var(--border-hairline)" }} />

      <div style={{ marginTop: 16 }}>
        {currentProject ? (
          <ProjectSwitcher name={currentProject.id} onSettingsClick={() => setSettingsOpen(true)} />
        ) : (
          <SectionLabel>No project selected</SectionLabel>
        )}
      </div>

      {projectId && (
        <div
          style={{
            marginTop: 24,
            flex: 1,
            overflowY: "auto",
            minHeight: 0,
            display: "flex",
            flexDirection: "column",
          }}
        >
          <SectionLabel>Tasks</SectionLabel>
          <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 2 }}>
            {tasks?.length === 0 ? (
              <p style={{ fontSize: "var(--text-hint)", color: "var(--text-tertiary)", padding: "4px 10px" }}>
                No tasks yet.
              </p>
            ) : null}
            {(tasks ?? []).map((task) => (
              <NavListItem
                key={task.id}
                icon={<CheckSquare size={15} strokeWidth={1.75} />}
                label={task.feature_slug ?? task.prompt}
                meta={TASK_STATUS_LABEL[task.status]}
                active={task.id === taskId}
                onClick={() => navigate(`/projects/${projectId}/tasks/${task.id}`)}
                onDelete={() =>
                  setDeleteTarget({ id: task.id, label: task.feature_slug ?? task.prompt })
                }
              />
            ))}
          </div>
        </div>
      )}

      {projectId && (
        <div
          style={{
            marginTop: "auto",
            flexShrink: 0,
            borderTop: "1px solid var(--border-hairline)",
            paddingTop: 16,
          }}
        >
          <Button
            variant="secondary"
            icon={<Plus size={14} strokeWidth={1.75} />}
            onClick={() => navigate(`/projects/${projectId}`)}
          >
            New Task
          </Button>
        </div>
      )}

      {currentProject && (
        <ProjectSettingsDialog
          open={settingsOpen}
          onClose={() => setSettingsOpen(false)}
          project={currentProject}
          onSaved={refetchProjects}
          onDeleteClick={() => {
            setSettingsOpen(false);
            setDeleteProjectOpen(true);
          }}
        />
      )}

      {currentProject && (
        <DeleteProjectDialog
          open={deleteProjectOpen}
          onClose={() => setDeleteProjectOpen(false)}
          projectId={currentProject.id}
          workspacePath={currentProject.workspace_path}
          onDeleted={() => {
            setDeleteProjectOpen(false);
            refetchProjects();
            void navigate("/");
          }}
        />
      )}

      <ConfirmDialog
        open={deleteTarget !== null}
        onClose={closeDeleteDialog}
        onConfirm={handleConfirmDelete}
        title="Delete Task"
        message={
          <>
            {deleteMessage}
            {deleteError ? (
              <span style={{ display: "block", marginTop: 8, color: "var(--error)" }}>{deleteError}</span>
            ) : null}
          </>
        }
        confirmLabel="Delete"
        confirming={deleting}
      />
    </div>
  );
}
