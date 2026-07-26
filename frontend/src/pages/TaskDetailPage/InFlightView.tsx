import { useEffect, useRef } from "react";
import { ActivityCard } from "@/components";

interface InFlightViewProps {
  label: string;
  onRefetch: () => void;
}

/**
 * Shown for a run that's in flight with no live WebSocket attached — e.g. after a page
 * refresh, since `activeRunId` (TaskDetailPage) is in-memory-only and doesn't survive
 * a reload. Polls in the background so the page advances on its own — no manual action
 * needed.
 */
export function InFlightView({ label, onRefetch }: InFlightViewProps) {
  const onRefetchRef = useRef(onRefetch);
  onRefetchRef.current = onRefetch;

  useEffect(() => {
    const id = setInterval(() => onRefetchRef.current(), 3000);
    return () => clearInterval(id);
  }, []);

  return <ActivityCard title={label} />;
}
