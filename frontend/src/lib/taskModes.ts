import { MessagesSquare, Rocket, Wrench } from "lucide-react";
import type { ComponentType } from "react";

export type TaskMode = "discuss" | "patch" | "ship";

interface ModeOption {
  value: TaskMode;
  label: string;
  description: string;
  icon: ComponentType<{ size?: number; strokeWidth?: number; className?: string }>;
  disabled?: boolean;
}

// Record, not an array -- indexing by the TaskMode key is guaranteed-present under
// noUncheckedIndexedAccess (unlike array indexing), same pattern as
// ExecutionView's BADGE_BY_ITEM_STATUS. Key order is render order (Discuss, Patch, Ship).
// Shared by ModeSelect (the picker) and Sidebar (the task list icon) — kept out of
// ModeSelect.tsx so that file only exports the component (react-refresh/only-export-components).
export const TASK_MODES: Record<TaskMode, ModeOption> = {
  discuss: { value: "discuss", label: "Discuss", description: "Talk it through — no files touched.", icon: MessagesSquare },
  patch: {
    value: "patch",
    label: "Patch",
    description: "Find it, fix it, test it — for small bugfixes or feature patches.",
    icon: Wrench,
  },
  ship: { value: "ship", label: "Ship", description: "Full pipeline — investigate, plan, build, review.", icon: Rocket },
};
