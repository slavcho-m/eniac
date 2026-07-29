import { Folder, Settings } from "lucide-react";
import styles from "./ProjectSwitcher.module.css";

interface ProjectSwitcherProps {
  name: string;
  onClick?: () => void;
  onSettingsClick?: () => void;
}

/** Only the name area (folder icon + text) is a nav link, to the project's home page —
 * the settings icon is a separate sibling action, same wrapper-div + button(s) pattern
 * already used by FileListItem/NavListItem for "main action + trailing icon action". */
export function ProjectSwitcher({ name, onClick, onSettingsClick }: ProjectSwitcherProps) {
  const main = (
    <>
      <span className={styles.icon}>
        <Folder size={15} strokeWidth={1.75} />
      </span>
      <span className={styles.name}>{name}</span>
    </>
  );

  return (
    <div className={styles.switcher}>
      {onClick ? (
        <button type="button" className={styles.main} onClick={onClick}>
          {main}
        </button>
      ) : (
        <div className={styles.main}>{main}</div>
      )}
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
