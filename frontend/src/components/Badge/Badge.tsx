import type { HTMLAttributes } from "react";
import styles from "./Badge.module.css";

export type BadgeVariant = "success" | "warning" | "error" | "info" | "neutral";

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant: BadgeVariant;
}

export function Badge({ variant, children, className, ...rest }: BadgeProps) {
  return (
    <span className={[styles.badge, styles[variant], className].filter(Boolean).join(" ")} {...rest}>
      {children}
    </span>
  );
}
