---
title: examples/library-script — single-primitive library-mode example
feature_id: library-mode-script-example
stage: intake
owner: intake-analyst
status: open
created_at: 2026-05-25T06:05:04Z
references:
  - kind: path
    path: docs/PRD.md
    note: §11 names "One library-mode example in examples/library-script/" as M1 MVP scope.
  - kind: path
    path: docs/PRD.md
    note: §3.5 US-8 is the library-or-framework foundational design constraint; library mode requires a standalone proof.
  - kind: path
    path: docs/BOOTSTRAP.md
    note: Phase 5 still lists the four examples; the library-script one is the M1 baseline.
  - kind: path
    path: src/internal/packages/@tesseract/persona/
    note: Persona parser, dual-anchor mirror emitter, and Cursor shim emitter are real and exportable.
---

# examples/library-script — single-primitive library-mode example

## Problem

US-8 makes library mode a foundational design constraint, and PRD §11 names
`examples/library-script/` as an M1 MVP deliverable that proves a single
`@tesseract/*` primitive imports cleanly into a non-Tesseract toolchain.
The directory does not exist. Until it does, the no-horizontal-deps lint and
the package-shape contracts cannot be validated against an external consumer.

## Goal

Ship one short Node script under `examples/library-script/` that imports a
single Tesseract primitive (proposed: `@tesseract/persona`) without any
`tesseract.yaml`, without any other Tesseract install, and without an
implicit dependency on the Tesseract filesystem layout.

## Required outcomes

1. `examples/library-script/` contains a `package.json`, a single
   `index.mjs` (≤80 lines), and a `README.md` that walks an external user
   through the example in five minutes.
2. The script parses a sample persona Markdown file from a path the caller
   passes on the command line, validates the 16-field frontmatter, and
   emits both the `.cursor/agents/<name>.md` mirror and the
   `.cursor/rules/<name>.mdc` shim to a temporary directory.
3. The example uses only `@tesseract/persona` plus its declared external
   peers; no other `@tesseract/*` package is referenced.
4. CI builds the example and runs its script in a smoke test that does not
   touch the host repository.
5. The README declares the primitive's `stability` tier and the SOTA
   conformance statement (Anthropic Claude Agent SDK 16-field).

## Acceptance criteria

- Running `node examples/library-script/index.mjs path/to/persona.md` from
  outside the monorepo produces the two emitted files in a temp directory
  and exits zero.
- `pnpm install && pnpm --filter library-script test` is green.
- The example never reads `src/memory/`, `src/inbox/`, or `tesseract.yaml`.
- The example's README is referenced from `docs/PRD.summary.md` as the
  library-mode proof.

## Out of scope

- LangGraph or MCP-driven examples (deferred per PRD §11 last bullet).
- Multi-primitive composition examples (M2+).

## Recommended downstream owners

- `tech-lead` for the primitive choice and the no-fs-coupling contract.
- `coder` for the script and README authoring.
- `reviewer` for the no-horizontal-deps audit on the example package.
