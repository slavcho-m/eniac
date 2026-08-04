import { useCallback } from "react";
import { getPatchReview } from "@/lib/api";
import { useAsync } from "./useAsync";

export function usePatchReview(taskId: string | undefined) {
  const fetcher = useCallback(() => {
    if (!taskId) return Promise.resolve({ diff: "", summary: null });
    return getPatchReview(taskId);
  }, [taskId]);
  return useAsync(fetcher, [taskId]);
}
