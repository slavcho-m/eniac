import type { ReactNode } from "react";
import { Button } from "../Button/Button";
import { Dialog } from "../Dialog/Dialog";

interface ConfirmDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  confirming?: boolean;
}

export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel = "Delete",
  confirming = false,
}: ConfirmDialogProps) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={confirming}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={onConfirm} disabled={confirming}>
            {confirming ? `${confirmLabel}…` : confirmLabel}
          </Button>
        </>
      }
    >
      <p style={{ margin: 0, color: "var(--text-secondary)", fontSize: "var(--text-body)" }}>{message}</p>
    </Dialog>
  );
}
