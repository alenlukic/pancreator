---
title: Scaffold Phase 0a As A Runnable pnpm Monorepo
status: draft
date: 2026-04-27
deciders: [tech-lead, LocalUserAuthorizer]
references:
  - kind: lines
    path: memory/features/bootstrap-phase-0a-closure/spec.md
    range: [49, 80]
    contentHash: 31994149904e507e81029d40dea33a7d93dde9654ec5f58c0217e1f0a3e97b9c
    note: Phase 0a closure acceptance criteria and scope boundary.
  - kind: lines
    path: BOOTSTRAP.md
    range: [40, 57]
    contentHash: 0f1088bedfa0eb32db30c78399f59cb40c79644249cba812dbe5d7eea6a10b5f
    note: Phase 0a scaffold requirements.
  - kind: lines
    path: PRD.md
    range: [386, 435]
    contentHash: 6a838ec1879ea8c1c83dc5c4dd24618637ff3f7522043775cc123f3751b18f37
    note: Package layout, tooling stack, exports, and dependency rule.
  - kind: lines
    path: PRD.md
    range: [1114, 1130]
    contentHash: 6a838ec1879ea8c1c83dc5c4dd24618637ff3f7522043775cc123f3751b18f37
    note: MVP package and install-path scope.
  - kind: lines
    path: memory/adr/0002-system-architecture-map.md
    range: [132, 148]
    contentHash: 3708a4f70c41ab01897392545b75037d617fdb7f1746c9c30dfabd2a6250685b
    note: Current versus future architecture boundary.
---

## Context

The repository contains bootstrap documentation, top-level directories, personas, skills, handbook seeds, policy defaults, and package README placeholders. The repository does not contain root workspace manifests, package manifests, package source stubs, declaration-build wiring, dependency-boundary lint wiring, CI scaffold checks, or a Phase 0a verification record.

ADR 0002 separates CURRENT repository substrate from FUTURE runtime behavior. Phase 0a closure MUST follow that boundary because the scaffold makes later work possible without claiming Phase 3 runtime capability.

## Decision

When Phase 0a closure implements the scaffold, `coder` MUST use `pnpm` workspaces with catalogs, Turborepo, Changesets linked releases, `tsup --dts`, `@arethetypeswrong/cli`, `publint`, ESLint, and a local `@tesseract/no-horizontal-primitive-deps` rule.

When `coder` creates package skeletons, each package MUST receive only `package.json`, `README.md`, and `src/index.ts` scaffold files. The scaffold MAY export versioned placeholder symbols, but it MUST NOT implement package runtime behavior.

When `coder` reconciles package inventory, existing `packages/@tesseract/*` directories MUST remain in place. The unscoped `packages/tesseract/` meta package MUST be added because PRD §11 names the `tesseract` meta package.

When `coder` wires verification, CI MUST run the root scaffold commands that prove workspace installation, builds, type declarations, public API packaging, and dependency-boundary checks.

## Status

Draft for Phase 0a closure planning. The decision awaits human review through the normal phase-boundary gate.

## Consequences

- Positive: Later bootstrap phases receive stable package identities before implementation begins.
- Positive: Public package tooling fails early when exports, types, or primitive boundaries drift.
- Positive: The Phase 0a verification record gives operators one review target for scaffold closure.
- Negative: The monorepo adds build-tool configuration before package behavior exists.
- Negative: The local ESLint rule may need replacement when a published lint package exists.
- Neutral: Contract packages and `mcp-server` remain skeleton-only; behavior stays deferred to later phases.
- Neutral: Phase 0b handbook, Phase 0c persona, Phase 2 contract, and Phase 3 runtime work remain outside this decision.
