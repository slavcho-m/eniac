import { useState } from "react";
import { Dialog, FileListItem, SectionLabel } from "@/components";
import type { BadgeVariant } from "@/components";
import { useFileContent } from "@/hooks/useFileContent";
import { renderMarkdown } from "@/lib/renderMarkdown";
import type { TaskFile, TaskFileStatus } from "@/types/api";
import { ProjectContextFiles } from "./ProjectContextFiles";

const BADGE_BY_STATUS: Record<TaskFileStatus, { variant: BadgeVariant; label: string }> = {
  approved: { variant: "success", label: "Approved" },
  awaiting_approval: { variant: "warning", label: "Awaiting Approval" },
  draft: { variant: "neutral", label: "Draft" },
};

interface FilesPanelProps {
  /** Omitted (ProjectPage's home-page usage) means "no task, don't show the feature-files
   * section at all" — distinct from an empty array, which would just render nothing under
   * a "Files" heading for no reason. */
  files?: TaskFile[];
  projectId: string | undefined;
}

export function FilesPanel({ files, projectId }: FilesPanelProps) {
  const [dialogFile, setDialogFile] = useState<TaskFile | null>(null);
  const { data: dialogContent } = useFileContent(dialogFile?.path);

  return (
    <>
      {files ? (
        <>
          <SectionLabel>Files</SectionLabel>
          <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 4 }}>
            {files.map((file) => (
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
        </>
      ) : null}

      <ProjectContextFiles projectId={projectId} />

      <Dialog open={dialogFile !== null} onClose={() => setDialogFile(null)} title={dialogFile?.name ?? ""} size="large">
        {dialogContent ? renderMarkdown(dialogContent) : "Loading…"}
      </Dialog>
    </>
  );
}
