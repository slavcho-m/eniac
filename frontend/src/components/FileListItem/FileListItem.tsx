import { File, Folder } from "lucide-react";
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

export function FileListItem({ name, meta, badge, kind = "file", active = false, onClick }: FileListItemProps) {
  const Icon = kind === "folder" ? Folder : File;

  return (
    <div className={[styles.item, active ? styles.active : ""].filter(Boolean).join(" ")} onClick={onClick}>
      <span className={styles.icon}>
        <Icon size={15} strokeWidth={1.75} />
      </span>
      <span className={styles.text}>
        <span className={styles.name}>{name}</span>
        {meta && <span className={styles.meta}>{meta}</span>}
      </span>
      {badge && <Badge variant={badge.variant}>{badge.label}</Badge>}
    </div>
  );
}
