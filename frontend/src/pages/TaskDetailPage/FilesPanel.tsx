import { useEffect, useState } from "react";
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
  // undefined: no manual selection yet, fall back to the smart default below.
  // null: user explicitly deselected — show nothing, don't fall back.
  // string: that file, explicitly picked.
  const [selectedPath, setSelectedPath] = useState<string | null | undefined>(undefined);

  const smartDefaultPath =
    files?.find((file) => file.status === "awaiting_approval")?.path ??
    files?.find((file) => file.status === "approved")?.path;

  // Re-arm the smart default whenever the file it would pick changes (e.g. a new file
  // becomes awaiting_approval after the previous one was approved) — otherwise a prior
  // manual selection or explicit deselection stays pinned forever and never follows the
  // task to whatever's newly relevant.
  useEffect(() => {
    setSelectedPath(undefined);
  }, [smartDefaultPath]);

  const activeFile: TaskFile | undefined =
    selectedPath === undefined
      ? files?.find((file) => file.path === smartDefaultPath)
      : files?.find((file) => file.path === selectedPath);

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
            onClick={() => setSelectedPath(file.path === activeFile?.path ? null : file.path)}
          />
        ))}
      </div>

      {previewable ? (
        <div style={{ marginTop: 20 }}>
          <MarkdownPreviewCard filename={activeFile.name}>
            {content ? renderMarkdown(content) : "Loading…"}
          </MarkdownPreviewCard>
        </div>
      ) : null}
    </>
  );
}
