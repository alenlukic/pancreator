---
name: modern-code-review
description: Runs Modern Code Review per Bacchelli/Bird and Google `eng-practices` against one Feature touch-set. Loads the Engineering Spec, plan, and ADR draft; classifies every finding under `must fix`, `consider`, or `nit`; runs every Spec Contract pulled in by `contracts:from_feature`; emits one `/.pan/work/<day>/<id>/review.md` for the `review_passes` gate.
license: Apache-2.0
metadata:
  pancreator-stability: experimental
  pancreator-bootstrap-only: false
  pancreator-pipeline-stages: [review]
  pancreator-risk-tier: medium
  pancreator-required-handbook:
    - /lib/memory/handbook/glossary.md
    - /lib/memory/handbook/contract-style.md
    - /lib/memory/handbook/contract-format.md
  pancreator-emits:
    - /.pan/work/<day>/<id>/review.md
references:
  - kind: lines
    path: .docs/PRD.md
    range: [508, 508]
    contentHash: 2eb6aa4
    note: "PRD §6 — MVP roster: reviewer runs Modern Code Review per Google's `eng-practices`, classifies must fix / consider / nit, verifies test coverage, checks ADR/PRD alignment, and runs declared Spec Contracts."
  - kind: lines
    path: .docs/PRD.md
    range: [669, 678]
    contentHash: 2eb6aa4
    note: "PRD §7 — feature-delivery `review` stage YAML declaring inputs `[code, tests, plan, adr-draft, contracts:from_feature]`, output `/.pan/work/<day>/<id>/review.md`, and `gate: review_passes`."
  - kind: lines
    path: .docs/PRD.md
    range: [113, 121]
    contentHash: 2eb6aa4
    note: "PRD §3.5 US-1 — Multi-cycle implement → review → fix → review → ship loop the reviewer gates with bounded loop count."
  - kind: lines
    path: .docs/PRD.md
    range: [1255, 1255]
    contentHash: 2eb6aa4
    note: "PRD §17 — Reading list cite for Modern Code Review (Bacchelli/Bird, Bosu/Greiler/Bird) the procedure draws from."
---

# Skill — `modern-code-review`

A reusable 7-step review procedure that converts one touch-set's diff into
one Markdown review with a binary verdict on the `review_passes` gate. The
canonical caller is `lib/personas/reviewer.md`. M2+ adds `appsec` (security
review variant), `frontend-eng` (UX-Spec contract review), and `sdet`
(test-coverage review) as specialized callers; each variant inherits the
skill's classification rubric and adds its own contract bundle.

## Prerequisites

- The `review` stage's inputs MUST be present at the paths declared in PRD
  §7 lines 671 through 676: code, tests, `/.pan/work/<day>/<id>/plan.md`,
  `/.pan/work/<day>/<id>/adr-draft.md`, and the contracts pulled in by
  `contracts:from_feature`.
- Coverage figures SHALL be derived from the touch-set diff and test files
  directly; `/.pan/work/<day>/<id>/test-report.md` is an output of the
  downstream `test` stage and is NOT a review prerequisite.
- `/lib/memory/handbook/glossary.md`, `/lib/memory/handbook/contract-style.md`, and
  `/lib/memory/handbook/contract-format.md` SHALL exist; the review body
  satisfies Layer 1 lint per PRD §4.6 and the contract result table
  validates against the wrapper schema.

## The 6-step review loop

Execute these steps in order, once per Feature review.

### Step 1 — Load the design artifacts before reading the code

Read `/.pan/work/<day>/<task-id>/spec.md`, `/.pan/work/<day>/<id>/plan.md`, and
`/.pan/work/<day>/<id>/adr-draft.md` first; do NOT open the diff until the design
context is loaded. The design-first ordering follows the Bacchelli/Bird
finding cited at PRD §17 line 1255 that reviewers who skip the design
artifacts file disproportionately many `nit`-class comments and miss the
architectural defects.

When any design artifact is missing, the review MUST halt and route an
inbox item per the Failure-handling section below.

### Step 2 — Walk the diff and classify every finding

Open `git diff` against the touch-set declared at
`/.pan/work/<day>/<id>/touch-set.json`. For each defect, classify under exactly one
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

Enumerate every clause in `/lib/memory/features/<category>/<id>/contracts/`. For each
clause, run the matching `ContractRunner` per
`/lib/memory/handbook/contract-format.md` and record the row below in the
review's Spec Contract results table.

| column | source |
| --- | --- |
| `clause.id` | from the clause's `id` field |
| `kind` | from the clause's `kind` field |
| `severity` | from the clause's `severity` field |
| `result` | runner output: `pass` \| `fail` \| `timeout` \| `error` |
| `runner output path` | dual-anchor citation to the runner's stdout/stderr capture under `/.pan/work/<day>/<id>/contract-runs/<clause.id>.log` |

Every `severity: block` clause whose `result` is `fail` MUST also appear in
the `must fix` section under Findings. An omitted clause fails the gate.

### Step 4 — Verify touch-set tests before QA handoff

Run every `touch-set.json` `tests` entry with `kind: command` from the run's
touch-set. Record each command in the **Touch-set tests** section of
`review.md`. Set `touch_set_tests_pass: true` only when every touch-set gate
command exits zero.

You MAY also run `pnpm test` and `node --test tests/*.test.mjs` from the
repository root for operator visibility. Record those rows with
`pass/fail: excluded-from-gate`; they MUST NOT set `touch_set_tests_pass: false`
or `review_passes: false` when they fail.

Do not rerun `pnpm lint` or `pnpm typecheck` unless review-stage remediation
changed code; otherwise set `lint_typecheck_rerun_required: false` and cite
`implementation-report.md`.

### Step 5 — Verify the coverage delta and the test plan

Derive statement and branch coverage on the changed lines from the touch-set
diff and the test files declared in the touch-set (`/.pan/work/<day>/<id>/touch-set.json`).
The reviewer MUST verify each public symbol the diff adds or modifies carries at
least one test under the touch-set's declared test paths per
`lib/personas/coder.md`. A missing test routes a `must fix` finding citing the
symbol. When `/.pan/work/<day>/<id>/implementation-report.md` contains coverage
figures the coder captured, the reviewer MAY cite those figures and MUST record
the source path. (`/.pan/work/<day>/<id>/test-report.md` is emitted by the
downstream `test` stage and is NOT available at review time.)

When the threshold policy in `pancreator.yaml: gates.coverage` declares
`new_lines_only: true`, the reviewer MUST cite the new-lines coverage
figure rather than the global coverage figure.

### Step 6 — Author the five-section review body

Write `/.pan/work/<day>/<id>/review.md` with exactly five `##` sections in the order
declared in `lib/personas/reviewer.md`:

1. **Verdict.** One paragraph at most 80 words declaring `review_passes:
   true` or `review_passes: false` with a one-sentence rationale citing
   the gate that decided the verdict. The Verdict MUST also declare
   `core_reentry_required: true|false`, and when applicable
   `spot_fixable: true|false` and `excluded_from_gate: true|false`.
2. **Findings.** The bulleted list grouped under `must fix`, `consider`,
   and `nit`.
3. **Spec Contract results.** The table built in Step 3.
4. **Coverage delta.** The figures captured in Step 5 plus a dual-anchor
   citation into the source (diff, touch-set test paths, or
   `/.pan/work/<day>/<id>/implementation-report.md`) from which the
   coverage figures were derived.
5. **Touch-set tests.** The table built in Step 4.

The full body MUST stay at most 1500 words across the five sections.

### Step 7 — Run Layer 1 lint and stage the verdict

Apply the Layer 1 lint discipline declared in
`/lib/memory/handbook/contract-style.md` to every normative clause in the
review body. Each rule MUST hold:

- One RFC 2119 obligation keyword per normative clause.
- One EARS template per normative clause.
- Active voice and present tense.
- Numeric claims quantified with units.
- No weasel words from the PRD §4.6 ban list.
- Every domain noun resolves to `/lib/memory/handbook/glossary.md`.
- Median sentence length at most 30 words.
- p95 sentence length at most 40 words.

Apply at most 3 self-correction rounds. On the 4th unresolved violation,
escalate via inbox per the R29 friction-circuit-breaker pattern from
PRD §13.

When the verdict is `review_passes: false` and the failure routes back to
`implement` per PRD §7 line 678's gate predicate, you MUST list the
`must fix` items the `coder` persona MUST resolve before the next round.
The MVP loop cap declared in PRD §3.5 US-1 line 120 MUST hold.

You MAY set `spot_fixable: true` only for artifact-only review remediation under
`.pan/work/` or `lib/memory/`. Set `spot_fix_scope: artifact-only`,
`spot_fix_owner: review`, `spot_fix_paths`, and `spot_fix_rationale`. Review-stage
spot fix MUST NOT modify source code; broader issues MUST stay `must fix` and route
back to `implement`.

When `git diff` touches `touch-set.json` `shared_paths`, do not file a touch-set
breach. Undeclared shared-layer edits route to `tech-lead` instead of coder loops.

## Stop conditions

- Halt when any required design artifact is missing; route an inbox item
  per the Failure-handling section.
- Halt when a Spec Contract runner fails to terminate within its declared
  `cost_ceiling_usd`; mark the row `result: timeout`, fail the gate, and
  route an inbox item to `contract-writer` per PRD §4.5 R28.
- Halt when the diff writes outside `paths` and undeclared `shared_paths`; route
  declared `shared_paths` edits as allowed integration work, not breaches.
- Halt when 3 consecutive Layer 1 lint rounds fail; escalate via inbox.

## Failure-handling

- If `/.pan/work/<day>/<id>/plan.md` or `/.pan/work/<day>/<id>/adr-draft.md` is
  missing, the review MUST halt and open one inbox item at
  `lib/inbox/in/<timestamp>-reviewer-missing-input.md` naming the Feature id
  and the missing upstream artifact. The reviewer MUST NOT guess the missing
  content. (`/.pan/work/<day>/<id>/test-report.md` is an output of the downstream
  `test` stage and is NOT a review prerequisite.)
- If the implement → review loop has run 5 times without a green
  `review_passes` gate, the reviewer MUST halt and escalate via inbox per
  PRD §3.5 US-1 line 120; the supervisor MAY dispatch `pause` or
  `quarantine` per PRD §3.5 US-10.

## Cost guards

- The contract runner aggregate cap defaults to
  `pipeline.contracts.max_dollars: 5` per run per
  `/lib/memory/handbook/contract-format.md`. On soft-overage at 80%, the
  reviewer MUST warn and skip remaining `severity: warn` clauses. On
  hard-overage at 100%, the reviewer MUST halt and route via inbox.
- Per-review-round token budget defaults to 60 000 tokens. A budget
  exhaustion mid-review MUST trip the breaker and route an inbox item; the
  reviewer MUST NOT silently truncate findings.
