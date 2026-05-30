---
title: CLI operator tooling batch — deferral protocol, intake scaffolder, active-memory refresh
feature_id: cli-operator-tooling-batch-deferral-protocol-intake-scaffolder-active-memory-ref
status: intake-awaiting-ratification
next_owner: tech-lead
next_stage: plan
source_inbox_item: archive/inbox/in/172981_05-25-26/22411_1746_cli-operator-tooling-batch-deferral-protocol-intake-scaffolder-active-memory-ref/64488_0605_cli-operator-tooling-batch.md
intake_round: 0
work_packages:
  - feature_id: cli-stub-verb-deferral-protocol
    label: WP-1 — Stub-verb explicit deferral protocol
  - feature_id: pan-intake-scaffolder
    label: WP-2 — Intake scaffolder
  - feature_id: pan-refresh-active-memory
    label: WP-3 — Active-memory refresher
references:
  - kind: lines
    path: archive/inbox/in/172981_05-25-26/22411_1746_cli-operator-tooling-batch-deferral-protocol-intake-scaffolder-active-memory-ref/64488_0605_cli-operator-tooling-batch.md
    range: [1, 52]
    contentHash: 7f60993
    note: Directive frontmatter and problem statement define the three operator-friction items consolidated in this batch.
  - kind: lines
    path: archive/inbox/in/172981_05-25-26/22411_1746_cli-operator-tooling-batch-deferral-protocol-intake-scaffolder-active-memory-ref/64488_0605_cli-operator-tooling-batch.md
    range: [82, 138]
    contentHash: 7f60993
    note: Required outcomes for WP-1 (deferral envelope shape, exit code, MCP parity, help-output tag, unit tests).
  - kind: lines
    path: archive/inbox/in/172981_05-25-26/22411_1746_cli-operator-tooling-batch-deferral-protocol-intake-scaffolder-active-memory-ref/64488_0605_cli-operator-tooling-batch.md
    range: [104, 137]
    contentHash: 7f60993
    note: Required outcomes for WP-2 (pan intake new command, SID/HHMM computation, overwrite refusal, template contract).
  - kind: lines
    path: archive/inbox/in/172981_05-25-26/22411_1746_cli-operator-tooling-batch-deferral-protocol-intake-scaffolder-active-memory-ref/64488_0605_cli-operator-tooling-batch.md
    range: [122, 138]
    contentHash: 7f60993
    note: Required outcomes for WP-3 (pan refresh-active-memory, dry-run flag, source derivation, conflict detection).
  - kind: lines
    path: lib/internal/packages/@pancreator/cli/lib/run.ts
    range: [37, 44]
    contentHash: 8817a0d
    note: stub() helper emits {status:"stub"} with zero exit code; WP-1 replaces this with the deferred envelope and non-zero exit.
  - kind: lines
    path: lib/memory/handbook/inbox-lifecycle.md
    range: [1, 10]
    contentHash: 0b097ca
    note: Defines the canonical {SID}_{HHMM}_{semantic}.md leaf layout and day-bucket naming that WP-2 must implement.
  - kind: lines
    path: lib/memory/features/timestamp-naming-conventions/spec.md
    range: [1, 10]
    contentHash: 0573437
    note: Defines SID = 86400 - secondsSinceMidnight and HHMM wallclock encoding that WP-2 must follow exactly.
  - kind: lines
    path: lib/memory/active/current.md
    range: [1, 10]
    contentHash: 300177f
    note: Active-memory file whose labelled sections WP-3 must rewrite deterministically without clobbering the references or operator-notes blocks.
  - kind: lines
    path: docs/PRD.md
    range: [641, 648]
    contentHash: 2ce8e5c
    note: PRD §7 feature-delivery intake stage declares inputs, outputs, loop.max_rounds 5, and gate human_approval.
---

# Spec

This Feature SHALL deliver three CLI affordances that remove recurring operator
friction in the Pancreator repository. Each affordance corresponds to a named
work package (WP) that retains its original `feature_id` for downstream tracking.

**WP-1 (`cli-stub-verb-deferral-protocol`)** SHALL replace every bare
`{"status":"stub"}` envelope in the `pan` CLI and the eight MCP tools with a
structured deferral envelope that names the owning milestone, provides a
tracking pointer, and exits non-zero with a stable error code.

**WP-2 (`pan-intake-scaffolder`)** SHALL add `pan intake new <slug>` to
the CLI, computing the day-bucket, SID, and HHMM from the local UTC clock and
writing a conformant inbox directive file at
`lib/inbox/in/<today-day-bucket>/<sid>_<hhmm>_<slug>.md`.

**WP-3 (`pan-refresh-active-memory`)** SHALL add
`pan refresh-active-memory [--dry-run]` to the CLI, rewriting the Active
Feature row, the Most-recent Shipped Features table, and the Operator-notes
timestamp in `lib/memory/active/current.md` from deterministic sources, with
conflict detection when a manually-edited section disagrees with the computed
value.

## Acceptance criteria

### WP-1 — Stub-verb explicit deferral protocol

- When an operator invokes a currently-stubbed CLI verb (`pan init`,
  `pan approve`, `pan memory`, `pan contracts`, `pan lint`, or the
  non-feature-delivery branch of `pan run`), the command SHALL emit a JSON
  envelope conforming exactly to the following shape and exit with a non-zero
  stable error code:
  ```json
  {
    "status": "deferred",
    "verb": "pan <name>",
    "milestone": "M1 | M2 | M3",
    "tracking_intake": "lib/inbox/in/<day>/<file>.md",
    "manual_workaround": "<plain-English paragraph>"
  }
  ```
- When the corresponding MCP tool stub is invoked, the tool SHALL return the
  same envelope keyed by tool name rather than verb, and SHALL indicate the
  deferred status via a non-success response code in the MCP protocol.
- When `tracking_intake` references a work package in this batch, it SHALL
  point to `archive/inbox/in/172981_05-25-26/22411_1746_cli-operator-tooling-batch-deferral-protocol-intake-scaffolder-active-memory-ref/64488_0605_cli-operator-tooling-batch.md`;
  when no intake item exists, it SHALL point to the relevant PRD section path.
- When an operator runs `pan --help` or `pan <verb> --help`, the help output
  SHALL mark every deferred verb with a `[deferred: <milestone>]` tag adjacent
  to the command description.
- A unit test suite SHALL assert that every deferred verb: (a) emits the
  envelope shape above; (b) exits with a non-zero exit code; and (c) returns the
  same stable error code across repeated invocations.
- A CI smoke test SHALL exercise every CLI verb at least once and SHALL assert
  that no verb returns the historical `{"status":"stub"}` payload.

### WP-2 — Intake scaffolder

- When an operator runs `pan intake new <slug>`, the command SHALL write a new
  file at `lib/inbox/in/<today-day-bucket>/<sid>_<hhmm>_<slug>.md`, where
  `<today-day-bucket>` is the UTC date formatted as `<epoch-day>_<MM>-<DD>-<YY>`,
  SID equals `86400 - secondsSinceMidnightUTC`, and HHMM is the zero-padded
  UTC hour and minute, exactly per `lib/memory/handbook/inbox-lifecycle.md` and
  `lib/memory/features/timestamp-naming-conventions/spec.md`.
- The command SHALL accept the optional flags `--title "<string>"`,
  `--owner <persona>` (default `intake-analyst`), `--feature-id <id>`, and
  `--from-template <name>`.
- The default template SHALL produce a file with the following frontmatter
  fields: `title`, `feature_id`, `stage: intake`, `owner: intake-analyst`,
  `status: open`, `created_at` (ISO 8601 UTC timestamp), and an empty
  `references: []` array; and the following body sections: `# <title>`,
  `## Problem`, `## Goal`, `## Required outcomes`, `## Acceptance criteria`,
  `## Out of scope`.
- When `--from-template <name>` is supplied, the command SHALL resolve
  `lib/memory/handbook/contract-templates/<name>.template.md` and use its
  content as the body template; it SHALL exit non-zero with a descriptive hint
  when the named template does not exist.
- The command SHALL refuse to overwrite an existing file and SHALL exit non-zero
  with a message naming the conflicting path.
- The command SHALL refuse to write into an archived day-bucket and SHALL exit
  non-zero with a message identifying the bucket as archived.
- The command SHALL exit non-zero with a clear hint when invoked outside an
  initialized Pancreator repository (i.e., when `pancreator.yaml` is absent from
  the repo root).
- The day-bucket directory SHALL be created when it does not yet exist.
- A vitest suite SHALL cover: (a) SID/HHMM computation accuracy across
  UTC day boundaries; (b) day-bucket creation when absent; (c) overwrite refusal;
  (d) archived-bucket refusal; and (e) template selection including the missing-
  template error path.

### WP-3 — Active-memory refresher

- When an operator runs `pan refresh-active-memory`, the command SHALL rewrite
  exactly three labelled sections in `lib/memory/active/current.md`:
  the Active Feature row, the Most-recent Shipped Features table, and the
  Operator-notes timestamp.
- The Active Feature value SHALL be derived from `lib/inbox/in/` as the newest
  unprocessed directive file; when the queue contains only `.gitkeep` and
  archived items, the value SHALL be `(none)`.
- The Shipped Features value SHALL be derived by walking
  `lib/memory/features/*/index.json` for entries with `status: indexed`, sorted
  reverse-chronologically by the `index.completed_at` field.
- The command SHALL not modify the `## References` block or any manually-curated
  `## Operator notes` section; it SHALL edit only the three labelled sections
  named above.
- When run with `--dry-run`, the command SHALL emit the computed diff to stdout
  without writing any file.
- When a labelled section's current content differs from the computed value, the
  command SHALL emit a structured diff to stdout and SHALL exit non-zero so the
  operator can inspect the conflict before accepting the change.
- A vitest suite SHALL cover: (a) the empty-queue case producing `(none)`;
  (b) the active-directive case producing the correct newest-file pointer;
  (c) the multi-shipped-features case producing the correct reverse-chronological
  list; and (d) the conflict-detection case confirming non-zero exit on mismatch.

### Cross-cutting

- `AGENTS.md` §6 SHALL be updated to reference: (a) the deferral protocol as
  the canonical operator-friction contract; (b) `pan intake new` as the
  canonical operator entry for new directives; and (c) `pan refresh-active-memory`
  as the canonical pre-commit active-memory refresher.
- The `compliance-auditor` persona's broad-sweep procedure SHALL cite
  `pan refresh-active-memory` as the auto-remediation for M-01 and M-03 class
  active-memory staleness findings.

## Out of scope

- Implementing the deferred verbs themselves; each requires a separate intake
  (for example `lib/inbox/in/172981_05-25-26/64500_0605_pan-init-and-create-pancreator-install-paths.md`
  tracks `pan init`).
- Localizing or templating the `manual_workaround` text beyond plain English.
- Editing existing inbox items; semantic immutability per
  `lib/memory/handbook/inbox-lifecycle.md` §3b prohibits mutation.
- Inbox archival; that is handled by the manual procedure or a separate
  `pan inbox archive` verb.
- MCP elicitation transport for intake or active-memory refresh; that is M2
  scope.
- Cron or scheduler invocation for active-memory refresh; that is deferred to
  M4+ per audit proposal P-02.
- Rotating the `## References` block or the open-risks block in
  `lib/memory/active/current.md`; those remain human-curated.
- Implementing a UI or non-CLI surface for any of the three commands.

## Downstream owners

The following persona assignments are RECOMMENDED for the plan stage:

| Work package | Recommended owner(s) |
|---|---|
| WP-1 deferral envelope contract and milestone map | `tech-lead` |
| WP-1 and WP-2 CLI/MCP wiring, SID/HHMM computation | `coder` |
| WP-2 intake template contract under `lib/memory/handbook/contract-templates/` | `tech-lead` |
| WP-3 active-memory rotation contract | `librarian` |
| WP-3 refresher implementation and vitest harness | `pancreator-engineer` |
| Help-output, exit-code, day-boundary, overwrite-refusal audits | `reviewer` |
| Adopting the refresher into the broad-sweep procedure | `compliance-auditor` |

## Open questions

_(none — directive is sufficiently specified for plan-stage delegation)_
