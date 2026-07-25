import { Copy, Eye, SkipForward } from "lucide-react";
import { Badge, type BadgeVariant } from "../Badge/Badge";
import styles from "./DiffViewer.module.css";

export interface DiffLine {
  type: "add" | "remove" | "context" | "collapsed";
  lineNumber?: number;
  content: string;
}

interface DiffViewerProps {
  filename: string;
  badge?: { variant: BadgeVariant; label: string };
  lines: DiffLine[];
  onCopy?: () => void;
  onViewFullFile?: () => void;
  onSkip?: () => void;
}

export function DiffViewer({ filename, badge, lines, onCopy, onViewFullFile, onSkip }: DiffViewerProps) {
  return (
    <div className={styles.viewer}>
      <div className={styles.header}>
        {badge && <Badge variant={badge.variant}>{badge.label}</Badge>}
        <span className={styles.filename}>{filename}</span>
        <button type="button" className={styles.copyButton} onClick={onCopy} aria-label="Copy diff">
          <Copy size={14} strokeWidth={1.75} />
        </button>
      </div>

      <div className={styles.code}>
        {lines.map((line, i) => {
          if (line.type === "collapsed") {
            return (
              <div key={i} className={[styles.line, styles.collapsed].join(" ")}>
                {line.content}
              </div>
            );
          }
          return (
            <div key={i} className={[styles.line, styles[line.type]].join(" ")}>
              <span className={styles.lineNumber}>{line.lineNumber ?? ""}</span>
              <span className={styles.content}>
                {line.type === "add" ? "+ " : line.type === "remove" ? "- " : "  "}
                {line.content}
              </span>
            </div>
          );
        })}
      </div>

      <div className={styles.footer}>
        <button type="button" className={styles.footerLink} onClick={onCopy}>
          <Copy size={13} strokeWidth={1.75} /> Copy diff
        </button>
        <button type="button" className={styles.footerLink} onClick={onViewFullFile}>
          <Eye size={13} strokeWidth={1.75} /> View full file
        </button>
        <button type="button" className={styles.footerLink} onClick={onSkip}>
          <SkipForward size={13} strokeWidth={1.75} /> Skip this file
        </button>
      </div>
    </div>
  );
}
