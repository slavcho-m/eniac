import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { AppShell, Button, Checkbox, FormField, PageHeader, TextInput } from "@/components";
import { Sidebar } from "@/layout/Sidebar";
import { ApiError, createProject } from "@/lib/api";

// Mirrors backend/app/main.py's NAME_RE exactly, so invalid names are caught before a
// round trip to the server, not just after.
const NAME_PATTERN = /^[a-z0-9_-]+$/;

/**
 * Route: "/new-project". Scoped to what the backend actually supports — no Description
 * field or Advanced Options (custom/imported PPM location), since neither is a real
 * backend capability yet. See docs/things-to-address.md.
 */
export function NewProjectPage() {
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [workspacePath, setWorkspacePath] = useState("");
  const [greenfield, setGreenfield] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmedName = name.trim();
  const nameValid = trimmedName.length > 0 && NAME_PATTERN.test(trimmedName);
  const canSubmit = nameValid && !submitting;

  async function handleSubmit() {
    if (!canSubmit) return;
    setError(null);
    setSubmitting(true);
    try {
      await createProject(trimmedName, greenfield ? undefined : workspacePath.trim() || undefined);
      void navigate(`/projects/${trimmedName}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to create project.");
      setSubmitting(false);
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

        <FormField
          label="Workspace Path"
          helperText="The folder where your project's code lives. Eniac will operate on files here — but never outside this path."
        >
          <TextInput
            placeholder="~/dev/payments-gateway"
            value={workspacePath}
            onChange={(e) => setWorkspacePath(e.target.value)}
            disabled={greenfield}
          />
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
          <Button variant="primary" onClick={handleSubmit} disabled={!canSubmit}>
            {submitting ? "Creating…" : "Create Project"}
          </Button>
          <Button variant="secondary" onClick={() => navigate("/")}>
            Cancel
          </Button>
        </div>
      </div>
    </AppShell>
  );
}
