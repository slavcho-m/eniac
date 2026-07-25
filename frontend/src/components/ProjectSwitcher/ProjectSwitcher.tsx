import { ChevronDown, Folder } from "lucide-react";
import styles from "./ProjectSwitcher.module.css";

interface ProjectSwitcherProps {
  name: string;
  onClick?: () => void;
}

export function ProjectSwitcher({ name, onClick }: ProjectSwitcherProps) {
  return (
    <button type="button" className={styles.switcher} onClick={onClick}>
      <span className={styles.icon}>
        <Folder size={15} strokeWidth={1.75} />
      </span>
      <span className={styles.name}>{name}</span>
      <span className={styles.chevron}>
        <ChevronDown size={14} strokeWidth={1.75} />
      </span>
    </button>
  );
}
