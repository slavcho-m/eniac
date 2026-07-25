import { useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
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
        <span className={[styles.chevron, open ? styles.chevronOpen : ""].filter(Boolean).join(" ")}>
          <ChevronDown size={14} strokeWidth={1.75} />
        </span>
      </button>
      {open && <div className={styles.content}>{children}</div>}
    </div>
  );
}
