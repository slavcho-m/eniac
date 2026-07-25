import type { HTMLAttributes } from "react";
import styles from "./StatusBanner.module.css";

export type StatusBannerVariant = "success" | "warning" | "error" | "info";

interface StatusBannerProps extends HTMLAttributes<HTMLDivElement> {
  variant: StatusBannerVariant;
}

export function StatusBanner({ variant, children, className, ...rest }: StatusBannerProps) {
  return (
    <div className={[styles.banner, styles[variant], className].filter(Boolean).join(" ")} {...rest}>
      <span className={styles.dot} />
      <span>{children}</span>
    </div>
  );
}
