import type { HTMLAttributes } from "react";
import styles from "./SectionLabel.module.css";

export function SectionLabel({ children, className, ...rest }: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span className={[styles.label, className].filter(Boolean).join(" ")} {...rest}>
      {children}
    </span>
  );
}
