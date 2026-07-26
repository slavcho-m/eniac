import { Trash2 } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import styles from "./NavListItem.module.css";

interface NavListItemProps {
  icon: ReactNode;
  label: string;
  meta?: string;
  active?: boolean;
  onClick?: () => void;
  onDelete?: () => void;
}

export function NavListItem({ icon, label, meta, active = false, onClick, onDelete }: NavListItemProps) {
  return (
    <div className={cn(styles.item, active && styles.active)}>
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
          aria-label={`Delete ${label}`}
        >
          <Trash2 size={13} strokeWidth={1.75} />
        </button>
      ) : null}
    </div>
  );
}
