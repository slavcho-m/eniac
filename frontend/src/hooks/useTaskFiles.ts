import { useCallback } from "react";
import { getTaskFiles } from "@/lib/api";
import { useAsync } from "./useAsync";

export function useTaskFiles(taskId: string | undefined) {
  const fetcher = useCallback(() => {
    if (!taskId) return Promise.resolve([]);
    return getTaskFiles(taskId);
  }, [taskId]);
  return useAsync(fetcher, [taskId]);
}
