import { useEffect, useSyncExternalStore } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { listProjects } from "@/lib/api";
import { ONBOARDING_STEPS, readOnboardingState, stepIndexById, writeOnboardingState } from "@/lib/onboarding";
import type { OnboardingPhase } from "@/lib/onboarding";

// Module-level, not component state -- each page renders its own <AppShell>, so it
// unmounts/remounts on every route change (there's no persistent layout route wrapping
// them). Plain useState here would reset mid-tour on the very navigation the tour
// itself triggers (the Phase A -> Phase B jump into a real project). This survives that
// because it lives as long as the JS module does, independent of any component's
// lifecycle -- exactly what useSyncExternalStore is for.
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

const PROJECT_PAGE_RE = /^\/projects\/[^/]+$/;

export function useOnboardingTour() {
  const navigate = useNavigate();
  const location = useLocation();
  const index = useSyncExternalStore(subscribe, getSnapshot);
  const step = index !== null ? (ONBOARDING_STEPS[index] ?? null) : null;

  // Auto-start on the very first-ever load, and auto-resume Phase B the moment the user
  // lands on a project page while paused waiting for their first one.
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

  // The interactive steps let a real click through (see OnboardingTour's allowInteraction
  // handling) -- when that real click leads somewhere the tour has its own step for, jump
  // there instead of continuing to float over the page the click just navigated away
  // from. Two concrete cases: opening the workspace menu and clicking through to "New
  // Project" lands on /new-project; actually creating a project from there lands on
  // /projects/:id, same destination the ordinary help-icon branch below already handles.
  useEffect(() => {
    if (!step) return;
    const cameFromMenuOrDeadEnd =
      step.id === "project-menu" || step.id === "project-menu-open" || step.id === "no-projects-yet";
    if (cameFromMenuOrDeadEnd && location.pathname === "/new-project") {
      setActive(stepIndexById("new-project-name"));
    } else if (
      (step.id === "new-project-create" || step.id === "no-projects-yet") &&
      PROJECT_PAGE_RE.test(location.pathname)
    ) {
      // Covers both a project created via the interactive form detour, and the
      // no-projects-yet dead end -- allowInteraction there lets the user open the real
      // menu and create one on their own, which lands here the same way.
      setActive(phaseFirstIndex("project"));
    }
  }, [step, location.pathname]);

  // Once the real element a step's real click was supposed to reveal actually appears
  // (e.g. the workspace dropdown opening), move on automatically rather than waiting for
  // Next -- same rAF-polling shape OnboardingTour's own useTargetRect uses.
  useEffect(() => {
    if (index === null || !step?.advanceWhenSelectorPresent) return undefined;
    const selector = step.advanceWhenSelectorPresent;
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
  }, [index, step]);

  const stepsInPhase = step ? ONBOARDING_STEPS.filter((s) => s.phase === step.phase) : [];
  const indexInPhase = step ? stepsInPhase.indexOf(step) : -1;

  function finish() {
    writeOnboardingState({ status: "completed", pausedForProject: false });
    setActive(null);
  }

  async function advance() {
    if (index === null) return;
    const current = ONBOARDING_STEPS[index];
    if (!current) return;

    // Plain Next (not a real click) from the "here's what's in the menu" step skips the
    // New Project form detour entirely -- that phase only makes sense once the user has
    // actually navigated there for real.
    if (current.id === "project-menu-open") {
      setActive(stepIndexById("help-icon"));
      return;
    }

    // The one remaining branch point: whether a real project already exists decides
    // whether the tour can continue straight into Phase B or has to pause and wait.
    if (current.id === "help-icon") {
      const projects = await listProjects();
      const target = projects[projects.length - 1];
      if (!target) {
        writeOnboardingState({ status: "completed", pausedForProject: true });
        setActive(stepIndexById("no-projects-yet"));
      } else {
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
