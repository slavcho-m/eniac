import { useCallback } from "react";
import { listProjectTasks } from "@/lib/api";
import { useAsync } from "./useAsync";

/**
 * `refreshKey`: Sidebar fetches independently of whatever page is currently rendering it,
 * so a task's status changing elsewhere on the page (e.g. TaskDetailPage after a run
 * finishes) doesn't automatically refetch the sidebar's copy. Callers can pass something
 * that changes when they know state moved on (e.g. task.status) to force a refetch —
 * found missing via a real end-to-end browser test, not by inspection.
 */
export function useProjectTasks(projectId: string | undefined, refreshKey?: unknown) {
  const fetcher = useCallback(
    () => (projectId ? listProjectTasks(projectId) : Promise.resolve([])),
    [projectId],
  );
  return useAsync(fetcher, [projectId, refreshKey]);
}
