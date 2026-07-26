import { useState } from "react";
import { Button, Checkbox, Dialog } from "@/components";
import { ApiError, deleteProject } from "@/lib/api";

interface DeleteProjectDialogProps {
  open: boolean;
  onClose: () => void;
  projectId: string;
  workspacePath: string | null;
  onDeleted: () => void;
}

export function DeleteProjectDialog({
  open,
  onClose,
  projectId,
  workspacePath,
  onDeleted,
}: DeleteProjectDialogProps) {
  const [deletePpm, setDeletePpm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleClose() {
    if (deleting) return;
    setDeletePpm(false);
    setError(null);
    onClose();
  }

  async function handleDelete() {
    setDeleting(true);
    setError(null);
    try {
      await deleteProject(projectId, deletePpm);
      setDeletePpm(false);
      onDeleted();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to delete project.");
      setDeleting(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      title="Delete Project"
      footer={
        <>
          <Button variant="secondary" onClick={handleClose} disabled={deleting}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={handleDelete} disabled={deleting}>
            {deleting ? "Deleting…" : "Delete"}
          </Button>
        </>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <p style={{ margin: 0, color: "var(--text-secondary)", fontSize: "var(--text-body)" }}>
          Delete <strong style={{ color: "var(--text-primary)" }}>{projectId}</strong> and all its tasks?
          This cannot be undone.
        </p>

        <Checkbox
          id="delete-ppm"
          checked={deletePpm}
          onChange={(e) => setDeletePpm(e.target.checked)}
          label="Also delete this project's saved specs & docs"
          description="Context, requirements, and task plans written for this project. Left unchecked, they stay on disk even after the project is removed."
        />

        {workspacePath ? (
          <p style={{ margin: 0, color: "var(--text-tertiary)", fontSize: "var(--text-hint)" }}>
            Your codebase at {workspacePath} is never touched.
          </p>
        ) : null}

        {error ? (
          <p style={{ margin: 0, color: "var(--error)", fontSize: "var(--text-body)" }}>{error}</p>
        ) : null}
      </div>
    </Dialog>
  );
}
