import { useEffect, useRef } from "react";
import { ActivityCard, Button } from "@/components";

interface InFlightViewProps {
  label: string;
  onRefetch: () => void;
}

/**
 * Shown for a run that's in flight with no live WebSocket attached — e.g. after a page
 * refresh, since `activeRunId` (TaskDetailPage) is in-memory-only and doesn't survive
 * a reload. Polls in the background so the page advances on its own; "Check again" stays
 * as an immediate manual option.
 */
export function InFlightView({ label, onRefetch }: InFlightViewProps) {
  const onRefetchRef = useRef(onRefetch);
  onRefetchRef.current = onRefetch;

  useEffect(() => {
    const id = setInterval(() => onRefetchRef.current(), 3000);
    return () => clearInterval(id);
  }, []);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <ActivityCard title={label} />
      <div>
        <Button variant="secondary" onClick={onRefetch}>
          Check again
        </Button>
      </div>
    </div>
  );
}
