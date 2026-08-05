import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/cn";
import { SectionLabel } from "../SectionLabel/SectionLabel";
import styles from "./FormField.module.css";

interface FormFieldProps extends HTMLAttributes<HTMLDivElement> {
  label: string;
  helperText?: ReactNode;
  children: ReactNode;
}

export function FormField({ label, helperText, children, className, ...rest }: FormFieldProps) {
  return (
    <div className={cn(styles.field, className)} {...rest}>
      <SectionLabel>{label}</SectionLabel>
      {children}
      {helperText && <p className={styles.helper}>{helperText}</p>}
    </div>
  );
}
