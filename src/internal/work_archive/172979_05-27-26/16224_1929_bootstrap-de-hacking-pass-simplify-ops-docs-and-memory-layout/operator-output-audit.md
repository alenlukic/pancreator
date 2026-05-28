# Operator-output audit — bootstrap de-hacking pass

**Task id.** `16224_1929_bootstrap-de-hacking-pass-simplify-ops-docs-and-memory-layout`  
**Scope guide.** `touch-set.json` → `readOnlyAuditScopes`: `src/personas/*.md`, `.cursor/agents/*.md`, `.cursor/rules/*.mdc`, `src/memory/handbook/*.md`, `AGENTS.md`, `README.md`, `OPERATION.md`.

## Method

1. Manual scan of runnable fenced blocks (`bash`, `sh`, `shell`, `zsh`, `console`, `terminal`) and prose copy-paste `tess` invocations per `src/memory/handbook/operator-output-contract.md`.
2. Automated gate: `node src/internal/tools/check-operator-output.mjs` (same glob roots as the checker: personas, `.cursor/agents`, `.cursor/rules`, handbook, `AGENTS.md`, `README.md`, `OPERATION.md`).

**Checker result (must_fix re-entry).** `node src/internal/tools/check-operator-output.mjs` → exit `0` (`[check-operator-output] ok`).

## Coverage summary

| Surface | Files in scope | Audited | Violations found | Disposition |
|---|---:|---:|---:|---|
| Personas (`src/personas/*.md`) | 12 | 12 | 7 (prose bare `tess`) | Fixed in touch-set personas; 5 clean |
| Cursor agents (`.cursor/agents/*.md`) | 37 | 37 | 0 | Clean |
| Cursor rules (`.cursor/rules/*.mdc`) | 12 | 12 | 0 | Clean |
| Handbook runnable examples | 3 | 3 | 0 in runnable blocks | Clean (deferred verbs are prose-only) |
| Top-level operator docs | 3 | 3 | 0 | Clean |

## Personas — full enumeration (`src/personas/*.md`)

| File | Runnable `tess` blocks | Prose / inline `tess` | Result |
|---|---|---|---|
| `adopter.md` | none | none actionable | **clean** |
| `coder.md` | none | bare `tess` (fixed) | **fixed** — `pnpm -w exec tess feature implement` |
| `compliance-auditor.md` | none | none actionable | **clean** |
| `contract-writer.md` | none | none actionable | **clean** |
| `intake-analyst.md` | none | bare `tess` (fixed) | **fixed** |
| `librarian.md` | none | bare `tess` (fixed) | **fixed** — `pnpm -w exec tess memory reindex` |
| `persona-designer.md` | none | none actionable | **clean** |
| `reviewer.md` | none | bare `tess` (fixed) | **fixed** |
| `supervisor.md` | none | bare `tess` (fixed) | **fixed** — intervention verbs prefixed |
| `tech-lead.md` | none | bare `tess` (fixed) | **fixed** |
| `tech-writer.md` | none | bare `tess` (fixed) | **fixed** |
| `tesseract-engineer.md` | none | none actionable | **clean** |

## Cursor agents — full enumeration (`.cursor/agents/*.md`)

| File | Result |
|---|---|
| `adopter-complex.md` | **clean** |
| `adopter-standard.md` | **clean** |
| `adopter.md` | **clean** |
| `coder-complex.md` | **clean** |
| `coder-standard.md` | **clean** |
| `coder.md` | **clean** |
| `compliance-auditor-complex.md` | **clean** |
| `compliance-auditor-standard.md` | **clean** |
| `compliance-auditor.md` | **clean** |
| `contract-writer-complex.md` | **clean** |
| `contract-writer-standard.md` | **clean** |
| `contract-writer.md` | **clean** |
| `general-purpose.md` | **clean** |
| `intake-analyst-complex.md` | **clean** |
| `intake-analyst-standard.md` | **clean** |
| `intake-analyst.md` | **clean** |
| `librarian-complex.md` | **clean** |
| `librarian-standard.md` | **clean** |
| `librarian.md` | **clean** |
| `persona-designer-complex.md` | **clean** |
| `persona-designer-standard.md` | **clean** |
| `persona-designer.md` | **clean** |
| `reviewer-complex.md` | **clean** |
| `reviewer-standard.md` | **clean** |
| `reviewer.md` | **clean** |
| `supervisor-complex.md` | **clean** |
| `supervisor-standard.md` | **clean** |
| `supervisor.md` | **clean** |
| `tech-lead-complex.md` | **clean** |
| `tech-lead-standard.md` | **clean** |
| `tech-lead.md` | **clean** |
| `tech-writer-complex.md` | **clean** |
| `tech-writer-standard.md` | **clean** |
| `tech-writer.md` | **clean** |
| `tesseract-engineer-complex.md` | **clean** |
| `tesseract-engineer-standard.md` | **clean** |
| `tesseract-engineer.md` | **clean** |

Projections contain retrieval stubs only; no runnable fenced `tess` blocks. Canonical operator examples remain in persona files and handbook.

## Cursor rules — full enumeration (`.cursor/rules/*.mdc`)

| File | Result |
|---|---|
| `adopter.mdc` | **clean** |
| `coder.mdc` | **clean** |
| `compliance-auditor.mdc` | **clean** |
| `contract-writer.mdc` | **clean** |
| `intake-analyst.mdc` | **clean** |
| `librarian.mdc` | **clean** |
| `persona-designer.mdc` | **clean** |
| `reviewer.mdc` | **clean** |
| `supervisor.mdc` | **clean** |
| `tech-lead.mdc` | **clean** |
| `tech-writer.mdc` | **clean** |
| `tesseract-engineer.mdc` | **clean** |

## Handbook — runnable-example pages (`src/memory/handbook/*.md`)

Only pages with operator-visible runnable fenced blocks were deep-audited; remaining handbook pages were scanned by `check-operator-output.mjs` (no runnable `tess` blocks).

| File | Runnable blocks | Result |
|---|---|---|
| `inbox-lifecycle.md` | `bash` (intake scaffold) | **clean** — prefixed examples; `tess inbox archive` remains deferred prose only |
| `operator-output-contract.md` | `bash` (prefix doctrine, samples) | **clean** — all copy-paste blocks use `pnpm -w exec tess` |
| `tesseract-config.md` | `bash` (CLI invocation, feature-delivery samples) | **clean** |

**Other handbook pages (16 files, no runnable `tess` blocks).** Audited via automation only — **clean**: `agents-md-authoring.md`, `backlog-format.md`, `constitution.md`, `context-cost-audit.md`, `context-economy.md`, `contract-format.md`, `contract-style.md`, `documentation-impact-contract.md`, `glossary.md`, `index.md`, `memory-tiers.md`, `persona-colors.md`, `persona-spec.md`, `policy-compliance-contract.md`, `run-log-schema.md`, `subagent-model-tiers.md`.

Prose-only deferred verbs (not copy-paste blocks): `contract-style.md` (`tess lint contracts`), `inbox-lifecycle.md` (`tess inbox archive`) — unchanged; tracked by existing backlog automation items.

## Top-level operator docs

| File | Result |
|---|---|
| `AGENTS.md` | **clean** — runnable examples use `pnpm -w exec tess` |
| `README.md` | **clean** — routes to `OPERATION.md`; no bare `tess` in runnable blocks |
| `OPERATION.md` | **clean** — all command tables use `pnpm -w exec tess` |

## Automation

- `src/internal/tools/check-operator-output.mjs` — repository gate (exit `0` at must_fix re-entry).
- `tests/operator-output-contract.test.mjs` — exercised under `node --test tests/*.test.mjs`.

## Deferred

No new backlog items for operator-output violations in scoped surfaces.
