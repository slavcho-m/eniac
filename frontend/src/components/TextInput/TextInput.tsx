import type { InputHTMLAttributes, ReactNode } from "react";
import styles from "./TextInput.module.css";

interface TextInputProps extends InputHTMLAttributes<HTMLInputElement> {
  trailingAdornment?: ReactNode;
}

export function TextInput({ trailingAdornment, className, ...rest }: TextInputProps) {
  return (
    <div className={[styles.wrapper, className].filter(Boolean).join(" ")}>
      <input className={styles.input} {...rest} />
      {trailingAdornment && <span className={styles.adornment}>{trailingAdornment}</span>}
    </div>
  );
}
