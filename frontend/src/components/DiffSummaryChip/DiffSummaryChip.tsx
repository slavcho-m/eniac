import { cn } from "@/lib/cn";
import { Badge } from "../Badge/Badge";
import styles from "./DiffSummaryChip.module.css";

export type DiffChangeKind = "new" | "modified" | "deleted";

const VARIANT_BY_KIND = { new: "success", modified: "warning", deleted: "error" } as const;
const LABEL_BY_KIND = { new: "NEW", modified: "MODIFIED", deleted: "DELETED" } as const;
const SELECTED_CLASS_BY_KIND = {
  new: styles.selectedSuccess,
  modified: styles.selectedWarning,
  deleted: styles.selectedError,
} as const;

interface DiffSummaryChipProps {
  kind: DiffChangeKind;
  filename: string;
  added: number;
  removed: number;
  selected?: boolean;
  onClick?: () => void;
}

export function DiffSummaryChip({
  kind,
  filename,
  added,
  removed,
  selected = false,
  onClick,
}: DiffSummaryChipProps) {
  return (
    <button
      type="button"
      className={cn(styles.chip, selected && SELECTED_CLASS_BY_KIND[kind])}
      onClick={onClick}
    >
      <div className={styles.top}>
        <Badge variant={VARIANT_BY_KIND[kind]}>{LABEL_BY_KIND[kind]}</Badge>
        <span className={styles.stat}>
          <span className={styles.added}>+{added}</span> <span className={styles.removed}>-{removed}</span>
        </span>
      </div>
      <span className={styles.filename}>{filename}</span>
    </button>
  );
}
