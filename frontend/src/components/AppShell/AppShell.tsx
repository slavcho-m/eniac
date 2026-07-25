import type { ReactNode } from "react";
import styles from "./AppShell.module.css";

interface AppShellProps {
  left: ReactNode;
  right?: ReactNode;
  children: ReactNode;
}

export function AppShell({ left, right, children }: AppShellProps) {
  return (
    <div className={styles.shell}>
      <div className={styles.left}>{left}</div>
      <div className={styles.main}>{children}</div>
      {right && <div className={styles.right}>{right}</div>}
    </div>
  );
}
