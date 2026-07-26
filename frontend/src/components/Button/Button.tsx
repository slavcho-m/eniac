import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/cn";
import styles from "./Button.module.css";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "destructive" | "link";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  icon?: ReactNode;
}

export function Button({ variant = "secondary", icon, children, className, ...rest }: ButtonProps) {
  return (
    <button className={cn(styles.button, styles[variant], className)} {...rest}>
      {icon ? <span className={styles.icon}>{icon}</span> : null}
      <span className={styles.label}>{children}</span>
    </button>
  );
}
