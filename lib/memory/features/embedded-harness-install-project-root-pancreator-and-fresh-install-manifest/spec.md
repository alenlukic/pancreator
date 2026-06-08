---
title: "Embedded harness install — project_root .pancreator and fresh-install manifest"
feature_id: embedded-harness-install-project-root-pancreator-and-fresh-install-manifest
status: intake-awaiting-ratification
next_owner: tech-lead
next_stage: plan
source_inbox_item: lib/inbox/in/172976_05-30-26/13329_2017_embedded-harness-project-root-install.md
intake_round: 0
work_packages:
  - id: WP1
    label: "WP1 — Project-root resolution primitive"
    requirement: R1
    primary_stages: [tech-lead, coder, reviewer]
  - id: WP2
    label: "WP2 — CLI and runtime path prefixing"
    requirement: R2
    primary_stages: [coder, reviewer, qa-tester]
  - id: WP3
    label: "WP3 — Embedded adopt scaffold (pan init)"
    requirement: R3
    primary_stages: [coder, reviewer]
  - id: WP4
    label: "WP4 — Fresh embedded harness manifest (allow/deny)"
    requirement: R4
    primary_stages: [tech-lead, coder, reviewer]
  - id: WP5
    label: "WP5 — Greenfield create-pancreator self-hosting invariant"
    requirement: R5
    primary_stages: [coder, reviewer]
  - id: WP6
    label: "WP6 — US-9 kit and adoption documentation"
    requirement: R6
    primary_stages: [tech-writer, reviewer, librarian]
  - id: WP7
    label: "WP7 — Tests and validation evidence"
    requirement: R7
    primary_stages: [qa-tester]
ratification_gates:
  - after: WP1
    gate: human_approval
    note: "Operator reads plan manifest and confirms resolver API shape before WP2–WP3 begin."
  - after: WP4
    gate: human_approval
    note: "Operator reads allow/deny manifest before WP3 scaffold implementation starts."
  - after: WP3
    gate: human_approval
    note: "Operator runs pan init --dry-run against a temp clone with AGENTS.md; confirms .pancreator/ only."
  - after: WP6
    gate: human_approval
    note: "Operator runs evaluator against updated fixture; confirms verdict pass."
  - after: WP7
    gate: human_approval
    note: "Operator ratifies spec/plan before SDK implement stage if scope includes unexpected self-dev paths."
references:
  - kind: lines
    path: lib/inbox/in/172976_05-30-26/13329_2017_embedded-harness-project-root-install.md
    range: [1, 60]
    contentHash: 199bac0
    note: "Directive frontmatter, problem statement, goal, and definitions that this spec canonicalizes."
  - kind: lines
    path: lib/inbox/in/172976_05-30-26/13329_2017_embedded-harness-project-root-install.md
    range: [107, 145]
    contentHash: 199bac0
    note: "R1 (resolver API), R2 (CLI touch-set), and R3 (pan init embedded scaffold) requirements."
  - kind: lines
    path: lib/inbox/in/172976_05-30-26/13329_2017_embedded-harness-project-root-install.md
    range: [146, 246]
    contentHash: 199bac0
    note: "R4 (manifest allow/deny), R5 (create-pancreator), R6 (US-9 kit), R7 (tests) requirements."
  - kind: lines
    path: lib/inbox/in/172976_05-30-26/13329_2017_embedded-harness-project-root-install.md
    range: [247, 309]
    contentHash: 199bac0
    note: "Acceptance criteria, manual validation steps, follow-on items, and out-of-scope boundaries."
  - kind: lines
    path: lib/internal/packages/@pancreator/cli/src/pan-init.ts
    range: [1, 33]
    contentHash: 65a9346
    note: "Current SCAFFOLD_FILES hardcodes project_root '.' and writes lib/ paths unprefixed at repoRoot; WP1–WP3 fix this."
  - kind: lines
    path: lib/memory/handbook/pancreator-config.md
    range: [1, 45]
    contentHash: 3608bf2
    note: "Canonical project_root contract; WP1 adds harness-root vs project-root distinction and resolver documentation."
  - kind: lines
    path: lib/personas/adopter.md
    range: [43, 69]
    contentHash: 9bf9624
    note: "Adopter write-surface and project_root proposal obligations; WP6 updates write surface to use <project_root>/…."
  - kind: lines
    path: lib/personas/skills/adopt-existing-repo/SKILL.md
    range: [60, 76]
    contentHash: 405d2d6
    note: "Step 1 dry-run and Pancreator-prefixed write surface; WP6 adds manifest deny-list enforcement."
  - kind: lines
    path: lib/memory/features/bootstrap-phase-5-m1-exit-close-docs-bootstrap/spec.md
    range: [1, 30]
    contentHash: 78de083
    note: "WP1 US-9 kit acceptance criteria and WP5 state-transition gate that this feature's R6 updates unblock."
  - kind: lines
    path: lib/memory/features/bootstrap-phase-5-m1-exit-close-docs-bootstrap/greenfield-evidence.schema.json
    range: [1, 10]
    contentHash: a1d208c
    note: "Schema to extend with required metadata.project_root field per R6 AC-1."
  - kind: lines
    path: AGENTS.md
    range: [229, 268]
    contentHash: b953d77
    note: "Workspace map distinguishing self-hosting substrate from operator-facing harness paths."
  - kind: lines
    path: OPERATION.md
    range: [1, 20]
    contentHash: a91d661
    note: "Feature-delivery loop and pan CLI verbs; WP6 adds harness-root vs project-root documentation."
  - kind: lines
    path: pancreator.yaml
    range: [1, 10]
    contentHash: a7092be
    note: "Self-hosting reference value project_root '.'; embedded installs MUST NOT copy this bootstrap tracking block."
---

# Spec

This Feature SHALL deliver an embedded-harness install model that allows
`pan init` to adopt existing repositories under a `.pancreator/` subdirectory
without conflicting with host `AGENTS.md` or application sources. It SHALL
also ensure that fresh-install and adopt scaffolds produce a minimal harness
manifest rather than copying daedaline's self-development history.

Seven ordered work packages implement the feature. **WP1 MUST land before WP2
and WP3.** **WP4 MUST land before the WP3 scaffold implementation.** WP6
documentation SHOULD follow WP2–WP5 implementation.

**WP1 (`project-root-resolution-primitive`)** SHALL add a shared
`projectRootAbs(harnessRoot)` and `resolveProjectPath(harnessRoot, …segments)`
resolver to `@pancreator/core` (or a single CLI module imported by all
callers). The resolver SHALL read `project_root` from harness-root
`pancreator.yaml`, defaulting to `"."` when the key is absent. All callers in
`@pancreator/cli` SHALL import the resolver rather than hand-joining paths.
`lib/memory/handbook/pancreator-config.md` SHALL document the harness-root vs
project-root distinction with copy-paste examples.

**WP2 (`cli-runtime-path-prefixing`)** SHALL update every `@pancreator/cli`
code path that today joins `repoRoot` with `lib/`, `.pan/work/`, `.pan/archive/`, or
`.pan/` to route through the WP1 resolver instead. `pancreator.yaml` and
repo-root `.env` SHALL remain at harness root. Feature-delivery `state.json`
artifact paths SHALL remain project-relative without embedding `.pancreator/`
in stored strings; only runtime resolution SHALL prefix `project_root`.

**WP3 (`embedded-adopt-scaffold`)** SHALL change `pan init --apply` behavior
in an existing repository to write harness-root `pancreator.yaml` with
`project_root: ".pancreator"` and a minimal policy block, scaffold fresh-harness
files exclusively under `.pancreator/` per the WP4 allow list, and emit an
adoption scan stub at `<project_root>/lib/memory/adoption/scan-<date>.md`. WP3
SHALL NOT overwrite host `AGENTS.md`, application sources, or host `.cursor/rules`
unless `--force` with explicit per-file operator confirmation. Dry-run output
SHALL report harness-root file conflicts separately from project-root file
conflicts; partial apply SHALL succeed when only harness-root `pancreator.yaml`
conflicts and `--force` is absent.

**WP4 (`fresh-embedded-harness-manifest`)** SHALL publish an explicit manifest
file (YAML or JSON) under `lib/memory/handbook/` or `lib/internal/tools/`
listing every path the embedded-install scaffold SHALL and SHALL NOT produce.
The manifest SHALL drive `pan init` (WP3) and adopter dry-run checks (WP6).
The allow list and deny list SHALL match the R4 specification exactly.

**WP5 (`greenfield-create-pancreator-invariant`)** SHALL preserve
`pan create-pancreator <name>` behavior: on an empty directory it SHALL
continue to use `project_root: "."`, scaffold the fresh-harness manifest at
repository root, and MAY include a minimal root `AGENTS.md` because no host
contract exists.

**WP6 (`us9-kit-and-adoption-documentation`)** SHALL update six surfaces:
`greenfield-evidence.schema.json` (add required `metadata.project_root`),
`greenfield-evidence.fixture.json` (add embedded example), the
`evaluate-greenfield-evidence.mjs` evaluator (validate `project_root`, reject
deny-listed paths), `lib/personas/skills/adopt-existing-repo/SKILL.md` and
`lib/personas/adopter.md` (write surface uses `<project_root>/…`; default
adopt proposal sets `project_root: ".pancreator"`; Step 1 dry-run uses manifest
deny list), `lib/memory/features/bootstrap-phase-5-m1-exit-close-docs-bootstrap/index.json`
(copy-paste steps for embedded adopt on `/Users/alen/Dev/xeremia-sandbox`), and
`OPERATION.md` (harness root vs project root for inbox entry args).

**WP7 (`tests-and-validation-evidence`)** SHALL add unit tests for the WP1
resolver and WP3 embedded scaffold (conflict partial apply, deny-list
enforcement), update `node --test tests/evaluate-greenfield-evidence.test.mjs`
for the `project_root` field, add regression tests proving self-hosting daedaline
paths still resolve unchanged, and add a fixture or integration test simulating
adopt into a temp repo with pre-existing `AGENTS.md`.

## Touch-set

| Work package | Primary paths |
|---|---|
| WP1 | new `lib/internal/packages/@pancreator/core/src/project-root.ts` (or `@pancreator/cli/src/project-root.ts`); `lib/memory/handbook/pancreator-config.md` |
| WP2 | `lib/internal/packages/@pancreator/cli/src/feature-delivery-run.ts`; `lib/internal/packages/@pancreator/cli/src/active-memory-refresh.ts`; `lib/internal/packages/@pancreator/cli/src/persona-resolve.ts`; `lib/internal/packages/@pancreator/cli/src/intervention-checkpoint.ts`; `lib/internal/packages/@pancreator/cli/src/feature-delivery-runner.ts`; `lib/internal/packages/@pancreator/cli/src/feature-delivery-stage-artifacts.ts`; `lib/internal/packages/@pancreator/cli/src/run.ts` |
| WP3 | `lib/internal/packages/@pancreator/cli/src/pan-init.ts` |
| WP4 | new `lib/memory/handbook/embedded-install-manifest.yaml` (or `lib/internal/tools/embedded-install-manifest.json`) |
| WP5 | `lib/internal/packages/@pancreator/cli/src/pan-init.ts` (create-pancreator path) |
| WP6 | `lib/memory/features/bootstrap-phase-5-m1-exit-close-docs-bootstrap/greenfield-evidence.schema.json`; `lib/memory/features/bootstrap-phase-5-m1-exit-close-docs-bootstrap/greenfield-evidence.fixture.json`; `lib/memory/features/bootstrap-phase-5-m1-exit-close-docs-bootstrap/evaluate-greenfield-evidence.mjs` (if present in tests/); `lib/personas/skills/adopt-existing-repo/SKILL.md`; `lib/personas/adopter.md`; `lib/memory/features/bootstrap-phase-5-m1-exit-close-docs-bootstrap/index.json`; `OPERATION.md` |
| WP7 | `tests/` — new and updated test files for resolver, pan-init, and greenfield-evidence evaluator |

## Acceptance criteria

### WP1 — Project-root resolution primitive

- When `pancreator.yaml` declares `project_root: ".pancreator"`, the resolver
  SHALL return `<harnessRoot>/.pancreator` from `projectRootAbs(harnessRoot)`.
- When `pancreator.yaml` declares `project_root: "."` or the key is absent, the
  resolver SHALL return `harnessRoot` unchanged (backward compatibility).
- When the caller invokes `resolveProjectPath(harnessRoot, "lib", "inbox", "in")`,
  the resolver SHALL return `path.join(projectRootAbs(harnessRoot), "lib", "inbox", "in")`.
- `lib/memory/handbook/pancreator-config.md` SHALL contain a section named
  "Harness root vs project root" with copy-paste `pnpm -w exec pan …` examples
  for embedded and self-hosting installs.

### WP2 — CLI and runtime path prefixing

- When `project_root: ".pancreator"` is set, `pnpm -w exec pan run feature-delivery
  <inbox-entry>` SHALL resolve the directive under
  `<harnessRoot>/.pancreator/lib/inbox/in/<inbox-entry>`.
- When `project_root: "."` is set, existing daedaline paths SHALL resolve
  identically to the pre-WP2 behavior.
- `state.json` artifact paths SHALL remain project-relative strings (e.g.,
  `lib/inbox/in/…`, `.pan/work/…`) without `.pancreator/` embedded.
- Every file in the WP2 touch-set SHALL import the WP1 resolver rather than
  hand-joining `repoRoot` with `lib/`, `.pan/work/`, `.pan/archive/`, or `.pan/`.

### WP3 — Embedded adopt scaffold

- When `pan init --apply` runs in a repository that already contains `AGENTS.md`,
  the command SHALL create `.pancreator/lib/…` scaffold files and SHALL NOT
  overwrite `AGENTS.md`.
- The written `pancreator.yaml` SHALL declare `project_root: ".pancreator"` and
  SHALL NOT copy daedaline bootstrap phase tracking (no `completed_phases` block).
- Dry-run output SHALL list harness-root file conflicts and project-root file
  conflicts in separate sections.
- When only `pancreator.yaml` conflicts at harness root, partial apply SHALL
  succeed for all project-root paths and exit non-zero with the harness-root
  conflict listed; `--force` SHALL allow overwriting.
- `pan init --apply` SHALL emit the adoption scan stub at
  `.pancreator/lib/memory/adoption/scan-<date>.md` and the inbox ratification
  item under `.pancreator/lib/inbox/in/…`.

### WP4 — Fresh embedded harness manifest

- The manifest SHALL exist at the declared path in WP4 touch-set.
- The manifest SHALL list every allowed scaffold path (project-relative) from R4
  "SHALL scaffold" exactly.
- The manifest SHALL list every denied path from R4 "SHALL NOT scaffold" exactly,
  including `.pan/archive/`, `lib/memory/backlog/`, `lib/memory/adr/`,
  `lib/memory/rfc/`, `lib/memory/postmortems/`, `lib/memory/research/`,
  `lib/memory/runbooks/`, `lib/memory/smes/`, `lib/internal/`, `tests/`,
  `.docs/PRD.md`, `.docs/BOOTSTRAP.md`, `.docs/M1.index.md`, and daedaline
  bootstrap evidence bundles.
- Embedded scaffold output SHALL contain zero paths matching any deny-list entry.

### WP5 — Greenfield create-pancreator invariant

- When `pan create-pancreator <name>` runs against an empty directory, the
  written `pancreator.yaml` SHALL declare `project_root: "."`.
- The scaffold SHALL place all fresh-harness files at repository root.
- All existing daedaline tests for `pan create-pancreator` SHALL pass unchanged.

### WP6 — US-9 kit and adoption documentation

- `greenfield-evidence.schema.json` SHALL contain a required field
  `metadata.project_root` with enum `[".", ".pancreator"]`.
- `greenfield-evidence.fixture.json` SHALL include an embedded example with
  `metadata.project_root: ".pancreator"` and a `target_repo.path` placeholder
  referencing `/Users/alen/Dev/xeremia-sandbox`.
- The evaluator SHALL exit non-zero when a checklist path matches a deny-listed
  self-dev tree (`.pan/archive/`, `lib/memory/backlog/`, etc.).
- `lib/personas/adopter.md` and `lib/personas/skills/adopt-existing-repo/SKILL.md`
  SHALL document the write surface using `<project_root>/…` templating.
- `lib/personas/skills/adopt-existing-repo/SKILL.md` Step 1 dry-run prose SHALL
  reference the WP4 manifest deny list.
- `lib/memory/features/bootstrap-phase-5-m1-exit-close-docs-bootstrap/index.json`
  `operator_setup.wp1_greenfield_us9` SHALL contain copy-paste steps for embedded
  adopt on `/Users/alen/Dev/xeremia-sandbox` without rsync of backlog or archive
  paths.
- `OPERATION.md` SHALL document that inbox entry args are relative to
  `<project_root>/lib/inbox/in/`, not the harness root.

### WP7 — Tests and validation evidence

- A unit test SHALL assert `readProjectRoot` returns `"."` for daedaline and
  `".pancreator"` for an embedded fixture.
- A unit test SHALL assert `pan init --apply` in a fixture repo with pre-existing
  `AGENTS.md` creates `.pancreator/lib/…` and leaves `AGENTS.md` untouched.
- A unit test SHALL assert that deny-list enforcement causes `pan init --dry-run`
  to exit non-zero when a deny-listed path would be written.
- `node --test tests/evaluate-greenfield-evidence.test.mjs` SHALL pass with the
  updated schema and fixture.
- Self-hosting regression tests (existing daedaline tests for `project_root: "."`)
  SHALL pass without modification.

## Out of scope

- Rewriting `lib/internal/` package implementations beyond the path-resolution
  hooks required for the embedded layout; no unrelated refactors.
- Migrating historical `.pan/archive/work/` or `.pan/archive/inbox/` content in this repo.
- Copying `lib/memory/backlog/` or any ranked product backlog into embedded installs.
- Auto-migrating existing self-hosted repos from `project_root: "."` to
  `.pancreator` unless an operator explicitly requests a follow-on feature.
- Executing the live US-9 bootstrap-gate run on `/Users/alen/Dev/xeremia-sandbox`
  (validation fixture and unit tests only; live run remains a follow-on item).
- Changing daedaline `pancreator.yaml` bootstrap phase tracking as part of
  WP1–WP6 (WP5 state-transition is gated on a separate follow-on US-9 evidence
  item per `lib/memory/features/bootstrap-phase-5-m1-exit-close-docs-bootstrap/spec.md`).
- Publishing `@pancreator/cli` to npm for host-repo invocation.
- Backlog seeding inside embedded installs.
- Archival automation for embedded hosts.
- Live xeremia adoption run and evidence transfer.

## Downstream owners

| Work package | Recommended owner(s) |
|---|---|
| WP1 resolver API design and handbook contract | `tech-lead` |
| WP1 and WP2 resolver implementation and CLI wiring | `coder` |
| WP3 pan init embedded scaffold | `coder` |
| WP4 manifest file and allow/deny list | `tech-lead` |
| WP5 create-pancreator invariant | `coder` |
| WP6 documentation updates | `tech-writer` |
| WP3, WP4, WP5, WP6 review | `reviewer` |
| WP7 tests | `qa-tester` |
| Final indexing and artifact closure | `librarian` |

## Open questions

_(none — directive is sufficiently specified for plan-stage delegation)_
