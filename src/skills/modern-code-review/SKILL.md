---
name: modern-code-review
description: Runs Modern Code Review per Bacchelli/Bird and Google `eng-practices` against one Feature touch-set. Loads the Engineering Spec, plan, and ADR draft; classifies every finding under `must fix`, `consider`, or `nit`; runs every Spec Contract pulled in by `contracts:from_feature`; emits one `/src/work/<day>/<id>/review.md` for the `review_passes` gate.
license: Apache-2.0
metadata:
  daedaline-stability: experimental
  daedaline-bootstrap-only: false
  daedaline-pipeline-stages: [review]
  daedaline-risk-tier: medium
  daedaline-required-handbook:
    - /src/memory/handbook/glossary.md
    - /src/memory/handbook/contract-style.md
    - /src/memory/handbook/contract-format.md
  daedaline-emits:
    - /src/work/<day>/<id>/review.md
references:
  - kind: lines
    path: docs/PRD.md
    range: [508, 508]
    contentHash: 2ce8e5c
    note: "PRD §6 — MVP roster: reviewer runs Modern Code Review per Google's `eng-practices`, classifies must fix / consider / nit, verifies test coverage, checks ADR/PRD alignment, and runs declared Spec Contracts."
  - kind: lines
    path: docs/PRD.md
    range: [669, 678]
    contentHash: 2ce8e5c
    note: "PRD §7 — feature-delivery `review` stage YAML declaring inputs `[code, tests, plan, adr-draft, contracts:from_feature]`, output `/src/work/<day>/<id>/review.md`, and `gate: review_passes`."
  - kind: lines
    path: docs/PRD.md
    range: [113, 121]
    contentHash: 2ce8e5c
    note: "PRD §3.5 US-1 — Multi-cycle implement → review → fix → review → ship loop the reviewer gates with bounded loop count."
  - kind: lines
    path: docs/PRD.md
    range: [1255, 1255]
    contentHash: 2ce8e5c
    note: "PRD §17 — Reading list cite for Modern Code Review (Bacchelli/Bird, Bosu/Greiler/Bird) the procedure draws from."
---

# Skill — `modern-code-review`

A reusable 6-step review procedure that converts one touch-set's diff into
one Markdown review with a binary verdict on the `review_passes` gate. The
canonical caller is `src/personas/reviewer.md`. M2+ adds `appsec` (security
review variant), `frontend-eng` (UX-Spec contract review), and `sdet`
(test-coverage review) as specialized callers; each variant inherits the
skill's classification rubric and adds its own contract bundle.

## Prerequisites

- The `review` stage's inputs MUST be present at the paths declared in PRD
  §7 lines 671 through 676: code, tests, `/src/work/<day>/<id>/plan.md`,
  `/src/work/<day>/<id>/adr-draft.md`, and the contracts pulled in by
  `contracts:from_feature`.
- Coverage figures SHALL be derived from the touch-set diff and test files
  directly; `/src/work/<day>/<id>/test-report.md` is an output of the
  downstream `test` stage and is NOT a review prerequisite.
- `/src/memory/handbook/glossary.md`, `/src/memory/handbook/contract-style.md`, and
  `/src/memory/handbook/contract-format.md` SHALL exist; the review body
  satisfies Layer 1 lint per PRD §4.6 and the contract result table
  validates against the wrapper schema.

## The 6-step review loop

Execute these steps in order, once per Feature review.

### Step 1 — Load the design artifacts before reading the code

Read `/src/memory/features/<id>/spec.md`, `/src/work/<day>/<id>/plan.md`, and
`/src/work/<day>/<id>/adr-draft.md` first; do NOT open the diff until the design
context is loaded. The design-first ordering follows the Bacchelli/Bird
finding cited at PRD §17 line 1255 that reviewers who skip the design
artifacts file disproportionately many `nit`-class comments and miss the
architectural defects.

When any design artifact is missing, the review MUST halt and route an
inbox item per the Failure-handling section below.

### Step 2 — Walk the diff and classify every finding

Open `git diff` against the touch-set declared at
`/src/work/<day>/<id>/touch-set.json`. For each defect, classify under exactly one
heading per the rubric below.

- **`must fix`.** A defect that violates a Spec Contract clause, a `plan.md`
  task acceptance criterion, the touch-set boundary at PRD §7 line 803, or
  a Layer 1 lint rule. The `review_passes` gate at PRD §7 line 678 fails
  while any `must fix` is unresolved.
- **`consider`.** A non-blocking improvement: a more idiomatic API shape, a
  clearer test name, a missing comment that captures non-obvious intent.
  The reviewer MUST cite the prior-art reference (style guide, ADR, or RFC)
  the suggestion draws from.
- **`nit`.** A purely cosmetic comment: whitespace, imports order, prose
  polish in a non-normative comment. The reviewer MAY note nits but MUST
  NOT block the gate on them.

Each finding MUST cite the file path and line range it references via
dual-anchor citation per PRD §8. A finding without a dual-anchor citation
fails the gate.

### Step 3 — Run every Spec Contract pulled in by `contracts:from_feature`

Enumerate every clause in `/src/memory/features/<id>/contracts/`. For each
clause, run the matching `ContractRunner` per
`/src/memory/handbook/contract-format.md` and record the row below in the
review's Spec Contract results table.

| column | source |
| --- | --- |
| `clause.id` | from the clause's `id` field |
| `kind` | from the clause's `kind` field |
| `severity` | from the clause's `severity` field |
| `result` | runner output: `pass` \| `fail` \| `timeout` \| `error` |
| `runner output path` | dual-anchor citation to the runner's stdout/stderr capture under `/src/work/<day>/<id>/contract-runs/<clause.id>.log` |

Every `severity: block` clause whose `result` is `fail` MUST also appear in
the `must fix` section under Findings. An omitted clause fails the gate.

### Step 4 — Verify the coverage delta and the test plan

Derive statement and branch coverage on the changed lines from the touch-set
diff and the test files declared in the touch-set (`/src/work/<day>/<id>/touch-set.json`).
The reviewer MUST verify each public symbol the diff adds or modifies carries at
least one test under the touch-set's declared test paths per
`src/personas/coder.md`. A missing test routes a `must fix` finding citing the
symbol. When `/src/work/<day>/<id>/implementation-report.md` contains coverage
figures the coder captured, the reviewer MAY cite those figures and MUST record
the source path. (`/src/work/<day>/<id>/test-report.md` is emitted by the
downstream `test` stage and is NOT available at review time.)

When the threshold policy in `daedaline.yaml: gates.coverage` declares
`new_lines_only: true`, the reviewer MUST cite the new-lines coverage
figure rather than the global coverage figure.

### Step 5 — Author the four-section review body

Write `/src/work/<day>/<id>/review.md` with exactly four `##` sections in the order
declared in `src/personas/reviewer.md`:

1. **Verdict.** One paragraph at most 80 words declaring `review_passes:
   true` or `review_passes: false` with a one-sentence rationale citing
   the gate that decided the verdict.
2. **Findings.** The bulleted list grouped under `must fix`, `consider`,
   and `nit`.
3. **Spec Contract results.** The table built in Step 3.
4. **Coverage delta.** The figures captured in Step 4 plus a dual-anchor
   citation into the source (diff, touch-set test paths, or
   `/src/work/<day>/<id>/implementation-report.md`) from which the
   coverage figures were derived.

The full body MUST stay at most 1500 words across the four sections.

### Step 6 — Run Layer 1 lint and stage the verdict

Apply the Layer 1 lint discipline declared in
`/src/memory/handbook/contract-style.md` to every normative clause in the
review body. Each rule MUST hold:

- One RFC 2119 obligation keyword per normative clause.
- One EARS template per normative clause.
- Active voice and present tense.
- Numeric claims quantified with units.
- No weasel words from the PRD §4.6 ban list.
- Every domain noun resolves to `/src/memory/handbook/glossary.md`.
- Median sentence length at most 30 words.
- p95 sentence length at most 40 words.

Apply at most 3 self-correction rounds. On the 4th unresolved violation,
escalate via inbox per the R29 friction-circuit-breaker pattern from
PRD §13.

When the verdict is `review_passes: false` and the failure routes back to
`implement` per PRD §7 line 678's gate predicate, you MUST list the
`must fix` items the `coder` persona MUST resolve before the next round.
The MVP loop cap declared in PRD §3.5 US-1 line 120 MUST hold.

## Stop conditions

- Halt when any required design artifact is missing; route an inbox item
  per the Failure-handling section.
- Halt when a Spec Contract runner fails to terminate within its declared
  `cost_ceiling_usd`; mark the row `result: timeout`, fail the gate, and
  route an inbox item to `contract-writer` per PRD §4.5 R28.
- Halt when the diff writes outside the declared touch-set; the gate fails
  on a `must fix` finding citing the out-of-touch-set write per PRD §7
  line 810.
- Halt when 3 consecutive Layer 1 lint rounds fail; escalate via inbox.

## Failure-handling

- If `/src/work/<day>/<id>/plan.md` or `/src/work/<day>/<id>/adr-draft.md` is
  missing, the review MUST halt and open one inbox item at
  `src/inbox/in/<timestamp>-reviewer-missing-input.md` naming the Feature id
  and the missing upstream artifact. The reviewer MUST NOT guess the missing
  content. (`/src/work/<day>/<id>/test-report.md` is an output of the downstream
  `test` stage and is NOT a review prerequisite.)
- If the implement → review loop has run 5 times without a green
  `review_passes` gate, the reviewer MUST halt and escalate via inbox per
  PRD §3.5 US-1 line 120; the supervisor MAY dispatch `pause` or
  `quarantine` per PRD §3.5 US-10.

## Cost guards

- The contract runner aggregate cap defaults to
  `pipeline.contracts.max_dollars: 5` per run per
  `/src/memory/handbook/contract-format.md`. On soft-overage at 80%, the
  reviewer MUST warn and skip remaining `severity: warn` clauses. On
  hard-overage at 100%, the reviewer MUST halt and route via inbox.
- Per-review-round token budget defaults to 60 000 tokens. A budget
  exhaustion mid-review MUST trip the breaker and route an inbox item; the
  reviewer MUST NOT silently truncate findings.
