import type { HTMLAttributes } from "react";
import { cn } from "@/lib/cn";
import styles from "./Badge.module.css";

export type BadgeVariant = "success" | "warning" | "error" | "info" | "neutral" | "deprecated";

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant: BadgeVariant;
}

export function Badge({ variant, children, className, ...rest }: BadgeProps) {
  return (
    <span className={cn(styles.badge, styles[variant], className)} {...rest}>
      {children}
    </span>
  );
}
