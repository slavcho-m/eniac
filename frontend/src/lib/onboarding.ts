export type OnboardingPhase = "home" | "new-project" | "project";

/** Facts about the workspace that change a step's copy or behavior -- currently just
 * whether any project exists yet, which affects step 2's wording and step 14's
 * checkpoint (see resolveStep). */
export interface OnboardingContext {
  hasProjects: boolean;
}

export interface OnboardingStep {
  id: string;
  phase: OnboardingPhase;
  /** CSS selector for the real element to spotlight; null renders a plain centered card
   * with no cutout (welcome/done slides). */
  target: string | null;
  title: string;
  body: string | ((ctx: OnboardingContext) => string);
  /** Lets a real click on the spotlighted target reach the app underneath instead of
   * being blocked -- every non-interactive step blocks clicks so the user can't wander
   * off mid-explanation, but a handful of steps (opening a real dropdown, navigating to
   * the New Project form, the create-your-first-project checkpoint) are genuinely meant
   * to be used while they're being explained. */
  allowInteraction?: boolean | ((ctx: OnboardingContext) => boolean);
  /** Hides the Next button -- only for the checkpoint step when there's truly nothing to
   * skip ahead to yet (no project exists, so there's no project screen to jump to until
   * the user creates one for real). */
  hideNext?: boolean | ((ctx: OnboardingContext) => boolean);
  /** Once an element matching this selector appears in the DOM, auto-advance to the next
   * step -- e.g. once a real dropdown this step points at actually opens, whether from a
   * genuine click or the Next-button bypass clicking it on the user's behalf (see
   * useOnboardingTour's advance()). Polled the same way OnboardingTour's own
   * useTargetRect polls for a step's own target. */
  advanceWhenSelectorPresent?: string;
  /** The real region the card must not overlap when placing itself -- defaults to
   * `target` and only needs setting when they differ. A handful of steps spotlight one
   * row inside a still-open real dropdown (e.g. "New Project" inside the project menu):
   * that dropdown renders above the tour overlay so a real click can reach it, which
   * means the *whole* menu stays visible regardless of which row is spotlighted -- if
   * the card only dodges the narrow spotlighted row, it lands right on top of the
   * dropdown's other, still-visible rows. */
  avoid?: string;
}

export interface ResolvedOnboardingStep {
  id: string;
  phase: OnboardingPhase;
  target: string | null;
  title: string;
  body: string;
  allowInteraction: boolean;
  hideNext: boolean;
  avoid: string | null;
}

export function resolveStep(step: OnboardingStep, ctx: OnboardingContext): ResolvedOnboardingStep {
  return {
    id: step.id,
    phase: step.phase,
    target: step.target,
    title: step.title,
    body: typeof step.body === "function" ? step.body(ctx) : step.body,
    allowInteraction:
      typeof step.allowInteraction === "function" ? step.allowInteraction(ctx) : Boolean(step.allowInteraction),
    hideNext: typeof step.hideNext === "function" ? step.hideNext(ctx) : Boolean(step.hideNext),
    avoid: step.avoid ?? step.target,
  };
}

export const ONBOARDING_STEPS: OnboardingStep[] = [
  {
    id: "welcome",
    phase: "home",
    target: null,
    title: "Welcome to Eniac",
    body: "A quick look at how the workspace fits together -- takes under a minute.",
  },
  {
    id: "home-projects",
    phase: "home",
    target: '[data-tour="main-content"]',
    title: "Your projects",
    body: (ctx) =>
      ctx.hasProjects
        ? "This is where all of your projects are listed."
        : "Future projects you create will be listed here.",
  },
  {
    id: "left-nav",
    phase: "home",
    target: '[data-tour="left-nav"]',
    title: "Primary navigation",
    body: "This column is where you'll spend most of your time -- see a project's current and future tasks, start new ones, create new projects, or jump back to the home page.",
  },
  {
    id: "help-icon",
    phase: "home",
    target: '[data-tour="help-button"]',
    title: "Help, anytime",
    body: "The getting-started guide and this tour are always one click away.",
  },
  {
    id: "project-menu-trigger",
    phase: "home",
    target: '[data-tour="project-menu-trigger"]',
    title: "Switch projects",
    body: "This is the project navigator. Click it to open the menu, or Next to keep going.",
    allowInteraction: true,
    advanceWhenSelectorPresent: '[data-tour="project-menu-list"]',
  },
  {
    id: "project-menu-list",
    phase: "home",
    target: '[data-tour="project-menu-list"]',
    title: "Two options",
    body: "New Project starts the setup form. View All Projects opens the home page you just saw, listing everything in your workspace.",
  },
  {
    id: "project-menu-view-all",
    phase: "home",
    target: '[data-tour="project-menu-view-all"]',
    avoid: '[data-tour="project-menu-list"]',
    title: "View All Projects",
    body: "Click this and the home page opens, listing every project in your workspace.",
  },
  {
    id: "project-menu-new-project",
    phase: "home",
    target: '[data-tour="project-menu-new-project"]',
    avoid: '[data-tour="project-menu-list"]',
    title: "New Project",
    body: "Click this to open the form for creating a new project.",
    allowInteraction: true,
  },
  {
    id: "new-project-form",
    phase: "new-project",
    target: '[data-tour="new-project-form"]',
    title: "Set up a project",
    body: "Fill in this form to set up a project. \"Creating a project\" here just means connecting Eniac to a real codebase -- or to a folder where one will exist once you start building.",
  },
  {
    id: "project-name-field",
    phase: "new-project",
    target: '[data-tour="project-name-field"]',
    title: "Project name",
    body: "Pick a short, lowercase name -- this becomes the project's folder name in Per-Project Memory.",
  },
  {
    id: "project-description-field",
    phase: "new-project",
    target: '[data-tour="project-description-field"]',
    title: "Description",
    body: "Optional -- a short note on what this project is, for your own reference later.",
  },
  {
    id: "workspace-path-field",
    phase: "new-project",
    target: '[data-tour="workspace-path-field"]',
    title: "Workspace path",
    body: "Point this at the folder where your code lives. Once you've entered a path, click Verify to check it's valid before creating the project.",
  },
  {
    id: "greenfield-checkbox",
    phase: "new-project",
    target: '[data-tour="greenfield-checkbox"]',
    title: "Greenfield projects",
    body: "No code yet? Check this box. A greenfield project skips the workspace path for now -- add one later from project settings once there's something to point at.",
  },
  {
    id: "new-project-recap",
    phase: "new-project",
    target: '[data-tour="new-project-form"]',
    title: "Ready to go",
    body: (ctx) =>
      ctx.hasProjects
        ? "That's the form. We'll continue on to the project screen now."
        : "Fill in the form and create your project whenever you're ready -- this tour will pick back up on the project screen the moment it's created.",
    allowInteraction: (ctx) => !ctx.hasProjects,
    hideNext: (ctx) => !ctx.hasProjects,
  },
  {
    id: "project-left-nav-updated",
    phase: "project",
    target: '[data-tour="left-nav"]',
    title: "Your project, in the nav",
    body: "The left navigation now shows this project's own tasks, and updates as you create more.",
  },
  {
    id: "project-header",
    phase: "project",
    target: '[data-tour="project-header"]',
    title: "Project header",
    body: "Click the project name to jump to its home page. The gear icon next to it opens project settings, where you can change things like the workspace path or description.",
  },
  {
    id: "new-task-button",
    phase: "project",
    target: '[data-tour="new-task-button"]',
    title: "Start a new task",
    body: "Click New Task any time to come back to this screen and start something new for this project.",
  },
  {
    id: "project-main-content",
    phase: "project",
    target: '[data-tour="main-content"]',
    title: "The task screen",
    body: "This is where you start new tasks, watch them build, and talk to the agents working on them.",
  },
  {
    id: "refresh-context",
    phase: "project",
    target: '[data-tour="refresh-context"]',
    title: "Keeping context current",
    body: "Refresh this project's context so Masterminds and Assistants have an up-to-date picture of the codebase.",
  },
  {
    id: "prompt-input",
    phase: "project",
    target: '[data-tour="prompt-input"]',
    title: "Describe what you want",
    body: "Write a task in plain language -- this is the one thing you write from scratch; everything after is agent-authored and yours to review.",
  },
  {
    id: "attach-button",
    phase: "project",
    target: '[data-tour="attach-button"]',
    title: "Attach images",
    body: "Attach a screenshot or mockup for the agent to reference -- useful for UI work, bug reports, or anything easier to show than describe.",
  },
  {
    id: "mode-select",
    phase: "project",
    target: '[data-tour="mode-select"]',
    title: "Ship, Patch, or Discuss",
    body: "Pick a mode depending on how big the task is. Once a task starts, its mode is locked in and can't be changed.",
    allowInteraction: true,
    advanceWhenSelectorPresent: '[data-tour="mode-select-menu"]',
  },
  {
    id: "mode-select-menu",
    phase: "project",
    target: '[data-tour="mode-select-menu"]',
    title: "Three modes",
    body: "Here are your options.",
  },
  {
    id: "mode-discuss",
    phase: "project",
    target: '[data-tour="mode-option-discuss"]',
    avoid: '[data-tour="mode-select-menu"]',
    title: "Discuss",
    body: "Talk it through with the agent -- no files are touched. Good for exploring an idea before committing to it.",
  },
  {
    id: "mode-patch",
    phase: "project",
    target: '[data-tour="mode-option-patch"]',
    avoid: '[data-tour="mode-select-menu"]',
    title: "Patch",
    body: "Find it, fix it, test it -- for small bugfixes or feature patches. Faster than a full Ship run.",
  },
  {
    id: "mode-ship",
    phase: "project",
    target: '[data-tour="mode-option-ship"]',
    avoid: '[data-tour="mode-select-menu"]',
    title: "Ship",
    body: "The full pipeline -- investigate, plan, build, and review. Use this for real features.",
  },
  {
    id: "agent-select",
    phase: "project",
    target: '[data-tour="agent-select"]',
    title: "Choose your agent",
    body: "Pick which CLI runs this task -- Claude or Codex, whichever you've got authenticated. For now, that's the choice.",
  },
  {
    id: "files-toggle",
    phase: "project",
    target: '[data-tour="files-toggle"]',
    title: "Project files",
    body: "Opens the files panel -- your project's context files and this task's memory files live here. Click any file to open it.",
  },
  {
    id: "done",
    phase: "project",
    target: null,
    title: "You're all set",
    body: "That's the tour. For more detail any time, reopen the getting-started guide from the Help icon.",
  },
];

export function stepIndexById(id: string): number {
  return ONBOARDING_STEPS.findIndex((s) => s.id === id);
}

const STORAGE_KEY = "eniac.onboarding";

export interface OnboardingState {
  status: "not_started" | "completed";
  pausedForProject: boolean;
}

const DEFAULT_STATE: OnboardingState = { status: "not_started", pausedForProject: false };

export function readOnboardingState(): OnboardingState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_STATE;
    // Own-write data (this module is the only writer), same trust level as api.ts's
    // response parsing -- not an external boundary that needs runtime schema validation.
    // eslint-disable-next-line typescript/no-unsafe-type-assertion
    const parsed = JSON.parse(raw) as Partial<OnboardingState>;
    return {
      status: parsed.status === "completed" ? "completed" : "not_started",
      pausedForProject: parsed.pausedForProject === true,
    };
  } catch {
    return DEFAULT_STATE;
  }
}

export function writeOnboardingState(state: OnboardingState): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}
