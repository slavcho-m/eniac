---
name: environment-setup-craft
description: >
  Craft guidance for local development environment setup — env-var
  documentation, docker-compose for local dev, setup scripts, and README
  setup instructions. Invoked explicitly by Eniac for the DevOps
  Environment Assistant — not self-triggered. Covers completeness,
  reproducibility, and never leaking a real secret into a committed file.
---

# Environment Setup Craft

## Completeness

If the application reads an environment variable anywhere in its real code,
it belongs in `.env.example` (or whatever this project's equivalent
convention already is) with a short comment explaining what it's for and,
where safe, an example non-secret value — not just the variables someone
happened to remember. A setup file that's missing half of what the app
actually needs fails silently for the next person who follows it.

## Never a real secret

`.env.example` and any other example/template file get placeholders only —
`your-api-key-here`, not a real key, even a low-stakes-looking one. Real
secret values only ever belong in the actual untracked `.env` (or
equivalent), never in anything meant to be committed.

## Reproducibility

Setup instructions and scripts should work starting from a genuinely clean
checkout — don't assume a step someone already did once (a global tool
install, a manually-created directory) unless the instructions say to do it
first. If this project targets more than one OS, don't write a step that
silently only works on one of them without noting the difference.

## Keep docs and scripts in sync

If a setup script changes, the README/setup doc describing that same
process needs to change with it — a setup guide that's drifted from what
the actual script does is worse than no guide, since it actively misleads
whoever follows it. When touching one, check the other.

## Verify, don't provision

Bash access here is for read-only, diagnostic checks of the change just
made — confirming a `docker-compose.yml` actually parses, a setup script's
syntax is valid, a tool's `--version` resolves. Never actually provision,
start, or install anything for real through it. A diff-only change with
nothing to verify is a completely normal, good outcome.
