---
name: code-review-craft
description: >
  Craft guidance for reviewing code against requirements well. Invoked
  explicitly by Eniac for the Backend and Frontend Review Assistants — not
  self-triggered. Covers what a review actually checks, how to cite
  findings, how to triage severity, and when a finding is worth turning into
  a proposed task item versus not. Domain-agnostic — applies the same way
  regardless of which codebase is under review.
---

# Code Review Craft

## What a review actually checks

Reviewing is not confirming the code runs — it's confirming the code does
what the requirements say, correctly, for the cases that actually matter.
For the specific lines that changed, trace the real data flow: what comes
in, what happens to it, what goes out — don't just read the diff as prose
and assume it does what its own comments/naming claim.

## Cite real evidence

Every finding needs a real file path and, where it helps make the point,
the actual code quoted — not a paraphrase of what the code roughly does.
"The handler doesn't check `user_id` matches the session" is a real,
checkable finding; "there might be an auth issue somewhere in here" is not
something anyone can act on.

## Severity triage

Not everything worth noticing is worth turning into a task. Distinguish:
- **A real bug** — the code does something wrong, will break in a real
  case, or contradicts a requirement. Always worth a proposed task.
- **A style preference** — a different but equally correct way to have
  written it. Not a review finding; you have no way to enforce style
  yourself and manufacturing a task for it just adds noise the human has to
  triage.

When in doubt, ask whether a task built from this finding would give the
next Assistant something concrete to fix. If the finding is really "this
could arguably be done differently," it isn't one.

## When to propose a task, and when not to

A clean review — nothing wrong, requirements met — is a completely normal,
good outcome. Don't invent a marginal finding just to have something to
report. Conversely, don't describe a real problem in prose and leave it
there: a review that identifies a bug but proposes nothing gives the human
nothing to act on except re-reading your own report and doing the fix
themselves, which defeats the point of reviewing in the first place.

## Common blind spots to actually check, not just the happy path

- **Edge cases**: empty/null/zero/boundary values — does the code handle
  them the way the requirements imply, or just the one case that was
  probably tested by hand?
- **Error paths**: when the thing being reviewed can fail (a network call,
  a lookup that might miss, invalid input), does it fail in a way that's
  handled, or does it just not have a path for that at all?
- **Requirements coverage, not just requirements presence**: something
  being *mentioned* in the code isn't the same as it being *correct* —
  check the actual logic against what was asked, not just that a
  plausible-looking implementation exists.
- **Security-sensitive logic**: authorization checks, input validation,
  anything handling credentials — these are exactly the places a
  plausible-looking diff can still be wrong in a way that only shows up
  under review, not under casual testing.
