import type { ReactNode } from "react";
import styles from "./NumberedSteps.module.css";

export type StepVariant = "done" | "current" | "pending";

interface NumberedStepsProps {
  steps: ReactNode[];
  /** Per-step visual state, same length/order as `steps` -- omit entirely for the plain
   * unstated numbered list (every step renders identically, as before this existed). */
  variants?: StepVariant[];
}

export function NumberedSteps({ steps, variants }: NumberedStepsProps) {
  return (
    <ol className={styles.list}>
      {/* index-as-key: steps are a static, ordered, position-only list */}
      {steps.map((step, i) => {
        const variant = variants?.[i];
        return (
          // eslint-disable-next-line react/no-array-index-key
          <li key={i} className={`${styles.step} ${(variant && styles[variant]) ?? ""}`}>
            <span className={styles.number}>{variant === "done" ? "✓" : i + 1}</span>
            <span className={styles.content}>{step}</span>
          </li>
        );
      })}
    </ol>
  );
}
