import { cn } from "@/lib/cn";
import styles from "./TerminalLog.module.css";

export interface TerminalLogLine {
  /** "command" renders a "$" prefix, "done" renders a "✓" prefix in success color */
  kind: "command" | "done";
  text: string;
}

interface TerminalLogProps {
  lines: TerminalLogLine[];
}

export function TerminalLog({ lines }: TerminalLogProps) {
  return (
    <div className={styles.log}>
      {/* index-as-key: lines are a static, ordered, position-only list with no natural id */}
      {lines.map((line, i) => (
        // eslint-disable-next-line react/no-array-index-key
        <div key={i} className={cn(styles.line, line.kind === "done" && styles.done)}>
          <span className={styles.prefix}>{line.kind === "done" ? "✓" : "$"}</span>
          <span>{line.text}</span>
        </div>
      ))}
    </div>
  );
}
