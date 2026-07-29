import { File, Folder, Trash2 } from "lucide-react";
import { cn } from "@/lib/cn";
import { Badge, type BadgeVariant } from "../Badge/Badge";
import styles from "./FileListItem.module.css";

interface FileListItemProps {
  name: string;
  meta?: string;
  badge?: { variant: BadgeVariant; label: string };
  kind?: "file" | "folder";
  active?: boolean;
  onClick?: () => void;
  onDelete?: () => void;
}

export function FileListItem({
  name,
  meta,
  badge,
  kind = "file",
  active = false,
  onClick,
  onDelete,
}: FileListItemProps) {
  const Icon = kind === "folder" ? Folder : File;
  const content = (
    <>
      <span className={styles.icon}>
        <Icon size={15} strokeWidth={1.75} />
      </span>
      <span className={styles.text}>
        <span className={styles.name}>{name}</span>
        {meta ? <span className={styles.meta}>{meta}</span> : null}
      </span>
      {badge ? <Badge variant={badge.variant}>{badge.label}</Badge> : null}
    </>
  );

  // Only interactive rows are real <button>s — a row with no onClick (e.g. an empty
  // folder) has nothing to do, so it stays a plain, non-focusable <div>. onDelete needs
  // its own sibling <button> (not nested inside the main one, invalid HTML) — matches
  // NavListItem's same wrapper-div + main-button + delete-button structure.
  const main = onClick ? (
    <button type="button" className={styles.main} onClick={onClick}>
      {content}
    </button>
  ) : (
    <div className={styles.main}>{content}</div>
  );

  if (!onDelete) {
    return <div className={cn(styles.item, active && styles.active)}>{main}</div>;
  }

  return (
    <div className={cn(styles.item, active && styles.active)}>
      {main}
      <button
        type="button"
        className={styles.delete}
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
        aria-label={`Delete ${name}`}
      >
        <Trash2 size={13} strokeWidth={1.75} />
      </button>
    </div>
  );
}
