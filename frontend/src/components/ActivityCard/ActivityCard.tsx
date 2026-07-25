import { useState, type ReactNode } from "react";
import { CheckCircle2, ChevronRight } from "lucide-react";
import styles from "./ActivityCard.module.css";

interface ActivityCardProps {
  title: string;
  timestamp?: string;
  defaultExpanded?: boolean;
  children?: ReactNode;
}

export function ActivityCard({ title, timestamp, defaultExpanded = false, children }: ActivityCardProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const expandable = Boolean(children);

  return (
    <div className={styles.card}>
      <button
        type="button"
        className={styles.header}
        disabled={!expandable}
        onClick={() => setExpanded((v) => !v)}
      >
        <span className={styles.icon}>
          <CheckCircle2 size={16} strokeWidth={2} />
        </span>
        <span className={styles.title}>{title}</span>
        {timestamp && <span className={styles.timestamp}>{timestamp}</span>}
        {expandable && (
          <span className={[styles.chevron, expanded ? styles.chevronOpen : ""].filter(Boolean).join(" ")}>
            <ChevronRight size={14} strokeWidth={2} />
          </span>
        )}
      </button>
      {expandable && expanded && <div className={styles.content}>{children}</div>}
    </div>
  );
}
