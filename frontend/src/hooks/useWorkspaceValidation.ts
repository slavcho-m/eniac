import { useState } from "react";
import { ApiError, initWorkspaceGit, validateWorkspace } from "@/lib/api";
import type { WorkspaceCheckResult } from "@/types/api";

/** Shared validate/init-git state machine for the Workspace Path field — used by both
 * NewProjectPage and ProjectSettingsDialog, so the two stay in sync rather than drifting
 * as two independent copies of the same logic (same reasoning as useImageAttachments). */
export function useWorkspaceValidation() {
  const [result, setResult] = useState<WorkspaceCheckResult | null>(null);
  const [checking, setChecking] = useState(false);
  const [initializing, setInitializing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function validate(path: string) {
    setChecking(true);
    setError(null);
    try {
      setResult(await validateWorkspace(path));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to validate workspace path.");
    } finally {
      setChecking(false);
    }
  }

  async function initGit(path: string) {
    setInitializing(true);
    setError(null);
    try {
      setResult(await initWorkspaceGit(path));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to initialize git.");
    } finally {
      setInitializing(false);
    }
  }

  function reset() {
    setResult(null);
    setError(null);
  }

  return { result, checking, initializing, error, validate, initGit, reset };
}
