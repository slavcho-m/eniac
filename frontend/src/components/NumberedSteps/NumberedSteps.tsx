import type { ReactNode } from "react";
import styles from "./NumberedSteps.module.css";

interface NumberedStepsProps {
  steps: ReactNode[];
}

export function NumberedSteps({ steps }: NumberedStepsProps) {
  return (
    <ol className={styles.list}>
      {/* index-as-key: steps are a static, ordered, position-only list */}
      {steps.map((step, i) => (
        // eslint-disable-next-line react/no-array-index-key
        <li key={i} className={styles.step}>
          <span className={styles.number}>{i + 1}</span>
          <span className={styles.content}>{step}</span>
        </li>
      ))}
    </ol>
  );
}
