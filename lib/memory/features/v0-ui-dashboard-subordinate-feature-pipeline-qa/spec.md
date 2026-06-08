---
title: v0 UI dashboard — subordinate feature-pipeline QA exercise
feature_id: v0-ui-dashboard-subordinate-feature-pipeline-qa
status: intake-awaiting-ratification
next_owner: tech-lead
next_stage: plan
source_inbox_item: lib/inbox/in/172977_05-29-26/70345_0427_v0-ui-dashboard-subordinate-feature-pipeline-qa.md
intake_round: 0
parent_feature: feature-delivery-harness-wire-cursorrunner-through-run-and-advance
parent_relationship: subordinate-qa-exercise
subordinate_qa_context: true
expected_generated_artifacts:
  - .pan/work/172977_05-29-26/<task-id>/state.json
  - .pan/work/172977_05-29-26/<task-id>/handoff.md
  - .pan/work/172977_05-29-26/<task-id>/next-prompt.md
  - .pan/work/172977_05-29-26/<task-id>/run.log.jsonl
  - .pan/work/172977_05-29-26/<task-id>/plan.md
  - .pan/work/172977_05-29-26/<task-id>/adr-draft.md
  - .pan/work/172977_05-29-26/<task-id>/touch-set.json
  - .pan/work/172977_05-29-26/<task-id>/implementation-report.md
  - .pan/work/172977_05-29-26/<task-id>/review.md
  - .pan/work/172977_05-29-26/<task-id>/test-report.md
  - lib/memory/features/v0-ui-dashboard-subordinate-feature-pipeline-qa/delivery-report.md
  - .pan/scheduler/interventions/<task-id>.jsonl
  - client/**
references:
  - kind: lines
    path: lib/inbox/in/172977_05-29-26/70345_0427_v0-ui-dashboard-subordinate-feature-pipeline-qa.md
    range: [13, 25]
    contentHash: 199faf3
    note: "Directive problem and goal — parent harness needs QA evidence that the automated feature-delivery runner executes a realistic subordinate directive without false worktree-hygiene flags."
  - kind: lines
    path: lib/inbox/in/172977_05-29-26/70345_0427_v0-ui-dashboard-subordinate-feature-pipeline-qa.md
    range: [26, 46]
    contentHash: 199faf3
    note: "Directive required outcomes — subordinate run creation, subordinate QA context marker, top-level client/ Next.js dashboard, palette, one-command startup, and core tests."
  - kind: lines
    path: lib/inbox/in/172977_05-29-26/70345_0427_v0-ui-dashboard-subordinate-feature-pipeline-qa.md
    range: [47, 55]
    contentHash: 199faf3
    note: "Directive acceptance criteria — valid subordinate run start, hygiene-clean stage transitions, dashboard outcomes satisfied, QA pass/fail/deferred reporting, and parent-stage evidence sufficiency."
  - kind: lines
    path: lib/inbox/in/172977_05-29-26/70345_0427_v0-ui-dashboard-subordinate-feature-pipeline-qa.md
    range: [57, 62]
    contentHash: 199faf3
    note: "Directive out-of-scope — production deployment, non-v0 polish, unrelated work, and manual gate bypasses."
  - kind: lines
    path: lib/memory/features/feature-delivery-harness-wire-cursorrunner-through-run-and-advance/spec.md
    range: [97, 99]
    contentHash: cf3aad8
    note: "Parent feature spec § Spec — the harness work this subordinate run exercises end-to-end."
  - kind: lines
    path: lib/pipelines/feature-delivery.yaml
    range: [25, 66]
    contentHash: 3c558e1
    note: "Canonical feature-delivery stage order and persona ownership consumed by the subordinate run."
  - kind: lines
    path: .docs/PRD.md
    range: [637, 689]
    contentHash: 2eb6aa4
    note: "PRD §7 feature-delivery stage YAML — intake gate, loop cap, plan/implement/review/test/report/ship inputs and outputs."
  - kind: lines
    path: OPERATION.md
    range: [26, 101]
    contentHash: a91d661
    note: "Operator feature-delivery loop and post-invocation state machine that the subordinate run follows."
  - kind: lines
    path: lib/memory/handbook/inbox-lifecycle.md
    range: [67, 156]
    contentHash: 2762053
    note: "Canonical inbox queue, response, and archive paths; system-produced outbox artifact rules consumed by subordinate-run reports."
  - kind: lines
    path: lib/memory/features/timestamp-naming-conventions/spec.md
    range: [69, 95]
    contentHash: 2355044
    note: "Outbox and work-task basename shape — {SID-prefix}_{HHMM}_{semantic-suffix} — that all subordinate-run system artifacts MUST conform to."
  - kind: lines
    path: lib/personas/qa-tester.md
    range: [89, 180]
    contentHash: d07db56
    note: "qa-tester verification contract and severity-based re-entry routing consumed by the test stage of this subordinate run."
  - kind: lines
    path: pancreator.yaml
    range: [1, 40]
    contentHash: a7092be
    note: "Live policy file — Phase 5, risk_tier medium, manual runner.cursor.invocation default that frames the subordinate run's automation mode."
---

# Spec

This subordinate Feature SHALL exercise the parent harness `feature-delivery-harness-wire-cursorrunner-through-run-and-advance` end-to-end by running one full `feature-delivery` pipeline against a realistic v0 dashboard directive while the operating agent stands in for human ratification at every gate. The acting agent SHALL deliver a v0 full-stack Next.js dashboard under a new top-level `client/` directory whose navigation surfaces inbox, memory, personas, work, and adjacent repo components, supports inline modal file inspection and editing, and renders a reverse-chronological repo-activity feed. The Feature explicitly marks itself as subordinate QA exercise context so downstream review, test, and hygiene tooling do not flag expected pipeline-generated artifacts as touch-set leaks.

## Background

The parent harness wires `CursorRunner` through `pnpm -w exec pan run feature-delivery` and `pnpm -w exec pan advance` and adds an automatic loopback regime, retry budget, and report-stage human gate. Acceptance for the parent requires QA evidence that the wired runtime can drive a realistic subordinate directive through `intake → plan → implement → review → test → report → ship → index → complete` without false-positive worktree-hygiene failures on expected generated paths. This subordinate Feature supplies that evidence by executing one bounded directive end-to-end against the harness under manual `runner.cursor.invocation` mode, since the parent harness is still in progress and SDK mode SHALL NOT be assumed.

## Scope orientation

The directive sets the subordinate v0 dashboard requirements. This spec preserves every existing pipeline, persona, and hygiene authority unchanged and adds one explicit subordinate-context marker.

| Concern | Authoritative source | Spec posture |
|---|---|---|
| Stage inventory and persona ownership | `lib/pipelines/feature-delivery.yaml` lines 25–66 | Reference only; no edits in this Feature. |
| Operator feature-delivery loop and state machine | `OPERATION.md` lines 26–101 | Reference only; manual mode remains the default. |
| Inbox path layout and outbox naming | `lib/memory/handbook/inbox-lifecycle.md` lines 67–156 and `lib/memory/features/timestamp-naming-conventions/spec.md` lines 69–95 | Reference only; subordinate-run artifacts MUST conform. |
| Test-stage severity routing | `lib/personas/qa-tester.md` lines 89–180 | Reference only; consumed by the subordinate test stage. |
| Parent harness contract | `lib/memory/features/feature-delivery-harness-wire-cursorrunner-through-run-and-advance/spec.md` lines 97–99 | Reference only; this Feature is its QA evidence source. |

## Acceptance criteria

The acceptance criteria split into six work packages. Plan-stage delegation MAY ratify alternative work-package partitioning, but every clause below SHALL be satisfied before the implementation report is accepted.

### WP-1 — Subordinate run lifecycle

- When the operator invokes `pnpm -w exec pan run feature-delivery 172977_05-29-26/70345_0427_v0-ui-dashboard-subordinate-feature-pipeline-qa.md` from the repository root, the CLI SHALL emit a JSON envelope carrying `taskId`, `featureId: v0-ui-dashboard-subordinate-feature-pipeline-qa`, `runDir`, `handoffFile`, `nextPromptFile`, and `currentStage: intake`.
- When the run starts, the runtime SHALL create `.pan/work/<day-bucket>/<task-id>/state.json`, `handoff.md`, `next-prompt.md`, and `run.log.jsonl` whose paths follow the seconds-remaining-prefix shape `{SID-prefix}_{HHMM}_{semantic-suffix}` per `lib/memory/features/timestamp-naming-conventions/spec.md` lines 71–76.
- When each non-terminal stage completes, the operator SHALL run the matching `pnpm -w exec pan advance <task-id> --artifact <stage-artifact>` command per `OPERATION.md` lines 69–80; the operating agent SHALL stand in for the human ratification step and SHALL document each ratification decision in the corresponding stage artifact.
- When the run reaches `complete`, the runtime SHALL emit a librarian `next-prompt.md` and the operator SHALL run exactly one `pnpm -w exec pan close-artifacts <task-id>` invocation per `OPERATION.md` lines 72–73.

### WP-2 — Subordinate QA context marker

- The spec front matter SHALL carry `subordinate_qa_context: true`, `parent_feature: feature-delivery-harness-wire-cursorrunner-through-run-and-advance`, and `expected_generated_artifacts` enumerating every pipeline-emitted path the subordinate run is permitted to create.
- When the reviewer or qa-tester evaluates worktree hygiene for this run, the persona SHALL treat any path matching an entry in `expected_generated_artifacts` (with `<task-id>` resolved against `state.json`) as in-scope and SHALL NOT raise a worktree-hygiene block on those paths.
- When a new generated path appears that is not enumerated, the reviewer SHALL either add the path to `expected_generated_artifacts` with a citation to the producing stage or open a must-fix finding; the persona SHALL NOT silently accept undocumented generated paths.

### WP-3 — v0 dashboard application

- When the plan stage produces the touch-set, the touch-set SHALL declare a new top-level `client/` directory plus required workspace-manifest entries (`pnpm-workspace.yaml`, root `package.json`, and `pnpm-lock.yaml`); the touch-set SHALL also enumerate the subordinate-run work-directory paths from `expected_generated_artifacts`.
- When the implement stage completes, `client/` SHALL contain a Next.js App Router project on a current LTS-compatible Node toolchain, a modern React major (≥ 18), TypeScript, and one modern component library declared as a dependency in `client/package.json`.
- When the operator runs the documented single startup command from `client/README.md`, the dashboard SHALL launch with hot reload enabled and SHALL be reachable on a local URL printed to stdout.
- When the operator opens the dashboard, the UI SHALL render navigation for at least the following repo domains: `lib/inbox/`, `lib/memory/`, `lib/personas/`, `.pan/work/`, and `lib/internal/packages/`; the navigation surface SHALL visually convey the relationships between these domains.
- When the operator selects a file inside a navigated domain, the UI SHALL open a collapsible inline modal panel that displays the file's text content and SHALL provide an explicit edit affordance.
- When the operator submits an edit, the UI SHALL persist the change through the WP-4 file-write endpoint and SHALL reflect the saved state without a full page reload.
- When the dashboard renders the activity feed, the feed SHALL list repo events in reverse-chronological order with a human-readable timestamp, an event title, and a short event description per entry.
- When the UI renders any chrome, content, or interactive surface, the styling SHALL apply the directive palette tokens `#05031B` (Ink Black), `#BBD8B3` (Celadon), `#A22C29` (Brown Red), and `#FFB400` (Amber Flame); the four tokens SHALL be defined once and referenced by token name throughout the codebase.

### WP-4 — Repository API endpoints

- The `client/` app SHALL expose `GET /api/activity` which returns a JSON array of repo events in reverse-chronological order, each event carrying at minimum `timestamp`, `title`, and `description` fields.
- The `client/` app SHALL expose `GET /api/file?path=<repo-relative-path>` which returns the UTF-8 text content of the requested file when the path resolves inside the repository root.
- The `client/` app SHALL expose `POST /api/file` accepting a JSON body of shape `{ "path": <repo-relative-path>, "content": <utf-8 string> }` which persists the new content when the path resolves inside the repository root.
- If a request to `GET /api/file` or `POST /api/file` targets a path that traverses above the repository root, escapes the repository working tree via symlink, or matches `lib/inbox/notes/**`, the server SHALL respond with HTTP 403 and SHALL NOT read or write the target.
- When any `/api/file` write succeeds, the server SHALL emit one structured log line carrying `path`, `bytes_written`, and the request timestamp to permit subsequent activity-feed correlation.

### WP-5 — Tests and operator validation

- When `pnpm --filter client test` runs, the suite SHALL include at least one passing unit or integration test per WP-4 endpoint covering reverse-chronological ordering for `/api/activity`, success-path read for `/api/file`, success-path write for `/api/file`, and at least one denial case for path traversal.
- When `pnpm --filter client test` runs, the suite SHALL include at least one UI test that asserts navigation renders the five WP-3 domains, that the collapsible inline modal opens with file content, and that the activity feed renders entries in reverse-chronological order.
- When `pnpm --filter client lint` runs, the suite SHALL exit with status code `0`.
- When `pnpm --filter client build` runs, the production build SHALL exit with status code `0`.
- When `node --test tests/*.test.mjs` runs, the repository-level suite SHALL remain green.
- When `node lib/internal/tools/check-phase-0a-scaffold.mjs` runs, the scaffold conformance suite SHALL remain green.
- When `node lib/internal/tools/context-budget-report.mjs` runs, the context-budget report SHALL remain green.

### WP-6 — Subordinate evidence for parent harness QA

- When the report stage completes, the delivery report at `lib/memory/features/v0-ui-dashboard-subordinate-feature-pipeline-qa/delivery-report.md` SHALL explicitly state pass / fail / deferred outcomes for each work package WP-1 through WP-5, name any blockers encountered, and cite the producing stage artifact for every outcome.
- When the qa-tester emits `.pan/work/<day-bucket>/<task-id>/test-report.md`, the report SHALL record the suite invocations and exit codes from WP-5 verbatim and SHALL classify any failure per the severity rules at `lib/personas/qa-tester.md` lines 89–180.
- When the run completes, the librarian SHALL index the subordinate run under the existing feature folder and SHALL link the delivery report from the feature `index.json`; the indexed artifacts SHALL be sufficient evidence for the parent harness QA stage decision per the directive at `lib/inbox/in/172977_05-29-26/70345_0427_v0-ui-dashboard-subordinate-feature-pipeline-qa.md` lines 47–55.

## Out of scope

- Production deployment, container packaging, and non-v0 UI polish beyond the directive at `lib/inbox/in/172977_05-29-26/70345_0427_v0-ui-dashboard-subordinate-feature-pipeline-qa.md` lines 57–61.
- Authentication, authorization, multi-tenant isolation, and secret management for the `client/` app; the app SHALL run as an operator-local tool only per the directive lines 22–24.
- Any change to the parent harness implementation, the `feature-delivery` pipeline YAML, persona specs, or runtime automation rules; this subordinate run consumes the harness behavior unchanged per the directive lines 57–61.
- Manual gate bypass, auto-push, auto-commit, or any operator-gate skip that would invalidate the harness evidence per the directive lines 60–61.
- SDK-mode automatic loopback evaluation; the subordinate run SHALL execute under the manual `runner.cursor.invocation` default declared in `pancreator.yaml` lines 1–40 until the parent harness ships SDK mode.
- Edits to any file under `lib/inbox/notes/` per AGENTS.md operator-sandbox rule and per `lib/memory/handbook/inbox-lifecycle.md` lines 79–101.

## Open questions

_(none — the directive at `lib/inbox/in/172977_05-29-26/70345_0427_v0-ui-dashboard-subordinate-feature-pipeline-qa.md` lines 26–61 fully specifies scope, acceptance, constraints, and prior-art for plan-stage delegation; component-library choice, Next.js runtime version, and reverse-chron event-source selection are reserved for tech-lead plan-stage ratification per WP-3 and WP-4.)_

## Documentation impact

```yaml
documentation_impact:
  applies: true
  rationale: >-
    The subordinate Feature introduces a new top-level `client/` application surface,
    documented one-command startup, and operator-facing test commands. It also
    establishes the subordinate-QA-context marker convention that downstream review
    and qa-tester runs consume when validating hygiene against expected generated
    artifacts.
  changed-surfaces:
    - client/README.md
    - pnpm-workspace.yaml
    - package.json
    - lib/memory/features/v0-ui-dashboard-subordinate-feature-pipeline-qa/delivery-report.md
  deferred-items: []
```

The plan-stage executor SHALL refine `changed-surfaces` against the realised touch-set and SHALL add backlog entries under `deferred-items` for any documentation surface the implementation cannot update inside the same task boundary.

## Suggested downstream owners

The following persona assignments are RECOMMENDED for the plan stage. The tech-lead MAY adjust them based on the realised touch-set.

| Concern | Recommended owner |
|---|---|
| Plan, ADR draft, touch-set, and handoff card | `tech-lead` |
| `client/` Next.js scaffold, API routes, and workspace wiring | `coder` |
| Component library selection, palette tokenization, and UX layout | `coder` (primary) and `tech-lead` (review) |
| Touch-set, disallowed-tool, and subordinate-QA-context review | `reviewer` |
| Automated and manual QA, severity routing, and evidence for parent harness | `qa-tester` |
| Delivery report and operator-facing documentation | `tech-writer` |
| Ship staging and human ratification | `supervisor` |
| Index, artifact closure, and active-memory hygiene | `librarian` |

## Traceability

- Parent Feature: `lib/memory/features/feature-delivery-harness-wire-cursorrunner-through-run-and-advance/spec.md` (this run produces its WP-7 QA evidence).
- Source directive: `lib/inbox/in/172977_05-29-26/70345_0427_v0-ui-dashboard-subordinate-feature-pipeline-qa.md`.
- Completed task: `68034_0506_v0-ui-dashboard-subordinate-feature-pipeline-qa` archived at `.pan/archive/work/172977_05-29-26/68034_0506_v0-ui-dashboard-subordinate-feature-pipeline-qa/`.
- Prior sibling tasks (`70319_0428_v0-ui-dashboard-subordinate-feature-pipeline-qa`, `69601_0439_v0-ui-dashboard-subordinate-feature-pipeline-qa`, `69218_0446_v0-ui-dashboard-subordinate-feature-pipeline-qa`) were superseded and removed from active work during librarian cleanup.

## Next operator steps

1. **What:** Read the canonical Engineering Spec and decide whether the intake artifact is acceptable for plan-stage delegation.
   **How:** Read-only: open `lib/memory/features/v0-ui-dashboard-subordinate-feature-pipeline-qa/spec.md` and confirm the six work-package acceptance blocks, the subordinate-QA-context front matter (`subordinate_qa_context`, `parent_feature`, `expected_generated_artifacts`), and the empty `## Open questions` section reflect the directive at `lib/inbox/in/172977_05-29-26/70345_0427_v0-ui-dashboard-subordinate-feature-pipeline-qa.md`.
2. **What:** Advance the feature-delivery run from `intake` to `plan` once the spec is accepted.
   **How:** From the repository root run:

   ```bash
   pnpm -w exec pan advance 68034_0506_v0-ui-dashboard-subordinate-feature-pipeline-qa \
     --artifact lib/memory/features/v0-ui-dashboard-subordinate-feature-pipeline-qa/spec.md
   ```

   Then confirm `.pan/work/172977_05-29-26/68034_0506_v0-ui-dashboard-subordinate-feature-pipeline-qa/state.json` shows `currentStage: plan` before delegating `tech-lead`.
