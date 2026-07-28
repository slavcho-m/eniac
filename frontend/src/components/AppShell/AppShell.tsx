import { PanelRightClose, PanelRightOpen } from "lucide-react";
import { useState, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import styles from "./AppShell.module.css";

interface AppShellProps {
  left: ReactNode;
  right?: ReactNode;
  children: ReactNode;
}

export function AppShell({ left, right, children }: AppShellProps) {
  const [rightCollapsed, setRightCollapsed] = useState(false);

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
