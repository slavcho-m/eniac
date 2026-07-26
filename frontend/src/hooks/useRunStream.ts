import { useEffect, useRef, useState } from "react";
import { runStreamUrl } from "@/lib/api";

interface RunStreamState {
  output: string;
  done: boolean;
}

/**
 * Opens the run's WebSocket and accumulates its output. The backend stages that matter
 * here (context/requirements/tasks/execution) use `claude --output-format json`, which
 * sends exactly one message at the very end, not token-by-token — so "live" here means
 * "the socket closing is a precise done signal," not an animated typing effect. Calls
 * `onDone` once when the socket closes (or errors), via a ref so callers don't need to
 * memoize it themselves.
 */
export function useRunStream(runId: string | null, onDone: () => void): RunStreamState {
  const [output, setOutput] = useState("");
  const [done, setDone] = useState(false);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  useEffect(() => {
    if (!runId) return undefined;
    setOutput("");
    setDone(false);

    // Cleanup's ws.close() below (route change, unmount) fires onclose on this same
    // socket — without this flag, that self-inflicted close would be indistinguishable
    // from the server actually finishing the run, firing onDone() early.
    let closedByCleanup = false;

    const ws = new WebSocket(runStreamUrl(runId));
    ws.onmessage = (event) => {
      // ponytail: the run stream only ever sends plain text frames (see backend/app/runs.py).
      // eslint-disable-next-line typescript/no-unsafe-type-assertion
      setOutput((prev) => prev + (event.data as string));
    };
    ws.onclose = () => {
      if (closedByCleanup) return;
      setDone(true);
      onDoneRef.current();
    };
    ws.onerror = () => {
      if (closedByCleanup) return;
      setDone(true);
      onDoneRef.current();
    };

    return () => {
      closedByCleanup = true;
      ws.close();
    };
  }, [runId]);

  return { output, done };
}
