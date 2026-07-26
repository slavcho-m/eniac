import { File, Folder } from "lucide-react";
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
}

export function FileListItem({
  name,
  meta,
  badge,
  kind = "file",
  active = false,
  onClick,
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
  // folder) has nothing to do, so it stays a plain, non-focusable <div>.
  if (onClick) {
    return (
      <button type="button" className={cn(styles.item, active && styles.active)} onClick={onClick}>
        {content}
      </button>
    );
  }
  return <div className={cn(styles.item, active && styles.active)}>{content}</div>;
}
