import type { InputHTMLAttributes, ReactNode } from "react";
import styles from "./Checkbox.module.css";

interface CheckboxProps extends InputHTMLAttributes<HTMLInputElement> {
  label: ReactNode;
  description?: ReactNode;
}

export function Checkbox({ label, description, id, className, ...rest }: CheckboxProps) {
  return (
    <div className={[styles.wrapper, className].filter(Boolean).join(" ")}>
      <label className={styles.row} htmlFor={id}>
        <input type="checkbox" id={id} className={styles.box} {...rest} />
        <span className={styles.label}>{label}</span>
      </label>
      {description && <p className={styles.description}>{description}</p>}
    </div>
  );
}
