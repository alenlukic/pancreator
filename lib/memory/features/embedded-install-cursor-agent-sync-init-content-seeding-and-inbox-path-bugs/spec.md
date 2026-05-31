---
id: embedded-install-cursor-agent-sync-init-content-seeding-and-inbox-path-bugs
title: "Embedded install — cursor agent sync, init content seeding, and inbox path bugs"
status: draft
stage: intake
owner: intake-analyst
created_at: "2026-05-30T23:23:00.000Z"
source_directive: lib/inbox/in/172976_05-30-26/2171_2323_embedded-install-cursor-agent-sync-and-init-gaps.md
references:
  - kind: lines
    path: lib/internal/packages/@pancreator/cli/src/pan-init.ts
    lines: "200-215"
    note: "buildScaffoldPlan — embedded branch writes harness_root_allow entries as empty .gitkeep stubs only; no cursor-sync call."
  - kind: lines
    path: lib/internal/packages/@pancreator/cli/src/pan-init.ts
    lines: "109-123"
    note: "embeddedScaffoldEntries — manifest.allow dirs receive empty .gitkeep; lib/personas and lib/memory/handbook are not seeded."
  - kind: lines
    path: lib/internal/packages/@pancreator/cli/src/run.ts
    lines: "507-508"
    note: "pan intake new computes targetAbs against repoRoot, not project_root; inbox lands under $HARNESS/lib/inbox/in/ in embedded mode."
  - kind: symbol
    path: lib/internal/tools/sync-cursor-agents.mjs
    note: "Bootstrap bridge: syncCursorAgents reads pancreator.yaml project_root, iterates lib/personas/*.md, emits .cursor/agents/*.md at harness root."
  - kind: symbol
    path: lib/memory/handbook/embedded-install-manifest.yaml
    note: "harness_root_allow lists .cursor/agents/ — init writes only .gitkeep; no content generated."
---

# Engineering Spec — Embedded install: cursor agent sync, init content seeding, and inbox path bugs

## 1 — Context and motivation

US-9 embedded-adopt validation on **xeremia-sandbox** completed with `verdict: pass` but
relied on 4 interim workarounds that are not part of the `pan init --apply` product path:

1. Manual execution of `lib/internal/tools/sync-cursor-agents.mjs` to populate `.cursor/agents/`.
2. Manual `rsync` of `lib/personas/` and `lib/memory/handbook/` from the harness repository.
3. Hand-authored inbox paths under `.pancreator/lib/inbox/in/` because `pan intake new` writes
   to the wrong root in embedded mode.
4. Manual addition of `runner.cursor.invocation: sdk` to the embedded `pancreator.yaml`.

Evidence for all 4 workarounds is recorded in the greenfield checklist at
`lib/memory/features/bootstrap-phase-5-m1-exit-close-docs-bootstrap/xeremia-greenfield-evidence.json`
and the evaluator output at
`lib/memory/features/bootstrap-phase-5-m1-exit-close-docs-bootstrap/xeremia-greenfield-evidence-evaluator.json`.

This feature removes all 4 workarounds so a fresh `pan init --apply` on an existing repo
satisfies the greenfield evidence checklist and enables SDK-mode feature-delivery without any
operator copy-paste step.

## 2 — Problem statements

### P1 — `pan init --apply` does not emit `.cursor/agents/` projections

`buildScaffoldPlan` in `pan-init.ts` iterates `harness_root_allow` and writes a `.gitkeep`
stub for every directory entry, including `.cursor/agents/`. No cursor-sync call follows.
The Cursor harness opened at an embedded target discovers no subagents.
Every `/persona` invocation fails until the operator runs `sync-cursor-agents.mjs` out of band.

### P2 — `pan init` does not seed persona or handbook content

`embeddedScaffoldEntries` converts `manifest.allow` paths into empty `.gitkeep` stubs.
`lib/personas/` and `lib/memory/handbook/` receive stubs with no content.
Greenfield evidence fields `persona_roster_present` and `handbook_seeds_present` cannot pass
without an out-of-band `rsync` from the harness repository.

### P3 — `pan intake new` ignores `project_root` in embedded mode

The `intake new` action in `run.ts` (line 507–508) computes `targetAbs` using `repoRoot`
(the harness root directory) in all modes. In embedded mode with `project_root: ".pancreator"`,
the correct base is `$HARNESS/.pancreator/`. The command writes to `$HARNESS/lib/inbox/in/`
instead of `$HARNESS/.pancreator/lib/inbox/in/`. Feature-delivery inbox resolution performs
the same error; operators must hand-author every inbox path.

### P4 — No first-class `pan cursor-sync` verb

`lib/internal/tools/sync-cursor-agents.mjs` implements correct projection generation and is
aware of `project_root`, but it is not a CLI subcommand, not documented in `OPERATION.md`,
and not invoked by `pan init`. PRD Q17 describes auto-emit from `lib/personas`; that wiring
never landed.

### P5 — Default embedded `pancreator.yaml` omits SDK invocation mode

`EMBEDDED_PANCREATOR_YAML` in `pan-init.ts` (line 81–83) contains only `project_root` and
`risk_tier`. It does not include `runner.cursor.invocation: sdk`. Operators following
`pc-install.md` Phase 2 encounter manual-delegation instructions that depend on P1 being
fixed first; fixing P1 without also setting SDK mode does not resolve the UX gap.

## 3 — Scope

### In scope

- `pan cursor-sync [--dry-run] [harnessRoot]` CLI subcommand (R1).
- Post-step in `pan init --apply` that invokes cursor-sync when `harness_root_allow` contains
  `.cursor/agents/` and at least 1 persona spec exists under the project root (R2).
- Persona and handbook seed policy: copy-from-package on embedded init when stubs are empty (R3).
- `pan intake new` and feature-delivery inbox resolution rooted at `project_root` in embedded
  mode (R4).
- `EMBEDDED_PANCREATOR_YAML` updated to include `runner.cursor.invocation: sdk` (R5 partial).
- `OPERATION.md` and embedded-install spec updated to document SDK mode as the preferred
  embedded path and `cursor-sync` as the manual-delegation prerequisite (R5).
- Unit tests covering cursor-sync for `project_root: "."` and `project_root: ".pancreator"`.
- Acceptance-test scenario verifying that a temp-clone embedded init produces a non-empty
  `.cursor/agents/intake-analyst.md` without manual steps.

### Out of scope

- Git-tracking policy for `.cursor/` in daedaline.
- Auto-emitting `.cursor/rules/*.mdc` shims.
- Phoenix trace or token-usage capture changes.
- Production changes to xeremia application `src/` or `client/`.
- Full init-greenfield pipeline runtime (remains deferred exit 125).

## 4 — Requirements

### R1 — CLI `pan cursor-sync`

**R1.1** The CLI SHALL expose the subcommand `pan cursor-sync [--dry-run] [harnessRoot]`.

**R1.2** When `--dry-run` is absent, `cursor-sync` SHALL write one `.cursor/agents/<name>.md`
file per persona spec found under `<project_root>/lib/personas/*.md`, using the
`buildAgentProjection` logic already proven in `sync-cursor-agents.mjs`.

**R1.3** `cursor-sync` SHALL also write `.cursor/agents/general-purpose.md` using
`buildGeneralPurposeProjection`.

**R1.4** `cursor-sync` SHALL remove `.cursor/agents/.gitkeep` when it exists after writing
agent projections.

**R1.5** When `--dry-run` is present, `cursor-sync` SHALL print a JSON envelope with
`command: "cursor-sync"`, `dryRun: true`, and a `written` array of objects each carrying
`path` and `action: "would_write" | "would_remove"`, then exit 0 without writing any file.

**R1.6** When `harness_root_allow` in the embedded manifest does not include `.cursor/agents/`,
`cursor-sync` SHALL exit 1 with a human-readable error message and SHALL NOT write any file.

**R1.7** When fewer than 1 persona spec is found under `<project_root>/lib/personas/`,
`cursor-sync` SHALL exit 1 with the message `"No persona specs found under <personasDir>"` and
SHALL NOT write any agent file.

**R1.8** Implementation SHALL promote the logic of `lib/internal/tools/sync-cursor-agents.mjs`
into `@pancreator/cli`, keeping the bridge script as a thin ES-module re-export until the
next archive pass.

### R2 — `pan init --apply` post-step emits cursor agents

**R2.1** After `runPanInit` completes scaffold writes in embedded mode with `apply: true`,
the function SHALL invoke the cursor-sync logic when both conditions hold:
  - `manifest.harness_root_allow` includes `".cursor/agents/"`, AND
  - at least 1 `.md` file exists under `<project_root>/lib/personas/`.

**R2.2** When condition (b) of R2.1 is false (no persona specs present yet), `runPanInit`
SHALL skip the cursor-sync step and SHALL record `cursorSync: "skipped-no-personas"` in the
result envelope.

**R2.3** When cursor-sync runs and succeeds, `runPanInit` SHALL record
`cursorSync: { count: <N>, written: [...] }` in the result envelope.

**R2.4** `dryRun: true` in the init call SHALL propagate as `dryRun: true` to the embedded
cursor-sync step; no files SHALL be written in dry-run mode.

### R3 — Persona and handbook seed policy

**R3.1** The implementation SHALL adopt the **copy-from-package** policy: when `pan init
--apply` runs in embedded mode and finds that `<project_root>/lib/personas/` contains only
`.gitkeep` (i.e., 0 persona `.md` files), init SHALL copy the MVP persona roster from the
running `@pancreator/cli` package into `<project_root>/lib/personas/`.

**R3.2** The same copy-from-package step SHALL apply to `<project_root>/lib/memory/handbook/`
when that directory contains only `.gitkeep`.

**R3.3** After seeding, `pan init --apply` SHALL invoke cursor-sync per R2.1 because persona
specs are now present.

**R3.4** The result envelope SHALL record `personaSeed: { count: <N>, source: "package" }` and
`handbookSeed: { count: <N>, source: "package" }` when seeding occurred.

**R3.5** Greenfield evidence fields `persona_roster_present` and `handbook_seeds_present` SHALL
evaluate to `true` after a fresh `pan init --apply` without any out-of-band operator step.

**R3.6** The implementation SHALL NOT copy files whose relative paths match any entry in
`manifest.deny_prefixes`.

### R4 — Inbox path respects `project_root`

**R4.1** `pan intake new` SHALL resolve inbox paths under `<project_root>/lib/inbox/in/` in
all modes. When `project_root` is `"."`, the resolved base equals the harness root. When
`project_root` is `".pancreator"`, the resolved base is `<harnessRoot>/.pancreator/`.

**R4.2** The `targetRel` value included in the JSON output envelope SHALL be relative to
`project_root`, not to `harnessRoot`, so that agents and ledger entries can resolve it using
the documented project-root-relative convention.

**R4.3** Feature-delivery inbox resolution (`feature-delivery-run.ts` and any callers) SHALL
apply the same `project_root`-aware base when locating inbox directive paths passed on the
CLI.

**R4.4** `pancreator.yaml` lookup for `project_root` in the `intake new` action SHALL use the
same `readProjectRoot` / `projectRootAbs` utilities already defined in `@pancreator/core` and
`sync-cursor-agents.mjs`, not an ad-hoc regex.

### R5 — Documentation and `pancreator.yaml` template

**R5.1** `EMBEDDED_PANCREATOR_YAML` in `pan-init.ts` SHALL include the following stanza so
that a freshly initialized embedded target starts in SDK mode:

```yaml
runner:
  cursor:
    invocation: sdk
```

**R5.2** `OPERATION.md` SHALL add a section titled "Embedded install checklist" that lists, in
order: (1) run `pan init --apply`, (2) verify `.cursor/agents/` is populated, (3) open the
harness root in Cursor, (4) run `pan run feature-delivery <directive>` in SDK mode.

**R5.3** `OPERATION.md` SHALL document `pan cursor-sync [--dry-run] [harnessRoot]` under a
"Manual agent sync" subsection with a copy-paste command block.

**R5.4** The embedded-install spec at
`lib/memory/features/embedded-harness-install-project-root-pancreator-and-fresh-install-manifest/`
SHALL be updated to reference this feature as the follow-on that closes R1–R5.

## 5 — Acceptance criteria

| ID | Criterion | Verification |
|----|-----------|--------------|
| AC1 | Fresh `pan init --apply` on a temp clone of an empty repo in embedded mode produces a non-empty `.cursor/agents/intake-analyst.md`. | `node --test` integration scenario. |
| AC2 | `/intake-analyst` is discoverable in Cursor opened at the harness root without any manual `rsync` or `sync-cursor-agents.mjs` invocation. | Manual smoke-test on xeremia-sandbox after reset. |
| AC3 | `pan intake new <slug>` on an embedded harness writes the directive under `.pancreator/lib/inbox/in/<day>/`. | Unit test asserting `targetRel` starts with `lib/inbox/in/` resolved under `.pancreator/`. |
| AC4 | Unit tests cover `cursor-sync` output for `project_root: "."` and `project_root: ".pancreator"`, verifying projection retrieval paths. | `node --test tests/*.test.mjs` exits 0. |
| AC5 | Greenfield evidence fields `persona_roster_present` and `handbook_seeds_present` evaluate to `true` on a fresh embedded init without out-of-band operator steps. | Evidence JSON assertion in integration test. |
| AC6 | `pan cursor-sync --dry-run` exits 0 and prints a JSON envelope with `dryRun: true` and a non-empty `written` array; no files are written. | Unit test asserting filesystem is unchanged. |
| AC7 | `pan cursor-sync` with 0 persona specs exits 1 with message `"No persona specs found under …"`. | Unit test for error path. |
| AC8 | xeremia-sandbox US-9 feature-delivery restarts cleanly in SDK mode after reset without manual workarounds. | Manual verification by operator; recorded in xeremia `pc-install.md` Phase 2 notes. |

## 6 — Touch set (projected)

| Path | Change type | Rationale |
|------|-------------|-----------|
| `lib/internal/packages/@pancreator/cli/src/pan-init.ts` | modify | Add cursor-sync post-step (R2), persona/handbook seed (R3), SDK default in embedded template (R5.1). |
| `lib/internal/packages/@pancreator/cli/src/run.ts` | modify | Wire `pan cursor-sync` subcommand (R1); fix `intake new` project_root resolution (R4). |
| `lib/internal/tools/sync-cursor-agents.mjs` | modify | Convert to thin re-export of promoted `@pancreator/cli` logic (R1.8). |
| `lib/internal/packages/@pancreator/cli/src/cursor-sync.ts` | create | Promoted cursor-sync module with TypeScript types and `runCursorSync` function (R1). |
| `lib/internal/packages/@pancreator/cli/src/cursor-sync.test.ts` | create | Unit tests for R1 and R2 (AC4, AC6, AC7). |
| `lib/internal/packages/@pancreator/cli/src/pan-init.test.ts` | create/modify | Integration scenario for R2, R3, R5.1 (AC1, AC5). |
| `OPERATION.md` | modify | Embedded install checklist, cursor-sync docs, SDK mode preference (R5.2, R5.3). |
| `lib/memory/features/embedded-harness-install-project-root-pancreator-and-fresh-install-manifest/index.json` | modify | Add follow-on reference (R5.4). |

## 7 — Non-goals (restated)

- Git-tracking policy for `.cursor/` in daedaline.
- Auto-emitting `.cursor/rules/*.mdc` rule shims.
- Phoenix trace or token-usage capture changes.
- Production changes to xeremia application `src/` or `client/`.
- Full init-greenfield pipeline runtime (remains deferred exit 125).

## 8 — Open questions

_None at time of intake. All five problem statements are fully evidenced by the xeremia US-9
run record. Persona and handbook seed policy is resolved: copy-from-package (R3.1)._

## 9 — Revision history

| Date | Author | Change |
|------|--------|--------|
| 2026-05-30 | intake-analyst | Initial canonical spec from directive `2171_2323_embedded-install-cursor-agent-sync-and-init-gaps.md`. |
