import type { ReactNode } from "react";
import styles from "./NumberedSteps.module.css";

interface NumberedStepsProps {
  steps: ReactNode[];
}

export function NumberedSteps({ steps }: NumberedStepsProps) {
  return (
    <ol className={styles.list}>
      {steps.map((step, i) => (
        <li key={i} className={styles.step}>
          <span className={styles.number}>{i + 1}</span>
          <span className={styles.content}>{step}</span>
        </li>
      ))}
    </ol>
  );
}
