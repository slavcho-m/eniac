import type { HTMLAttributes } from "react";
import { cn } from "@/lib/cn";
import styles from "./SectionLabel.module.css";

export function SectionLabel({ children, className, ...rest }: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span className={cn(styles.label, className)} {...rest}>
      {children}
    </span>
  );
}
