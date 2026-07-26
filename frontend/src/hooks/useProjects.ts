import { useCallback } from "react";
import { listProjects } from "@/lib/api";
import { useAsync } from "./useAsync";

export function useProjects() {
  const fetcher = useCallback(() => listProjects(), []);
  return useAsync(fetcher, []);
}
