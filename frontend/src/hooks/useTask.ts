import { useCallback } from "react";
import { getTask } from "@/lib/api";
import { useAsync } from "./useAsync";

export function useTask(taskId: string | undefined) {
  const fetcher = useCallback(() => {
    if (!taskId) return Promise.reject(new Error("no taskId"));
    return getTask(taskId);
  }, [taskId]);
  return useAsync(fetcher, [taskId]);
}
