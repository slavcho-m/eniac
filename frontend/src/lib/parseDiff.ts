import type { DiffChangeKind } from "@/components";
import type { DiffLine } from "@/components";

export interface ParsedFileDiff {
  filename: string;
  kind: DiffChangeKind;
  added: number;
  removed: number;
  lines: DiffLine[];
}

const FILE_HEADER = /^diff --git a\/(.+?) b\/(.+)$/;
const HUNK_HEADER = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

/**
 * Parses `git diff`'s unified-diff text output (exactly what runs.py stores in
 * `runs.diff`/`task_items.latest_run.diff`) into per-file structures DiffViewer/
 * DiffSummaryChip can render directly. Scoped to what `git diff` actually produces —
 * this isn't a general-purpose diff parser for arbitrary/untrusted input.
 */
export function parseDiff(raw: string): ParsedFileDiff[] {
  if (!raw.trim()) return [];

  const files: ParsedFileDiff[] = [];
  // Split on "diff --git " header lines, keeping each file's block intact.
  const blocks = raw.split(/(?=^diff --git )/m).filter((block) => block.trim());

  for (const block of blocks) {
    const blockLines = block.split("\n");
    const headerMatch = FILE_HEADER.exec(blockLines[0] ?? "");
    const filename = headerMatch?.[2] ?? headerMatch?.[1] ?? "unknown file";

    let kind: DiffChangeKind = "modified";
    let added = 0;
    let removed = 0;
    const lines: DiffLine[] = [];
    let oldLineNumber = 0;
    let newLineNumber = 0;
    let sawHunk = false;

    for (const line of blockLines) {
      if (line.startsWith("new file mode")) {
        kind = "new";
      } else if (line.startsWith("deleted file mode")) {
        kind = "deleted";
      } else if (line.startsWith("@@")) {
        const hunkMatch = HUNK_HEADER.exec(line);
        if (hunkMatch?.[1] && hunkMatch[2]) {
          if (sawHunk) {
            lines.push({ type: "collapsed", content: "…" });
          }
          oldLineNumber = Number(hunkMatch[1]);
          newLineNumber = Number(hunkMatch[2]);
          sawHunk = true;
        }
      } else if (!sawHunk || line.startsWith("index ") || line.startsWith("---") || line.startsWith("+++")) {
        // Header lines before the first hunk — nothing to render.
        continue;
      } else if (line.startsWith("+")) {
        lines.push({ type: "add", lineNumber: newLineNumber, content: line.slice(1) });
        newLineNumber += 1;
        added += 1;
      } else if (line.startsWith("-")) {
        lines.push({ type: "remove", lineNumber: oldLineNumber, content: line.slice(1) });
        oldLineNumber += 1;
        removed += 1;
      } else if (line.startsWith(" ")) {
        lines.push({ type: "context", lineNumber: newLineNumber, content: line.slice(1) });
        oldLineNumber += 1;
        newLineNumber += 1;
      }
    }

    files.push({ filename, kind, added, removed, lines });
  }

  return files;
}
