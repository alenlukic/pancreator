---
title: Tesseract Glossary
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
    contentHash: acca2e3f9a67c2aab2bb44d032b395a090c65b03317195693f6c8491a6864e5b
    note: "PRD §4 — Core Concepts (Glossary). Mirrored and extended here."
  - kind: lines
    path: docs/PRD.md
    range: [908, 966]
    contentHash: 0c3ffe7503262992a168caff37f0565684d8c0a23a0c76ea565867b33563cdac
    note: "PRD §8 — Memory Architecture (memory-tier nouns)."
  - kind: lines
    path: docs/PRD.md
    range: [858, 905]
    contentHash: 30f1a107eafbcdd71f67d539db18e10a508059f169beafe4d269afbd87813fd9
    note: "PRD §7 — Intervention Conventions (lever vocabulary)."
related:
  - /src/memory/handbook/persona-spec.md
  - /src/memory/handbook/contract-format.md
  - /src/memory/handbook/contract-style.md
---

# Glossary

Canonical lexicon for Tesseract. The ubiquitous-language source of truth.

## How to use this file

Every persona, skill, contract clause, and handbook page draws its domain nouns
from this file. When a new noun is needed, the authoring persona MUST add the
entry here in the same change. The Layer 1 lint pass refuses any normative
clause whose nouns do not resolve.

When PRD §4 and this file disagree, the PRD wins until a Phase-5 reconciliation
ADR promotes this file to canonical. Until then, divergences are tracked under
`/src/memory/adr/draft/0003-glossary-divergence.md`.

## 1 — Personas, cohorts, and authoring roles

- **Persona** — a named subagent specification. One Markdown file under
  `src/personas/<name>.md` whose YAML frontmatter conforms to the Anthropic Claude
  Agent SDK 16-field per-agent spec (`name`, `description`, `model`,
  `permissionMode`, `tools`, `disallowedTools`, `mcpServers`, `maxTurns`,
  `skills`, `isolation`, `memory`, `effort`, `color`, `hooks`, `initialPrompt`,
  `background`). Two lifecycles: *ephemeral* (spawned per task) and *long-lived*
  (SMEs). See `/src/memory/handbook/persona-spec.md`.
- **Persona Spec Format** — the 16-field YAML frontmatter plus a Tesseract
  `metadata` map. Authored once at `src/personas/<name>.md`; a build step emits a
  Cursor `.cursor/rules/<name>.mdc` shim from the same source.
- **Subagent** — a runtime instance of a persona. The persona is the spec; the
  subagent is the running invocation.
- **SME (Subject-Matter Expert)** — a long-lived persona that owns a knowledge
  domain and accumulates a private memory under `/src/memory/smes/<name>/`. SMEs
  persist across pipelines and sessions. M4+.
- **Persona Ensemble** — a configured cohort of named, opinionated personas
  (e.g., `prickly-senior`, `magnanimous-staff`, `security-stickler`)
  instantiated to deliberate over a single artifact and surface dissent. The
  structure of disagreement is the output. M4+. Configuration lives under
  `/src/ensembles/<name>.yaml`.
- **Sycophancy parameter** — per-persona `sycophancy: 0.0–1.0` knob inside an
  ensemble configuration. Operationalizes the 2025–26 MAD literature; mixed
  values empirically yield more useful dissent than uniform values.
- **Scout** — a proactive, scheduled persona that scans an information frontier
  (papers, changelogs, dependency releases, competitor sites) and emits
  canonical artifacts. M4+.
- **Bootstrap-canonical persona** — a persona authored by hand during Phase 0c
  whose `metadata.tesseract-bootstrap-only: false` declares it persists past
  the bootstrap. The MVP set is `persona-designer` and `contract-writer`.
- **Skill** — a reusable procedure under `src/skills/<name>/SKILL.md` conforming to
  the Agent Skills open spec (`agentskills.io`). Personas reference skills via
  the `skills:` field; multiple personas MAY share one skill.

## 2 — Pipelines, gates, and orchestration

- **Pipeline** — a declarative workflow under `/src/pipelines/<name>.yaml` that
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
  `contracts:from_feature`.
- **Threshold Policy** — the per-pipeline numeric and categorical thresholds
  declared in `tesseract.yaml`. Lowered to Conftest + OPA Rego at evaluation
  time. See PRD §7 for the YAML schema.
- **Risk tier** — `low | medium | high | any`. Selects the default contract
  bundle and human-approval policy. `low` defaults to allow; `medium` notifies
  with 24-hour auto-approve; `high` requires explicit human ratification.
- **Touch-set** — the declared set of paths and symbols a coder task MAY write
  to. The Conflict Planner uses touch-sets to fan out parallel work without
  silent collisions.
- **Conflict Planner** — pre-fan-out planner persona. Builds an interference
  graph across the cohort and either splits or serializes overlapping
  touch-sets. M2+.
- **Worktree Pool** — managed pool of `git worktree` directories under
  `.tess/worktrees/<task-id>/`. Each pipeline runs inside a dedicated worktree.
- **EnvIsolation** — pluggable allocator for non-filesystem environment state
  per worktree (PORT, DB_NAME, COMPOSE_PROJECT_NAME, `.env.tess` overrides).
  Default: `PortRegistryEnvIsolation`. Closes the silent-collision risk that
  worktree filesystem isolation alone cannot.
- **Sandbox Pool** — alternative to Worktree Pool for untrusted code. Container
  or VM per task via E2B, Daytona, or Modal. M3+.
- **Intervention** — a first-class operator action against a running pipeline.
  Seven levers ordered by blast radius: `steer`, `pause`, `reroute`, `snapshot`,
  `rollback`, `abort`, `quarantine`. See PRD §7.
- **Checkpoint** — a serialized snapshot of pipeline state at a stage boundary.
  Conforms to LangGraph `BaseCheckpointSaver` v1 schema; persists to
  `/src/memory/checkpoints/<task-id>/<seq>.json`.
- **Authorizer** — pluggable interface that gates intervention actions in
  library mode. Typed against Cedar `AuthorizationEngine`. Default:
  `LocalUserAuthorizer`.

## 3 — Contracts and verification vocabulary

- **Spec Contract** — a `contract:` block on any spec artifact declaring
  machine-checkable assertions. Pulled in as a verification gate by downstream
  pipelines. See `/src/memory/handbook/contract-format.md`.
- **Contract Wrapper** — the kind-agnostic envelope every clause shares (`id`,
  `kind`, `severity`, `applies_to`, `owner`, `description`, `references`,
  `metadata`, `runtime`). See `/src/memory/handbook/contract-format.md`.
- **Contract Kind** — the runner the wrapper dispatches to. The MVP closed-core
  set is `rego` and `llm-judge`. M2 adds `playwright`, `schemathesis`, `axe`.
  M3+ adds `semgrep`, `hypothesis`, `fast-check`, `ts-predicate`,
  `py-predicate`. Open-registry kinds use the `x-<owner>/<name>` namespace.
- **Severity** — `block | warn | info`. `block` halts the gate; `warn` logs
  without halting; `info` is documentation-only.
- **Applies-to anchor** — a dual-anchor citation that pins the artifact a
  clause gates. Discriminator is one of `artifact-symbol`,
  `pipeline-telemetry`, `file-path`, `run-log-event`, `tesseract-config`.
- **LLM judge** — a kind that delegates the assertion to a model panel. Every
  `severity: block` LLM-judge clause MUST carry a quorum policy and a cost
  ceiling.
- **Quorum policy** — the `quorum: <N>-of-<M>` field on an LLM-judge clause.
  `M >= 3` and `N >= 2` for `severity: block`.
- **Cost ceiling** — the `cost_ceiling_usd` field on a clause. Hard kill at
  the ceiling. Default 1.00 USD per clause.
- **Lint debt** — a documented Layer 1 violation deferred to a later milestone
  via the `tesseract.lint-debt` field on the clause. Permitted only on
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
  `/src/memory/handbook/contract-style.md`.
- **Layer 2 conformance** — per-kind structural requirements: OPA `# METADATA`
  block on Rego, worked good-and-bad examples on LLM judge, Gherkin docstring
  on Playwright, passing-and-failing example pair on Schemathesis. See
  `/src/memory/handbook/contract-style.md`.
- **Layer 3 template** — slot-driven scaffold under
  `/src/memory/handbook/contract-templates/`. Authors fill slots; they do not
  improvise prose where a slot exists.
- **Atomic clause** — a single normative obligation with a single subject and
  a single response. Compound obligations MUST be split.
- **Weasel word** — a hedging adverb or adjective that defeats RFC 2119
  precision. The Layer 1 ban list includes *appropriately*, *reasonably*,
  *generally*, *typically*, *usually*, *if needed*, *as required*, *etc.*,
  *and so on*, *user-friendly*, *modern*, *robust*, *seamless*. The list is
  versioned in `/src/memory/handbook/contract-style.md`.
- **Dual-anchor citation** — a cross-reference of the form
  `{kind: 'symbol', path, symbol, contentHash}` (preferred, resolved via
  tree-sitter or ast-grep) or `{kind: 'lines', path, range, contentHash}`
  (fallback for non-AST content). Survives moves and renames; flags semantic
  changes as needs-re-verification.
- **Content hash** — the SHA-256 of the cited file at citation time. The
  citation verifier compares the recorded hash against the live file and
  reports `valid | moved | changed | gone`.
- **Stability tier** — `experimental | stable | deprecated`. New artifacts
  land as `experimental` and promote on green dogfood usage for four
  consecutive weeks.
- **Goodhart guard** — the convention that a verification step records what
  failed, not just the pass-rate. Mitigates metric-gaming.

## 5 — Memory, artifacts, and the inbox

- **Memory** — the union of `/src/memory/` (semantic and procedural),
  `/src/memory/smes/` (per-SME), `/src/memory/features/` (per-feature),
  `/src/memory/backlog/`, `/src/inbox/` (episodic), and the codebase itself.
- **Memory tiers** — *procedural* (`/src/memory/handbook/`, `/src/personas/`,
  `/src/skills/` — the rules), *semantic* (`/src/memory/adr|rfc|prd|runbooks/` — the
  facts and decisions), *episodic* (`/src/inbox/threads/`, `/src/work/*/*/run.log.jsonl`
  — the experiences).
- **active-memory** — the short-term operator-facing tier under `src/memory/active/`
  that holds concise summaries and pointers; canonical policy lives at
  `/src/memory/handbook/memory-tiers.md`.
- **durable-memory** — long-term ratified memory under `src/memory/features/`,
  `src/memory/adr/`, and `src/memory/backlog/` loaded by explicit route.
- **archival-memory** — historical execution artifacts under `src/work/`,
  `src/inbox/out/`, and `src/inbox/threads/` treated as explicit-read by default.
- **internal-operating-content** — handbook pages, persona specs, skills,
  Cursor rules, and Cursor agent mirrors loaded by narrow routes rather than
  wholesale sweeps.
- **generated-machine-artifact** — machine-oriented JSON, manifests, dry-run
  outputs, compliance bundles, and structured logs excluded from default
  semantic indexing unless a task documents inclusion.
- **MemoryStore** — the runtime adapter that exposes Mem0-shaped CRUD plus a
  Letta-shaped tier overlay plus Tesseract-native dual-anchor citations.
- **MemoryRouter** — reads `/src/memory/handbook/index.md` and loads top-K topic
  files for a given intent. Prevents context-window overload as the handbook
  grows.
- **Artifact** — a durable file produced by a pipeline or conversation: PRD,
  ADR, RFC, UX Spec, test plan, runbook, postmortem, delivery report.
  Citation-bearing and anti-rot-tracked.
- **Feature** — a first-class entity under `/src/memory/features/<id>/` binding
  every artifact for a single product capability. Has a unique slug and a
  generated `index.json`.
- **Backlog** — `/src/memory/backlog/`. The live, ranked product roadmap. Owned
  by the `pm` persona at M2+.
- **Adoption (`adopter` persona)** — the non-destructive first-run process for
  existing repositories. Scans codebase, detects conventions, proposes initial
  SMEs, seeds threshold policy from existing baselines, writes
  `/src/memory/adoption/scan-<date>.md`.
- **Inbox** — bidirectional message queue between humans and the org under
  `src/inbox/in/`, `src/inbox/out/`, and `src/inbox/threads/`. The `src/inbox/notes/`
  subdirectory is a human-operator-only sandbox; agents MUST NOT read or
  modify it (see `/src/memory/handbook/inbox-lifecycle.md` §1a).
- **Spec Kit alignment** — `/src/memory/features/<id>/` paths align with GitHub
  Spec Kit v0.8 conventions: `spec.md`, `plan.md`, `tasks.md`. The repo-level
  constitution lives at `/src/memory/handbook/constitution.md`.

## 6 — Substrate, control plane, and ecosystem endpoints

- **Control Plane** — thin orchestration layer: `AgentRunner`, `MemoryStore`,
  `Inbox`, `Notifier`, `WorktreePool`, `Scheduler`, `Intervention`,
  `Authorizer`. Decouples the rest of Tesseract from any one harness.
- **Primitive** — a single, independently importable piece of Tesseract under
  `@tesseract/<name>`. Each primitive depends only on `@tesseract/core` and
  external libraries.
- **Framework Mode** — opinionated install of the entire ecosystem (full org,
  conventions, CLI, scheduler, watchdog). The default install path.
- **Library Mode** — independent import of one or more primitives into another
  toolchain, with no dependency on the Tesseract CLI, conventions, or
  `tesseract.yaml`.
- **AGENTS.md** — repo-level Markdown briefing per the Linux Foundation
  Agentic AI Foundation standard. Tesseract's primary cross-tool contract.
  `CLAUDE.md` and `.github/copilot-instructions.md` are symlinks (or 3-line
  forwarders on Windows).
- **MCP server (`@tesseract/mcp-server`)** — publishes Tesseract primitives as
  MCP Tools and Resources. Stdio in MVP; HTTP at M5.
- **A2A (`@tesseract/a2a`)** — Linux-Foundation-hosted Agent-to-Agent v1.x.
  Each Tesseract org serves `/.well-known/agent-card.json`. M5+.
- **Run-log** — append-only OTLP-encoded stream under `/src/work/<day>/<id>/run.log.jsonl`
  carrying OpenInference primary attributes plus an OTel GenAI semconv parallel
  layer. The basis for Phoenix and Langfuse import.

## 7 — Stability and how to extend

- **Add a term.** The authoring persona MUST add the entry in the same change
  that introduces the noun. The entry SHOULD include the section number.
- **Rename a term.** Open an inbox item to `librarian` proposing the rename.
  After human ratification, `librarian` performs the project-wide rename and
  records the change under `/src/memory/adr/<seq>-glossary-rename-<term>.md`.
- **Deprecate a term.** Mark the entry with a `deprecated:` block citing the
  superseding term. Layer 1 lint emits a warning on deprecated terms; deletion
  follows after two MVP releases.

## 8 — Bootstrap status

This file is the Phase 0b handbook seed. The terms here MUST anchor every
clause authored in Phase 0c through Phase 5. Contradictions between this file
and the PRD MUST be resolved before promotion to `stability: stable`.
