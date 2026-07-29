import { useState } from "react";
import { CollapsibleSection, ConfirmDialog, Dialog, FileListItem, SectionLabel } from "@/components";
import type { BadgeVariant } from "@/components";
import { useFileContent } from "@/hooks/useFileContent";
import { useProjectContextFiles } from "@/hooks/useProjectContextFiles";
import { ApiError, deleteProjectContextFile } from "@/lib/api";
import { renderMarkdown } from "@/lib/renderMarkdown";
import type { ProjectContextFile, TaskFile, TaskFileStatus } from "@/types/api";

const BADGE_BY_STATUS: Record<TaskFileStatus, { variant: BadgeVariant; label: string }> = {
  approved: { variant: "success", label: "Approved" },
  awaiting_approval: { variant: "warning", label: "Awaiting Approval" },
  draft: { variant: "neutral", label: "Draft" },
};

/** Groups project-context files by which repo they belong to — "." (root) first, then
 * each child repo — mirroring Sidebar's groupTasksByNode so the two "root vs. node"
 * groupings in this app read the same way. The backend already emits entries grouped
 * contiguously by repo (root's entries, then each repo's in turn), so a simple
 * run-length grouping is enough — no need to bucket by a Map. */
function groupContextFiles(files: ProjectContextFile[]): { label: string; repo: string; files: ProjectContextFile[] }[] {
  const groups: { label: string; repo: string; files: ProjectContextFile[] }[] = [];
  for (const file of files) {
    const last = groups[groups.length - 1];
    if (last && last.repo === file.repo) {
      last.files.push(file);
    } else {
      const label = file.repo === "." ? "Orchestrator" : (file.repo.split("/").pop() ?? file.repo);
      groups.push({ label, repo: file.repo, files: [file] });
    }
  }
  return groups;
}

interface FilesPanelProps {
  files: TaskFile[] | undefined;
  projectId: string | undefined;
}

export function FilesPanel({ files, projectId }: FilesPanelProps) {
  // Shared across both sections below — the right panel is too narrow to comfortably
  // read a whole file inline, so any file click (feature file or project-context file)
  // opens the same full-screen Dialog rather than an inline preview. Only one file can
  // be open at a time, so one piece of state covers the whole panel.
  const [dialogFile, setDialogFile] = useState<{ name: string; path: string } | null>(null);
  const { data: dialogContent } = useFileContent(dialogFile?.path);

  const { data: contextFiles, refetch: refetchContextFiles } = useProjectContextFiles(projectId);
  const contextGroups = groupContextFiles(contextFiles ?? []);
  const showGroupLabels = !(contextGroups.length === 1 && contextGroups[0]?.repo === ".");

  const [deleteTarget, setDeleteTarget] = useState<ProjectContextFile | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  async function handleConfirmDelete() {
    if (!deleteTarget || !projectId) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteProjectContextFile(projectId, deleteTarget.path);
      if (dialogFile?.path === deleteTarget.path) setDialogFile(null);
      setDeleteTarget(null);
      refetchContextFiles();
    } catch (err) {
      setDeleteError(err instanceof ApiError ? err.message : "Failed to delete file.");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <>
      <SectionLabel>Files</SectionLabel>
      <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 4 }}>
        {(files ?? []).map((file) => (
          <FileListItem
            key={file.name}
            name={file.name}
            meta={file.modified_at ? new Date(file.modified_at).toLocaleString() : "-"}
            badge={BADGE_BY_STATUS[file.status]}
            active={file.path === dialogFile?.path}
            // draft = not generated yet, nothing to show — stays a non-interactive row
            // (FileListItem's onClick is optional, renders as a plain div without it).
            onClick={file.status !== "draft" ? () => setDialogFile(file) : undefined}
          />
        ))}
      </div>

      {contextGroups.length > 0 ? (
        <div style={{ marginTop: 24 }}>
          <SectionLabel>Project Context</SectionLabel>
          <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 12 }}>
            {contextGroups.map((group) => {
              const items = group.files.map((file) => (
                <FileListItem
                  key={`${file.repo}:${file.path}`}
                  name={file.name}
                  meta={file.modified_at ? new Date(file.modified_at).toLocaleString() : "-"}
                  active={file.path === dialogFile?.path}
                  onClick={() => setDialogFile(file)}
                  onDelete={() => setDeleteTarget(file)}
                />
              ));
              return showGroupLabels ? (
                <CollapsibleSection key={group.repo} title={group.label}>
                  {items}
                </CollapsibleSection>
              ) : (
                <div key={group.repo} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  {items}
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      <Dialog open={dialogFile !== null} onClose={() => setDialogFile(null)} title={dialogFile?.name ?? ""} size="large">
        {dialogContent ? renderMarkdown(dialogContent) : "Loading…"}
      </Dialog>

      <ConfirmDialog
        open={deleteTarget !== null}
        onClose={() => {
          setDeleteTarget(null);
          setDeleteError(null);
        }}
        onConfirm={() => void handleConfirmDelete()}
        title={`Delete ${deleteTarget?.name ?? ""}?`}
        confirming={deleting}
        message={
          <>
            This clears the file so the next context refresh (or a manual edit) can replace it. This can't be
            undone.
            {deleteError ? (
              <span style={{ display: "block", marginTop: 8, color: "var(--error)" }}>{deleteError}</span>
            ) : null}
          </>
        }
      />
    </>
  );
}
