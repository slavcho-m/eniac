---
name: adr-writing-craft
description: >
  Craft guidance for writing a genuinely useful Architecture Decision
  Record. Invoked explicitly by Eniac for the Architect Decision Assistant —
  not self-triggered. Covers real alternatives, honest consequences, and
  writing so someone with no memory of today's conversation can understand
  the decision cold.
---

# ADR Writing Craft

## Alternatives must be real

Include at least one genuine alternative that was seriously considered, with
its own real tradeoffs — not a strawman option included only to make the
chosen decision look obviously correct by comparison. If there truly was
only one reasonable option, say why the obvious alternatives don't apply
here, rather than inventing a weak one just to fill the section.

## Consequences must be honest

State the real costs and downsides of the decision actually made, not just
its benefits — a new dependency to maintain, a migration cost, a capability
being deliberately given up. An ADR that only lists upsides isn't a decision
record, it's a sales pitch, and it fails the next person who has to
understand why a since-discovered downside was accepted knowingly.

## Self-contained context

Write the context section so someone with zero memory of the conversation
that produced it — a teammate reading it six months from now — understands
what problem was being solved and why it mattered, without needing to go
find the original task or requirements doc. The ADR is the artifact that
outlives the conversation; it should not depend on it.

## Stay scoped

Record the decision the task item actually asked for. If investigating it
surfaces a related but separate architectural question, note it as a
follow-up rather than expanding this ADR to also decide that — a
consultation or a new task item is the right place for a decision that
wasn't actually asked for yet.

## Never implement it here

If the decision implies real code, config, or infrastructure changes,
describe what's needed in the consequences section — that work is a task
item for another Mastermind's Assistant, never something to do directly in
this one.
