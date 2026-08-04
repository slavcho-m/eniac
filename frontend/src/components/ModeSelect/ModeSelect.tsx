import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/cn";
import { TASK_MODES } from "@/lib/taskModes";
import type { TaskMode } from "@/lib/taskModes";
import styles from "./ModeSelect.module.css";

export type { TaskMode };

interface ModeSelectProps {
  value: TaskMode;
  onChange: (mode: TaskMode) => void;
  disabled?: boolean;
  /** Native tooltip on the trigger button -- e.g. explaining why it's disabled once a task
   * already exists. Browsers show `title` on hover even for a disabled button. */
  title?: string;
}

/** Mode picker for the new-task composer footer. Locked in once a task exists — this
 * component only owns its own open/closed state, the chosen value is fully controlled. */
export function ModeSelect({ value, onChange, disabled, title }: ModeSelectProps) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ bottom: 0, left: 0 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const current = TASK_MODES[value];

  useEffect(() => {
    if (!open) return undefined;
    function handlePointerDown(e: MouseEvent) {
      const target = e.target;
      if (!(target instanceof Node)) return;
      if (triggerRef.current?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
      setOpen(false);
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  function toggleOpen() {
    if (!open && triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      setPosition({ bottom: window.innerHeight - rect.top + 6, left: rect.left });
    }
    setOpen((o) => !o);
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={styles.trigger}
        onClick={toggleOpen}
        disabled={disabled}
        title={title}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <current.icon size={13} strokeWidth={1.75} />
        {current.label}
      </button>
      {open
        ? createPortal(
            <div
              ref={menuRef}
              className={styles.menu}
              role="menu"
              style={{ bottom: position.bottom, left: position.left }}
            >
              {Object.values(TASK_MODES).map((mode) => (
                <button
                  key={mode.value}
                  type="button"
                  className={cn(styles.option, mode.value === value && styles.optionActive)}
                  role="menuitem"
                  aria-label={mode.label}
                  disabled={mode.disabled}
                  onClick={() => {
                    onChange(mode.value);
                    setOpen(false);
                  }}
                >
                  <mode.icon size={13} strokeWidth={1.75} className={styles.optionIcon} />
                  <span className={styles.optionText}>
                    <span className={styles.optionLabel}>{mode.label}</span>
                    <span className={styles.optionDescription}>{mode.description}</span>
                  </span>
                </button>
              ))}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
