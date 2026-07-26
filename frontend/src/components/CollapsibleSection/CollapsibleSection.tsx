import { useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/cn";
import styles from "./CollapsibleSection.module.css";

interface CollapsibleSectionProps {
  title: string;
  defaultOpen?: boolean;
  children: ReactNode;
}

export function CollapsibleSection({ title, defaultOpen = false, children }: CollapsibleSectionProps) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className={styles.wrapper}>
      <button type="button" className={styles.trigger} onClick={() => setOpen((v) => !v)}>
        {title}
        <span className={cn(styles.chevron, open && styles.chevronOpen)}>
          <ChevronDown size={14} strokeWidth={1.75} />
        </span>
      </button>
      {open ? <div className={styles.content}>{children}</div> : null}
    </div>
  );
}
