import { useCallback } from "react";
import { getProject } from "@/lib/api";
import { useAsync } from "./useAsync";

export function useProject(projectId: string | undefined) {
  const fetcher = useCallback(
    () => (projectId ? getProject(projectId) : Promise.resolve(null)),
    [projectId],
  );
  return useAsync(fetcher, [projectId]);
}
