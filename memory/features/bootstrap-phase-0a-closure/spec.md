---
title: Bootstrap Phase 0a Closure Intake Spec
feature_id: bootstrap-phase-0a-closure
status: ready-for-plan
next_owner: tech-lead
next_stage: plan
source_inbox_item: inbox/in/60714_0708_bootstrap-phase-0a-closure.md
intake_round: 1
references:
  - kind: lines
    path: inbox/in/60714_0708_bootstrap-phase-0a-closure.md
    range: [1, 33]
    contentHash: cdc36ec05574db3ab5ed513e5a4144ca613ed1bad0ef12d8ac4a5ea6ba8ff0a1
    note: Human directive that opens the Phase 0a closure slice and constrains scope.
  - kind: lines
    path: BOOTSTRAP.md
    range: [36, 57]
    contentHash: 0f1088bedfa0eb32db30c78399f59cb40c79644249cba812dbe5d7eea6a10b5f
    note: Bootstrap Phase 0a defines the monorepo scaffold, top-level directories, and root rule shim.
  - kind: lines
    path: BOOTSTRAP.md
    range: [95, 97]
    contentHash: 0f1088bedfa0eb32db30c78399f59cb40c79644249cba812dbe5d7eea6a10b5f
    note: Phase 0 exit criterion ties the scaffold to later bootstrap progression.
  - kind: lines
    path: PRD.md
    range: [386, 435]
    contentHash: 6a838ec1879ea8c1c83dc5c4dd24618637ff3f7522043775cc123f3751b18f37
    note: PRD package-layout and tooling-stack requirements define the monorepo baseline.
  - kind: lines
    path: PRD.md
    range: [1114, 1130]
    contentHash: 6a838ec1879ea8c1c83dc5c4dd24618637ff3f7522043775cc123f3751b18f37
    note: PRD MVP scope names the required M1 package set and the boundary-first expectation.
  - kind: lines
    path: memory/handbook/glossary.md
    range: [222, 235]
    contentHash: aae7388df950d4aa27ab2eda452cabcc4e746875e7dcfa21565116b4d45344dd
    note: Glossary defines Feature-folder and Spec Kit alignment conventions.
---

# Spec

This spec canonicalizes the `bootstrap-phase-0a-closure` directive into a
bounded Phase 0a closure slice. The slice closes the missing monorepo scaffold,
package skeleton manifests, and root tooling needed before later bootstrap
phases can rely on a stable workspace baseline.

## Acceptance criteria

- WHEN the slice starts, the implementation plan MUST reconcile the live
  workspace against the Phase 0a and M1 package requirements and MUST record
  every required add, rename, keep, or defer decision.
- WHEN the workspace scaffold lands, the repository MUST include the root
  configuration for a `pnpm` workspace, `pnpm` catalogs, Turborepo, Changesets,
  and the always-apply `AGENTS.md` rule shim.
- WHEN the package skeletons land, the slice MUST create the minimal manifest
  and source stub set for each required M1 package so package boundaries exist
  before rich implementation work starts.
- WHEN public package tooling runs, the workspace MUST wire
  `@arethetypeswrong/cli`, `publint`, and declaration-build support into
  repeatable root-level commands.
- WHEN dependency boundaries are checked, the workspace MUST provide the
  `@tesseract/no-horizontal-primitive-deps` lint rule and MUST expose a
  conformance check that fails horizontal primitive dependencies.
- WHEN Phase 0a closure is reviewed, the slice MUST leave an explicit
  verification checklist or equivalent operator-facing record that proves the
  scaffold satisfies the Phase 0a portion of the bootstrap gate.
- WHEN the slice is implemented, the change set SHOULD stay limited to the
  workspace scaffold, package skeletons, supporting CI or lint wiring, and
  directly required documentation updates.

## Out of scope

- Implementing runtime behavior inside the scaffolded packages beyond minimal
  export stubs.
- Delivering Phase 0b handbook seed work, Phase 0c meta-persona work, or Phase
  3 substrate behavior.
- Shipping M2+ or M3-only packages such as `@tesseract/a2a`,
  `@tesseract/runner-claude`, or sandbox adapters as part of this slice.

## Open questions

- None.
