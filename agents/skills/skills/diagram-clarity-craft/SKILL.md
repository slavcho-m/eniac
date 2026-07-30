---
name: diagram-clarity-craft
description: >
  Craft guidance for producing genuinely clear, useful mermaid diagrams —
  system topology, sequence/flow diagrams, infra layout. Invoked explicitly
  by Eniac for the Architect Diagram Assistant — not self-triggered. Covers
  choosing the right diagram type, real naming, and staying scoped to what
  the diagram is actually for.
---

# Diagram Clarity Craft

## Choose the right diagram type for the content

- **Sequence diagram** — interactions between parties over time (a request
  flowing through several services, an auth handshake). Use this when order
  and back-and-forth matters.
- **Flowchart** — branching logic or a process with decision points. Use
  this when the interesting thing is *which path* gets taken, not *when*.
- **Graph/topology** — static structure (services, their dependencies, data
  stores). Use this when the interesting thing is *what exists and what
  talks to what*, not a sequence of events.

Picking the wrong shape for the content (e.g. a sequence diagram for a
static topology) produces something technically renderable but genuinely
harder to read than the right shape would have been.

## Use real names, grounded in the actual code

Label nodes and steps with the real service, function, file, or endpoint
names from the actual codebase — not generic placeholders like "Service A"
or "Component 1". A diagram that could describe any system describes none
of them usefully; the value is in it matching what a reader will actually
find when they go look at the code.

## Stay scoped to what the diagram is for

Show what the task item actually asked to be diagrammed, at a level of
detail someone can absorb in one look — not the entire system crammed into
one diagram because more information seemed more thorough. A diagram that
tries to show everything ends up communicating nothing; a follow-up task
can always add a second, differently-scoped diagram if that's genuinely
needed.

## Correctness of the mermaid syntax itself matters

A diagram that fails to render is worse than no diagram — double-check
that node IDs, arrow syntax, and the diagram-type declaration are actually
valid mermaid for the type chosen, not just structurally close.
