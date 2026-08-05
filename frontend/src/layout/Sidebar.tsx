import { ChevronDown, List, ListPlus, Plus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate, useParams } from "react-router-dom";
import { Button, ConfirmDialog, NavListItem, ProjectSwitcher, SectionLabel } from "@/components";
import { useProjects } from "@/hooks/useProjects";
import { useProjectTasks } from "@/hooks/useProjectTasks";
import { deleteTask } from "@/lib/api";
import { cn } from "@/lib/cn";
import { dateGroupLabel, formatRelativeTime } from "@/lib/formatRelativeTime";
import { TASK_MODES } from "@/lib/taskModes";
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
  const [projectMenuOpen, setProjectMenuOpen] = useState(false);
  const [projectMenuPosition, setProjectMenuPosition] = useState({ top: 0, right: 0 });
  const projectMenuTriggerRef = useRef<HTMLButtonElement>(null);
  const projectMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!projectMenuOpen) return undefined;
    function handlePointerDown(e: MouseEvent) {
      const target = e.target;
      if (!(target instanceof Node)) return;
      if (projectMenuTriggerRef.current?.contains(target)) return;
      if (projectMenuRef.current?.contains(target)) return;
      setProjectMenuOpen(false);
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setProjectMenuOpen(false);
    }
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [projectMenuOpen]);

  function toggleProjectMenu() {
    if (!projectMenuOpen && projectMenuTriggerRef.current) {
      const rect = projectMenuTriggerRef.current.getBoundingClientRect();
      setProjectMenuPosition({ top: rect.bottom + 6, right: window.innerWidth - rect.right });
    }
    setProjectMenuOpen((o) => !o);
  }

  const currentProject = projects?.find((p) => p.id === projectId);
  // Backend returns tasks oldest-first (ORDER BY created_at); reverse once here so every
  // group below — and the plain top-to-bottom render order — puts the most recent task
  // first, without each grouping function needing to know about sort order itself.
  const orderedTasks = [...(tasks ?? [])].reverse();
  const taskGroups = currentProject?.is_orchestrator
    ? groupTasksByNode(orderedTasks, currentProject.repos)
    : groupTasksByDate(orderedTasks);

  function renderTaskItem(task: Task) {
    const mode = TASK_MODES[task.mode];
    return (
      <NavListItem
        key={task.id}
        icon={
          <span title={`${mode.label} mode`} style={{ display: "inline-flex" }}>
            <mode.icon size={15} strokeWidth={1.75} />
          </span>
        }
        label={
          task.title ?? task.feature_slug ?? <span className={styles.titleSkeleton} aria-label="Generating title…" />
        }
        meta={formatRelativeTime(task.created_at)}
        active={task.id === taskId}
        status={task.status === "completed" ? "success" : task.status === "failed" ? "error" : undefined}
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
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "4px 4px 16px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <img src="/eniac-icon.svg" alt="" width={20} height={20} />
          <span style={{ fontSize: "var(--text-label)", fontWeight: "var(--weight-label)", color: "var(--text-primary)" }}>
            Eniac Workspace
          </span>
        </div>
        <button
          ref={projectMenuTriggerRef}
          type="button"
          className={cn(styles.menuTrigger, projectMenuOpen && styles.menuTriggerOpen)}
          onClick={toggleProjectMenu}
          title="Project actions"
          aria-label="Project actions"
          aria-haspopup="menu"
          aria-expanded={projectMenuOpen}
          data-tour="project-menu-trigger"
        >
          <ChevronDown size={15} strokeWidth={1.75} className={styles.menuTriggerIcon} />
        </button>
        {projectMenuOpen
          ? createPortal(
              <div
                ref={projectMenuRef}
                className={styles.menu}
                role="menu"
                style={{ top: projectMenuPosition.top, right: projectMenuPosition.right }}
                data-tour="project-menu-list"
              >
                <button
                  type="button"
                  className={styles.menuOption}
                  role="menuitem"
                  onClick={() => {
                    setProjectMenuOpen(false);
                    void navigate("/new-project");
                  }}
                >
                  <Plus size={14} strokeWidth={1.75} className={styles.menuOptionIcon} />
                  New Project
                </button>
                <button
                  type="button"
                  className={styles.menuOption}
                  role="menuitem"
                  onClick={() => {
                    setProjectMenuOpen(false);
                    void navigate("/");
                  }}
                >
                  <List size={14} strokeWidth={1.75} className={styles.menuOptionIcon} />
                  View All Projects
                </button>
              </div>,
              document.body,
            )
          : null}
      </div>

      <div style={{ marginBottom: 16, borderTop: "1px solid var(--border-hairline)" }} />

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
                <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 4 }}>
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
            display: "flex",
            flexDirection: "column",
            gap: 8,
          }}
        >
          <Button
            variant="secondary"
            icon={<ListPlus size={14} strokeWidth={1.75} />}
            onClick={() => navigate(`/projects/${projectId}`)}
            style={{ width: "100%" }}
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
