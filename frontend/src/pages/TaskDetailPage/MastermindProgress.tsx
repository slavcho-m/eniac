import { NumberedSteps } from "@/components";
import type { StepVariant } from "@/components";
import type { Task } from "@/types/api";

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

interface MastermindProgressProps {
  task: Task;
}

/** A multi-mastermind task cycles through requirements/tasks/execution once per recommended
 * mastermind, looping the same status values (investigating, requirements_ready, ...) back
 * around for each one -- without this, that loop reads as the app silently restarting rather
 * than progressing. Renders nothing for the (overwhelmingly common) single-mastermind case. */
export function MastermindProgress({ task }: MastermindProgressProps) {
  const masterminds = task.masterminds;
  if (!masterminds || masterminds.length < 2) return null;

  const doneMasterminds = new Set(task.mastermind_history.map((entry) => entry.mastermind));
  const steps = masterminds.map((mastermind) => capitalize(mastermind));
  const variants: StepVariant[] = masterminds.map((mastermind) =>
    doneMasterminds.has(mastermind)
      ? "done"
      : mastermind === task.current_mastermind
        ? "current"
        : "pending",
  );

  return <NumberedSteps steps={steps} variants={variants} />;
}
