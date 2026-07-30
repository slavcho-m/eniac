---
name: devops-analysis-craft
description: >
  Craft guidance for producing a genuinely useful infrastructure/CI/CD/
  environment analysis. Invoked explicitly by Eniac for the DevOps Analysis
  Assistant — not self-triggered. Covers what makes a finding
  decision-ready, how to prioritize, and when to flag something as
  security-sensitive even outside the immediate task scope.
---

# DevOps Analysis Craft

## Be decision-ready, not a survey

The analysis itself is the deliverable — there's no downstream Assistant
that turns a vague write-up into something concrete. "There are several
ways to approach caching" is not decision-ready; "this pipeline has no
dependency caching, adding it would cut build time from roughly N to M by
skipping the reinstall on every run" is. If a comparison of options
concludes one is clearly better, say so directly — don't leave the reader
to infer your own conclusion from a neutral list of pros and cons.

## Ground every claim in the real config

Cite the actual file and the actual setting — a workflow file's job name, a
Dockerfile line, an environment variable's actual current value or absence.
Don't describe what a typical setup like this "usually" has; describe what
this one actually has, confirmed by reading it.

## Prioritize by real impact

When a task surfaces more than one finding, don't present them as an
undifferentiated list — say which ones actually matter (a real security
exposure, a build that silently doesn't fail on error) versus which are
minor polish, so triage doesn't require the reader to re-derive severity
from scratch.

## Flag security/credential issues prominently, even out of scope

If something credential- or security-sensitive turns up while investigating
something else entirely (a secret committed in plaintext, an overly broad
IAM permission, a debug endpoint left open), call it out clearly rather than
letting it pass unmentioned because it wasn't what this task item asked
about.

## Every actionable finding becomes a proposed task

A finding that isn't turned into a `new_tasks` entry effectively doesn't
exist to the rest of the pipeline — nothing else reads free-form prose back
out of a completed analysis. If it's worth fixing, propose the fix as a
task concrete enough for the Assistant that picks it up to act on directly,
not just "consider addressing X."
