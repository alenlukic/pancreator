---
title: Build-mode inbox scaffolding Engineering Spec
feature_id: build-mode-inbox-scaffolding
task_id: 73472_0335_build-mode-inbox-scaffolding
stage: intake
owner: intake-analyst
status: intake-awaiting-ratification
intake_round: 0
clarifying_rounds_posted: 0
source_inbox_item: lib/inbox/in/172971_06-04-26/19570_1833_build-mode-inbox-scaffolding.md
next_owner: tech-lead
next_stage: plan
intake_closure:
  human_approval_gate: pending
  approved_date: null
  channel: operator_cursor_chat
  note: Spec emitted for human ratification. No clarifying rounds were required because the Build-mode directive defines the operator prompt, a four-step plan, two acceptance checks, and `source_channel: cursor-build-mode` without unresolved scope, acceptance, constraint, or prior-art gaps.
intake_notes:
  - The intake-analyst did not enter the canonicalize-spec clarifying-question loop because the source directive carries a completed plan snapshot, explicit acceptance bullets, and a `source_channel: cursor-build-mode` frontmatter field from `pan intake from-build-plan`.
  - The canonical spec consolidates the directive plan into one CLI module, one new intake subcommand, operator documentation, agent obligations, and test coverage without expanding into automatic feature-delivery startup or inbox archival.
  - The human_approval gate remains mandatory before any state transition. After ratification, the SDK-controlled feature-delivery runner may advance task `73472_0335_build-mode-inbox-scaffolding` with this artifact.
references:
  - kind: lines
    path: lib/inbox/in/172971_06-04-26/19570_1833_build-mode-inbox-scaffolding.md
    range: [14, 16]
    contentHash: a021958
    note: Source directive Problem section states the Build-mode auto-scaffold requirement.
  - kind: lines
    path: lib/inbox/in/172971_06-04-26/19570_1833_build-mode-inbox-scaffolding.md
    range: [26, 29]
    contentHash: a021958
    note: Source directive plan enumerates intake-scaffold extraction, from-build-plan CLI, documentation, and tests.
  - kind: lines
    path: lib/inbox/in/172971_06-04-26/19570_1833_build-mode-inbox-scaffolding.md
    range: [33, 34]
    contentHash: a021958
    note: Source directive acceptance bullets anchor path shape and agent timing obligations.
  - kind: lines
    path: AGENTS.md
    range: [178, 189]
    contentHash: b953d77
    note: AGENTS Build-mode inbox scaffolding obligation names from-build-plan invocation timing and duplicate-prevention rules.
  - kind: lines
    path: lib/memory/handbook/inbox-lifecycle.md
    range: [75, 83]
    contentHash: 2762053
    note: Canonical inbox path layout with day-bucket and SID_HHMM_semantic leaf naming.
  - kind: lines
    path: lib/memory/features/timestamp-naming-conventions/spec.md
    range: [54, 59]
    contentHash: 294422f
    note: SID equals 86400 seconds minus seconds since UTC midnight; HHMM uses zero-padded UTC hour and minute.
  - kind: lines
    path: lib/memory/features/cli-operator-tooling-batch-deferral-protocol-intake-scaffolder-active-memory-ref/spec.md
    range: [120, 152]
    contentHash: 57626d6
    note: Prior art for pan intake new path computation, template contract, and overwrite refusal that from-build-plan MUST reuse.
  - kind: lines
    path: .docs/PRD.md
    range: [641, 648]
    contentHash: 2eb6aa4
    note: Feature-delivery intake stage declares loop.max_rounds 5 and gate human_approval.
---

# Spec

This Feature SHALL close the gap between Cursor Build mode and the Pancreator
inbox queue. When an operator submits a net-new product or pipeline request
through Cursor Build mode without naming an existing `lib/inbox/in/` directive,
the agent SHALL present a plan, then SHALL scaffold a canonical inbox directive
before the first implementation edit. The Feature SHALL extract shared UTC
day-bucket, SID, HHMM, slug, and write helpers into
`lib/internal/packages/@pancreator/cli/src/intake-scaffold.ts`, SHALL add
`pnpm -w exec pan intake from-build-plan <slug>` to emit Build-mode directives
with `source_channel: cursor-build-mode`, SHALL document the obligation in
`AGENTS.md` and `OPERATION.md`, and SHALL add unit and repository-structure
tests that lock the contract.

## Acceptance criteria

### Shared intake scaffold module

- When the Feature refactors `pan intake new`, the Feature SHALL move UTC
  day-bucket, SID, HHMM, slug validation, slugify, default Markdown template,
  Build-plan Markdown template, and inbox write logic into
  `lib/internal/packages/@pancreator/cli/src/intake-scaffold.ts`.
- When the module computes a day bucket, the module SHALL format the basename
  as `<days-to-FDS>_<MM>-<DD>-<YY>` using UTC per
  `lib/memory/handbook/inbox-lifecycle.md` and
  `lib/memory/features/timestamp-naming-conventions/spec.md`.
- When the module computes SID for an inbox leaf, the module SHALL set SID to
  seconds remaining until the next UTC midnight.
- When the module computes HHMM for an inbox leaf, the module SHALL zero-pad
  the UTC hour and minute to four digits.
- When `createIntakeDirective` targets an existing file, the command SHALL
  refuse overwrite and SHALL exit non-zero with a message naming the conflicting
  path.
- When `createIntakeDirective` runs outside an initialized Pancreator workspace,
  the command SHALL exit non-zero with a hint to run from a repository containing
  `pancreator.yaml`.

### `pan intake from-build-plan` CLI

- When an operator runs
  `pnpm -w exec pan intake from-build-plan <slug>`, the command SHALL require
  non-empty operator prompt content via `--operator-prompt` or `--prompt-file`.
- When an operator runs
  `pnpm -w exec pan intake from-build-plan <slug>`, the command SHALL require
  non-empty plan content via `--plan-text` or `--plan-file`.
- When the command succeeds, the command SHALL write
  `lib/inbox/in/<day-bucket>/<SID>_<HHMM>_<slug>.md` and SHALL include
  `source_channel: cursor-build-mode` in YAML frontmatter.
- When the command succeeds, the Markdown body SHALL include sections for
  Problem, Goal, Required outcomes, Acceptance criteria, Out of scope,
  Operator prompt (Build mode), and Plan snapshot populated from the supplied
  prompt and plan text.
- When the operator supplies `--title`, `--owner`, or `--feature-id`, the command
  SHALL record those values in frontmatter; otherwise the command SHALL default
  title and feature id to `<slug>` and owner to `intake-analyst`.
- When the command succeeds, the JSON envelope on stdout SHALL include
  `"command": "intake from-build-plan"`, `"status": "ok"`, and the repo-relative
  `"path"` of the created directive.

### Agent and operator documentation

- When an agent reads `AGENTS.md`, the agent SHALL find a Build-mode inbox
  scaffolding clause that requires plan presentation, `pan intake from-build-plan`
  invocation after plan completion and before implementation edits, lowercase
  hyphenated slug selection, duplicate-directive prevention when an existing
  inbox path or active `.pan/work/<day>/<task-id>/` run owns the work, and a
  prohibition on inbox creation under `simple task mode`.
- When an operator reads `OPERATION.md` § Inbox lifecycle, the operator SHALL
  find a documented `pan intake from-build-plan` workflow with copy-paste flags
  for `--title`, `--operator-prompt`, and `--plan-text` (or file equivalents).

### Agent runtime obligation

- When an agent completes a Build-mode plan for a net-new request without a
  named inbox directive, the agent SHALL run
  `pnpm -w exec pan intake from-build-plan <slug>` before the first repository
  edit that implements the plan.
- When the operator named an existing `lib/inbox/in/` path or an active
  `.pan/work/<day>/<task-id>/` run owns the work, the agent SHALL NOT create a
  duplicate directive.

### Tests

- A vitest suite under `intake-scaffold.test.ts` SHALL cover day-bucket shape,
  SID and HHMM computation, slugify behavior, Build-plan Markdown frontmatter
  and body fields, and overwrite refusal.
- A vitest suite under `run.test.ts` SHALL cover the `from-build-plan` command
  end-to-end including stdout envelope shape and written directive content.
- A repository-structure test SHALL assert that `AGENTS.md` documents both
  Build-mode inbox scaffolding and `pan intake from-build-plan`.

## Out of scope

- Changing `pan intake new` operator semantics beyond refactoring to the shared
  scaffold module per
  `lib/memory/features/cli-operator-tooling-batch-deferral-protocol-intake-scaffolder-active-memory-ref/spec.md`.
- Automatically starting `pnpm -w exec pan run feature-delivery` from Build
  mode; operators still promote inbox directives into feature-delivery runs
  explicitly.
- SDK runner or CursorRunner invoking `from-build-plan`; agents invoke the CLI
  manually or via shell per the AGENTS obligation.
- Inbox archival, thread management, or mutation of existing directives; semantic
  immutability per `lib/memory/handbook/inbox-lifecycle.md` §3b remains in
  force.
- Reading or writing `lib/inbox/notes/`; that path stays human-only.
- Creating inbox directives when `simple task mode` applies per
  `lib/memory/handbook/context-economy.md`.
- MCP tool surfaces for Build-mode scaffolding; CLI and agent documentation
  suffice for M1.

## Open questions

_(none — directive is sufficiently specified for plan-stage delegation)_
