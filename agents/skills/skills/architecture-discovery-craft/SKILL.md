---
name: architecture-discovery-craft
description: >
  Craft guidance for producing a genuinely useful architectural finding —
  a tech-stack inventory, an audit of how a concern is currently handled, a
  comparison of existing patterns. Invoked explicitly by Eniac for the
  Architect Discovery Assistant — not self-triggered. Covers grounding
  claims in real evidence, scoping to the task, and reporting fact rather
  than recommending.
---

# Architecture Discovery Craft

## Ground every claim in real evidence

Cite the actual file, dependency manifest entry, or config that supports
each claim — don't infer a pattern from a directory or file name alone
without confirming what's actually inside it. "This project uses
PostgreSQL" should be backed by the actual connection config or dependency,
not guessed from a folder called `db/`.

## Scope to the task, not the whole codebase

Cover what the assigned task item actually asked about, thoroughly — not
everything discoverable about the project. A discovery report that wanders
into unrelated areas dilutes the findings that actually matter for this
task and makes the real ones harder to find.

## Absence is a real finding

"No rate limiting exists anywhere in this codebase" or "there's no existing
convention for X" is itself a concrete, useful finding — state it plainly
rather than only reporting what does exist. The next stage (Decision) often
needs to know what's *missing* just as much as what's there.

## Report fact, not recommendation

Discovery's job is to establish what's actually true about the codebase
today — not to recommend what should change. Leave the judgment call to
Decision, which has a whole separate deliverable for exactly that; a
discovery report that quietly slides into "and therefore we should..."
blurs a distinction the rest of the pipeline depends on.
