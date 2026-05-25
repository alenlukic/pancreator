---
title: tess init + npx create-tesseract install paths
feature_id: tess-install-paths
stage: intake
owner: intake-analyst
status: open
created_at: 2026-05-25T06:05:00Z
references:
  - kind: path
    path: docs/PRD.md
    note: §3.5 US-9 makes both install paths an MVP requirement; §11 names them as M1 baseline.
  - kind: path
    path: docs/BOOTSTRAP.md
    note: Phase 5 names init-greenfield and adopt as on-real-targets work; M1 baseline already promises both install paths.
  - kind: path
    path: src/internal/packages/@tesseract/cli/src/run.ts
    note: tess init currently returns a JSON stub; no adopter persona invocation, no scan artifact, no inbox handoff.
  - kind: path
    path: src/internal/packages/@tesseract/adopter-scan/
    note: The presence-only repo scan primitive exists; it is not wired to any CLI verb.
  - kind: path
    path: src/personas/adopter.md
    note: Adopter persona is authored but has no automated entry point.
---

# tess init + npx create-tesseract install paths

## Problem

US-9 promises both install paths in M1, but `tess init` currently prints a
`{"status":"stub"}` JSON envelope and `npx create-tesseract` does not exist.
The `adopter` persona, the `@tesseract/adopter-scan` primitive, and the
`adopt.yaml` and `init-greenfield.yaml` pipeline definitions are all present
but unwired. This is the single biggest M1 baseline gap.

## Goal

Wire the two install paths end-to-end so an operator can install Tesseract into
a fresh repo or an existing repo without hand-authoring the inbox/feature/work
scaffold.

## Required outcomes

1. `tess init` runs `@tesseract/adopter-scan` against the current working tree
   in dry-run by default, surfaces a per-file diff for any write it would make,
   and refuses to run when conflicts exist unless `--force` is passed.
2. `tess init` writes the scan report to
   `src/memory/adoption/scan-<UTC-day>.md` and opens an `src/inbox/in/<day>/`
   ratification item that lists detected languages, frameworks, and proposed
   threshold-policy seeds.
3. `tess init --dry-run` is the default; `--apply` is required to actually
   write any file outside `src/memory/adoption/`.
4. `npx create-tesseract <name>` creates a new directory with a complete M1
   scaffold (handbook seed pointers, `tesseract.yaml` defaults, AGENTS.md,
   sample `src/inbox/in/` directive, runnable `feature-delivery` walkthrough)
   without depending on this repository's bootstrap layout.
5. Both paths are non-destructive: zero existing files are overwritten without
   explicit confirmation; the scan report is the proposal artifact, not the
   apply log.

## Acceptance criteria

- `tess init --dry-run` against a checked-out copy of the standard examples
  (TS monorepo, Python service, Next.js app) completes without writing any
  file outside `src/memory/adoption/` and produces a scan report that resolves
  language, framework, test runner, and CI surface.
- `tess init --apply` against a fresh empty directory installs the M1 scaffold
  in one pass and exits zero.
- `npx create-tesseract demo` produces a runnable greenfield walkthrough whose
  `tess inbox` and `tess run feature-delivery` flow succeeds against a seeded
  inbox directive.
- The adopter scan artifact is dual-anchor citation-bearing per
  `src/memory/handbook/contract-format.md`.

## Out of scope

- Bidirectional sync to GitHub Issues / Linear (deferred per Q10).
- Automatic SME proposal beyond the high-confidence default per Q15.
- Container-sandbox install paths (M3).

## Recommended downstream owners

- `tech-lead` for the plan and adoption-report contract.
- `coder` for the CLI wiring and the `create-tesseract` package.
- `reviewer` for non-destructive guarantees and dry-run defaults.
