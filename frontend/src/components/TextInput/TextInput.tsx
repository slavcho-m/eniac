import type { InputHTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/cn";
import styles from "./TextInput.module.css";

interface TextInputProps extends InputHTMLAttributes<HTMLInputElement> {
  trailingAdornment?: ReactNode;
}

export function TextInput({ trailingAdornment, className, ...rest }: TextInputProps) {
  return (
    <div className={cn(styles.wrapper, className)}>
      <input className={styles.input} {...rest} />
      {trailingAdornment ? <span className={styles.adornment}>{trailingAdornment}</span> : null}
    </div>
  );
}
