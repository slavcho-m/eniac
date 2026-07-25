import type { ReactNode } from "react";
import { Pencil } from "lucide-react";
import styles from "./MarkdownPreviewCard.module.css";

interface MarkdownPreviewCardProps {
  filename: string;
  status?: string;
  onEdit?: () => void;
  children: ReactNode;
}

export function MarkdownPreviewCard({ filename, status, onEdit, children }: MarkdownPreviewCardProps) {
  return (
    <div className={styles.card}>
      <div className={styles.headerRow}>
        <span className={styles.filename}>{filename}</span>
        {status && <span className={styles.status}>{status}</span>}
        {onEdit && (
          <button type="button" className={styles.editLink} onClick={onEdit}>
            <Pencil size={12} strokeWidth={1.75} /> Edit
          </button>
        )}
      </div>
      <div className={styles.body}>{children}</div>
    </div>
  );
}
