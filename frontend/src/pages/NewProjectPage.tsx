import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  AppShell,
  Button,
  Checkbox,
  Dialog,
  FormField,
  PageHeader,
  Textarea,
  TextInput,
  WorkspaceValidateButton,
  WorkspaceValidationResult,
} from "@/components";
import { useWorkspaceValidation } from "@/hooks/useWorkspaceValidation";
import { Sidebar } from "@/layout/Sidebar";
import { ApiError, createProject, deleteProject } from "@/lib/api";

// Mirrors backend/app/main.py's NAME_RE exactly, so invalid names are caught before a
// round trip to the server, not just after.
const NAME_PATTERN = /^[a-z0-9_-]+$/;

/**
 * Route: "/new-project". Scoped to what the backend actually supports — no Advanced
 * Options (custom/imported PPM location), since that isn't a real backend capability
 * yet. See docs/things-to-address.md.
 */
export function NewProjectPage() {
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [workspacePath, setWorkspacePath] = useState("");
  const [greenfield, setGreenfield] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [orchestratorPrompt, setOrchestratorPrompt] = useState<{ id: string; repos: string[] } | null>(
    null,
  );
  const [undoing, setUndoing] = useState(false);
  const workspaceValidation = useWorkspaceValidation();

  const trimmedName = name.trim();
  const nameValid = trimmedName.length > 0 && NAME_PATTERN.test(trimmedName);
  const canSubmit = nameValid && !submitting;

  async function handleSubmit() {
    if (!canSubmit) return;
    setError(null);
    setSubmitting(true);
    try {
      const project = await createProject(
        trimmedName,
        greenfield ? undefined : workspacePath.trim() || undefined,
        description.trim() || undefined,
      );
      if (project.is_orchestrator) {
        setOrchestratorPrompt({ id: project.id, repos: project.repos });
        setSubmitting(false);
      } else {
        void navigate(`/projects/${trimmedName}`);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to create project.");
      setSubmitting(false);
    }
  }

  async function handleUndoOrchestrator() {
    if (!orchestratorPrompt) return;
    setUndoing(true);
    try {
      await deleteProject(orchestratorPrompt.id, true);
      setOrchestratorPrompt(null);
    } finally {
      setUndoing(false);
    }
  }

  return (
    <AppShell left={<Sidebar />}>
      <PageHeader
        title="New project"
        subtitle="Set up a workspace for Eniac to help with."
        onBack={() => navigate("/")}
      />

      <div style={{ display: "flex", flexDirection: "column", gap: 20, maxWidth: 480 }}>
        <FormField
          label="Project Name"
          data-tour="new-project-fields"
          helperText={
            name.length > 0 && !nameValid ? (
              <span style={{ color: "var(--error)" }}>
                Only lowercase letters, numbers, &apos;-&apos;, and &apos;_&apos; are allowed.
              </span>
            ) : (
              "Lowercase letters, numbers, and hyphens. This becomes the folder name in Per-Project Memory."
            )
          }
        >
          <TextInput placeholder="payments-gateway" value={name} onChange={(e) => setName(e.target.value)} />
        </FormField>

        <FormField label="Description" helperText="Optional — a short note on what this project is.">
          <Textarea
            rows={2}
            placeholder="What is this project for?"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </FormField>

        <FormField
          label="Workspace Path"
          helperText="The folder where your project's code lives. Eniac will operate on files here — but never outside this path."
        >
          <TextInput
            placeholder="~/dev/payments-gateway"
            value={workspacePath}
            onChange={(e) => setWorkspacePath(e.target.value)}
            disabled={greenfield}
            trailingAdornment={
              greenfield ? null : (
                <WorkspaceValidateButton
                  onClick={() => void workspaceValidation.validate(workspacePath.trim())}
                  checking={workspaceValidation.checking}
                  disabled={!workspacePath.trim()}
                />
              )
            }
          />
          {greenfield ? null : (
            <WorkspaceValidationResult
              result={workspaceValidation.result}
              error={workspaceValidation.error}
              initializing={workspaceValidation.initializing}
              onInitGit={() => void workspaceValidation.initGit(workspacePath.trim())}
            />
          )}
        </FormField>

        <Checkbox
          id="greenfield"
          checked={greenfield}
          onChange={(e) => setGreenfield(e.target.checked)}
          label="I'll add this later — this is a greenfield project."
          description="You can add a workspace path anytime from project settings. Implementation-type Assistants won't run until you do."
        />

        {error ? (
          <p style={{ color: "var(--error)", fontSize: "var(--text-body)", margin: 0 }}>{error}</p>
        ) : null}

        <div style={{ display: "flex", gap: 12 }}>
          <Button
            variant="primary"
            onClick={handleSubmit}
            disabled={!canSubmit}
            data-tour="new-project-create"
          >
            {submitting ? "Creating…" : "Create Project"}
          </Button>
          <Button variant="secondary" onClick={() => navigate("/")}>
            Cancel
          </Button>
        </div>
      </div>

      <Dialog
        open={orchestratorPrompt !== null}
        onClose={() => {
          if (orchestratorPrompt) void navigate(`/projects/${orchestratorPrompt.id}`);
        }}
        title="Multiple repositories detected"
        footer={
          <>
            <Button variant="secondary" onClick={() => void handleUndoOrchestrator()} disabled={undoing}>
              {undoing ? "Removing…" : "Not what I meant"}
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                if (orchestratorPrompt) void navigate(`/projects/${orchestratorPrompt.id}`);
              }}
            >
              Continue
            </Button>
          </>
        }
      >
        <p style={{ margin: 0, color: "var(--text-secondary)", fontSize: "var(--text-body)" }}>
          This looks like a workspace containing multiple repositories:{" "}
          {orchestratorPrompt?.repos.map((repo, i) => (
            <span key={repo}>
              {i > 0 ? ", " : ""}
              <code>{repo}</code>
            </span>
          ))}
          . It&apos;ll be flagged as an orchestrator workspace. If that&apos;s not what you meant,
          remove this project and pick a different path.
        </p>
      </Dialog>
    </AppShell>
  );
}
