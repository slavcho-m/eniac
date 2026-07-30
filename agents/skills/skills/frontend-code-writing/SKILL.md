---
name: frontend-code-writing
description: >
  Framework-agnostic craft guidance for writing frontend UI code well. Invoked
  explicitly by Eniac for the Frontend Implementation Assistant — not
  self-triggered. Covers markup/accessibility, component boundaries and
  state, styling discipline, and the non-happy-path states real UI code
  needs. Framework-specific guidance (React, Angular, etc.) is out of scope
  here; this is the baseline every framework sits on top of.
---

# Frontend Code Writing

Apply this alongside — not instead of — whatever this specific project's own
conventions.md says. Where they conflict, the project's own conventions win;
this is the baseline for everything a project's conventions don't already
cover.

## Markup and accessibility

- Use the real semantic element for the job (`button` for actions, `a` for
  navigation, `label` for form fields) before reaching for a `div` with an
  `onClick`. A non-interactive element standing in for an interactive one
  breaks keyboard navigation and screen readers by default, not as an edge
  case.
- Every interactive element needs a name a screen reader can announce —
  visible text, or an explicit `aria-label`/`aria-labelledby` when the
  visible content isn't enough (an icon-only button, for example).
- Don't trap or silently discard keyboard focus. If you build something that
  intercepts a key (Escape, Enter, arrow keys), make sure Tab still moves
  focus somewhere sensible afterward.

## Component boundaries and state

- State lives at the lowest point that actually needs it. Lift it only when
  two or more components genuinely need to share the same value — not
  preemptively "in case" something else needs it later.
- Don't store something in state that can be derived from other state or
  props on every render. A derived value that's also stored separately is a
  sync bug waiting to happen the first time one update path is missed.
- A component that's grown multiple unrelated responsibilities (e.g. it
  fetches data, formats it, and renders three unrelated UI concerns) is a
  sign to split it — but don't split a component that's already small and
  cohesive just to hit some line-count target.

## Styling discipline

- Reuse whatever this project's existing design tokens/variables/theme
  system already provides (spacing scale, color tokens, type scale) rather
  than hand-picking a new pixel value or hex code that happens to look
  close. A one-off magic number is exactly how a design system erodes.
- Prefer relative/responsive units over fixed pixel values for anything that
  should scale with content or viewport (font sizes, spacing, widths) unless
  the existing codebase's own convention is fixed units throughout.
- Match the styling *mechanism* already in use in this codebase (CSS
  Modules, styled-components, Tailwind, inline styles, whatever it actually
  is) — introducing a second styling approach alongside an established one
  is a bigger cost than it looks, even for "just this one component."

## The states real UI code needs, not just the happy path

Before considering a piece of UI done, account for:
- **Loading** — what renders while the data isn't there yet.
- **Empty** — what renders when the data legitimately came back with
  nothing (an empty list is not the same bug as a failed request).
- **Error** — what the user sees if the request/action failed, and whether
  they have any way to recover (retry, dismiss) without reloading the page.

Skipping these isn't a smaller version of the task — it's a different,
incomplete task that happens to look finished in the one case that was
tested by hand.

## Consistency over cleverness

Before introducing a new pattern (a new way to fetch data, a new component
composition style, a new state-management approach), check whether this
codebase already has an established way to do it. Match it, even if you'd
have reached for something different on a blank slate — a codebase with one
consistent pattern used everywhere is easier to work in than one with two
"better" patterns used in different places.
