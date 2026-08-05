import { CircleHelp, PanelRightClose, PanelRightOpen } from "lucide-react";
import { useState, type ReactNode } from "react";
import { useOnboardingTourContext } from "@/hooks/useOnboardingTourContext";
import { cn } from "@/lib/cn";
import { HelpDialog } from "../HelpDialog/HelpDialog";
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
  const [helpOpen, setHelpOpen] = useState(false);
  const tour = useOnboardingTourContext();

  return (
    <div className={styles.shell}>
      <div className={styles.left} data-tour="left-nav">
        {left}
      </div>
      <div className={styles.mainOuter}>
        <div className={styles.mainHeader}>
          <button
            type="button"
            className={styles.helpButton}
            onClick={() => setHelpOpen(true)}
            aria-label="Help"
            title="Help"
            data-tour="help-button"
          >
            <CircleHelp size={14} strokeWidth={1.75} />
          </button>
        </div>
        <div className={styles.main} data-tour="main-content">
          {children}
        </div>
      </div>
      <HelpDialog open={helpOpen} onClose={() => setHelpOpen(false)} onStartTutorial={tour.startTutorial} />
      {right && (
        <div className={cn(styles.right, rightCollapsed && styles.rightCollapsed)}>
          <button
            type="button"
            className={styles.rightToggle}
            onClick={() => setRightCollapsed((v) => !v)}
            aria-label={rightCollapsed ? "Expand panel" : "Collapse panel"}
            data-tour="files-toggle"
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
