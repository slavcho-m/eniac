import { CheckSquare, Plus } from "lucide-react";
import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Button, ConfirmDialog, NavListItem, ProjectSwitcher, SectionLabel } from "@/components";
import { useProjects } from "@/hooks/useProjects";
import { useProjectTasks } from "@/hooks/useProjectTasks";
import { deleteTask } from "@/lib/api";
import { dateGroupLabel, formatRelativeTime } from "@/lib/formatRelativeTime";
import type { Task } from "@/types/api";
import { DeleteProjectDialog } from "./DeleteProjectDialog";
import { ProjectSettingsDialog } from "./ProjectSettingsDialog";
import styles from "./Sidebar.module.css";

interface SidebarProps {
  /** Bump to force the task list to refetch — e.g. pass task.status from TaskDetailPage
   * so an in-place status change elsewhere on the page updates this list too. */
  refreshKey?: unknown;
}

/** Groups tasks by which node (child repo) they're scoped to, for an orchestrator
 * project's sidebar -- one heading per node that actually has a task, plus an
 * "Orchestrator" heading for root-scoped tasks (repo_scope null/"."). Ordinary
 * single-repo projects never call this; their sidebar stays a single flat list. */
function groupTasksByNode(tasks: Task[], repos: string[]): { label: string; tasks: Task[] }[] {
  const groups: { label: string; tasks: Task[] }[] = [];
  const rootTasks = tasks.filter((t) => !t.repo_scope || t.repo_scope === ".");
  if (rootTasks.length > 0) groups.push({ label: "Orchestrator", tasks: rootTasks });
  for (const repo of repos) {
    if (repo === ".") continue;
    const nodeTasks = tasks.filter((t) => t.repo_scope === repo);
    if (nodeTasks.length > 0) groups.push({ label: repo.split("/").pop() ?? repo, tasks: nodeTasks });
  }
  return groups;
}

/** Groups an ordinary (non-orchestrator) project's tasks into Today/Yesterday/date
 * buckets, per the reference design — reuses the same {label, tasks} shape as
 * groupTasksByNode so both render through the same JSX below. */
function groupTasksByDate(tasks: Task[]): { label: string; tasks: Task[] }[] {
  const groups: { label: string; tasks: Task[] }[] = [];
  for (const task of tasks) {
    const label = dateGroupLabel(task.created_at);
    const group = groups.find((g) => g.label === label);
    if (group) group.tasks.push(task);
    else groups.push({ label, tasks: [task] });
  }
  return groups;
}

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
  const taskGroups = currentProject?.is_orchestrator
    ? groupTasksByNode(tasks ?? [], currentProject.repos)
    : groupTasksByDate(tasks ?? []);

  function renderTaskItem(task: Task) {
    return (
      <NavListItem
        key={task.id}
        icon={<CheckSquare size={15} strokeWidth={1.75} />}
        label={
          task.title ?? task.feature_slug ?? <span className={styles.titleSkeleton} aria-label="Generating title…" />
        }
        meta={formatRelativeTime(task.created_at)}
        active={task.id === taskId}
        onClick={() => navigate(`/projects/${projectId}/tasks/${task.id}`)}
        onDelete={() => setDeleteTarget({ id: task.id, label: task.feature_slug ?? task.prompt })}
      />
    );
  }

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
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 4px 16px" }}>
        <img src="/eniac-icon.svg" alt="" width={20} height={20} />
        <span style={{ fontSize: "var(--text-label)", fontWeight: "var(--weight-label)", color: "var(--text-primary)" }}>
          Eniac Workspace
        </span>
      </div>

      <div style={{ marginBottom: 16, borderTop: "1px solid var(--border-hairline)" }} />

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
          <ProjectSwitcher
            name={currentProject.id}
            onClick={() => navigate(`/projects/${currentProject.id}`)}
            onSettingsClick={() => setSettingsOpen(true)}
          />
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
          {taskGroups.length === 0 ? (
            <>
              <SectionLabel>Tasks</SectionLabel>
              <p style={{ fontSize: "var(--text-hint)", color: "var(--text-tertiary)", padding: "4px 10px" }}>
                No tasks yet.
              </p>
            </>
          ) : (
            taskGroups.map((group, i) => (
              <div key={group.label} style={{ marginTop: i > 0 ? 20 : 0 }}>
                <SectionLabel>{group.label}</SectionLabel>
                <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 2 }}>
                  {group.tasks.map(renderTaskItem)}
                </div>
              </div>
            ))
          )}
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
