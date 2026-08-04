import { useCallback } from "react";
import { getAgentAvailability } from "@/lib/api";
import { useAsync } from "./useAsync";

export function useAgentAvailability() {
  const fetcher = useCallback(() => getAgentAvailability(), []);
  return useAsync(fetcher, []);
}
