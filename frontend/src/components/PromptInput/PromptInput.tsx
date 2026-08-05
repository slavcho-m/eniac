import { ArrowUp, Paperclip } from "lucide-react";
import { useState } from "react";
import type { DragEvent, KeyboardEvent, ReactNode, TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/cn";
import styles from "./PromptInput.module.css";

interface PromptInputProps
  extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "value" | "onChange" | "rows"> {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  /** Shows a paperclip button in the footer bar. Omit to render just the textarea + send
   * (the other call sites of this component don't take attachments). */
  onAttach?: () => void;
  /** Enables dropping files anywhere on the box, in addition to the attach button — same
   * files a drag-and-drop attach zone would receive. Omit to disable drag-and-drop. */
  onDropFiles?: (files: FileList) => void;
  /** Rendered in the footer bar next to attach. Only the new-task composer passes this
   * (a ModeSelect) — other call sites (amendments, clarifications, consults) leave it unset. */
  modeSelect?: ReactNode;
  /** Onboarding-tour target id for the wrapper div. Only the new-task composer sets this
   * — PromptInput is reused by other call sites (reject-feedback, consult) that aren't
   * "the composer" the tour explains. */
  dataTour?: string;
}

/** A textarea with a slim footer bar underneath holding its controls (attach, send) — the
 * footer is a separate row, never overlaid on the text, so long input can never run under a
 * button. Enter submits (Shift+Enter for a newline), matching a standard chat-input pattern. */
export function PromptInput({
  value,
  onChange,
  onSubmit,
  onAttach,
  onDropFiles,
  modeSelect,
  dataTour,
  disabled,
  ...rest
}: PromptInputProps) {
  const [isDragging, setIsDragging] = useState(false);

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      if (value.trim() && !disabled) onSubmit();
    }
  }

  function handleDragOver(e: DragEvent<HTMLDivElement>) {
    if (!onDropFiles) return;
    e.preventDefault();
    setIsDragging(true);
  }

  function handleDragLeave(e: DragEvent<HTMLDivElement>) {
    if (!onDropFiles) return;
    if (e.relatedTarget instanceof Node && e.currentTarget.contains(e.relatedTarget)) return;
    setIsDragging(false);
  }

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    if (!onDropFiles) return;
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files.length > 0) onDropFiles(e.dataTransfer.files);
  }

  return (
    <div
      className={cn(styles.wrapper, isDragging ? styles.dragging : undefined)}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      data-tour={dataTour}
    >
      <textarea
        className={styles.textarea}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        disabled={disabled}
        rows={4}
        {...rest}
      />
      <div className={styles.footer}>
        {onAttach ? (
          <button
            type="button"
            className={styles.attach}
            onClick={onAttach}
            disabled={disabled}
            aria-label="Attach image"
            title="Attach image"
          >
            <Paperclip size={13} strokeWidth={1.75} />
          </button>
        ) : null}
        {modeSelect}
        <div className={styles.spacer} />
        <button
          type="button"
          className={styles.submit}
          onClick={onSubmit}
          disabled={disabled || !value.trim()}
          aria-label="Send"
        >
          <ArrowUp size={15} strokeWidth={2.25} />
        </button>
      </div>
    </div>
  );
}
