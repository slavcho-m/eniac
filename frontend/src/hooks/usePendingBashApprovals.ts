import { useEffect, useRef } from "react";
import { listPendingBashApprovals } from "@/lib/api";
import { useAsync } from "./useAsync";

export function usePendingBashApprovals() {
  const { data, refetch } = useAsync(listPendingBashApprovals, []);

  const refetchRef = useRef(refetch);
  refetchRef.current = refetch;

  useEffect(() => {
    const id = setInterval(() => refetchRef.current(), 3000);
    return () => clearInterval(id);
  }, []);

  return { approvals: data ?? [], refetch };
}
