import { useCallback, useEffect, useRef } from "react";
import { listProjectTasks } from "@/lib/api";
import { useAsync } from "./useAsync";

// ~30s at 2s intervals — generous over typical haiku title-generation latency, still bounded
// so a permanently-failed title (see backend's runs.generate_title) doesn't poll forever.
const MAX_TITLE_POLL_ATTEMPTS = 15;

/**
 * `refreshKey`: Sidebar fetches independently of whatever page is currently rendering it,
 * so a task's status changing elsewhere on the page (e.g. TaskDetailPage after a run
 * finishes) doesn't automatically refetch the sidebar's copy. Callers can pass something
 * that changes when they know state moved on (e.g. task.status) to force a refetch —
 * found missing via a real end-to-end browser test, not by inspection.
 *
 * Also self-polls while any task has neither `title` nor `feature_slug` yet — the window
 * right after creation where the sidebar shows a loading placeholder instead of the raw
 * prompt (see Sidebar.tsx). Stops the moment nothing is pending, or after the attempt cap.
 */
export function useProjectTasks(projectId: string | undefined, refreshKey?: unknown) {
  const fetcher = useCallback(
    () => (projectId ? listProjectTasks(projectId) : Promise.resolve([])),
    [projectId],
  );
  const state = useAsync(fetcher, [projectId, refreshKey]);
  const attemptsRef = useRef(0);
  const refetchRef = useRef(state.refetch);
  refetchRef.current = state.refetch;

  const hasPendingTitle = (state.data ?? []).some((t) => t.title == null && t.feature_slug == null);

  useEffect(() => {
    if (!hasPendingTitle || attemptsRef.current >= MAX_TITLE_POLL_ATTEMPTS) return undefined;
    const id = setTimeout(() => {
      attemptsRef.current += 1;
      refetchRef.current();
    }, 2000);
    return () => clearTimeout(id);
  }, [hasPendingTitle, state.data]);

  return state;
}
