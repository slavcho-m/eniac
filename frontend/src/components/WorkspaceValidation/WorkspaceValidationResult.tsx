import type { WorkspaceCheckResult } from "@/types/api";
import { Button } from "../Button/Button";
import { StatusBanner } from "../StatusBanner/StatusBanner";
import styles from "./WorkspaceValidationResult.module.css";

interface WorkspaceValidationResultProps {
  result: WorkspaceCheckResult | null;
  error: string | null;
  initializing: boolean;
  onInitGit: () => void;
}

/** Renders below the Workspace Path field, once a Validate/Initialize Git action has
 * produced a result — advisory only, never blocks Create/Save. */
export function WorkspaceValidationResult({ result, error, initializing, onInitGit }: WorkspaceValidationResultProps) {
  if (!result && !error) return null;

  return (
    <div className={styles.wrapper}>
      {error ? <StatusBanner variant="error">{error}</StatusBanner> : null}

      {result?.status === "not_found" ? (
        <StatusBanner variant="error">This folder doesn&apos;t exist.</StatusBanner>
      ) : null}

      {result?.status === "not_git" ? (
        <StatusBanner variant="warning">
          This folder isn&apos;t a git repository yet.{" "}
          <Button
            variant="link"
            onClick={onInitGit}
            disabled={initializing}
            style={{ display: "inline", fontSize: "inherit" }}
          >
            {initializing ? "Initializing…" : "Initialize Git"}
          </Button>
        </StatusBanner>
      ) : null}

      {result?.status === "ok_repo" ? (
        <StatusBanner variant="success">
          Ready — a single git repository.
          {result.dirty ? " Note: this repo currently has uncommitted changes." : ""}
        </StatusBanner>
      ) : null}

      {result?.status === "ok_orchestrator" ? (
        <StatusBanner variant="success">
          Ready — found {result.repos?.length} repositories:{" "}
          {result.repos?.map((repo, i) => (
            <span key={repo}>
              {i > 0 ? ", " : ""}
              <code>{repo}</code>
            </span>
          ))}
          {result.dirty ? " Note: the root folder itself has uncommitted changes." : ""}
        </StatusBanner>
      ) : null}
    </div>
  );
}
