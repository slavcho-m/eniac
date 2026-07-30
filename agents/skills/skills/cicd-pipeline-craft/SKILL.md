---
name: cicd-pipeline-craft
description: >
  Craft guidance for writing CI/CD pipeline definitions, Dockerfiles, and
  infra-as-code well. Invoked explicitly by Eniac for the DevOps CI-CD
  Implementer Assistant — not self-triggered. Covers fail-fast design,
  credential scoping, idempotency, and the boundary between verifying a
  change and actually deploying something. Tool-agnostic — applies the same
  way across GitHub Actions, GitLab CI, Terraform, or whatever this project
  already uses.
---

# CI/CD Pipeline Craft

## Match the tooling that's already there

Don't introduce a second CI system, a second IaC tool, or a parallel way of
doing something this project's pipeline already does one way. Extend the
existing workflow/pipeline file's own structure and step-naming style
rather than adding a stylistically different block next to it.

## Fail fast, fail clearly

A step that can catch a problem early (lint, typecheck, a fast unit-test
pass) should run before slower or more expensive steps, so a broken change
fails quickly rather than burning a long build before hitting the real
issue. A failing step's output should make it obvious what failed and why —
don't let a real error get buried under output from an unrelated step.

## Least-privilege credentials

A pipeline step should only get the scope of credential/secret access it
actually needs for that step — not the broadest token available "in case."
Never write a real secret value into a pipeline file; reference it through
whatever secret-store mechanism this project's CI already uses.

## Idempotency

A pipeline step that can legitimately run more than once (a retried job, a
redeployed workflow) shouldn't double-apply an effect it shouldn't — a
"create" step that fails outright on a second run because the thing already
exists is a common, avoidable source of flaky pipelines.

## Verify, don't deploy

Bash access here is for read-only, diagnostic verification of the change
just made — linting a workflow file, `terraform validate`, a config's own
`--dry-run`/`--check` mode, a `docker build` with no push. Never run
anything that mutates real infrastructure or a live environment
(`terraform apply`, `docker push`, `kubectl apply`, an actual deploy
command) — that's out of scope regardless of whether the gate would approve
it. A diff-only change with nothing verified via Bash is a completely
normal, good outcome when there's nothing meaningful to dry-run locally.
