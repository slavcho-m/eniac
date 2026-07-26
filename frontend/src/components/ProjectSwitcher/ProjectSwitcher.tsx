import { Folder, Settings } from "lucide-react";
import styles from "./ProjectSwitcher.module.css";

interface ProjectSwitcherProps {
  name: string;
  onSettingsClick?: () => void;
}

/** Static header — the current project's name, not a nav link (see layout/Sidebar's
 * "View All Projects" button for that). Only the settings icon is interactive. */
export function ProjectSwitcher({ name, onSettingsClick }: ProjectSwitcherProps) {
  return (
    <div className={styles.switcher}>
      <span className={styles.icon}>
        <Folder size={15} strokeWidth={1.75} />
      </span>
      <span className={styles.name}>{name}</span>
      {onSettingsClick ? (
        <button
          type="button"
          className={styles.settings}
          onClick={onSettingsClick}
          aria-label={`${name} settings`}
        >
          <Settings size={14} strokeWidth={1.75} />
        </button>
      ) : null}
    </div>
  );
}
