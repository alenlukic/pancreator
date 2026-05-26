---
title: CLI operator tooling batch — deferral protocol, intake scaffolder, active-memory refresh
feature_id: cli-operator-tooling-batch
stage: intake
owner: intake-analyst
status: open
created_at: 2026-05-25T06:05:12Z
references:
  - kind: path
    path: src/internal/packages/@tesseract/cli/src/run.ts
    note: tess init, tess approve, tess memory, tess contracts, tess lint and the non-feature-delivery branch of tess run return {"status":"stub"}; tess inbox is read-only with no tess intake new.
  - kind: path
    path: src/internal/packages/@tesseract/mcp-server/
    note: Eight MCP tools mirror the same stubbed behavior; consistent protocol benefits both surfaces.
  - kind: path
    path: docs/PRD.md
    note: §9 claims the CLI grammar is operator-ready; today operators cannot tell which verbs work without invoking each.
  - kind: path
    path: src/personas/compliance-auditor.md
    note: Compliance-auditor expects deterministic CLI behavior; opaque stubs undermine audit reproducibility.
  - kind: path
    path: src/memory/handbook/inbox-lifecycle.md
    note: Defines the canonical {SID}_{HHMM}_{semantic}.md leaf layout and day-bucket naming.
  - kind: path
    path: src/memory/features/timestamp-naming-conventions/spec.md
    note: Defines SID = 86400 - secondsSinceMidnight and the HHMM wallclock encoding.
  - kind: path
    path: src/inbox/in/
    note: Operators currently hand-author day-bucket, SID prefix, and HHMM segment; active-feature row is meant to mirror the live queue.
  - kind: path
    path: src/memory/active/current.md
    note: Operator-facing pointers; the active-feature row and shipped-features table both lag inbox state today.
  - kind: path
    path: src/internal/work_archive/172981_05-25-26/69180_0447_broad-sweep-compliance/compliance-audit.md
    note: Finding M-01 and proposal P-02 record manual rotation as a recurring audit gap.
  - kind: path
    path: src/memory/features/json-formatting/index.json
    note: Per-feature index files are the existing source of truth for shipped features.
---

# CLI operator tooling batch — deferral protocol, intake scaffolder, active-memory refresh

This intake consolidates three related operator-friction items into one
delivery batch. Each work package retains its original `feature_id` for
tracking and downstream feature-folder creation.

| Work package | Original `feature_id` |
|---|---|
| Stub-verb deferral protocol | `cli-stub-verb-deferral-protocol` |
| Intake scaffolder | `tess-intake-scaffolder` |
| Active-memory refresher | `tess-refresh-active-memory` |

## Problem

Three deterministic operator workflows remain manual or opaque:

1. **Stub verbs masquerade as success.** The `tess` CLI and eight MCP tools
   expose verbs documented as MVP scope but implemented as
   `{"status":"stub"}` JSON with a zero exit code. Operators and CI cannot
   tell which verbs work, which milestone owns the gap, or what manual
   workaround applies.
2. **Intake authoring is fully manual.** Dropping a directive requires
   computing the day-bucket, SID prefix, HHMM wallclock encoding, YAML
   frontmatter, and canonical body sections by hand — every step is a
   documented contract, none is automated.
3. **Active memory drifts from source files.** `src/memory/active/current.md`
   is updated by hand. Compliance audits keep finding stale state (M-01 in
   the last broad sweep); the rotation is derivable from `src/inbox/in/`,
   `src/memory/features/*/index.json`, and active-work `state.json` but has
   no automated owner.

## Goal

Ship three CLI affordances that remove recurring operator friction:

1. A structured deferral protocol replacing bare stub envelopes.
2. `tess intake new <slug>` for templated inbox directive creation.
3. `tess refresh-active-memory` for deterministic active-memory rotation.

## Required outcomes

### WP-1 — Stub-verb explicit deferral protocol (`cli-stub-verb-deferral-protocol`)

1. Every stub CLI verb returns a JSON envelope of the shape:
   ```json
   {
     "status": "deferred",
     "verb": "tess <name>",
     "milestone": "M1 | M2 | M3",
     "tracking_intake": "src/inbox/in/<day>/<file>.md",
     "manual_workaround": "<short paragraph>"
   }
   ```
   and exits non-zero with a stable error code.
2. The same envelope is returned by the corresponding MCP tool stubs,
   keyed by tool name rather than verb.
3. Each stub points at the intake item that tracks its implementation
   (where one exists in this batch or elsewhere) or the relevant PRD section.
4. Help output (`tess --help`, `tess <verb> --help`) marks deferred verbs
   with a `[deferred: <milestone>]` tag.
5. Unit tests assert the envelope shape, the non-zero exit code, and the
   stable error code.

### WP-2 — Intake scaffolder (`tess-intake-scaffolder`)

1. `tess intake new <slug> [--title "..."] [--owner intake-analyst]
   [--feature-id <id>] [--from-template <name>]` writes a new file at
   `src/inbox/in/<today-day-bucket>/<sid>_<hhmm>_<slug>.md`.
2. The command computes the day-bucket, SID, and HHMM from the local
   clock in UTC, exactly per the inbox-lifecycle contract.
3. The command refuses to overwrite an existing file and refuses to write
   into an archived day-bucket.
4. The default template includes the canonical frontmatter (`title`,
   `feature_id`, `stage: intake`, `owner: intake-analyst`,
   `status: open`, `created_at`, empty `references[]`) and the canonical
   body (`# <title>`, `## Problem`, `## Goal`, `## Required outcomes`,
   `## Acceptance criteria`, `## Out of scope`).
5. `--from-template` selects an alternate template under
   `src/memory/handbook/contract-templates/` for ratification requests,
   compliance-trigger directives, etc.

### WP-3 — Active-memory refresher (`tess-refresh-active-memory`)

1. `tess refresh-active-memory [--dry-run]` rewrites the Active Feature
   row, the Most-recent shipped Features table, and the Operator-notes
   timestamp in `src/memory/active/current.md`.
2. Active Feature is computed from `src/inbox/in/` (newest unprocessed
   directive), with `(none)` when the queue contains only `.gitkeep` and
   archived items.
3. Shipped Features are computed by walking
   `src/memory/features/*/index.json` for entries with `status: indexed`
   sorted reverse-chronologically by `index.completed_at`.
4. The refresher refuses to clobber the references block and the operator
   notes section; it edits only the labelled sections.
5. The refresher emits a structured diff to stdout and exits non-zero
   when a manually-edited section conflicts with the computed value, so
   operators see the conflict instead of silent overwriting.

## Acceptance criteria

### WP-1 — Deferral protocol

- Running each currently-stubbed verb produces the deferral envelope,
  not the bare stub.
- A CI smoke test exercises every CLI verb at least once and asserts
  that no verb returns the historical `{"status":"stub"}` payload.
- AGENTS.md §6 references the deferral protocol as the canonical
  operator-friction contract.
- The compliance-auditor persona can rely on stable exit codes when
  evaluating CLI presence in broad sweeps.

### WP-2 — Intake scaffolder

- `tess intake new my-thing --title "My thing"` produces a file whose
  path, frontmatter, and body all conform to
  `src/memory/handbook/inbox-lifecycle.md`.
- A vitest suite covers SID/HHMM computation across day boundaries and
  the day-bucket creation path.
- AGENTS.md §6 references the command as the canonical operator entry.
- The command exits non-zero with a clear hint when invoked without an
  initialized repository.

### WP-3 — Active-memory refresher

- A vitest suite covers the empty-queue case, the active-directive case,
  and the multi-shipped-features case.
- The refresher resolves audit finding M-01 deterministically when run
  before commit.
- AGENTS.md §6 references the command as the canonical pre-commit
  refresher.
- The compliance-auditor persona's broad-sweep procedure cites the
  command as the auto-remediation for M-01 / m-03 class findings.

## Out of scope

- Implementing the deferred verbs themselves (each is a separate intake,
  for example `64500_0605_tess-init-and-create-tesseract-install-paths.md`
  for `tess init`).
- Localizing or templating the manual-workaround text beyond plain English.
- Editing existing inbox items (semantic immutability per
  `src/memory/handbook/inbox-lifecycle.md` §3b).
- Inbox archival (handled by the manual procedure or a separate
  `tess inbox archive` verb).
- MCP elicitation transport for intake or active-memory refresh (M2 scope).
- Cron / scheduler invocation for active-memory refresh (deferred to M4+
  per P-02).
- Rotating the references block or the open-risks block in
  `current.md` (those remain human-curated).

## Recommended downstream owners

- `tech-lead` for the deferral envelope contract, milestone map, and
  intake template contract under `src/memory/handbook/contract-templates/`.
- `coder` for CLI / MCP wiring, SID/HHMM computation, and the intake verb.
- `librarian` for the active-memory rotation contract.
- `tesseract-engineer` for the refresher implementation and vitest harness.
- `reviewer` for help-output, exit-code, day-boundary, and overwrite-refusal
  audits.
- `compliance-auditor` for adopting the refresher into the broad-sweep
  procedure.
