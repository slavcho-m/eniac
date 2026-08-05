export type OnboardingPhase = "home" | "new-project-form" | "project" | "concepts";

export interface OnboardingStep {
  id: string;
  phase: OnboardingPhase;
  /** CSS selector for the real element to spotlight; null renders a plain centered card
   * with no cutout (welcome/concepts slides). */
  target: string | null;
  title: string;
  body: string;
  /** Repo-relative docs/images paths, same convention GETTING_STARTED.md's own markdown
   * images use. A caption pairs each with a short label (e.g. "Single-repo" /
   * "Orchestrator") -- plain `image` alone doesn't cover the concepts step, which needs
   * to show two project shapes side by side, not just illustrate one thing. */
  images?: { src: string; caption: string }[];
  /** Lets a real click on the spotlighted target reach the app underneath instead of
   * being blocked -- every non-interactive step blocks clicks so the user can't wander
   * off mid-explanation, but a handful of steps (the workspace menu, the New Project
   * form) are genuinely meant to be used while they're being explained. Independent of
   * whether Next is shown -- see hideNext. */
  allowInteraction?: boolean;
  /** Hides the Next button entirely -- only for a true dead end (waiting on the user to
   * go create their first project). Every other interactive step still shows Next as an
   * explicit bypass, so engaging with the real UI is an option, not a requirement. */
  hideNext?: boolean;
  /** Short emphasized line inviting a real click, shown above Next/Skip -- only set on
   * steps where allowInteraction actually leads somewhere (opens a menu, reveals a
   * follow-up step). */
  hint?: string;
  /** Once an element matching this selector appears in the DOM, auto-advance to the next
   * step -- e.g. once the real dropdown this step points at actually opens. Polled the
   * same way useTargetRect already polls for a step's own target. */
  advanceWhenSelectorPresent?: string;
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
    id: "project-menu",
    phase: "home",
    target: '[data-tour="project-menu-trigger"]',
    title: "Your projects",
    body: "Create a new project or jump to any existing one from here.",
    allowInteraction: true,
    hint: "Click it to open the menu, or Next to keep going.",
    advanceWhenSelectorPresent: '[data-tour="project-menu-list"]',
  },
  {
    id: "project-menu-open",
    phase: "home",
    target: '[data-tour="project-menu-list"]',
    title: "New Project / View All Projects",
    body: "“New Project” walks through setting one up. “View All Projects” lists everything you've got.",
    allowInteraction: true,
    hint: "Click “New Project” to see the form, or Next to keep going.",
  },
  {
    id: "new-project-name",
    phase: "new-project-form",
    target: '[data-tour="new-project-fields"]',
    title: "Name it and point at your code",
    body: "Pick a project name and, optionally, the folder where your code lives -- you can always add a workspace path later for a greenfield project.",
    allowInteraction: true,
  },
  {
    id: "new-project-create",
    phase: "new-project-form",
    target: '[data-tour="new-project-create"]',
    title: "Create it",
    body: "That sets up this project's own memory. Fill it in and create it now, or Next to keep exploring first.",
    allowInteraction: true,
  },
  {
    id: "help-icon",
    phase: "home",
    target: '[data-tour="help-button"]',
    title: "Help, anytime",
    body: "The getting-started guide and this tour are always one click away.",
  },
  {
    id: "no-projects-yet",
    phase: "home",
    target: null,
    title: "Ready when you are",
    body: "Create your first project from the workspace menu up top whenever you like -- this tour will pick back up the moment you do.",
    hideNext: true,
    // No spotlight to protect here, but the intent is the opposite of every other
    // hideNext-less step: get out of the way and let the user go use the real menu
    // right now, not block the page until they hit Skip.
    allowInteraction: true,
  },
  {
    id: "composer",
    phase: "project",
    target: '[data-tour="prompt-input"]',
    title: "Describe what you want",
    body: "Write a task in plain language -- this is the one thing you write from scratch; everything after is agent-authored and yours to review.",
  },
  {
    id: "mode-select",
    phase: "project",
    target: '[data-tour="mode-select"]',
    title: "Ship, Patch, or Discuss",
    body: "Ship runs the full pipeline for real features. Patch is a fast single-shot fix. Discuss is just a conversation, no code changes.",
  },
  {
    id: "agent-select",
    phase: "project",
    target: '[data-tour="agent-select"]',
    title: "Choose your agent",
    body: "Run tasks on Claude or Codex -- whichever CLI you have authenticated.",
  },
  {
    id: "files-toggle",
    phase: "project",
    target: '[data-tour="files-toggle"]',
    title: "Project files",
    body: "Generated requirements, tasks, and context files for this project live in this panel.",
  },
  {
    id: "refresh-context",
    phase: "project",
    target: '[data-tour="refresh-context"]',
    title: "Keeping context current",
    body: "Refresh this project's context so Masterminds and Assistants have an up-to-date picture of the codebase.",
  },
  {
    id: "orchestrator-vs-single-repo",
    phase: "concepts",
    target: null,
    title: "Two kinds of projects",
    body: "A single-repo project points straight at one codebase. An orchestrator project points at a folder containing several independently-versioned repos -- Eniac detects this automatically and lets you scope tasks to one repo or run them across all of them.",
    images: [
      { src: "images/01-workspace-home.jpg", caption: "Single-repo" },
      // TODO: no real orchestrator-project screenshot exists yet in docs/images/ --
      // everything captured so far is single-repo. Needs a fresh screenshot of an
      // orchestrator project's home-screen RepoGraph before this caption has a real
      // image instead of reusing the single-repo one as a placeholder.
      { src: "images/01-workspace-home.jpg", caption: "Orchestrator" },
    ],
  },
  {
    id: "done",
    phase: "concepts",
    target: null,
    title: "You're all set",
    body: "Reopen this tour anytime from the Help icon.",
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
