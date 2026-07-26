import { useEffect, useState } from "react";
import { Button, Dialog, FormField, SectionLabel, TextInput } from "@/components";
import { ApiError, updateProject } from "@/lib/api";
import type { Project } from "@/types/api";

interface ProjectSettingsDialogProps {
  open: boolean;
  onClose: () => void;
  project: Project;
  onSaved: () => void;
  onDeleteClick: () => void;
}

export function ProjectSettingsDialog({
  open,
  onClose,
  project,
  onSaved,
  onDeleteClick,
}: ProjectSettingsDialogProps) {
  const [workspacePath, setWorkspacePath] = useState(project.workspace_path ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setWorkspacePath(project.workspace_path ?? "");
      setError(null);
    }
  }, [open, project.workspace_path]);

  async function handleSave() {
    setSubmitting(true);
    setError(null);
    try {
      await updateProject(project.id, workspacePath.trim() || null);
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to save.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={`${project.id} Settings`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button variant="primary" onClick={handleSave} disabled={submitting}>
            {submitting ? "Saving…" : "Save"}
          </Button>
        </>
      }
    >
      <FormField
        label="Workspace Path"
        helperText="The folder where this project's code lives. Eniac will operate on files here — but never outside this path."
      >
        <TextInput
          placeholder="~/dev/payments-gateway"
          value={workspacePath}
          onChange={(e) => setWorkspacePath(e.target.value)}
        />
      </FormField>
      {error ? (
        <p style={{ color: "var(--error)", fontSize: "var(--text-body)", margin: "12px 0 0" }}>{error}</p>
      ) : null}

      <div
        style={{
          marginTop: 24,
          paddingTop: 20,
          borderTop: "1px solid var(--border-hairline)",
        }}
      >
        <SectionLabel>Danger Zone</SectionLabel>
        <p style={{ margin: "8px 0 12px", color: "var(--text-secondary)", fontSize: "var(--text-body)" }}>
          Permanently delete this project and everything tracked under it.
        </p>
        <Button variant="destructive" onClick={onDeleteClick}>
          Delete Project
        </Button>
      </div>
    </Dialog>
  );
}
