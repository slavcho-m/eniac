import { createContext, useContext } from "react";
import type { useOnboardingTour } from "./useOnboardingTour";

export type OnboardingTourValue = ReturnType<typeof useOnboardingTour>;

/** Provided once in App.tsx, above <Routes> -- not called per-page from inside AppShell
 * (which unmounts/remounts on every route change). React Router doesn't guarantee the
 * old route's tree unmounts before the new one mounts, so calling useOnboardingTour()
 * from AppShell meant two AppShell instances could briefly coexist during a navigation,
 * each rendering its own <OnboardingTour> off the same shared step -- the same card
 * rendered twice on screen at once. One Provider instance, shared via context, makes
 * that structurally impossible. */
export const OnboardingTourContext = createContext<OnboardingTourValue | null>(null);

export function useOnboardingTourContext(): OnboardingTourValue {
  const context = useContext(OnboardingTourContext);
  if (!context) {
    throw new Error("useOnboardingTourContext must be used within an OnboardingTourContext provider");
  }
  return context;
}
