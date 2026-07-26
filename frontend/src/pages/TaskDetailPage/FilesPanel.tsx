import { useState } from "react";
import { FileListItem, MarkdownPreviewCard, SectionLabel } from "@/components";
import type { BadgeVariant } from "@/components";
import { useFileContent } from "@/hooks/useFileContent";
import { renderMarkdown } from "@/lib/renderMarkdown";
import type { TaskFile, TaskFileStatus } from "@/types/api";

const BADGE_BY_STATUS: Record<TaskFileStatus, { variant: BadgeVariant; label: string }> = {
  approved: { variant: "success", label: "Approved" },
  awaiting_approval: { variant: "warning", label: "Awaiting Approval" },
  draft: { variant: "neutral", label: "Draft" },
};

interface FilesPanelProps {
  files: TaskFile[] | undefined;
}

export function FilesPanel({ files }: FilesPanelProps) {
  const [selectedPath, setSelectedPath] = useState<string | null>(null);

  const activeFile: TaskFile | undefined =
    files?.find((file) => file.path === selectedPath) ??
    files?.find((file) => file.status === "awaiting_approval") ??
    files?.find((file) => file.status === "approved");

  const previewable = activeFile && activeFile.status !== "draft";
  const { data: content } = useFileContent(previewable ? activeFile.path : undefined);

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
            active={file.path === activeFile?.path}
            onClick={() => setSelectedPath(file.path)}
          />
        ))}
      </div>

      {previewable ? (
        <div style={{ marginTop: 20 }}>
          <MarkdownPreviewCard
            filename={activeFile.name}
            status={activeFile.status === "approved" ? "Approved" : "Ready for review"}
          >
            {content ? renderMarkdown(content) : "Loading…"}
          </MarkdownPreviewCard>
        </div>
      ) : null}
    </>
  );
}
