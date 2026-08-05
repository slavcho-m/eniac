import { FolderCheck } from "lucide-react";
// Reuses ModeSelect's `.trigger` class -- the same small bordered monospace button
// AgentSelect already cross-imports this module for, so all three composer-adjacent
// pickers/actions share one visual language instead of each inventing its own.
import styles from "../ModeSelect/ModeSelect.module.css";

interface WorkspaceValidateButtonProps {
  onClick: () => void;
  checking: boolean;
  disabled?: boolean;
}

/** Goes in a TextInput's `trailingAdornment` slot, not below the field -- keeps the
 * action inside the field's own bordered box instead of competing with the path text
 * for vertical space. */
export function WorkspaceValidateButton({ onClick, checking, disabled }: WorkspaceValidateButtonProps) {
  return (
    <button type="button" className={styles.trigger} onClick={onClick} disabled={disabled || checking}>
      <FolderCheck size={13} strokeWidth={1.75} />
      {checking ? "Validating…" : "Validate"}
    </button>
  );
}
