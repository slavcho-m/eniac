import { useState } from "react";
import { CollapsibleSection, ConfirmDialog, Dialog, FileListItem, SectionLabel } from "@/components";
import { useFileContent } from "@/hooks/useFileContent";
import { useProjectContextFiles } from "@/hooks/useProjectContextFiles";
import { ApiError, deleteProjectContextFile } from "@/lib/api";
import { renderMarkdown } from "@/lib/renderMarkdown";
import type { ProjectContextFile } from "@/types/api";

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

interface ProjectContextFilesProps {
  projectId: string | undefined;
}

/** Self-contained: fetches its own data, owns its own preview/delete dialogs. Shared
 * between FilesPanel and ProjectPage the same way LiveRunView is shared between
 * TaskDetailPage and ProjectPage — one real component, not two near-duplicates. Whether
 * this whole section starts visible is the caller's call (AppShell's right-panel collapse,
 * not a second collapse nested inside it) — this component itself only ever collapses its
 * own per-repo sub-groups, same as before it was extracted.*/
export function ProjectContextFiles({ projectId }: ProjectContextFilesProps) {
  const { data: contextFiles, refetch: refetchContextFiles } = useProjectContextFiles(projectId);
  const contextGroups = groupContextFiles(contextFiles ?? []);
  const showGroupLabels = !(contextGroups.length === 1 && contextGroups[0]?.repo === ".");

  const [dialogFile, setDialogFile] = useState<ProjectContextFile | null>(null);
  const { data: dialogContent } = useFileContent(dialogFile?.path);

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

  if (contextGroups.length === 0) return null;

  return (
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
    </div>
  );
}
