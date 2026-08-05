import { useEffect, useSyncExternalStore } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { listProjects } from "@/lib/api";
import {
  ONBOARDING_STEPS,
  readOnboardingState,
  resolveStep,
  stepIndexById,
  writeOnboardingState,
} from "@/lib/onboarding";
import type { OnboardingPhase } from "@/lib/onboarding";
import { useProjects } from "./useProjects";

// Module-level, not component state -- each page renders its own <AppShell>, so it
// unmounts/remounts on every route change (there's no persistent layout route wrapping
// them). Plain useState here would reset mid-tour on the very navigation the tour
// itself triggers (e.g. the Phase "home" -> Phase "project" jump into a real project).
// This survives that because it lives as long as the JS module does, independent of any
// component's lifecycle -- exactly what useSyncExternalStore is for.
let activeIndex: number | null = null;
const listeners = new Set<() => void>();

function setActive(index: number | null) {
  activeIndex = index;
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot() {
  return activeIndex;
}

function phaseFirstIndex(phase: OnboardingPhase): number {
  return ONBOARDING_STEPS.findIndex((s) => s.phase === phase);
}

function clickTarget(selector: string) {
  document.querySelector<HTMLElement>(selector)?.click();
}

const PROJECT_PAGE_RE = /^\/projects\/[^/]+$/;

export function useOnboardingTour() {
  const navigate = useNavigate();
  const location = useLocation();
  const index = useSyncExternalStore(subscribe, getSnapshot);
  const rawStep = index !== null ? (ONBOARDING_STEPS[index] ?? null) : null;
  // Reactive, not a one-off fetch -- both step 2's copy and step 14's checkpoint branch
  // (see resolveStep) need to know whether a project exists *while rendering*, not just
  // at the moment Next is clicked.
  const { data: projects } = useProjects();
  const hasProjects = (projects?.length ?? 0) > 0;
  const step = rawStep ? resolveStep(rawStep, { hasProjects }) : null;

  // Auto-start on the very first-ever load, and auto-resume Phase "project" the moment
  // the user lands on a project page while paused waiting for their first one (see the
  // checkpoint-persistence effect below).
  useEffect(() => {
    if (index !== null) return;
    const state = readOnboardingState();
    if (state.pausedForProject && PROJECT_PAGE_RE.test(location.pathname)) {
      writeOnboardingState({ status: "completed", pausedForProject: false });
      setActive(phaseFirstIndex("project"));
    } else if (state.status === "not_started" && location.pathname === "/") {
      setActive(0);
    }
  }, [location.pathname, index]);

  // Persists the checkpoint the moment its no-projects branch is showing -- covers a
  // page reload while the real New Project form is still open; the resume effect above
  // reads this back once the user actually lands on a project page.
  useEffect(() => {
    if (rawStep?.id === "new-project-recap" && !hasProjects) {
      writeOnboardingState({ status: "completed", pausedForProject: true });
    }
  }, [rawStep, hasProjects]);

  // The checkpoint hands off to the real app rather than a Next click when there's no
  // project yet (resolveStep flips allowInteraction/hideNext true in that branch) --
  // once the user submits the real form and navigates away, get out of the way instead
  // of floating the card over a page it no longer has a step for.
  useEffect(() => {
    if (rawStep?.id === "new-project-recap" && !hasProjects && location.pathname !== "/new-project") {
      setActive(null);
    }
  }, [rawStep, hasProjects, location.pathname]);

  // A real click on the project-menu trigger opens the real dropdown; once it's in the
  // DOM, move on automatically instead of waiting for Next -- same mechanism covers the
  // mode-select trigger and its own dropdown. Also covers the Next-button bypass for
  // both (see advance()), which clicks the same trigger on the user's behalf.
  useEffect(() => {
    if (index === null || !rawStep?.advanceWhenSelectorPresent) return undefined;
    const selector = rawStep.advanceWhenSelectorPresent;
    const currentIndex = index;
    let frame: number;
    function check() {
      if (document.querySelector(selector)) {
        setActive(currentIndex + 1);
        return;
      }
      frame = requestAnimationFrame(check);
    }
    frame = requestAnimationFrame(check);
    return () => cancelAnimationFrame(frame);
  }, [index, rawStep]);

  // Same handoff idea as the checkpoint above, for "click New Project": once the real
  // click (or its Next-bypass, see advance()) actually navigates to /new-project,
  // continue the tour there instead of a plain index bump.
  useEffect(() => {
    if (rawStep?.id === "project-menu-new-project" && location.pathname === "/new-project") {
      setActive(stepIndexById("new-project-form"));
    }
  }, [rawStep, location.pathname]);

  const stepsInPhase = rawStep ? ONBOARDING_STEPS.filter((s) => s.phase === rawStep.phase) : [];
  const indexInPhase = rawStep ? stepsInPhase.indexOf(rawStep) : -1;

  function finish() {
    writeOnboardingState({ status: "completed", pausedForProject: false });
    setActive(null);
  }

  async function advance() {
    if (index === null) return;
    const current = ONBOARDING_STEPS[index];
    if (!current) return;

    // Next-bypass for the two dropdown-opening steps: synthesize the same click a real
    // user would make (their ids match their own data-tour attribute), then let the
    // advanceWhenSelectorPresent effect above pick up from there -- one mechanism for
    // both the real click and this bypass.
    if (current.id === "project-menu-trigger" || current.id === "mode-select") {
      clickTarget(`[data-tour="${current.id}"]`);
      return;
    }

    // Next-bypass for "click New Project": navigate for them, then let the location
    // effect above pick up the transition, same as a real click would.
    if (current.id === "project-menu-new-project") {
      void navigate("/new-project");
      return;
    }

    // Closes the real mode dropdown (a second click on its own trigger toggles it shut)
    // before moving on to the agent-select step -- otherwise it's left open, floating
    // over a step that has nothing to do with it.
    if (current.id === "mode-ship") {
      clickTarget('[data-tour="mode-select"]');
      setActive(index + 1);
      return;
    }

    // The one remaining branch point: whether a real project already exists decides
    // whether Next continues straight into Phase "project" (against that project) --
    // when none exists, Next is hidden here (see resolveStep) and the checkpoint
    // effects above take over instead.
    if (current.id === "new-project-recap") {
      const freshProjects = await listProjects();
      const target = freshProjects[freshProjects.length - 1];
      if (target) {
        void navigate(`/projects/${target.id}`);
        setActive(phaseFirstIndex("project"));
      }
      return;
    }

    const nextIndex = index + 1;
    if (nextIndex >= ONBOARDING_STEPS.length) {
      finish();
      return;
    }
    setActive(nextIndex);
  }

  function back() {
    if (index === null || indexInPhase <= 0) return;
    setActive(index - 1);
  }

  function startTutorial() {
    writeOnboardingState({ status: "not_started", pausedForProject: false });
    void navigate("/");
    setActive(0);
  }

  return {
    step,
    stepNumber: index !== null ? index + 1 : 0,
    totalSteps: ONBOARDING_STEPS.length,
    canGoBack: indexInPhase > 0,
    next: () => void advance(),
    back,
    skip: finish,
    startTutorial,
  };
}
