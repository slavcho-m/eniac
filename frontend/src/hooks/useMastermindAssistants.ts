import { useCallback } from "react";
import { listMastermindAssistants } from "@/lib/api";
import type { Mastermind } from "@/types/api";
import { useAsync } from "./useAsync";

export function useMastermindAssistants(mastermind: Mastermind | undefined) {
  const fetcher = useCallback(
    () => (mastermind ? listMastermindAssistants(mastermind) : Promise.resolve([])),
    [mastermind],
  );
  return useAsync(fetcher, [mastermind]);
}
