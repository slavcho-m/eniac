# Eniac

A personal, local, multi-agent workplace tool that drives a conversation-based flow from a natural-language request through to reviewed, applied code changes — using your Claude Pro/Max subscription (via the `claude` CLI) rather than paid model APIs.

You describe what you want in plain language. A Supervisor agent scopes the request and hands it to one or more domain Masterminds (Frontend, Backend, DevOps, Architect), which investigate your actual codebase and turn it into a concrete `requirements.md` and `tasks.md`. Each task item is then handed to a specialized Assistant (Design, Implementation, Review, Test, and others) that does the real work — writing code, reviewing a diff, writing tests. Every stage is gated on your approval, and every code change is a plain `git diff` you review before it's kept. Eniac also maintains a per-project "context" (architecture, layout, conventions) that every Mastermind and Assistant reads before acting, so they don't have to rediscover your codebase's conventions on every task.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the full design.

## Requirements

- Python 3.9+
- Node 18+
- The [`claude` CLI](https://docs.claude.com/claude-code), installed and logged in to a Claude Pro/Max subscription (`claude auth login`)

## Setup

```
make setup
```

This checks the above prerequisites, initializes `~/.eniac/` (Eniac's own state — a SQLite DB and per-project PPM files, separate from any code you point it at), copies `.env.example` → `.env` wherever one exists, and installs backend/frontend dependencies. If `~/.eniac/` already exists from a previous run, it'll ask whether to keep, back up, or wipe it.

## Running

```
make start
```

Starts the backend at `http://localhost:1946` and the frontend at `http://localhost:5173`. Stop both from another terminal with:

```
make down
```

## Layout

- `frontend/` — the UI (React + Vite)
- `backend/` — the FastAPI server that orchestrates Supervisor/Mastermind/Assistant runs via the `claude` CLI
- `agents/` — every agent's prompt: `supervisor/`, `context-investigator/`, `masterminds/<domain>/`, `assistants/<domain>/<assistant>/`
- `docs/` — architecture reference and a running log of known cross-cutting gaps (`docs/things-to-address.md`)
