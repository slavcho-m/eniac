import { useCallback } from "react";
import { readFile } from "@/lib/api";
import { useAsync } from "./useAsync";

export function useFileContent(path: string | undefined) {
  const fetcher = useCallback(() => {
    if (!path) return Promise.resolve(null);
    return readFile(path).then((res) => res.content);
  }, [path]);
  return useAsync(fetcher, [path]);
}
