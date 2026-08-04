import { Trash2 } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import styles from "./NavListItem.module.css";

interface NavListItemProps {
  icon: ReactNode;
  /** Usually a string; a non-string node (e.g. a loading placeholder) is fine too — the
   * delete button's accessible name falls back to something generic in that case, since it
   * can't be built from arbitrary JSX. */
  label: ReactNode;
  meta?: string;
  active?: boolean;
  /** Left-border color-code for a terminal outcome (e.g. a task's completed/failed status)
   * — omit for items with no such notion. Only shown when not `active`, since the active
   * highlight already owns that border. */
  status?: "success" | "error";
  onClick?: () => void;
  onDelete?: () => void;
}

export function NavListItem({ icon, label, meta, active = false, status, onClick, onDelete }: NavListItemProps) {
  return (
    <div
      className={cn(
        styles.item,
        active ? styles.active : status && styles[status],
      )}
    >
      <button type="button" className={styles.main} onClick={onClick}>
        <span className={styles.icon}>{icon}</span>
        <span className={styles.label}>{label}</span>
        {meta ? <span className={styles.meta}>{meta}</span> : null}
      </button>
      {onDelete ? (
        <button
          type="button"
          className={styles.delete}
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          aria-label={`Delete ${typeof label === "string" ? label : "item"}`}
        >
          <Trash2 size={13} strokeWidth={1.75} />
        </button>
      ) : null}
    </div>
  );
}
