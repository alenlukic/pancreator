---
id: surface-opt-track-o-cli-engine
title: "surface-opt Track O — CLI/runner engine pass"
status: draft
stage: intake
owner: tech-lead
created_at: "2026-06-01T17:52:00.000Z"
program: pancreator-surface-optimization
track: O
pieces: ["P5", "P6", "P7", "P8"]
delivery_mode: "out-of-band single pass (simple task mode); NOT feature-delivery"
depends_on: ["P3", "P7-internal"]
source_directive: lib/inbox/in/172974_06-01-26/75420_0303_surface-opt-track-o-cli-engine.md
references:
  - kind: lines
    path: lib/inbox/in/172974_06-01-26/75420_0303_surface-opt-track-o-cli-engine.md
    range: [31, 188]
    contentHash: eb3ea57
    note: "Source directive defines the Track O problem, single-window implementation order, validation flow, and AC-P5 through AC-P8."
  - kind: lines
    path: lib/internal/packages/@pancreator/cli/src/run.ts
    range: [270, 389]
    contentHash: f31b63d
    note: "CLI currently wires run, inbox, status, and advance as JSON-only commands and has no pan next or pan doctor surface."
  - kind: lines
    path: lib/internal/packages/@pancreator/cli/src/feature-delivery-run.ts
    range: [1302, 1325]
    contentHash: 33de090
    note: "stageContractMarkdown hardcodes copy-paste advance commands in prompt text instead of exposing a reusable next-command derivation surface."
  - kind: lines
    path: lib/internal/packages/@pancreator/cli/src/feature-delivery-run.ts
    range: [1645, 1670]
    contentHash: 33de090
    note: "State load/write currently parses into FeatureDeliveryState and rewrites from the typed shape, so additive fields require explicit passthrough."
  - kind: lines
    path: lib/internal/packages/@pancreator/cli/src/feature-delivery-run.ts
    range: [1739, 1779]
    contentHash: 33de090
    note: "Implement-after-must_fix already supports a review.md reentry fast path that the new next-command surface SHALL preserve."
  - kind: lines
    path: lib/internal/packages/@pancreator/cli/src/feature-delivery-stage-artifacts.ts
    range: [159, 194]
    contentHash: 0a453d8
    note: "Artifact validation is existence-only today; warn-first content validation extends this surface."
  - kind: lines
    path: lib/internal/packages/@pancreator/cli/src/feature-delivery-runner.ts
    range: [444, 460]
    contentHash: c0befcf
    note: "Review and test artifacts already expose minimal machine-readable verdict fields that can anchor warn-first validators."
  - kind: lines
    path: lib/internal/tools/migrate-timestamp-naming.mjs
    range: [59, 109]
    contentHash: 02eadfb
    note: "daysToFds, secondsRemainingInDay, and hhmm encode the countdown naming scheme that Track O MUST decode for text output."
  - kind: lines
    path: lib/internal/tools/context-budget-report.mjs
    range: [149, 156]
    contentHash: 6cc94bb
    note: "The report currently reads .cursorindexingignore unconditionally, so a missing file throws instead of returning a structured diagnostic."
---

# Engineering Spec — surface-opt Track O CLI/runner engine pass

## 1 — Context and motivation

Track O is the first engine pass that changes operator-facing CLI behavior and
the feature-delivery runtime in one window. Today the CLI emits JSON envelopes
only, the exact advance command exists only as duplicated prose inside prompt
text, artifact validation blocks only on missing files, the countdown timestamp
scheme is write-only for humans, and `context-budget-report.mjs` throws when
`.cursorindexingignore` is absent. All four gaps sit on the same compiled
runner boundary and share one rebuild, so the pass SHALL land as one out-of-band
engine change after the Track D archive line is clear.

The design priority is truthfulness over convenience. Every surfaced
`nextCommand` SHALL be executable for the current ledger state, including the
existing implement-after-`must_fix` review reentry fast path and report-approval
states whose artifact path is created at runtime. Every new validator SHALL
remain warn-first in the advance path so the engine becomes more observable
before it becomes stricter.

## 2 — Requirements

### R1 — Reusable next-command engine

**R1.1** The CLI/runtime SHALL expose one shared next-step resolver that returns
the exact next event, artifact path, and `nextCommand` string for the current
feature-delivery state.

**R1.2** `pan run feature-delivery ...`, `pan advance ...`, and `pan status
<taskId>` SHALL include `nextCommand` in JSON output whenever the state is
non-terminal and the next operator action is an `advance` command.

**R1.3** The new `pan next <taskId>` read-only command SHALL return the same
next-step payload without mutating state.

**R1.4** The resolver SHALL preserve the existing implement-after-`must_fix`
fast path: when the current stage is `implement`, the last advance was
`review -> implement` on `must_fix`, `review.md` exists, and `review_passes:
true` is present, the emitted command SHALL advance with `review.md` and land at
`test`.

**R1.5** When the next artifact path is created dynamically and cannot be
rederived from stage contracts alone, the state MAY persist `nextCommand` as an
optional field; readers SHALL prefer the persisted value, writers SHALL preserve
it verbatim, and writers SHALL preserve unknown sibling fields instead of
narrowing the JSON shape on save.

**R1.6** The shared resolver SHALL become the source of truth for prompt text
that currently hardcodes advance commands, so prompt output and CLI output
cannot drift.

### R2 — Human-readable text mode and timestamp decode

**R2.1** `pan run feature-delivery ...`, `pan advance ...`, `pan status
<taskId>`, `pan next <taskId>`, and `pan inbox` SHALL support `--format text`
in addition to the existing JSON default.

**R2.2** The CLI SHALL add one shared countdown decode util under
`lib/internal/packages/@pancreator/cli/src` that inverts
`<days>_<MM-DD-YY>/<seconds>_<HHMM>_<slug>` into `YYYY-MM-DD HH:MM UTC` using
the same FDS/day-start math as the existing encoders.

**R2.3** In text mode, every displayed countdown id SHALL keep the raw id and
add the decoded UTC timestamp on the same line; on-disk names SHALL remain
unchanged.

**R2.4** `pan status` and `pan next` SHALL derive the day bucket from
`runDir`/`stateFile`; `pan inbox` SHALL derive it from each nested inbox entry
path.

### R3 — Warn-first content validation

**R3.1** Stage artifact validation SHALL retain the existing missing-file checks
and SHALL add content warnings for `plan.md`, `implementation-report.md`,
`review.md`, `test-report.md`, and `policy-compliance.json`.

**R3.2** The validators SHALL stay deliberately minimal:

- `review.md`: `review_passes: true|false` MUST parse.
- `test-report.md`: `qa_passes: true|false` MUST parse; `plan_invalidating`
  remains optional.
- `policy-compliance.json`: JSON MUST parse and include the required top-level
  keys from the policy-compliance contract.
- `plan.md` and `implementation-report.md`: files MUST be non-empty markdown
  with at least one level-2 heading and at least one non-heading content line.

**R3.3** The advance path SHALL record content warnings in warn-only mode and
SHALL never throw or block progression solely because content validation failed
in this pass.

**R3.4** The CLI SHALL add `pan artifacts validate <taskId> --stage <stage>` as
a read-only entry point over the same validators. The command SHALL produce
`warningCount` and per-artifact diagnostics; it SHALL exit `0` when clean and
non-zero when warnings are present, without throwing.

### R4 — `pan doctor` pre-close aggregator

**R4.1** The CLI SHALL add `pan doctor` as a read-only pre-close validation
command that aggregates the existing librarian pre-close checks from
`OPERATION.md`, the R3 artifact validators, and the P3 shipped-ledger cap
check.

**R4.2** `pan doctor` SHALL execute the existing repo-root check suite as named
checks, preserve their command strings in output, and append read-only engine
checks for:

- active `feature-delivery` artifact-content validation,
- `lib/memory/active/current.md` shipped-ledger cap,
- `.cursorindexingignore` availability / context-budget-report health.

**R4.3** The command SHALL print one summary with per-check `pass|fail|skip`,
the failed remediation command or file path, and an aggregate exit code of `0`
only when every required check passes.

**R4.4** When no active feature-delivery run exists, artifact-content validation
MAY report `skip`; the rest of `pan doctor` SHALL still run.

### R5 — State fidelity and rebuild discipline

**R5.1** `schemaVersion` SHALL be preserved from the loaded state when present;
new runs MAY continue to initialize with the current schema version value.

**R5.2** Additive fields introduced by this pass, including optional
`nextCommand`, SHALL be backward-compatible and SHALL NOT require a blocking
migration.

**R5.3** The pass SHALL remain single-window: no compiled `dist` rebuild occurs
until all code and tests for P5 through P8 are ready, and exactly one rebuild
occurs before the smoke test.

## 3 — Acceptance criteria

- AC-P5: When `run`, `advance`, or `status` returns a non-terminal
  feature-delivery envelope, the envelope SHALL include an executable
  `nextCommand` string; `pan next <taskId>` SHALL exist; `--format text` SHALL
  exist on `run`, `advance`, `status`, `next`, and `inbox`.
- AC-P5a: When a task sits in implement after a review `must_fix` loop and
  `review.md` records `review_passes: true`, the surfaced `nextCommand` SHALL
  advance with `review.md`, not regress to a generic implementation-report path.
- AC-P5b: When the report-approval gate creates an outbox approval artifact, the
  surfaced `nextCommand` SHALL continue to point at that exact outbox artifact
  after a later `pan status` or `pan next` read.
- AC-P6: Text output for `pan next`, `pan status`, and `pan inbox` SHALL display
  raw countdown ids and decoded `YYYY-MM-DD HH:MM UTC` timestamps on the same
  line, while leaving repository path names unchanged.
- AC-P6a: Encode-then-decode SHALL be exact for 10 representative ids spanning
  midnight-edge, early-day, and late-day values.
- AC-P7: `feature-delivery` advances SHALL warn, not throw, when `plan.md`,
  `implementation-report.md`, `review.md`, `test-report.md`, or
  `policy-compliance.json` is malformed; `pan artifacts validate <taskId>
  --stage <stage>` SHALL report 1 warning for a malformed required artifact and
  0 warnings for a valid one.
- AC-P8: `pan doctor` SHALL run the named pre-close checks, the warn-first
  artifact validators in read-only mode, the P3 shipped-ledger cap check, and
  the context-budget ignore-file check, then print one pass/fail summary with
  remediation commands; a missing `.cursorindexingignore` SHALL return non-zero
  without an unhandled throw.

## 4 — Technical design

### 4.1 — Next-step resolution

The pass SHALL introduce one shared resolver with a read-only contract
equivalent to:

```ts
type NextStep = {
  event: string | null;
  artifact: string | null;
  nextCommand: string | null;
  source: "derived" | "persisted";
  reason?: string;
};
```

Resolution order SHALL be:

1. If the loaded state carries an explicit `nextCommand` for a
   runtime-generated gate artifact, return it.
2. If the state is `halted`, `closed`, `aborted`, or `complete`, return
   `nextCommand: null`.
3. If implement-after-`must_fix` reentry preconditions hold, return the
   `review.md` command.
4. Otherwise derive the command from the current stage, the default or requested
   transition event, and the stage contract's primary advance artifact.
5. If no matching transition exists, return `nextCommand: null` with an
   explanatory `reason` rather than fabricating a command.

This resolver SHALL feed:

- JSON envelopes for `run`, `advance`, `status`, and `next`,
- text-mode renderers,
- prompt stage contracts that currently duplicate
  `pnpm -w exec pan advance ...`,
- any future retry/report gating that needs to surface an exact resume command.

For report approval, the engine already creates a task-specific outbox artifact
path at runtime. That path is not rederivable from stage contracts alone, so the
created command SHALL be written into optional state and cleared after the next
successful transition.

### 4.2 — Text formatter contract

Text mode SHALL be presentation-only. Core command functions SHALL continue
returning structured JSON objects; `run.ts` SHALL format those results into text
when `--format text` is selected.

Minimum text payloads:

- `run` / `advance`: current stage, next human action, surfaced `nextCommand`,
  and the decoded task timestamp.
- `status`: task id, decoded timestamp, pipeline status, current stage, next
  human action, and surfaced `nextCommand`.
- `next`: task id, decoded timestamp, resolved event, resolved artifact, and
  surfaced `nextCommand`.
- `inbox`: one line per nested inbox path, with decoded timestamp appended when
  the first two path segments match the countdown naming scheme.

The timestamp decoder SHALL accept `dayBucket` plus `taskId`, reconstruct the
UTC calendar day from `daysToFds`, reconstruct the UTC clock from the SID/HHMM
tokens, and verify the tokens agree before emitting the final timestamp string.
A token mismatch SHALL produce a formatter diagnostic instead of silently
inventing a date.

### 4.3 — Artifact validation model

`validateStageCompletionArtifacts()` SHALL grow from:

- `missing[]`
- `present[]`

to a richer result that also includes per-artifact warnings. Missing required
files remain hard failures. Content warnings are soft failures in the advance
path.

Validator sources:

- `review.md` SHALL reuse `parseReviewPassesVerdict()`.
- `test-report.md` SHALL reuse `parseQaVerdict()`.
- `policy-compliance.json` SHALL parse as JSON and assert `task_id`,
  `governing_sources_checked`, `documentation_impact`, and `policy_alignment`.
- `plan.md` and `implementation-report.md` SHALL assert non-empty markdown with
  at least one level-2 heading and at least one non-heading content line.

`pan artifacts validate <taskId> --stage <stage>` SHALL call the same validator
surface read-only. `advanceFeatureDelivery()` SHALL call it after existence
checks and SHALL append warnings to CLI output and run-log context, but SHALL
not block stage advancement in this pass.

### 4.4 — `pan doctor` execution model

`pan doctor` SHALL materialize a check registry instead of ad hoc command
chaining. Each check record SHALL contain:

- stable check id,
- human label,
- command or helper name,
- `pass|fail|skip`,
- exit code when applicable,
- one-line remediation.

The registry SHALL include the current librarian pre-close suite from
`OPERATION.md`:

```text
pnpm run build
pnpm lint
pnpm run lint:deps
pnpm typecheck
pnpm run attw
pnpm run publint
pnpm test
node --test tests/*.test.mjs
node lib/internal/tools/run-compliance.mjs
node lib/internal/tools/check-phase-0a-scaffold.mjs
node lib/internal/tools/context-budget-report.mjs
bash -n .cursor/hooks/enforce-policy-compliance.sh
node lib/internal/tools/check-operator-output.mjs
```

The registry SHALL then add read-only engine checks:

- one P7 artifact validation pass for each active feature-delivery state under
  `.pan/work/<day>/<taskId>/state.json`,
- one shipped-ledger cap check against `lib/memory/active/current.md`,
- one explicit `.cursorindexingignore` health check that turns a missing file
  into a normal failed check instead of an exception.

The final summary SHALL surface both counts and copy-paste remediation, for
example rerunning the exact failed command or restoring `.cursorindexingignore`
at the repository root.

### 4.5 — Context-budget failure guard

`context-budget-report.mjs` SHALL stop assuming `.cursorindexingignore` exists.
When the file is missing, the tool SHALL:

1. print a stable structured error line naming the missing path,
2. exit non-zero,
3. avoid an uncaught stack trace,
4. keep imported helper behavior usable by `pan doctor`.

This guard SHALL be treated as a normal failing doctor check, not a fatal CLI
crash.

## 5 — Projected touch set

| Path | Change type | Rationale |
|------|-------------|-----------|
| `lib/internal/packages/@pancreator/cli/src/run.ts` | modify | Add `pan next`, `pan doctor`, `pan artifacts validate`, and `--format text` command wiring (R1, R2, R3, R4). |
| `lib/internal/packages/@pancreator/cli/src/feature-delivery-run.ts` | modify | Add shared next-step resolution, enrich result envelopes, preserve optional/passthrough state fields, and remove duplicated prompt command construction (R1, R5). |
| `lib/internal/packages/@pancreator/cli/src/feature-delivery-stage-artifacts.ts` | modify | Extend existence checks with warn-first content validators and expose read-only validation results (R3). |
| `lib/internal/packages/@pancreator/cli/src/feature-delivery-runner.ts` | modify | Reuse the shared next-step logic for review/test reentry and preserve runtime-generated `nextCommand` values when gates create dynamic artifacts (R1). |
| `lib/internal/packages/@pancreator/cli/src/timestamp-decode.ts` | create | Shared countdown decode util reused by `next`, `status`, `run`, `advance`, and `inbox` text mode (R2). |
| `lib/internal/tools/context-budget-report.mjs` | modify | Convert missing `.cursorindexingignore` from an uncaught exception into a structured non-zero failure (R4.3, R4.5). |
| `lib/internal/packages/@pancreator/cli/src/run.test.ts` | modify | Cover `pan next`, `--format text`, persisted dynamic `nextCommand`, and `pan doctor` aggregation (AC-P5, AC-P6, AC-P8). |
| `lib/internal/packages/@pancreator/cli/src/feature-delivery-stage-artifacts.test.ts` | modify | Cover warn-first malformed/valid artifact behavior (AC-P7). |
| CLI test file under `lib/internal/packages/@pancreator/cli/src` | create/modify | Cover countdown round-trip exactness for 10 representative ids and the missing-ignore-file doctor path (AC-P6a, AC-P8). |

## 6 — Out of scope

- Track D pieces P1 through P4, P9, and P10.
- Blocking content validation on malformed artifacts.
- Renaming any on-disk work or inbox paths.
- Changing MCP handlers, dashboard surfaces, or active-memory content outside
  the already-shipped P3 cap rule.
- Hand-editing live `state.json` files to recover from a failed rebuild.

## 7 — Dependencies and sequencing

- This pass depends on P3 for the shipped-ledger cap rule reused by
  `pan doctor`.
- This pass depends on the internal P7 validator work because P8 consumes the
  same read-only validator surface.
- The pass SHALL run after every Track D run through P4 reaches archival close
  and `.pan/work/` is clear, and SHALL land before P9/P10 consume the surfaced
  `nextCommand` and decoded timestamp shape.

## 8 — Open questions

_None. This spec resolves the two engine edge cases the directive leaves
implicit: persisted `nextCommand` for runtime-generated report-approval
artifacts, and the existing implement-after-`must_fix` review reentry fast
path._

## 9 — Revision history

| Date | Author | Change |
|------|--------|--------|
| 2026-06-01 | tech-lead | Initial engineering spec for directive `75420_0303_surface-opt-track-o-cli-engine.md`. |
