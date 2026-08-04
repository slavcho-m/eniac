import { useCallback, useEffect, useRef } from "react";
import { getTask } from "@/lib/api";
import { useAsync } from "./useAsync";

// Same bounded self-poll as useProjectTasks, applied to this single task's title instead
// of a whole list — see that hook for why (async title generation, no push mechanism).
const MAX_TITLE_POLL_ATTEMPTS = 15;

export function useTask(taskId: string | undefined) {
  const fetcher = useCallback(() => {
    if (!taskId) return Promise.reject(new Error("no taskId"));
    return getTask(taskId);
  }, [taskId]);
  const state = useAsync(fetcher, [taskId]);
  const attemptsRef = useRef(0);
  const refetchRef = useRef(state.refetch);
  refetchRef.current = state.refetch;

  const pendingTitle = state.data ? state.data.title == null && state.data.feature_slug == null : false;

  useEffect(() => {
    if (!pendingTitle || attemptsRef.current >= MAX_TITLE_POLL_ATTEMPTS) return undefined;
    const id = setTimeout(() => {
      attemptsRef.current += 1;
      refetchRef.current();
    }, 2000);
    return () => clearTimeout(id);
  }, [pendingTitle, state.data]);

  return state;
}
