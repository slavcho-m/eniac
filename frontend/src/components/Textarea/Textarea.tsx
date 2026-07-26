import type { TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/cn";
import styles from "./Textarea.module.css";

export function Textarea({ className, rows = 4, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn(styles.textarea, className)} rows={rows} {...rest} />;
}
