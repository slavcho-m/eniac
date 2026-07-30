---
name: test-writing-craft
description: >
  Craft guidance for writing effective tests. Invoked explicitly by Eniac
  for the Backend and Frontend Test Assistants — not self-triggered. Covers
  matching existing conventions, testing behavior over implementation,
  actual edge-case coverage, and confirming tests really pass rather than
  assuming. Framework-agnostic — applies the same way whether the suite is
  pytest, Jest, JUnit, or anything else already established in the project.
---

# Test Writing Craft

## Match what already exists, first

Before writing a single test, find how this codebase already tests things
like it — framework, file layout and naming, fixture/mock conventions,
assertion style. A test file that looks like it belongs with its neighbors
is easier for a human to trust and maintain than a technically-correct one
that reinvents the project's own conventions.

## Test behavior, not implementation

Assert on the observable outcome (the return value, the response body, the
rendered output, the state a caller can actually see) rather than internal
implementation details (that a specific private helper was called, the
exact internal sequence of steps). A test coupled to implementation breaks
the moment someone refactors correct code, which teaches everyone to
distrust — and eventually ignore — test failures.

## Cover the real edge cases, not just the happy path

For the change being tested, think through: the empty/zero/null case, a
boundary value, and the failure/error path (what happens when the thing
being tested is given bad input, or a dependency it relies on fails) — not
only the one scenario that's easiest to write a test for. A test suite that
only proves the happy path works proves less than it looks like it does.

## One behavior per test, named for what it verifies

A test's name should describe the behavior being checked well enough that a
failure is understandable from the name alone, without reading the test
body. Prefer several small, clearly-named tests over one large test
asserting several unrelated things — a failure in the combined version
tells you less about what actually broke.

## Don't over-mock

Mocking a dependency is sometimes necessary, but mocking too much of the
system under test can make a test pass even when the real integration is
broken — the test ends up proving the mock behaves as configured, not that
the code works. Prefer exercising real code paths where the existing test
setup already makes that practical; reach for a mock when the alternative
is genuinely impractical (a real external network call, a slow or
non-deterministic dependency), not by default.

## Actually confirm it passes

If Bash is available, run the tests you wrote before reporting done — a
test you didn't run is a claim, not a confirmed fact, and reporting success
on an untested test defeats the entire point of writing one. If Bash isn't
available or a run gets denied, say so plainly rather than asserting
correctness you didn't verify.
