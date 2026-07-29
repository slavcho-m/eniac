# Things to Address

Gaps found while building one part of the system that need a change somewhere
else to fully resolve — usually backend work surfaced while building the
frontend. Logged here instead of fixed on the spot so unrelated work doesn't
get scope-creeped into whatever's in progress.

## No custom/importable PPM location

**Found:** 2026-07-25, building the New Project form.

**What's missing:** the reference design's "Advanced options" section
(Custom PPM Location, Import Existing PPM) doesn't correspond to any real
backend capability — the PPM directory is always hardcoded to
`~/.eniac/ppm/{project_id}` in `backend/app/db.py` (`PPM_ROOT / name`), with
no way to override it or import an existing one.

**Current workaround:** the New Project form has no Advanced Options section
at all for now.

**Fix, when it's time:** this is a bigger one than the other two — would
need a real design decision (a new column/config for a custom PPM path, a
copy/merge step for "import existing," validation that an imported PPM
directory is actually well-formed) before any frontend work makes sense.

## Consult Mastermind amendments never touch `requirements.md`

**Found:** 2026-07-27, live — Review itself caught this organically while
testing the task-list-amendment feature: after a Consult Mastermind
amendment changed `tasks.md`, Review ran against the resulting code and
correctly flagged that new validation logic contradicted `requirements.md`'s
still-current "Out of Scope: input validation" line, citing real line
numbers, and proposed a fix task to remove the stale line.

**What's missing:** a Consult Mastermind amendment (`stage = "consultation"`
in `runs.py`) only ever produces `new_tasks`/`deprecate_item_ids` against
`tasks.md` — there's no mechanism for it to also amend `requirements.md`
when the scope change genuinely invalidates something requirements already
states. `tasks.md` and `requirements.md` can drift out of sync as a result.

**Current workaround:** none — relies on something (usually Review) noticing
the drift after the fact and proposing a fix task, same as the case that
surfaced this.

**Fix, when it's time:** needs a real design pass, not a quick patch — the
amendment shape, diffing, and approve/reject plumbing were all built around
a single target file (`tasks.md`); extending to `requirements.md` means
deciding whether an amendment can touch both files in one proposal, how the
diff/approval UI shows two-file changes, and whether `requirements.md`
changes need the same `depends_on`/deprecation-cascade treatment or a
simpler direct-edit model.

## Resolved

Kept as a record, not open work.

- **Task `created_at` not exposed by the API** (found 2026-07-25) — `tasks`
  now serialize `created_at`; sidebar shows real relative timestamps and
  Today/Yesterday grouping. Fixed 2026-07-29.
- **No project `description` field** (found 2026-07-25) — `projects` table,
  API, and New Project form all carry it end-to-end. Fixed 2026-07-29.
- **`workspace_path` had no concept of a multi-repo orchestrator** (found
  2026-07-25) — full two-phase orchestrator feature built and live-verified:
  repo detection (`runs.discover_repos`), node-scoped tasks
  (`_effective_workspace_path`), the home-screen `RepoGraph`, and
  orchestrator-root cross-repo tasks with per-item `repo` scoping. Fixed
  2026-07-27/28.
- **DevOps's `Analysis` Assistant couldn't act on what it finds** (found
  2026-07-27) — gained the same optional `new_tasks` field as Review's `done`
  shape; the amendment pipeline was already generic so no `runs.py` changes
  were needed. Fixed 2026-07-29.
</content>
