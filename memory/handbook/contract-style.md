---
title: Contract Style Discipline (Layers 1–5)
slug: contract-style
stability: experimental
bootstrap-only: false
phase: 0b
owners: [contract-writer, librarian, reviewer]
purpose: |
  The 5-layer style discipline every contract clause MUST follow. Layer 1 is
  body-prose lint. Layer 2 is per-kind structural conformance. Layer 3 is
  template-slot discipline. Layer 4 is cross-clause invariants. Layer 5 is
  repo-level governance. The canonical reference for the lint loop in the
  `author-contract` skill and for `reviewer`'s Phase 4 contract pass.
references:
  - kind: lines
    path: PRD.md
    range: [260, 260]
    contentHash: TBD-on-commit
    note: "PRD §4 glossary — Spec Contract definition."
  - kind: lines
    path: PRD.md
    range: [839, 839]
    contentHash: TBD-on-commit
    note: "PRD §7 — `Spec contracts are gates, not suggestions` paragraph."
  - kind: lines
    path: PRD.md
    range: [1190, 1190]
    contentHash: TBD-on-commit
    note: "PRD §13 R11 — spec-contract over-fitting risk."
related:
  - /memory/handbook/glossary.md
  - /memory/handbook/contract-format.md
  - /memory/handbook/contract-templates/
external:
  - https://www.rfc-editor.org/info/bcp14
  - https://alistairmavin.com/ears/
  - https://www.openpolicyagent.org/docs/policy-language/#metadata
  - https://owasp.org/www-project-application-security-verification-standard/
---

# Contract Style Discipline

A contract clause is correct in two ways: the wrapper validates against the
schema in `/memory/handbook/contract-format.md`, and the prose passes the
5-layer discipline below.

The wrapper rejects malformed YAML. The discipline rejects ambiguous English.
Both gates MUST pass before a `severity: block` clause merges.

## 1 — Layer 1: body-prose lint

Layer 1 governs every line of human-readable text inside a clause:
`description`, `runtime.rubric.examples.*.rationale`, OPA `# METADATA`
descriptions, Gherkin docstrings, `ContractFailure.message`, and any free
prose in a sidecar artifact.

Layer 1 has nine rules. The lint pass enforces each one. A `severity: block`
clause MUST resolve every Layer 1 violation before submission.

### Rule 1.1 — RFC 2119 obligation per clause

Every normative statement MUST carry exactly one RFC 2119 obligation keyword:
`MUST`, `MUST NOT`, `SHALL`, `SHALL NOT`, `SHOULD`, `SHOULD NOT`, `MAY`,
`OPTIONAL`, `RECOMMENDED`, `NOT RECOMMENDED`, or `REQUIRED`. The keywords
are uppercase verbatim.

Sentences without a keyword are descriptive prose; the lint pass tolerates
them but the wrapper's `description` field MUST contain at least one
keyword.

### Rule 1.2 — EARS template per normative statement

Every normative statement MUST instantiate one of the five EARS forms:

- **Ubiquitous.** "The `<subject>` SHALL `<response>`."
- **Event-driven.** "When `<trigger>`, the `<subject>` SHALL `<response>`."
- **Unwanted-behavior.** "If `<unwanted>`, then the `<subject>` SHALL
  `<response>`."
- **State-driven.** "While `<state>`, the `<subject>` SHALL `<response>`."
- **Optional.** "Where `<feature>`, the `<subject>` SHALL `<response>`."

`<subject>` MUST be the runner, persona, contract, or artifact that performs
the action. Passive subjects ("the system," "it") fail the lint pass.

### Rule 1.3 — Atomic clauses

Each sentence MUST carry exactly one obligation, one subject, and one
response. Compound obligations connected by `and` or `or` MUST be split into
separate sentences.

The split improves traceability when a `ContractFailure` quotes the offending
clause; one obligation per failure is the routing primitive.

### Rule 1.4 — Active voice and present tense

Every normative sentence MUST be in active voice and present tense. Passive
constructions ("is verified by," "shall be checked") fail the lint pass.
Future tense ("will return") fails.

The exception is `references[].note`, which MAY be neutral past tense when
citing a published artifact's content.

### Rule 1.5 — Quantification with units

Every numeric claim MUST carry a unit and a measurement window. Examples:

- "...median latency MUST be at most 200 ms over a 5-minute window."
- "...the panel MUST reach quorum within 60 seconds of submission."
- "...statement coverage MUST be at least 80 percent on changed lines."

Bare numbers ("at most 200") fail the lint pass. The unit MUST be a SI unit,
a percent, a count, or a documented domain unit (e.g., `USD`).

### Rule 1.6 — No weasel words

The Layer 1 ban list MUST NOT appear in any normative clause. Current ban
list (versioned in this file):

`appropriately`, `reasonably`, `generally`, `typically`, `usually`,
`if needed`, `as required`, `etc.`, `and so on`, `user-friendly`, `modern`,
`robust`, `seamless`, `simple`, `easy`, `intuitive`, `best`, `optimal`,
`high-quality`, `industry-standard`, `state-of-the-art`, `best-in-class`,
`flexible`, `extensible` (when not pointing at a named extension surface),
`scalable` (when not paired with a measured load).

Adding a word to the ban list requires an RFC under `/memory/rfc/draft/`.
Removing a word requires the same.

### Rule 1.7 — Glossary discipline

Every domain noun MUST resolve to an entry in `/memory/handbook/glossary.md`
or to an explicit code-symbol citation. Unknown nouns fail the lint pass.

The lint pass uses tree-sitter to extract noun phrases and resolves each
against the glossary's term index. New nouns SHALL be added to the glossary
in the same change that introduces them.

### Rule 1.8 — Sentence length caps

The body prose MUST satisfy:

- Median sentence length at most 30 words across the clause.
- p95 sentence length at most 40 words across the clause.

The cap MAY be exceeded for one fenced code block, one bulleted list, or one
table per clause. Exceedances MUST carry a `tesseract.lint-debt` entry with
a documented justification.

### Rule 1.9 — Dual-anchor citation on every external standard

Every cited RFC, WCAG criterion, OWASP control, NIST identifier, ISO
standard, or vendor specification MUST resolve to a `references[]` entry of
the dual-anchor form defined in `/memory/handbook/glossary.md` (kind:
symbol or kind: lines, plus path and contentHash).

URLs without a content-hash anchor fail the lint pass for `severity: block`
clauses. URLs MAY appear in `severity: warn` clauses with a documented
`tesseract.lint-debt` entry.

## 2 — Layer 2: per-kind structural conformance

Layer 2 governs the per-kind shape that the runner consumes. The required
structures below are checked by the runner's `validatePayload(runtime)`
function and by the corresponding template under
`/memory/handbook/contract-templates/`.

### 2.1 — `kind: rego`

The Rego module MUST carry an OPA `# METADATA` block at the top:

```rego
# METADATA
# title: <human-readable name>
# description: <one-paragraph EARS-disciplined description>
# severity: <block | warn | info>
# references:
#   - "<path-or-URL with content hash>"
# custom:
#   tesseract.contract_id: <wrapper.id>
#   tesseract.applies_to: <serialized applies_to>
package tesseract.<area>
```

Additional rules:

- `deny` rules MUST return strings. The string MUST quote the wrapper's
  `description` verbatim.
- `import` statements MUST be explicit; wildcard imports fail Layer 2.
- The package name MUST start with the `tesseract.` namespace for clauses
  authored under `/memory/`. Vendor-authored modules MUST use the
  `vendor.<owner>.<area>` namespace.

### 2.2 — `kind: llm-judge`

The `runtime.rubric` MUST carry:

- A scoring scale anchored at 1.0, 0.5, and 0.0.
- A `threshold` (default 0.75) above which the panel reports pass.
- At least two worked examples — one good, one bad — each with a one-sentence
  rationale.
- A `references:` block citing the source of the judgment criteria.

The `runtime.panel` MUST carry:

- A `quorum` of `<N>-of-<M>` with `M >= 3` and `N >= 2` for `severity: block`.
- A `judges` array of model identifiers; the array length MUST equal `M`.
- A pinned `seed` for replay.
- A `cost_ceiling_usd` at most 1.00 USD per clause; the panel halts on
  overage and routes via inbox.

Without good-and-bad examples, judge variance explodes. The runner refuses
the clause and surfaces the missing examples through `ContractFailure`.

### 2.3 — `kind: playwright` (M2+)

The Playwright spec file MUST carry a Gherkin docstring at the top:

```typescript
/**
 * Feature: <wrapper.description Feature line>
 *   Scenario: <wrapper.id>
 *     Given <state>
 *     When <trigger>
 *     Then <response>
 */
test.describe("<wrapper.id>", () => { ... });
```

The `test.describe` block name MUST equal `wrapper.id` exactly. Test failure
messages MUST quote the wrapper's `description` verbatim so contract-failure
routing is grep-friendly.

### 2.4 — `kind: schemathesis` (M2+)

The clause MUST include at least one passing example and one failing
example per assertion. The OpenAPI extension `x-tesseract.contract_id` MUST
appear on the gated path or operation and MUST link back to `wrapper.id`.

### 2.5 — `kind: axe` (M2+)

The clause MUST list specific axe rule identifiers (e.g., `color-contrast`,
`label`); empty rule lists fail Layer 2. The clause MUST run against a
deployed URL or a Playwright-served fixture, never against raw HTML.

### 2.6 — `kind: semgrep` (M3+)

The Semgrep rule MUST populate `metadata.likelihood` (`LOW | MEDIUM | HIGH`)
and `metadata.impact` (`LOW | MEDIUM | HIGH`). The `message:` field MUST
quote the wrapper's `description`. The rule MUST ship at least one
negative-case fixture in the rule's test file.

### 2.7 — Threat-model and security clauses

Threat-model and security clauses MUST carry:

- A STRIDE category (`spoofing`, `tampering`, `repudiation`,
  `information-disclosure`, `denial-of-service`, `elevation-of-privilege`).
- An OWASP-ASVS reference (e.g., `ASVS-V2.1.1`).
- An EARS-disciplined assertion describing the mitigation.
- A numeric likelihood × impact score on a 1–5 × 1–5 scale.

### 2.8 — Performance clauses

Performance clauses MUST carry:

- An SLI definition (the measured signal).
- An SLO target (the threshold).
- A measurement window (e.g., `5-minute rolling`).
- An error budget (the permitted SLI miss-rate per window).

## 3 — Layer 3: template-slot discipline

Every kind in the closed-core registry has a template under
`/memory/handbook/contract-templates/<name>.template.md`. The MVP set is
`ux-spec`, `api-spec`, `security`, `performance`, `behavior-preservation`,
and `llm-judge`.

### Rule 3.1 — Use the template

Authors MUST start from the matching template. Filling slots is the single
biggest determinant of consistency in practice.

The template carries REQUIRED slots and OPTIONAL slots. REQUIRED slots
SHALL be filled; OPTIONAL slots MAY be omitted with a one-line justification.

### Rule 3.2 — Opt-out is explicit

When no template fits, the author MUST opt out via `style: prose-ok` on the
wrapper. The opt-out logs a Layer 3 warning.

The warning resolves either by template revision (Layer 5) or by accepting
the prose-ok carve-out indefinitely.

### Rule 3.3 — Recurrence triggers an RFC

When the same template recurs as a poor fit across three or more clauses,
the author MUST open an RFC under `/memory/rfc/draft/` proposing the
template revision. The RFC names every poor-fit clause and the proposed slot
delta.

## 4 — Layer 4: cross-clause invariants

Layer 4 governs the corpus, not the clause. The reviewer's Phase 4 contract
pass enforces these. The runner enforces them at scheduling time.

### Rule 4.1 — Owner exists

Every `wrapper.owner` MUST resolve to a persona file under `personas/`. The
runner refuses orphan clauses.

### Rule 4.2 — Owner is in scope

Every `wrapper.owner`'s `metadata.tesseract-pipeline-stages` MUST include the
stage that triggers the clause. The reviewer flags clauses whose owner is
out-of-scope for the gate.

### Rule 4.3 — Anchor uniqueness

At most one `severity: block` clause MAY gate the same `applies_to` anchor.
Multiple block clauses on the same anchor MUST be merged into one composite
clause. Multiple `severity: warn` clauses on the same anchor are permitted.

### Rule 4.4 — Kind allowlist enforcement

Every clause's `kind` MUST appear in the current milestone's allowlist on the
authoring persona's `metadata.tesseract-allowed-kinds-<milestone>` field.
Refusal opens a kind-promotion ADR.

### Rule 4.5 — No self-gating loops

A clause MUST NOT gate the file it is authored in. A clause MUST NOT gate
its own owner persona's spec file. Both rules mitigate the BR1 / BR2 risks
in `BOOTSTRAP.md`.

## 5 — Layer 5: repo-level governance

Layer 5 governs the lifecycle of templates, kinds, and lint rules across
releases.

### Rule 5.1 — Template revisions go through RFC

A template change requires an RFC under `/memory/rfc/draft/`. The RFC SHALL
list every existing clause the change affects and SHALL specify a migration
window of at least one milestone.

### Rule 5.2 — Kind promotions are dated

A new closed-core kind MUST land via a kind-promotion ADR under
`/memory/adr/`. The ADR SHALL declare the milestone the kind is allowed in
and SHALL update the allowlist on `personas/contract-writer.md`.

### Rule 5.3 — Lint rule additions are dated

Adding a Layer 1 rule requires this file's revision plus a Phase-5 review
note. The rule MUST ship in `severity: warn` mode for one milestone before
escalating to `severity: error`.

### Rule 5.4 — Lint debt has budgets

The aggregate `tesseract.lint-debt` count across the repo MUST be at most:

- 50 entries in M1.
- 25 entries in M2.
- 10 entries in M3.
- 0 entries in M4 and beyond.

Overrun freezes new contract authoring until the debt budget recovers. The
freeze is a Layer 4 invariant the reviewer enforces.

## 6 — The lint loop

The author runs the lint loop after Step 4 of the `author-contract` skill.

1. Run the Layer 1 lint rules in order. Fix each violation in place.
2. Run the Layer 2 conformance check for the chosen kind.
3. Diff against the chosen template; resolve any unfilled slot or improvised
   prose.
4. After three consecutive self-correction rounds without convergence,
   escalate via inbox per the R29 friction-circuit-breaker pattern.

From Phase 3 step 2 onward, `tess lint contracts --explain` automates steps 1
through 3 and reports the violated rule, a suggested EARS rewrite, and the
relevant template-section reference. Until then, hand-check.

## 7 — Worked example: a Layer 1 fix

Bad (compound, weasel, no quantification, no EARS):

> The system should typically verify input appropriately and return a
> reasonable error when needed.

Good (atomic, EARS, quantified, glossary-resolved):

> When the request payload fails JSON Schema validation, the API SHALL
> return HTTP 400 within 50 ms and emit a `ContractFailure` whose message
> quotes this clause's description verbatim.

The lint pass converted one ambiguous sentence into one quantifiable
contract. The runner can now grep the run log for the failure.

## 8 — Stability

This file is the Phase 0b handbook seed. The five layers are stable for M1.
Adding a layer requires an RFC. Promoting this file to `stability: stable`
follows Phase 5 dogfood validation across the full M1 contract corpus.
