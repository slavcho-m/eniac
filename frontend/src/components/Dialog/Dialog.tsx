import { X } from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useRef } from "react";
import { cn } from "@/lib/cn";
import { SectionLabel } from "../SectionLabel/SectionLabel";
import styles from "./Dialog.module.css";

interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  /** Extra controls in the header row, between the title and the close button (e.g.
   * HelpDialog's "Start Tutorial"). */
  headerActions?: ReactNode;
  /** "large" for content that benefits from more room (e.g. a full diff) — still capped
   * to the viewport height and scrolls internally rather than overflowing it. */
  size?: "default" | "large";
}

/** Built on the native <dialog> element — Escape-to-close, a real backdrop, and modal
 * focus handling come from the browser instead of hand-rolled overlay/role/keydown code. */
export function Dialog({ open, onClose, title, children, footer, headerActions, size = "default" }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    // <dialog>'s implicit role already makes it interactive (Escape-to-close is native);
    // this backdrop-click is a mouse-only convenience on top of that, not the accessible
    // path — the explicit close button below is. oxlint's jsx-a11y doesn't know <dialog>
    // counts as interactive, hence the disable.
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/click-events-have-key-events
    <dialog
      ref={ref}
      className={cn(styles.panel, size === "large" && styles.large)}
      onClose={onClose}
      onClick={(e) => {
        // The dialog element's own box has no padding (see Dialog.module.css) — every
        // point inside it is covered by header/body/footer, so this target can only be
        // the backdrop area itself.
        if (e.target === ref.current) onClose();
      }}
    >
      <div className={styles.header}>
        <SectionLabel>{title}</SectionLabel>
        <div className={styles.headerActions}>
          {headerActions}
          <button type="button" className={styles.close} onClick={onClose} aria-label="Close">
            <X size={15} strokeWidth={1.75} />
          </button>
        </div>
      </div>
      <div className={styles.body}>{children}</div>
      {footer ? <div className={styles.footer}>{footer}</div> : null}
    </dialog>
  );
}
