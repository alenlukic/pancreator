# Implementation report — embedded-install-cursor-agent-sync-init-content-seeding-and-inbox-path-bugs

- Task id: `72723_0347_embedded-install-cursor-agent-sync-init-content-seeding-and-inbox-path-bugs`
- Stage: `implement` (re-entry after review must-fix)
- Persona: `coder`
- Spec: `lib/memory/features/embedded-install-cursor-agent-sync-init-content-seeding-and-inbox-path-bugs/spec.md`

## Summary

Implemented R1–R5 from the accepted spec: promoted cursor-agent sync into `@pancreator/cli`, wired `pan cursor-sync`, embedded init seeding plus post-init sync, fixed `pan intake new` project-root pathing, and updated operator docs plus follow-on feature linkage. Re-entry resolved the review must-fix by reverting out-of-touch-set `index.ts` exports and routing the bootstrap bridge through the `pan cursor-sync` CLI subprocess.

## Changes by requirement

| Requirement | Implementation |
|---|---|
| R1 — `pan cursor-sync` | Added `lib/internal/packages/@pancreator/cli/src/cursor-sync.ts` with `runCursorSync`, `buildAgentProjection`, and `buildGeneralPurposeProjection`. Wired CLI verb in `run.ts`. Converted `lib/internal/tools/sync-cursor-agents.mjs` to a thin subprocess bridge (no `index.ts` export surface). |
| R2 — init post-step | `runPanInit` invokes cursor sync after embedded apply when manifest allows `.cursor/agents/` and personas exist; records `cursorSync` or `skipped-no-personas` in the envelope. Dry-run reports skip when personas are not yet seeded. |
| R3 — persona/handbook seed | Copy-from-package seeding when target dirs contain zero `.md` files; deny-prefix filtering; envelope records `personaSeed` / `handbookSeed`. |
| R4 — inbox pathing | `pan intake new` resolves writes under `resolveProjectPath` (project root). Fixed two `resolveRepoPath` call sites in `feature-delivery-run.ts` for embedded ledger paths. |
| R5 — docs and defaults | `EMBEDDED_PANCREATOR_YAML` includes `runner.cursor.invocation: sdk`. Added Embedded install checklist and Manual agent sync sections to `OPERATION.md`. Linked follow-on in embedded-harness feature `index.json`. |

## Review must-fix remediation

| Finding | Resolution |
|---|---|
| `index.ts` modified outside touch-set | Reverted cursor-sync re-exports from `lib/internal/packages/@pancreator/cli/src/index.ts`. Bridge script now delegates to `pan cursor-sync` via subprocess, staying within declared touch-set paths. |
| Bridge contract coverage (consider) | Added `sync-cursor-agents.mjs bridge delegates to pan cursor-sync` test in `tests/cursor-sync.test.mjs`. |

## Public symbols added or modified

| Symbol | File | Tests |
|---|---|---|
| `runCursorSync` | `cursor-sync.ts` | `tests/cursor-sync.test.mjs` |
| `buildAgentProjection` | `cursor-sync.ts` | `tests/cursor-sync.test.mjs` |
| `buildGeneralPurposeProjection` | `cursor-sync.ts` | `tests/cursor-sync.test.mjs` |
| `runPanInit` (envelope extensions) | `pan-init.ts` | `tests/pan-init.test.mjs` |
| `parseAndRun` (`cursor-sync`, `intake new`) | `run.ts` | `tests/cursor-sync.test.mjs`, `tests/project-root-resolution.test.mjs` |
| `runCursorSync` / `syncCursorAgents` (bridge) | `sync-cursor-agents.mjs` | `tests/cursor-sync.test.mjs` (bridge subtest) |

## Touch-set compliance

All staged paths match `touch-set.json` exactly. No paths outside the declared boundary are modified.

## Validation results

| Command | Result |
|---|---|
| `node --test tests/cursor-sync.test.mjs` | pass (6/6) |
| `node --test tests/pan-init.test.mjs` | pass (3/3) |
| `node --test tests/project-root-resolution.test.mjs` | pass (5/5) |
| `node --test tests/cursor-sync.test.mjs tests/pan-init.test.mjs tests/project-root-resolution.test.mjs` | pass (14/14) |
| `pnpm --filter @pancreator/cli typecheck` | pass |
| `pnpm --filter @pancreator/cli build` | pass |

## Acceptance criteria mapping

| ID | Status | Evidence |
|---|---|---|
| AC1 | covered | `tests/pan-init.test.mjs` — embedded apply produces `.cursor/agents/intake-analyst.md` |
| AC2 | manual | Operator smoke on xeremia-sandbox after reset |
| AC3 | covered | `tests/project-root-resolution.test.mjs` — intake under `.pancreator/lib/inbox/in/` |
| AC4 | covered | `tests/cursor-sync.test.mjs` — both `project_root` modes |
| AC5 | covered | `tests/pan-init.test.mjs` — seeded persona/handbook paths exist post-init |
| AC6 | covered | `tests/cursor-sync.test.mjs` — dry-run envelope, no writes |
| AC7 | covered | `tests/cursor-sync.test.mjs` — zero personas exits 1 |
| AC8 | manual | xeremia US-9 SDK restart verification |

## Documentation impact

- `OPERATION.md`: embedded install checklist and manual `pan cursor-sync` procedure added (R5.2, R5.3).
- `lib/memory/features/embedded-harness-install-project-root-pancreator-and-fresh-install-manifest/index.json`: follow-on linkage added (R5.4).
- No AGENTS.md or handbook seed changes required.

## Risks and follow-ups

- Seed copy is non-destructive (only when zero `.md` files present); partial operator edits with mixed stubs are not overwritten.
- Bridge subprocess adds one CLI hop versus direct import; acceptable trade-off to keep touch-set boundary clean.

## Next operator steps

**What:** Ratify this implementation and advance to the review stage.

**How:**

```bash
pnpm -w exec pan advance 72723_0347_embedded-install-cursor-agent-sync-init-content-seeding-and-inbox-path-bugs --artifact work/172975_05-31-26/72723_0347_embedded-install-cursor-agent-sync-init-content-seeding-and-inbox-path-bugs/implementation-report.md
```

Then delegate `/reviewer` with `work/172975_05-31-26/72723_0347_embedded-install-cursor-agent-sync-init-content-seeding-and-inbox-path-bugs/next-prompt.md` after the ledger refreshes.
