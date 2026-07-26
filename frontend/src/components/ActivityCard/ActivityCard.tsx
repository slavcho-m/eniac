import { useState, type CSSProperties, type ReactNode } from "react";
import { CheckCircle2, ChevronRight } from "lucide-react";
import { cn } from "@/lib/cn";
import styles from "./ActivityCard.module.css";

interface ActivityCardProps {
  title: string;
  timestamp?: string;
  defaultExpanded?: boolean;
  /** "pending" (default) shows a pulsing dot and an animated title — this component is
   * only ever used for in-progress activity today. "done" is here for whenever a
   * genuinely-finished activity needs this card; nothing uses it yet. */
  status?: "pending" | "done";
  /** Defaults on; LiveRunView turns it off for now — while output isn't actually
   * streamed, there's nothing behind the toggle to reveal. */
  collapsible?: boolean;
  children?: ReactNode;
}

function WaveTitle({ text }: { text: string }) {
  return (
    <>
      {Array.from(text).map((char, i) => (
        <span
          // eslint-disable-next-line react/no-array-index-key -- static string, position is the identity
          key={i}
          className={styles.waveChar}
          // CSS custom properties aren't part of the CSSProperties type.
          // eslint-disable-next-line typescript/no-unsafe-type-assertion
          style={{ "--char-index": i } as CSSProperties}
        >
          {char}
        </span>
      ))}
    </>
  );
}

export function ActivityCard({
  title,
  timestamp,
  defaultExpanded = false,
  status = "pending",
  collapsible = true,
  children,
}: ActivityCardProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const toggleable = collapsible && Boolean(children);
  const showContent = Boolean(children) && (!collapsible || expanded);

  return (
    <div className={styles.card}>
      <button
        type="button"
        className={styles.header}
        disabled={!toggleable}
        onClick={() => setExpanded((v) => !v)}
      >
        <span className={styles.icon}>
          {status === "done" ? (
            <CheckCircle2 size={16} strokeWidth={2} />
          ) : (
            <span className={styles.pulseDot} />
          )}
        </span>
        <span className={styles.title}>
          {status === "pending" ? <WaveTitle text={title} /> : title}
        </span>
        {timestamp ? <span className={styles.timestamp}>{timestamp}</span> : null}
        {toggleable ? (
          <span className={cn(styles.chevron, expanded && styles.chevronOpen)}>
            <ChevronRight size={14} strokeWidth={2} />
          </span>
        ) : null}
      </button>
      {showContent ? <div className={styles.content}>{children}</div> : null}
    </div>
  );
}
