import { useCallback } from "react";
import { getTaskRuns } from "@/lib/api";
import { useAsync } from "./useAsync";

export function useTaskRuns(taskId: string | undefined) {
  const fetcher = useCallback(() => {
    if (!taskId) return Promise.resolve([]);
    return getTaskRuns(taskId);
  }, [taskId]);
  return useAsync(fetcher, [taskId]);
}
