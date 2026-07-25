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
      {lines.map((line, i) => (
        <div key={i} className={[styles.line, line.kind === "done" ? styles.done : ""].filter(Boolean).join(" ")}>
          <span className={styles.prefix}>{line.kind === "done" ? "✓" : "$"}</span>
          <span>{line.text}</span>
        </div>
      ))}
    </div>
  );
}
