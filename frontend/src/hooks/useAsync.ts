import { useCallback, useEffect, useRef, useState, type DependencyList } from "react";

interface AsyncState<T> {
  data: T | undefined;
  loading: boolean;
  error: Error | null;
  refetch: () => void;
}

/**
 * Fetches `fn()` on mount and whenever `deps` changes, exposing the standard
 * data/loading/error/refetch shape shared by every data-fetching hook in this app.
 */
export function useAsync<T>(fn: () => Promise<T>, deps: DependencyList): AsyncState<T> {
  const [data, setData] = useState<T>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  // fn is re-created every render by callers (it closes over their own deps), so it can't
  // itself be a dependency here — deps is the caller's explicit, deliberately-scoped list.
  const fnRef = useRef(fn);
  fnRef.current = fn;

  const refetch = useCallback(() => {
    setLoading(true);
    setError(null);
    fnRef
      .current()
      .then(setData)
      .catch((err: unknown) => setError(err instanceof Error ? err : new Error(String(err))))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    refetch();
  }, [refetch]);

  return { data, loading, error, refetch };
}
