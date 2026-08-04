# Eniac — Commercialization Plan

> Captures the direction decided in planning discussion, before implementation. Distinct from `ARCHITECTURE.md` (the tool itself) — this covers turning it into a paid product. Update as decisions change.

---

## 1. What's being sold

Eniac stays exactly what it is today: a personal, local, multi-agent workplace tool where execution runs on the user's own Claude Pro/Max subscription (via the `claude` CLI) — no hosted execution, no multi-user collaboration, no API billing on the vendor's side. The commercial layer is purely a **subscription gate on the tool itself**, not a change to how it runs.

This was chosen deliberately over two heavier alternatives:
- Multi-user team collaboration with cloud-synced PPM
- A fully hosted control plane running agents server-side

Both would require real cloud infrastructure and, in the hosted-execution case, invert the cost model (vendor pays per-token API costs instead of the user's own subscription covering it). Out of scope for now.

**Positioning matters for pricing.** The closest *functional* peers — tools that also just orchestrate a user's own model access rather than bundling inference (Cline, Aider, Continue.dev, Kilo Code) — are free and open-source. Eniac can't compete on "it calls Claude for you" alone; the case for paying has to rest on the structured, gated multi-agent workflow (Supervisor → Mastermind → Assistant, PPM/context memory, human approval gates at every stage) and, once built, multi-CLI routing (§6) — things thin BYOK wrappers don't offer.

---

## 2. Distribution & code exposure

Two separate concerns, two separate fixes:

- **Source visibility**: keep the repo private. Public `git clone` access is not how the product ships.
- **Update/runtime bypass**: accepted as a known ceiling, not solved. The tool runs on the user's own machine — a determined person can always edit out a local check. This gates the casual/default path only. Explicitly **not** pursuing compiled/obfuscated builds (e.g. Nuitka) — real added cost (per-OS builds, code signing, a permanently heavier release process) for protection that's still not airtight. Revisit only if there's evidence of actual abuse, not speculatively.

**Chosen distribution mechanism: license-gated release archives, not GitHub repo access.**
Rejected "invite paying customers as GitHub collaborators" — worse on both axes than the archive approach: it hands over full git history/branches (more exposure than a snapshot), and requires the buyer to have/use a GitHub account and accept an invite (friction). Instead:

- The vendor cuts a release (`git archive` at a tag → `.tar.gz`).
- The license-service (§3) serves it from `GET /download/latest`, gated by the same license key used for runtime verification.
- Buyer flow: after checkout, they get a license key and a one-line `curl | tar` command — no GitHub account needed.

---

## 3. Licensing & enforcement

**New piece: a small vendor-hosted `license-service`** (FastAPI + Stripe + SQLite — mirrors the existing stack's own choices, no new infra category). Never shipped to end users; this is the one part of the system that isn't fully local.

Endpoints:
- `POST /checkout` — Stripe Checkout Session (subscription mode)
- `GET /success?session_id=...` — shows the generated license key once
- `POST /webhook` — on subscription created/updated/deleted, updates `{license_key, stripe_customer_id, status, current_period_end}`
- `GET /verify?key=...` — `{valid, plan, current_period_end}`
- `POST /portal` — Stripe Customer Portal session (manage/cancel)
- `GET /download/latest`, `GET /releases/latest` — license-gated archive delivery + version metadata (§5)

**Local side** (`backend/app/license.py`, new): stores `license_key` + a cached verification result in `~/.eniac/config.json` (currently created but never read — this finally uses it). Verification is cached 24h; on a network failure, falls back to a cached "valid" result up to 7 days old (offline grace for a personal tool, not a security boundary — `# ponytail: fixed 7-day grace, revisit if it's ever actually load-bearing`). No new backend dependency — a couple of JSON HTTP calls, stdlib `urllib` is enough.

**Single enforcement point**: `_fire_and_forget` in `backend/app/main.py` — confirmed to be the one choke point all ~16 run-spawning endpoints already route through. One guard there, not 16 per-route checks.

**Frontend**: a full-page `LicenseGate` (reusing existing `Dialog`/`FormField`/`TextInput`/`Button`/`StatusBanner` primitives and the `useAsync` hook convention already used throughout the app) blocks the app when the license is invalid; a "Manage subscription" link (via `/portal`) appears once valid.

---

## 4. Pricing

**$49/year**, deliberately below the initial $69–79/year estimate, for two reasons: (1) it's positioned as a personal workspace tool, not enterprise software, and (2) given the free-competitor landscape in §1, a low-friction "sure, why not" price point matters more for conversion than maximizing per-customer revenue on an unproven v1. Round number, sits under the psychological $50 line.

Annual (not monthly, not one-time) — justified because the real value (agent/prompt quality, `claude` CLI compatibility) requires continuous iteration to stay useful, so "keeps getting updates" is core to the product, not an add-on.

Pricing is a starting point, not fixed: easier to raise for new customers later once there's traction/evidence than to lower it for people who already paid. Don't over-index on getting the exact number right pre-launch.

---

## 5. Access model & updates

**Continuous access**, not a version-locked "maintenance" model: an active subscription means the tool runs *and* can fetch updates; a lapse blocks both. One Stripe webhook flips both a license-service DB row (governs `/verify`) and, if using the GitHub-collaborator approach is ever reconsidered, repo access — under the current archive-based distribution, only the license DB row matters, since archive downloads are already key-gated.

Chosen over a "pay once, updates for a year, then frozen-but-working-forever" model — simpler (one meaning for "valid"), and can be relaxed later if churn feedback ever demands it. Don't build the more complex version speculatively.

**Update delivery**: no `git pull` dependency (consistent with §2 — buyers never get git access).
- A `VERSION` file at the repo root, bumped per release.
- `GET /version/status` (piggybacking the same 24h poll cycle as license verification, not a second poll loop) compares local vs. `license-service`'s `/releases/latest`.
- A `StatusBanner` in the UI surfaces "update available."
- `POST /update` on the local backend downloads/extracts/runs `make setup`, streamed via the same WebSocket infra already used for agent run output.
- Stops short of true auto-restart: the backend can't safely hot-swap its own running source without an external process supervisor, which doesn't exist yet and isn't worth building speculatively. Final step is a clear "restart to apply" message, matching the existing hard-stop-with-instructions pattern already used in `scripts/setup.sh`.

**Known follow-up, not yet designed**: buyers are meant to hand-edit `agents/*/prompt.md` directly (per `ARCHITECTURE.md` — no override system exists). A raw archive overwrite on update will clobber local edits with no merge/conflict warning. Proposed direction: an in-app editor for these files with a "restore to default" option, so customization survives updates without needing real merge logic. Not yet scoped in detail.

---

## 6. Multi-CLI support (Codex) before commercial release

Already anticipated as a deferred decision in `ARCHITECTURE.md` §9 ("Adding `codex` ... pending empirical research"). Bringing this forward to ship *before* commercial release strengthens the pricing case in §1 — a tool that routes different pipeline stages to different CLIs is a real differentiator free single-CLI wrappers don't have.

Shape of the work:
- **CLI adapter layer**: today `claude` is invoked as direct subprocess calls scattered through `backend/app/runs.py`/`main.py`. Needs one interface (`run_cli(cli_name, prompt, cwd, ...)`) with per-CLI implementations handling each tool's own flags, auth, and output-streaming format.
- **Where the choice is made**: the existing `approve-assistant` gate (`ARCHITECTURE.md` §3 step 8 — already a per-task-item human checkpoint) gains one more field, rather than a new UI flow.
- **Setup/auth**: extend the existing `scripts/setup.sh` preflight pattern (`command -v claude` + `claude auth status`, hard stop with fix instructions) to optionally check for `codex`, only enforced for CLIs the user has actually configured.
- **Net-new requirement**: this is the first feature that needs a real global settings surface — none exists today (confirmed while researching the license gate; settings today are per-project only, via `ProjectSettingsDialog`). Likely the same surface that ends up hosting license/subscription management (§3) — worth building once.

---

## 7. Open questions (not yet decided — business/legal, not engineering)

- **Legal**: Terms of Service, Privacy Policy (Stripe Checkout collects PII), refund policy, selling entity (individual vs. LLC — affects liability).
- **Device/seat limits**: does one license cover one machine, or a person across multiple devices? Affects the `license-service` schema, not just a policy doc.
- **Support channel**: buyers won't have repo/issue access under the archive-distribution model (§2) — need an actual support intake (email, form, etc.).
- **Failure visibility**: fully local, zero telemetry today — the vendor has no signal when something breaks for a paying customer unless they report it. Decide now whether to add basic opt-in error reporting; cheaper to decide upfront than retrofit later.
- **Trial/refund**: given the free-competitor landscape in §1, a refund window or trial likely matters more for conversion here than for a typical paid tool — not yet decided.
- **Naming**: no trademark check done yet on "Eniac" for commercial use.
