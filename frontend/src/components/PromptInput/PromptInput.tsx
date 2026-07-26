import { ArrowUp } from "lucide-react";
import type { KeyboardEvent, TextareaHTMLAttributes } from "react";
import styles from "./PromptInput.module.css";

interface PromptInputProps
  extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "value" | "onChange" | "rows"> {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
}

/** A full-width textarea with its submit button anchored inside it, bottom-right — Enter
 * submits (Shift+Enter for a newline), matching a standard chat-input pattern. */
export function PromptInput({ value, onChange, onSubmit, disabled, ...rest }: PromptInputProps) {
  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      if (value.trim() && !disabled) onSubmit();
    }
  }

  return (
    <div className={styles.wrapper}>
      <textarea
        className={styles.textarea}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        disabled={disabled}
        rows={4}
        {...rest}
      />
      <button
        type="button"
        className={styles.submit}
        onClick={onSubmit}
        disabled={disabled || !value.trim()}
        aria-label="Send"
      >
        <ArrowUp size={18} strokeWidth={2.25} />
      </button>
    </div>
  );
}
