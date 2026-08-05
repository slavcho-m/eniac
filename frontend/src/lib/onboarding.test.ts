import { beforeEach, describe, expect, it } from "vitest";
import { readOnboardingState, writeOnboardingState } from "./onboarding";

describe("onboarding state persistence", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("defaults to not_started/not-paused when nothing is stored", () => {
    expect(readOnboardingState()).toEqual({ status: "not_started", pausedForProject: false });
  });

  it("round-trips a written state", () => {
    writeOnboardingState({ status: "completed", pausedForProject: true });
    expect(readOnboardingState()).toEqual({ status: "completed", pausedForProject: true });
  });

  it("falls back to defaults on corrupted JSON rather than throwing", () => {
    localStorage.setItem("eniac.onboarding", "{not json");
    expect(readOnboardingState()).toEqual({ status: "not_started", pausedForProject: false });
  });

  it("falls back to defaults on unexpected field values", () => {
    localStorage.setItem("eniac.onboarding", JSON.stringify({ status: "bogus", pausedForProject: "yes" }));
    expect(readOnboardingState()).toEqual({ status: "not_started", pausedForProject: false });
  });
});
