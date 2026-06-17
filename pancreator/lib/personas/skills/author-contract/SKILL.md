---
name: author-contract
description: Authors a single contract clause to the PRD §4.5 wrapper schema and the §4.6 5-layer style discipline. Picks a `kind`, picks a template, resolves the `applies_to` anchor, fills the slots, runs the lint loop, then registers ownership routing.
license: Apache-2.0
metadata:
  pancreator-stability: experimental
  pancreator-bootstrap-only: false
  pancreator-pipeline-stages: [bootstrap-phase-2, intake, plan, review]
  pancreator-risk-tier: medium
  pancreator-required-handbook:
    - /lib/memory/handbook/contract-format.md
    - /lib/memory/handbook/contract-style.md
    - /lib/memory/handbook/contract-templates/
    - /lib/memory/handbook/glossary.md
  pancreator-allowed-kinds-mvp: [rego, llm-judge]
  pancreator-allowed-kinds-m2: [rego, llm-judge, playwright, schemathesis, axe]
  pancreator-allowed-kinds-m3plus: [rego, llm-judge, playwright, schemathesis, axe, semgrep, hypothesis, fast-check, ts-predicate, py-predicate]
  pancreator-emits:
    - clause-inline-or-sidecar
    - /lib/memory/features/<category>/<id>/contracts.index.json entry
references:
  - kind: lines
    path: .docs/PRD.md
    range: [317, 480]
    contentHash: 2eb6aa4
    note: "PRD §4.5 — wrapper schema, closed-core kind registry, ContractRunner adapter, ContractFailure, quorum policy"
  - kind: lines
    path: .docs/PRD.md
    range: [483, 610]
    contentHash: 2eb6aa4
    note: "PRD §4.6 — Layers 1-5 + worked example"
  - kind: lines
    path: .docs/PRD.md
    range: [967, 980]
    contentHash: 2eb6aa4
    note: "PRD §6 — meta-skill spec this file implements"
---

# Skill — `author-contract`

A reusable 6-step procedure for authoring one contract clause. The canonical caller
is `lib/personas/contract-writer.md`; `intake-analyst`, `tech-lead`, `reviewer`,
`appsec`, `sdet`, `design-engineer`, `design-reviewer`, and `groomer` MAY invoke it
directly when their own work product needs a contract gate.

## Prerequisites

- `/lib/memory/handbook/contract-format.md` SHALL exist and define the §4.5 wrapper
  schema reference.
- `/lib/memory/handbook/contract-style.md` SHALL exist and capture Layers 1–3 of §4.6.
- `/lib/memory/handbook/contract-templates/` SHALL contain at minimum the 6 MVP
  scaffolds: `ux-spec.template.md`, `api-spec.template.md`, `security.template.md`,
  `performance.template.md`, `behavior-preservation.template.md`, `llm-judge.template.md`.
- The artifact under gate (e.g., `spec.md`, `ux-spec.md`, `pancreator.yaml`) SHALL
  have a stable path and a current content hash.
- The contract's `owner` persona SHALL exist in `lib/personas/`.

## The 6-step authoring loop

Execute these steps in order, once per clause.

### Step 1 — Pick a `kind`

Match the assertion to one of the closed-core kinds in PRD §4.5. Use the decision
tree:

- Structural policy over JSON, threshold gates, access-control invariants → `rego`.
- Semantic or qualitative judgement with no deterministic runner → `llm-judge`.
- End-to-end browser behavior → `playwright` (M2+).
- API contract conformance over OpenAPI → `schemathesis` (M2+).
- WCAG accessibility → `axe` (M2+).
- Code-shape and AST patterns → `semgrep` (M3+).
- Property-based invariant tests in Python → `hypothesis` (M3+).
- Property-based invariant tests in TypeScript → `fast-check` (M3+).
- Arbitrary TS/Py predicate (escape hatch) → `ts-predicate` / `py-predicate` (M3+).

When the assertion fits no closed-core kind and the milestone is M2+, you MAY use an
open-registry `x-<owner>/<name>` kind, subject to the ombudsperson approval gate
from PRD §13 Q25 / R27. When the milestone is M1, refuse and open an inbox item
proposing a kind-promotion ADR.

### Step 2 — Pick a template

Load the matching template from `/lib/memory/handbook/contract-templates/<kind>.md` or
from a domain-specific file in `<domain>.template.md`. Filling slots is the single
biggest determinant of consistency in practice; you MUST NOT start from a blank page.

When no template fits, opt out explicitly via `style: prose-ok` and accept the lint
warning. When the same template recurs as a poor fit across 3 or more clauses, open
an RFC under `/lib/memory/rfc/draft/` proposing a template revision per Layer 5.

### Step 3 — Resolve the `applies_to` anchor

Compute a dual-anchor citation per PRD §8: prefer
`{kind: 'symbol', path, symbol, contentHash}` resolved via tree-sitter; fall back to
`{kind: 'lines', path, range, contentHash}` only for non-AST content. From M1 step
3.8 onward, `pan contracts anchor --suggest <file>:<line>` automates the
AST-symbol lookup.

The five `applies_to.kind` discriminators per §4.5 are `artifact-symbol`,
`pipeline-telemetry`, `file-path`, `run-log-event`, and `pancreator-config`. Pick
exactly one; lint blocks on missing or ambiguous discriminators.

### Step 4 — Fill the slots

The template's slots enforce Layer 2 per-kind requirements. Do not skip any slot
marked REQUIRED:

- `kind: llm-judge` rubrics MUST include at least 2 worked examples (good and bad,
  with explanation), a numeric scoring rubric anchored at 1.0/0.5/0.0, and a
  `references:` block. Without good and bad examples, judge variance explodes.
- `kind: rego` clauses MUST include an OPA `# METADATA` block with `title`,
  `description`, `severity`, `references`, plus `pancreator.contract_id` and
  `pancreator.applies_to` extensions. `deny` rules MUST return strings; imports
  MUST be explicit.
- `kind: playwright` clauses MUST carry a Gherkin docstring at the top of the spec;
  `test.describe` block name MUST match the contract `id` exactly; failure messages
  MUST quote the EARS assertion verbatim so contract-failure routing is grep-able.
- `kind: schemathesis` clauses MUST cover at least one passing and one failing
  example per assertion; the `x-pancreator.contract_id` OpenAPI extension MUST link
  back to the clause.
- `kind: semgrep` rules MUST populate `metadata.likelihood` and `metadata.impact`,
  cite the EARS assertion in `message:`, and ship at least one negative-case
  fixture in the rule's test file.
- Threat-model and security clauses MUST carry a STRIDE category, an OWASP-ASVS
  reference, an EARS assertion, and a numeric likelihood × impact score.
- Performance clauses MUST carry an SLI definition, an SLO target, a measurement
  window, and an error budget.

When the clause has `severity: block` and `kind: llm-judge`, you MUST set
`quorum: <N>-of-<M>` with `M >= 3` and `N >= 2`, plus `cost_ceiling_usd <= 1.00`
and a pinned `seed:` per PRD §4.5 quorum policy and §13 R28.

### Step 5 — Run `pan lint contracts --explain`

From Phase 3 step 2 onward, run `pan lint contracts --explain` against the new
clause. The `--explain` flag shows, for every violation: the violated rule, a
suggested EARS-formatted rewrite, and the relevant template-section reference.

When the clause has `severity: block`, all Layer 1 violations MUST resolve to zero
before submission; warn-level and info-level violations MAY remain when
documented in `pancreator.lint-debt`. Apply at most 3 self-correction rounds; on the
4th unresolved violation, escalate via inbox per R29.

Until Phase 3 step 2 lands `pan lint contracts`, gate by hand against the Layer 1
checklist in `/lib/memory/handbook/contract-style.md`.

### Step 6 — Submit and register the owner routing

When all gates are green, you MUST:

1. Place the clause inline (in the artifact's frontmatter under `contract:`) or as
   a sidecar file under `/lib/memory/features/<category>/<id>/contracts/<clause-id>.{rego,spec.ts,...}`
   referenced from the clause via `spec:` / `module:`. Sidecar is preferred for
   `kind: playwright`, `kind: schemathesis`, large rego modules, or anything
   benefiting from native LSP support.
2. Auto-register the `clause.id` in `/lib/memory/features/<category>/<id>/contracts.index.json`
   with the resolved `applies_to` anchor and the named `owner` persona.
3. Verify the wrapper schema (Zod) and the per-kind payload schema both validate
   from Phase 3 step 2 onward; until then, hand-check the wrapper against
   `/lib/memory/handbook/contract-format.md`.
4. Confirm the `owner` persona exists in `lib/personas/`; if not, halt and open an
   inbox item rather than create an orphan contract.
5. Stage the changes; do not commit. Open an inbox item to the human (Phases 0–4)
   or to `reviewer` (Phase 5+) summarizing the new clause, its `kind`, its
   `severity`, and any `pancreator.lint-debt` warnings the clause carries.

## Stop conditions

- Halt when the chosen `kind` falls outside the milestone's allowlist; open a
  kind-promotion ADR.
- Halt when a required template is missing; open an inbox item proposing the
  template rather than improvise from a blank page.
- Halt when 3 consecutive self-correction rounds fail to resolve a Layer 1 lint
  violation; escalate via inbox.
- Halt when the `owner` persona does not yet exist; do not author orphan contracts.
- Halt when the `applies_to` anchor's `contentHash` cannot be computed (e.g.,
  target file moved or deleted); refresh the anchor or open an inbox item.

## Cost guards (PRD §13 Q24, R28)

- Per-clause `cost_ceiling_usd` defaults to 1.00 USD; hard kill at the ceiling.
- Aggregate per-pipeline-run caps default to `pipeline.contracts.max_wall_seconds: 600`
  and `pipeline.contracts.max_dollars: 5`. On soft-overage at 80%, this skill MUST
  warn and skip remaining `severity: warn` clauses; on hard-overage at 100%, it
  MUST halt and route via inbox.
