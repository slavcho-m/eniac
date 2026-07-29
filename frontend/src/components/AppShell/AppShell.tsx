import { PanelRightClose, PanelRightOpen } from "lucide-react";
import { useState, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import styles from "./AppShell.module.css";

interface AppShellProps {
  left: ReactNode;
  right?: ReactNode;
  /** TaskDetailPage wants the files panel open by default; ProjectPage (home) wants it
   * out of the way of the prompt until the user asks for it. */
  defaultRightCollapsed?: boolean;
  children: ReactNode;
}

export function AppShell({ left, right, defaultRightCollapsed = false, children }: AppShellProps) {
  const [rightCollapsed, setRightCollapsed] = useState(defaultRightCollapsed);

  return (
    <div className={styles.shell}>
      <div className={styles.left}>{left}</div>
      <div className={styles.main}>{children}</div>
      {right && (
        <div className={cn(styles.right, rightCollapsed && styles.rightCollapsed)}>
          <button
            type="button"
            className={styles.rightToggle}
            onClick={() => setRightCollapsed((v) => !v)}
            aria-label={rightCollapsed ? "Expand panel" : "Collapse panel"}
          >
            {rightCollapsed ? (
              <PanelRightOpen size={14} strokeWidth={1.75} />
            ) : (
              <PanelRightClose size={14} strokeWidth={1.75} />
            )}
          </button>
          <div className={styles.rightInner}>{right}</div>
        </div>
      )}
    </div>
  );
}
