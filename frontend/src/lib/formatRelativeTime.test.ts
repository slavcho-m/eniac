import { describe, expect, it } from "vitest";
import { dateGroupLabel, formatRelativeTime } from "./formatRelativeTime";

const NOW = new Date("2026-07-28T12:00:00Z");

describe("formatRelativeTime", () => {
  it("shows 'just now' for under a minute", () => {
    expect(formatRelativeTime("2026-07-28T11:59:45Z", NOW)).toBe("just now");
  });

  it("shows minutes", () => {
    expect(formatRelativeTime("2026-07-28T11:42:00Z", NOW)).toBe("18m ago");
  });

  it("shows hours", () => {
    expect(formatRelativeTime("2026-07-28T09:00:00Z", NOW)).toBe("3h ago");
  });

  it("shows days", () => {
    expect(formatRelativeTime("2026-07-25T12:00:00Z", NOW)).toBe("3d ago");
  });

  it("falls back to a short date past a week", () => {
    expect(formatRelativeTime("2026-07-01T12:00:00Z", NOW)).toBe("Jul 1");
  });
});

describe("dateGroupLabel", () => {
  it("labels the same calendar day as Today", () => {
    expect(dateGroupLabel("2026-07-28T01:00:00Z", NOW)).toBe("Today");
  });

  it("labels the prior calendar day as Yesterday", () => {
    expect(dateGroupLabel("2026-07-27T10:00:00Z", NOW)).toBe("Yesterday");
  });

  it("labels anything older with a short date", () => {
    expect(dateGroupLabel("2026-07-20T12:00:00Z", NOW)).toBe("Jul 20");
  });
});
