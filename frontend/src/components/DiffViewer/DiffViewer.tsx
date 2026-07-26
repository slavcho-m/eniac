import { Check, Copy, Eye } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { Badge, type BadgeVariant } from "../Badge/Badge";
import { Dialog } from "../Dialog/Dialog";
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
}

function toDiffText(lines: DiffLine[]): string {
  return lines
    .filter((line) => line.type !== "collapsed")
    .map((line) => `${line.type === "add" ? "+" : line.type === "remove" ? "-" : " "}${line.content}`)
    .join("\n");
}

function CodeLines({ lines }: { lines: DiffLine[] }) {
  return (
    <div className={styles.code}>
      {/* .codeInner is display:inline-block so its own (shrink-to-fit) width matches
       * whichever .line is widest — every line then stretches to that same width via
       * ordinary width:auto, so a short line's add/remove background still spans the
       * full horizontal-scroll extent instead of stopping at its own text. */}
      <div className={styles.codeInner}>
        {/* index-as-key: a diff's lines are a static, ordered, position-only list */}
        {lines.map((line, i) => {
          if (line.type === "collapsed") {
            return (
              // eslint-disable-next-line react/no-array-index-key
              <div key={i} className={cn(styles.line, styles.collapsed)}>
                {line.content}
              </div>
            );
          }
          return (
            // eslint-disable-next-line react/no-array-index-key
            <div key={i} className={cn(styles.line, styles[line.type])}>
              <span className={styles.lineNumber}>{line.lineNumber ?? ""}</span>
              <span className={styles.content}>
                {line.type === "add" ? "+ " : line.type === "remove" ? "- " : "  "}
                {line.content}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function DiffViewer({ filename, badge, lines }: DiffViewerProps) {
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // A different file's diff shouldn't inherit the previous file's "Copied!" state.
  useEffect(() => {
    setCopied(false);
  }, [filename]);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  async function handleCopy() {
    await navigator.clipboard.writeText(toDiffText(lines));
    setCopied(true);
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => setCopied(false), 5000);
  }

  return (
    <div className={styles.viewer}>
      <div className={styles.header}>
        {badge ? <Badge variant={badge.variant}>{badge.label}</Badge> : null}
        <span className={styles.filename}>{filename}</span>
        <button type="button" className={styles.copyButton} onClick={handleCopy} aria-label="Copy diff">
          {copied ? <Check size={14} strokeWidth={1.75} /> : <Copy size={14} strokeWidth={1.75} />}
        </button>
      </div>

      <CodeLines lines={lines} />

      <div className={styles.footer}>
        <button type="button" className={styles.footerLink} onClick={handleCopy}>
          {copied ? <Check size={13} strokeWidth={1.75} /> : <Copy size={13} strokeWidth={1.75} />}
          {copied ? "Copied!" : "Copy diff"}
        </button>
        <button type="button" className={styles.footerLink} onClick={() => setExpanded(true)}>
          <Eye size={13} strokeWidth={1.75} /> View full file
        </button>
      </div>

      <Dialog open={expanded} onClose={() => setExpanded(false)} title={filename} size="large">
        <CodeLines lines={lines} />
      </Dialog>
    </div>
  );
}
