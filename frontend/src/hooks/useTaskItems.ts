import { useCallback } from "react";
import { getTaskItems } from "@/lib/api";
import { useAsync } from "./useAsync";

export function useTaskItems(taskId: string | undefined) {
  const fetcher = useCallback(() => {
    if (!taskId) return Promise.resolve([]);
    return getTaskItems(taskId);
  }, [taskId]);
  return useAsync(fetcher, [taskId]);
}
