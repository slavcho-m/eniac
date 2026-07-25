import type { TextareaHTMLAttributes } from "react";
import styles from "./Textarea.module.css";

export function Textarea({ className, rows = 4, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={[styles.textarea, className].filter(Boolean).join(" ")} rows={rows} {...rest} />;
}
