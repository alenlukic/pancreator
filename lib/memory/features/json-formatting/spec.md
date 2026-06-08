---
title: JSON Formatting Intake Spec
feature_id: json-formatting
status: intake-awaiting-ratification
next_owner: tech-lead
next_stage: plan
source_inbox_item: lib/inbox/in/json_formatting.md
intake_round: 2
closure_artifact: lib/inbox/threads/172983_05-23-26/json-formatting/67080_0522_round-02-operator-scope-correction.md
references:
  - kind: lines
    path: lib/inbox/in/json_formatting.md
    range: [1, 3]
    contentHash: ebfc73c
    note: Informal directive requires pretty-formatted JSON on all agent/script output surfaces, abbreviated hashes, and migration of existing JSON.
  - kind: lines
    path: lib/inbox/threads/172983_05-23-26/json-formatting/74280_0322_round-01-reply.md
    range: [29, 96]
    contentHash: 35d65b8
    note: Round-1 operator answers resolve hash length (Q1), contentHash abbreviation scope (Q2), output-file scope for bulk migration (Q3), exclusions (Q4), array formatting (Q5), migration ownership (Q6), and enforcement mechanism (Q7). Q3 scopes the file inventory for migration/compliance; it does not limit R1 surfaces per round-2 correction.
  - kind: lines
    path: lib/inbox/threads/172983_05-23-26/json-formatting/67080_0522_round-02-operator-scope-correction.md
    range: [1, 142]
    contentHash: 7770f73
    note: Round-2 operator ratification corrects scope to all R1 surfaces (repo .json artifacts, markdown-embedded JSON, terminal/CLI, agent chat). Supersedes narrowed-scope portions of the prior spec. Authoritative for R1–R5 requirements.
  - kind: lines
    path: .docs/PRD.md
    range: [641, 648]
    contentHash: 2eb6aa4
    note: PRD §7 feature-delivery intake stage declares inputs, outputs, loop.max_rounds 5, and gate human_approval.
  - kind: lines
    path: lib/memory/handbook/glossary.md
    range: [199, 206]
    contentHash: c70da7c
    note: Glossary Dual-anchor citation and Content hash entries; the Content hash entry SHALL be updated so its normative definition specifies the abbreviated form as the canonical stored value.
---

# Spec

This Feature SHALL define a canonical JSON formatting convention for every
surface where an agent or automated script emits JSON, and SHALL enforce that
convention via compliance tests under `tests/compliance/`. In-scope surfaces
are: every `.json` artifact produced or maintained by repo functionality or the
human operator; JSON embedded in Markdown and other non-`.json` artifacts
(including dual-anchor citations in delivery reports, persona examples, handbook
prose, inbox threads, and work-stage markdown); JSON printed to terminal/CLI by
agents or scripts; and JSON printed to the agent chat window by agents.
The following are excluded from all surfaces: `node_modules/`, third-party
vendored paths, and tooling-regenerated files. `pancreator-engineer` SHALL
execute a one-shot bulk migration script to bring all existing in-scope `.json`
files into conformance. The Feature serves every persona and agent that writes
or reads structured JSON anywhere in the repository or its output channels.

## Acceptance criteria

### Repository `.json` artifact surfaces

- When an agent or automated script writes an in-scope `.json` file, the output
  SHALL use `indent=2` with each object key-value pair on its own line.
- When an agent or automated script writes a JSON array in an in-scope `.json`
  file, the array element layout SHALL follow the pretty-printer default; strict
  one-element-per-line layout is not required for primitive-array elements.
- When an agent or automated script writes a JSON field that contains a git
  commit hash in an in-scope `.json` file, the field value SHALL use the
  abbreviated form produced by `git rev-parse --short HEAD` at write time.
- When an agent or automated script writes a JSON field that contains a SHA-256
  content hash (e.g., a `contentHash` dual-anchor citation field) in an
  in-scope `.json` file, the field value SHALL use an abbreviated form whose
  character count equals the character count produced by `git rev-parse --short
  HEAD` at write time.
- When `pancreator-engineer` executes the bulk migration script, the script
  SHALL reformat every in-scope `.json` file to satisfy all formatting and
  hash-abbreviation criteria above in a single run.
- When the compliance suite executes tests under `tests/compliance/`, the
  Feature's compliance test SHALL verify that every in-scope `.json` file
  satisfies the indent, key-per-line, and hash-abbreviation rules.
- When the compliance test evaluates a JSON file under `node_modules/`, the
  test SHALL exclude that file from the in-scope set.
- When the compliance test evaluates a tooling-regenerated JSON file (e.g.,
  `package-lock.json`, `tsconfig.tsbuildinfo`), the test SHALL exclude that
  file from the in-scope set.

### Markdown-embedded JSON surfaces

- When an agent writes a dual-anchor citation JSON object inside Markdown prose
  (e.g., in a delivery report, persona spec, handbook entry, inbox thread, or
  work-stage artifact), the citation object SHALL serialize with `indent=2` and
  one key-value pair per line using the `formatCanonicalJson` canonical printer
  in `lib/internal/tools/migrate-json-formatting.mjs`.
- When an agent writes a dual-anchor citation JSON object in a long-form
  Markdown artifact, the citation SHOULD appear inside a fenced `json` code
  block; a backtick-wrapped multiline pretty-printed object is acceptable when
  the renderer preserves newlines.
- Compact single-line JSON blobs (e.g., `{"kind":"lines","path":"...","contentHash":"..."}`)
  SHALL NOT appear in prose or fenced blocks as a substitute for the pretty-printed
  form when the object contains more than one key.
- When an agent writes a `contentHash` field inside a Markdown-embedded JSON
  object, the value SHALL use the abbreviated form whose character count equals
  the character count produced by `git rev-parse --short HEAD` at write time.
- Placeholder values such as `TBD-on-commit` in citation JSON fields SHALL NOT
  appear in ratified stage artifacts on any Markdown surface.

### Terminal/CLI and agent chat window surfaces

- When an agent or automated script prints a JSON object to the terminal/CLI,
  the output SHALL use `indent=2` with each object key-value pair on its own
  line, matching the `formatCanonicalJson` canonical shape.
- When an agent prints a JSON object in an agent chat window response, the
  output SHALL use `indent=2` with each object key-value pair on its own line,
  matching the `formatCanonicalJson` canonical shape.
- When a JSON field printed to terminal/CLI or agent chat carries a git commit
  hash or `contentHash` value, the value SHALL use the abbreviated form whose
  character count equals the character count produced by `git rev-parse --short
  HEAD` at write time.
- JavaScript object-literal syntax (single-quoted keys, unquoted keys) SHALL
  NOT be used in place of valid JSON on any R1 surface.

### Glossary update

- When this Feature is delivered, the **Content hash** / `contentHash` entry in
  `lib/memory/handbook/glossary.md` SHALL be updated so that its normative
  definition specifies the abbreviated form — with prefix length equal to the
  character count produced by `git rev-parse --short HEAD` at write time — as
  the canonical stored value, replacing the full 64-character hex digest as the
  canonical stored representation.

### Compliance coverage

- When the compliance suite executes tests under `tests/compliance/`, the
  Feature's compliance descriptor and tests SHALL be extended or supplemented
  so that violations on non-`.json` agent-output surfaces (e.g., persona
  examples, delivery-report prose citations) are detectable where practical.

## Out of scope

- This Feature does not format JSON produced by external libraries or third-party
  dependencies.
- This Feature does not reformat tooling-regenerated files (e.g.,
  `package-lock.json`, `tsconfig.tsbuildinfo`) or any file under `node_modules/`.
- This Feature does not add a pre-commit hook or a Cursor rule for enforcement;
  compliance tests under `tests/compliance/` are the primary automated gate.
- This Feature does not update the citation verifier implementation to perform
  abbreviated SHA-256 prefix comparison; that change is tracked as a companion
  downstream feature in the Deferrals section below.
- The bulk migration script is responsible for `.json` files only; separate
  migration or remediation steps for markdown-embedded JSON MAY be planned in
  the touch-set when one-shot cleanup of non-file surfaces is needed.

## Deferrals

- **Citation-verifier implementation.** The operator confirmed that the
  hash-abbreviation rule applies to SHA-256 `contentHash` fields in dual-anchor
  citations, not only to git commit hashes. The glossary normative alignment —
  updating the **Content hash** / `contentHash` entry in
  `lib/memory/handbook/glossary.md` to specify the abbreviated form as the
  canonical stored value — is in scope for this Feature per the acceptance
  criterion above. The companion deliverable — updating the citation verifier
  implementation to perform abbreviated SHA-256 prefix comparison rather than
  full 64-character digest comparison for `valid | moved | changed | gone`
  evaluation — is deferred to a separate downstream feature. The operator
  direction establishes option (a): the abbreviated form is the stored value in
  in-scope JSON artifacts; the downstream verifier feature SHALL update the
  verifier to perform prefix comparison against the recorded abbreviated hash.

## Superseded work

Artifacts under `.pan/work/172983_05-23-26/67055_0522_json-formatting/` —
including `plan.md`, `adr-draft.md`, `touch-set.json`, `implementation-report.md`,
`review.md`, and the delivery report at
`lib/memory/features/json-formatting/delivery-report.md` — were produced against
the pre-correction spec that limited enforcement to in-scope `.json` files and
deferred terminal/CLI and agent-chat formatting. These artifacts reflect a
narrowed scope that the operator has not ratified. They MUST be superseded and
replanned after this spec is ratified at the human gate. The plan stage MUST NOT
proceed against those prior artifacts.

## Open questions

- None.
