---
title: Pancreator Glossary
slug: glossary
stability: experimental
bootstrap-only: false
phase: 0b
owners: [librarian, persona-designer, contract-writer]
purpose: |
  Canonical lexicon. Every domain noun used in a persona, skill, contract, or
  artifact MUST resolve to a term defined here. Layer 1 lint fails on any
  unresolved noun.
references:
  - kind: lines
    path: docs/PRD.md
    range: [250, 289]
    contentHash: acca2e3
    note: "PRD §4 — Core Concepts (Glossary). Mirrored and extended here."
  - kind: lines
    path: docs/PRD.md
    range: [908, 966]
    contentHash: 0c3ffe7
    note: "PRD §8 — Memory Architecture (memory-tier nouns)."
  - kind: lines
    path: docs/PRD.md
    range: [858, 905]
    contentHash: 30f1a10
    note: "PRD §7 — Intervention Conventions (lever vocabulary)."
related:
  - /lib/memory/handbook/persona-spec.md
  - /lib/memory/handbook/contract-format.md
  - /lib/memory/handbook/contract-style.md
  - /lib/memory/handbook/context-economy.md
---

# Glossary

Canonical lexicon for Pancreator. The ubiquitous-language source of truth.

## How to use this file

Every persona, skill, contract clause, and handbook page draws its domain nouns
from this file. When a new noun is needed, the authoring persona MUST add the
entry here in the same change. The Layer 1 lint pass refuses any normative
clause whose nouns do not resolve.

When PRD §4 and this file disagree, the PRD wins until a Phase-5 reconciliation
ADR promotes this file to canonical. Until then, divergences are tracked under
`/lib/memory/adr/draft/0003-glossary-divergence.md`.

## 1 — Personas, cohorts, and authoring roles

- **Persona** — a named subagent specification. One Markdown file under
  `lib/personas/<name>.md` whose YAML frontmatter conforms to the Anthropic Claude
  Agent SDK 16-field per-agent spec (`name`, `description`, `model`,
  `permissionMode`, `tools`, `disallowedTools`, `mcpServers`, `maxTurns`,
  `skills`, `isolation`, `memory`, `effort`, `color`, `hooks`, `initialPrompt`,
  `background`). Two lifecycles: *ephemeral* (spawned per task) and *long-lived*
  (SMEs). See `/lib/memory/handbook/persona-spec.md`.
- **Persona Spec Format** — the 16-field YAML frontmatter plus a Pancreator
  `metadata` map. Authored once at `lib/personas/<name>.md`; `pan cursor-sync`
  emits `.cursor/agents/<name>.md` and `.cursor/rules/<name>.mdc` from
  `lib/personas/rules/<name>.yaml`.
- **Subagent** — a runtime instance of a persona. The persona is the spec; the
  subagent is the running invocation.
- **SME (Subject-Matter Expert)** — a long-lived persona that owns a knowledge
  domain and accumulates a private memory under `/lib/memory/smes/<name>/`. SMEs
  persist across pipelines and sessions. M4+.
- **Persona Ensemble** — a configured cohort of named, opinionated personas
  (e.g., `prickly-senior`, `magnanimous-staff`, `security-stickler`)
  instantiated to deliberate over a single artifact and surface dissent. The
  structure of disagreement is the output. M4+. Configuration lives under
  `/lib/ensembles/<name>.yaml`.
- **Sycophancy parameter** — per-persona `sycophancy: 0.0–1.0` knob inside an
  ensemble configuration. Operationalizes the 2025–26 MAD literature; mixed
  values empirically yield more useful dissent than uniform values.
- **Scout** — a proactive, scheduled persona that scans an information frontier
  (papers, changelogs, dependency releases, competitor sites) and emits
  canonical artifacts. M4+.
- **Bootstrap-canonical persona** — a persona authored by hand during Phase 0c
  whose `metadata.pancreator-bootstrap-only: false` declares it persists past
  the bootstrap. The MVP set is `persona-designer` and `contract-writer`.
- **qa-tester** — the `feature-delivery` persona that owns the `test` stage.
  Runs after `reviewer` emits `review_passes: true`. Executes automated
  verification (lint, typecheck, compliance suite, and tests), performs manual
  verification proportional to the touch-set, applies straightforward fixes
  (typos, lint autofixes, missing citations), and emits
  `/work/<day>/<id>/test-report.md` with a `qa_passes` gate verdict. When
  `qa_passes: false`, routes re-entry to `implement` with a compact must-fix
  list. Canonical spec: `lib/personas/qa-tester.md`. See PRD §6 line 519 and
  PRD §7 lines 675–678.
- **Skill** — a reusable procedure under `lib/personas/skills/<name>/SKILL.md` conforming to
  the Agent Skills open spec (`agentskills.io`). Personas reference skills via
  the `skills:` field; multiple personas MAY share one skill.

## 2 — Pipelines, gates, and orchestration

- **Pipeline** — a declarative workflow under `/lib/pipelines/<name>.yaml` that
  composes personas under a supervisor with stages, gates, threshold policies,
  and outputs. The YAML compiles to a LangGraph.js `StateGraph` at runtime.
- **Pipeline Mode** — DAG-of-stages execution. The default mode for the MVP
  pipelines.
- **Conversation Mode** — interactive multi-turn channel between a human and
  one persona. Any turn MAY end with `/end --emit <artifact-type>` to promote
  the dialogue into a canonical artifact.
- **Stage** — one node in a pipeline DAG. Each stage names a persona, declares
  inputs and outputs, and MAY declare a `gate`.
- **Gate** — a verification step that blocks stage advance until the named
  predicate passes. Common gates: `human_approval`, `review_passes`,
  `qa_passes`, `contracts:from_feature`.
- **Threshold Policy** — the per-pipeline numeric and categorical thresholds
  declared in `pancreator.yaml`. Lowered to Conftest + OPA Rego at evaluation
  time. See PRD §7 for the YAML schema.
- **Risk tier** — `low | medium | high | any`. Selects the default contract
  bundle and human-approval policy. `low` defaults to allow; `medium` notifies
  with 24-hour auto-approve; `high` requires explicit human ratification.
- **Touch-set** — the declared set of paths and symbols a coder task MAY write
  to. The Conflict Planner uses touch-sets to fan out parallel work without
  silent collisions.
- **Planning/execution boundary** — the pipeline transition where a planning
  persona stops expanding context, emits a bounded handoff card, and delegates
  execution to the next persona.
- **Handoff card** — a compact Markdown artifact at
  `work/<day>/<id>/handoff.md` that names the Feature id, stage, planner,
  executor, upstream artifact paths, in-scope paths, explicit non-goals,
  validation commands, known failures, blockers, and re-entry rule.
- **Conflict Planner** — pre-fan-out planner persona. Builds an interference
  graph across the cohort and either splits or serializes overlapping
  touch-sets. M2+.
- **Worktree Pool** — managed pool of `git worktree` directories under
  `.pan/worktrees/<task-id>/`. Each pipeline runs inside a dedicated worktree.
- **EnvIsolation** — pluggable allocator for non-filesystem environment state
  per worktree (PORT, DB_NAME, COMPOSE_PROJECT_NAME, `.env.pan` overrides).
  Default: `PortRegistryEnvIsolation`. Closes the silent-collision risk that
  worktree filesystem isolation alone cannot.
- **Sandbox Pool** — alternative to Worktree Pool for untrusted code. Container
  or VM per task via E2B, Daytona, or Modal. M3+.
- **Intervention** — a first-class operator action against a running pipeline.
  Seven levers ordered by blast radius: `steer`, `pause`, `reroute`, `snapshot`,
  `rollback`, `abort`, `quarantine`. See PRD §7.
- **Checkpoint** — a serialized snapshot of pipeline state at a stage boundary.
  Conforms to LangGraph `BaseCheckpointSaver` v1 schema; persists to
  `/lib/memory/checkpoints/<task-id>/<seq>.json`.
- **Authorizer** — pluggable interface that gates intervention actions in
  library mode. Typed against Cedar `AuthorizationEngine`. Default:
  `LocalUserAuthorizer`.
- **escalation config** — a named entry under the top-level `configs` key of
  `pancreator-model-escalation.yaml`; each escalation config contains a per-persona tier map.
- **escalation tier** — one entry in an escalation config's persona tier map; keyed by the
  literal string `default` or by a non-negative integer; its value is a model string.
- **tier key** — the integer key of an escalation tier entry; the effective model for stage
  invocation index *N* is the tier whose tier key is the greatest integer ≤ *N*; when no
  integer tier key applies, the `default` tier value is used.
- **effective model** — the model string resolved from the active escalation config for a
  given persona slug and stage invocation index; it overrides the static persona frontmatter
  model for one SDK transport invocation.
- **stage invocation index** — a non-negative integer equal to the number of times the
  current stage has been invoked in the current run; `0` on the first invocation of each
  stage; incremented by `1` on each loopback to the same stage; reset to `0` on first entry
  to any new stage.
- **model issue** — a transport-classified failure where `@cursor/sdk` returns an error
  caused by an unresolvable model name, a provider-unavailable response, or a model quota
  error; distinct from artifact-missing errors and stage-logic errors.
- **active config** — the escalation config name selected for the current run; resolved from
  `runner.cursor.model_escalation.config` in `pancreator.yaml`, or overridden by the
  `PAN_MODEL_ESCALATION_CONFIG` environment variable.

## 3 — Contracts and verification vocabulary

- **Spec Contract** — a `contract:` block on any spec artifact declaring
  machine-checkable assertions. Pulled in as a verification gate by downstream
  pipelines. See `/lib/memory/handbook/contract-format.md`.
- **Contract Wrapper** — the kind-agnostic envelope every clause shares (`id`,
  `kind`, `severity`, `applies_to`, `owner`, `description`, `references`,
  `metadata`, `runtime`). See `/lib/memory/handbook/contract-format.md`.
- **Contract Kind** — the runner the wrapper dispatches to. The MVP closed-core
  set is `rego` and `llm-judge`. M2 adds `playwright`, `schemathesis`, `axe`.
  M3+ adds `semgrep`, `hypothesis`, `fast-check`, `ts-predicate`,
  `py-predicate`. Open-registry kinds use the `x-<owner>/<name>` namespace.
- **Severity** — `block | warn | info`. `block` halts the gate; `warn` logs
  without halting; `info` is documentation-only.
- **Applies-to anchor** — a dual-anchor citation that pins the artifact a
  clause gates. Discriminator is one of `artifact-symbol`,
  `pipeline-telemetry`, `file-path`, `run-log-event`, `pancreator-config`.
- **LLM judge** — a kind that delegates the assertion to a model panel. Every
  `severity: block` LLM-judge clause MUST carry a quorum policy and a cost
  ceiling.
- **Quorum policy** — the `quorum: <N>-of-<M>` field on an LLM-judge clause.
  `M >= 3` and `N >= 2` for `severity: block`.
- **Cost ceiling** — the `cost_ceiling_usd` field on a clause. Hard kill at
  the ceiling. Default 1.00 USD per clause.
- **Lint debt** — a documented Layer 1 violation deferred to a later milestone
  via the `pancreator.lint-debt` field on the clause. Permitted only on
  `severity: warn` and `severity: info` clauses in M1.
- **Behavior preservation contract** — the 5-tier contract that gates a
  refactor: existing tests, mutation-test score, property tests, public-API
  diff, snapshot tests.

## 4 — Style and lint vocabulary

- **RFC 2119 keywords** — the obligation vocabulary `MUST`, `MUST NOT`,
  `SHALL`, `SHALL NOT`, `SHOULD`, `SHOULD NOT`, `MAY`, `OPTIONAL`,
  `RECOMMENDED`, `NOT RECOMMENDED`, `REQUIRED`. Layer 1 requires one keyword
  per normative clause.
- **EARS template** — Easy Approach to Requirements Syntax. Five forms:
  *ubiquitous* ("The system SHALL..."), *event-driven* ("When <trigger>, the
  system SHALL..."), *unwanted-behavior* ("If <unwanted>, then the system
  SHALL..."), *state-driven* ("While <state>, the system SHALL..."), and
  *optional* ("Where <feature>, the system SHALL..."). Layer 1 requires one
  EARS form per normative clause.
- **Layer 1 lint** — body-prose discipline. RFC 2119 obligation per clause,
  EARS template, atomic clause, active voice, present tense, quantified
  numerics with units, glossary-resolved nouns, no weasel words, median
  sentence length at most 30 words, p95 at most 40 words. See
  `/lib/memory/handbook/contract-style.md`.
- **Layer 2 conformance** — per-kind structural requirements: OPA `# METADATA`
  block on Rego, worked good-and-bad examples on LLM judge, Gherkin docstring
  on Playwright, passing-and-failing example pair on Schemathesis. See
  `/lib/memory/handbook/contract-style.md`.
- **Layer 3 template** — slot-driven scaffold under
  `/lib/memory/handbook/contract-templates/`. Authors fill slots; they do not
  improvise prose where a slot exists.
- **Atomic clause** — a single normative obligation with a single subject and
  a single response. Compound obligations MUST be split.
- **Weasel word** — a hedging adverb or adjective that defeats RFC 2119
  precision. The Layer 1 ban list includes *appropriately*, *reasonably*,
  *generally*, *typically*, *usually*, *if needed*, *as required*, *etc.*,
  *and so on*, *user-friendly*, *modern*, *robust*, *seamless*. The list is
  versioned in `/lib/memory/handbook/contract-style.md`.
- **Dual-anchor citation** — a cross-reference serialized as JSON. Preferred `"kind"` is `symbol`
  (resolved via tree-sitter or ast-grep):

  ```json
  {
    "kind": "symbol",
    "path": "<path>",
    "symbol": "<symbol>",
    "contentHash": "<abbrev>"
  }
  ```

  Fallback `"kind"` is `lines` for non-AST content:

  ```json
  {
    "kind": "lines",
    "path": "<path>",
    "range": [
      1,
      9
    ],
    "contentHash": "<abbrev>"
  }
  ```

  Dual-anchor citations survive moves and renames; they flag semantic changes as
  needs-re-verification. In prose/chat surfaces, citation objects MUST serialize
  with the json-formatting canonical printer (`lib/internal/tools/migrate-json-formatting.mjs`,
  importing `canonical-json-format.mjs`). Compact single-line blobs with multiple
  object keys MUST NOT substitute for that layout. Each `contentHash` value MUST
  stay abbreviated per the prefix length emitted by `git rev-parse --short HEAD`
  at write time.
- **Content hash** — the SHA-256 digest of the cited file at citation time. For
  stored values in-scope, the canonical `contentHash` field SHALL record only an
  abbreviated hexadecimal prefix; the prefix length MUST equal the character count
  from `git rev-parse --short HEAD` at write time rather than retaining all 64
  digest hex characters in the artifact. The citation verifier compares full
  digests against in-repo citations today; abbreviated-prefix comparison waits on
  companion feature id `json-formatting-citation-verifier-prefix`.
- **Stability tier** — `experimental | stable | deprecated`. New artifacts
  land as `experimental` and promote on green dogfood usage for four
  consecutive weeks.
- **Goodhart guard** — the convention that a verification step records what
  failed, not just the pass-rate. Mitigates metric-gaming.

## 5 — Memory, artifacts, and the inbox

- **Memory** — the union of `/lib/memory/` (semantic and procedural),
  `/lib/memory/smes/` (per-SME), `/lib/memory/features/` (per-feature),
  `/lib/memory/backlog/`, `/lib/inbox/` (episodic), and the codebase itself.
- **Memory tiers** — *procedural* (`/lib/memory/handbook/`, `/lib/personas/`,
  `/lib/personas/skills/` — the rules), *semantic* (`/lib/memory/adr|rfc|prd|runbooks/` — the
  facts and decisions), *episodic* (`/lib/inbox/threads/`, `/work/*/*/run.log.jsonl`
  — the experiences).
- **active-memory** — the short-term operator-facing tier under `lib/memory/active/`
  that holds concise summaries and pointers; canonical policy lives at
  `/lib/memory/handbook/memory-tiers.md`.
- **durable-memory** — long-term ratified memory under `lib/memory/features/`,
  `lib/memory/adr/`, and `lib/memory/backlog/` loaded by explicit route.
- **archival-memory** — historical execution artifacts under `work/`,
  `lib/inbox/out/`, and `lib/inbox/threads/` treated as explicit-read by default.
- **internal-operating-content** — handbook pages, persona specs, skills,
  Cursor rules, and Cursor agent mirrors loaded by narrow routes rather than
  wholesale sweeps.
- **external surface** — repository paths used for Pancreator-powered feature
  delivery on a target project. Default indexed entrypoints include `README.md`
  (high-level landing), `OPERATION.md` (human procedures), `lib/memory/active/`,
  personas, pipelines, and delivery handbook routes. Agent operating instructions
  live in `AGENTS.md` (self-host, explicit-read) or `.pancreator/AGENTS.md`
  (embedded). Policy: `lib/memory/adr/0008-external-vs-internal-surfaces.md`.
- **internal surface** — repository paths used to plan and build Pancreator
  itself, including root `AGENTS.md` (daedaline self-host), `docs/**`,
  `lib/memory/adr/`, `lib/memory/backlog/`, bootstrap feature specs, `tests/**`,
  and `client/`. Excluded from default semantic indexing; explicit-read when the
  task evolves Pancreator. Policy: `lib/memory/adr/0008-external-vs-internal-surfaces.md`.
- **agent operating card** — the cross-tool agent contract: pipeline delegation,
  working agreement, operator queue, workspace map, and runtime defaults.
  Self-host: root `AGENTS.md` (explicit-read). Embedded adopt:
  `.pancreator/AGENTS.md`. Resolver: `resolveDeliveryOperatingCard` in
  `@pancreator/core`.
- **generated-machine-artifact** — machine-oriented JSON, manifests, dry-run
  outputs, compliance bundles, and structured logs excluded from default
  semantic indexing unless a task documents inclusion.
- **MemoryStore** — the runtime adapter that exposes Mem0-shaped CRUD plus a
  Letta-shaped tier overlay plus Pancreator-native dual-anchor citations.
- **MemoryRouter** — reads `/lib/memory/handbook/index.md` and loads top-K topic
  files for a given intent. Prevents context-window overload as the handbook
  grows.
- **Artifact** — a durable file produced by a pipeline or conversation: PRD,
  ADR, RFC, UX Spec, test plan, runbook, postmortem, delivery report.
  Citation-bearing and anti-rot-tracked.
- **Feature** — a first-class entity under `/lib/memory/features/<id>/` binding
  every artifact for a single product capability. Has a unique slug and a
  generated `index.json`.
- **Backlog** — `/lib/memory/backlog/`. The live, ranked product roadmap. Owned
  by the `pm` persona at M2+.
- **Adoption (`adopter` persona)** — the non-destructive first-run process for
  existing repositories. Scans codebase, detects conventions, proposes initial
  SMEs, seeds threshold policy from existing baselines, writes
  `/lib/memory/adoption/scan-<date>.md`.
- **Inbox** — bidirectional message queue between humans and the org under
  `lib/inbox/in/`, `lib/inbox/out/`, and `lib/inbox/threads/`. The `lib/inbox/notes/`
  subdirectory is a human-operator-only sandbox; agents MUST NOT read or
  modify it (see `/lib/memory/handbook/inbox-lifecycle.md` §1a).
- **Next operator steps** — the standardized `## Next operator steps` section
  every agent appends at bounded task completion per
  `/lib/memory/handbook/operator-output-contract.md`. Each step states **What**
  and **How**; read-only verification is labeled `Read-only:`; multiple options
  add **When to choose** and **Impact**.
- **`pan` CLI invocation** — in this workspace, runnable operator commands use
  `pnpm -w exec pan <subcommand> …` from the repository root because `pan` is
  not on the shell `PATH`. Agents MUST NOT emit bare `pan …` in copy-paste
  **How** clauses. Policy: `/lib/memory/handbook/pancreator-config.md`.
- **Copy-paste next-step commands** — **Next operator steps** shell procedures
  MUST be fully formed fenced command blocks listing every path and flag. Agents
  MUST NOT use underspecified file lists or offload automatable commands to the
  operator. Policy: `/lib/memory/handbook/operator-output-contract.md` §3.4.
- **Spec Kit alignment** — `/lib/memory/features/<id>/` paths align with GitHub
  Spec Kit v0.8 conventions: `spec.md`, `plan.md`, `tasks.md`. The repo-level
  constitution lives at `/lib/memory/handbook/constitution.md`.

## 6 — Substrate, control plane, and ecosystem endpoints

- **Control Plane** — thin orchestration layer: `AgentRunner`, `MemoryStore`,
  `Inbox`, `Notifier`, `WorktreePool`, `Scheduler`, `Intervention`,
  `Authorizer`. Decouples the rest of Pancreator from any one harness.
- **Primitive** — a single, independently importable piece of Pancreator under
  `@pancreator/<name>`. Each primitive depends only on `@pancreator/core` and
  external libraries.
- **Framework Mode** — opinionated install of the entire ecosystem (full org,
  conventions, CLI, scheduler, watchdog). The default install path.
- **Library Mode** — independent import of one or more primitives into another
  toolchain, with no dependency on the Pancreator CLI, conventions, or
  `pancreator.yaml`.
- **AGENTS.md** — repo-level Markdown briefing per the Linux Foundation
  Agentic AI Foundation standard. Root `AGENTS.md` holds agent operating
  instructions (explicit-read on self-host). Human operators use `OPERATION.md`.
  Embedded installs place the agent card at `.pancreator/AGENTS.md` and preserve
  the host project's root `AGENTS.md` with an additive pointer block.
- **MCP server (`@pancreator/mcp-server`)** — publishes Pancreator primitives as
  MCP Tools and Resources. Stdio in MVP; HTTP at M5.
- **A2A (`@pancreator/a2a`)** — Linux-Foundation-hosted Agent-to-Agent v1.x.
  Each Pancreator org serves `/.well-known/agent-card.json`. M5+.
- **Run-log** — append-only OTLP-encoded stream under `/work/<day>/<id>/run.log.jsonl`
  carrying OpenInference primary attributes plus an OTel GenAI semconv parallel
  layer. The basis for Phoenix and Langfuse import.

## 7 — Stability and how to extend

- **Add a term.** The authoring persona MUST add the entry in the same change
  that introduces the noun. The entry SHOULD include the section number.
- **Rename a term.** Open an inbox item to `librarian` proposing the rename.
  After human ratification, `librarian` performs the project-wide rename and
  records the change under `/lib/memory/adr/<seq>-glossary-rename-<term>.md`.
- **Deprecate a term.** Mark the entry with a `deprecated:` block citing the
  superseding term. Layer 1 lint emits a warning on deprecated terms; deletion
  follows after two MVP releases.

## 8 — Bootstrap status

This file is the Phase 0b handbook seed. The terms here MUST anchor every
clause authored in Phase 0c through Phase 5. Contradictions between this file
and the PRD MUST be resolved before promotion to `stability: stable`.
