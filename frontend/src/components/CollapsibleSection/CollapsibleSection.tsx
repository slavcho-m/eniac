import { useState, type ReactNode } from "react";
import { ChevronDown, Folder } from "lucide-react";
import { cn } from "@/lib/cn";
import styles from "./CollapsibleSection.module.css";

interface CollapsibleSectionProps {
  title: string;
  defaultOpen?: boolean;
  children: ReactNode;
}

/** Same visual pattern as ProjectSwitcher (folder icon + name in a bordered row) —
 * deliberately reused rather than invented fresh, just with the trailing icon swapped
 * for a chevron and the whole row itself as the toggle instead of a separate button. */
export function CollapsibleSection({ title, defaultOpen = false, children }: CollapsibleSectionProps) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className={styles.wrapper}>
      <button type="button" className={styles.trigger} onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <span className={styles.icon}>
          <Folder size={15} strokeWidth={1.75} />
        </span>
        <span className={styles.title}>{title}</span>
        <span className={cn(styles.chevron, open && styles.chevronOpen)}>
          <ChevronDown size={14} strokeWidth={1.75} />
        </span>
      </button>
      {open ? <div className={styles.content}>{children}</div> : null}
    </div>
  );
}
