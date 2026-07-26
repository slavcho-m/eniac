import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { renderMarkdown } from "./renderMarkdown";

const REQUIREMENTS_SAMPLE = `# Requirements

## Summary
Add a GET /health route.

## Requirements
- Verify \`Stripe-Signature\` header against the endpoint's signing secret
- Return **200** within 5s to avoid retry storms

## Open Risks
None noted.
`;

describe("renderMarkdown", () => {
  it("renders headings, bullets, inline code, and bold text", () => {
    render(<div>{renderMarkdown(REQUIREMENTS_SAMPLE)}</div>);

    expect(screen.getByRole("heading", { level: 1, name: "Requirements" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Summary" })).toBeInTheDocument();
    expect(screen.getByText("Stripe-Signature").tagName).toBe("CODE");
    expect(screen.getByText("200").tagName).toBe("STRONG");
    expect(screen.getByText(/Add a GET \/health route/)).toBeInTheDocument();
  });

  it("groups consecutive bullet lines into one list", () => {
    const { container } = render(<div>{renderMarkdown(REQUIREMENTS_SAMPLE)}</div>);
    const lists = container.querySelectorAll("ul");
    expect(lists).toHaveLength(1);
    expect(lists[0]?.querySelectorAll("li")).toHaveLength(2);
  });

  it("renders numbered lists (mastermind ordering) as list items too", () => {
    render(<div>{renderMarkdown("## Mastermind Ordering\n1. backend\n2. frontend\n")}</div>);
    const items = screen.getAllByRole("listitem");
    expect(items.map((el) => el.textContent)).toEqual(["backend", "frontend"]);
  });
});
