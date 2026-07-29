import { useCallback } from "react";
import { getProjectContextFiles } from "@/lib/api";
import { useAsync } from "./useAsync";

export function useProjectContextFiles(projectId: string | undefined) {
  const fetcher = useCallback(() => {
    if (!projectId) return Promise.resolve([]);
    return getProjectContextFiles(projectId);
  }, [projectId]);
  return useAsync(fetcher, [projectId]);
}
