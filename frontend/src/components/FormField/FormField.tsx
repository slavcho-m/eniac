import type { ReactNode } from "react";
import { SectionLabel } from "../SectionLabel/SectionLabel";
import styles from "./FormField.module.css";

interface FormFieldProps {
  label: string;
  helperText?: ReactNode;
  children: ReactNode;
}

export function FormField({ label, helperText, children }: FormFieldProps) {
  return (
    <div className={styles.field}>
      <SectionLabel>{label}</SectionLabel>
      {children}
      {helperText && <p className={styles.helper}>{helperText}</p>}
    </div>
  );
}
