import type { ReactNode } from "react";
import { useState } from "react";
import { Eye, Pencil } from "lucide-react";
import { cn } from "@/lib/cn";
import { Dialog } from "../Dialog/Dialog";
import styles from "./MarkdownPreviewCard.module.css";

interface MarkdownPreviewCardProps {
  filename: string;
  onEdit?: () => void;
  children: ReactNode;
}

/**
 * No "Approved"/"Ready for review" status text — the file list right above this already
 * shows that via a badge, so it was pure repetition. Replaced with a "View Full Screen"
 * button (same expand-into-a-larger-dialog pattern as DiffViewer's "View full file").
 */
export function MarkdownPreviewCard({ filename, onEdit, children }: MarkdownPreviewCardProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className={styles.card}>
      <div className={styles.headerRow}>
        <span className={styles.filename}>{filename}</span>
        <button type="button" className={styles.viewLink} onClick={() => setExpanded(true)}>
          <Eye size={12} strokeWidth={1.75} /> View Full Screen
        </button>
        {onEdit && (
          <button type="button" className={styles.editLink} onClick={onEdit}>
            <Pencil size={12} strokeWidth={1.75} /> Edit
          </button>
        )}
      </div>
      <div className={styles.body}>{children}</div>

      <Dialog open={expanded} onClose={() => setExpanded(false)} title={filename} size="large">
        <div className={cn(styles.body, styles.bare)}>{children}</div>
      </Dialog>
    </div>
  );
}
