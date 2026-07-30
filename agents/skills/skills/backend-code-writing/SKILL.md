---
name: backend-code-writing
description: >
  Framework-agnostic craft guidance for writing backend/server code well.
  Invoked explicitly by Eniac for the Backend Design and Implementation
  Assistants — not self-triggered. Covers API/interface shape, error
  handling, data and persistence discipline, and security boundaries.
  Language- and framework-specific guidance (Django, Express, Spring, etc.)
  is out of scope here; this is the baseline every backend stack sits on
  top of.
---

# Backend Code Writing

Apply this alongside — not instead of — whatever this specific project's own
conventions.md says. Where they conflict, the project's own conventions win;
this is the baseline for everything a project's conventions don't already
cover.

## API and interface shape

- Keep request/response shapes consistent with the rest of this codebase's
  existing endpoints — field naming, error envelope, pagination style,
  status-code conventions. A new endpoint that invents its own shape is a
  worse outcome than one that looks slightly awkward but matches everything
  around it.
- Validate untrusted input at the boundary (the request handler), before it
  reaches business logic — don't let a malformed payload travel three layers
  deep before something chokes on it with an unhelpful error.
- Return errors the caller can actually act on: a real status code and a
  message that says what was wrong, not a generic 500 for anything that
  wasn't the happy path.

## Error handling

- Distinguish expected failures (bad input, not-found, a downstream
  dependency being unavailable) from genuine bugs. Handle the former
  explicitly and return something sensible; let the latter surface loudly
  (a real exception/stack trace) rather than being silently swallowed into a
  generic catch-all.
- Don't catch an exception just to log it and continue as if nothing
  happened, unless that's a deliberate, already-established pattern in this
  codebase for that specific situation.

## Data and persistence

- Wrap multi-step writes that must succeed or fail together in a real
  transaction — don't leave a partially-applied change possible because two
  separate writes weren't atomic.
- If an operation might be retried (by a client, a queue, a webhook
  redelivery), consider whether it needs to be idempotent — a second
  identical call shouldn't double-apply the effect.
- Schema changes should be additive/backward-compatible by default (new
  nullable column, not a rename-in-place) unless the task item explicitly
  calls for a breaking migration — match whatever migration convention this
  project already has.

## Security boundaries

- Never trust a client-supplied identifier as authorization — check that the
  requesting user/context actually has access to the resource that ID
  points at, don't just check that the ID is well-formed.
- Avoid building queries or shell commands by string-concatenating untrusted
  input — use the parameterized/escaped mechanism this codebase's existing
  data-access layer already provides.
- Never write a real secret, credential, or token into application code or a
  committed file — only into whatever this project's existing
  secrets/environment mechanism already is.

## Consistency over cleverness

Before introducing a new pattern (a new way to structure a handler, a new
error-handling idiom, a new data-access style), check whether this codebase
already has an established way to do it. Match it, even if you'd have
reached for something different on a blank slate — a codebase with one
consistent pattern used everywhere is easier to work in and to review than
one with two "better" patterns used in different places.
