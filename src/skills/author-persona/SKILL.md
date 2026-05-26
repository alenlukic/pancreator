---
name: author-persona
description: Authors a Tesseract subagent persona spec to the Anthropic Claude Agent SDK 16-field YAML frontmatter spec, emits the matching Cursor `.cursor/rules/<name>.mdc` shim, and self-checks against the Layer 1 lint discipline before submission.
license: Apache-2.0
metadata:
  tesseract-stability: experimental
  tesseract-bootstrap-only: false
  tesseract-pipeline-stages: [bootstrap-phase-1, sme-spawn, ad-hoc-persona-new]
  tesseract-risk-tier: medium
  tesseract-required-handbook:
    - /src/memory/handbook/persona-spec.md
    - /src/memory/handbook/glossary.md
    - /src/memory/handbook/contract-style.md
  tesseract-emits:
    - src/personas/<name>.md
    - .cursor/rules/<name>.mdc
references:
  - kind: lines
    path: docs/PRD.md
    range: [793, 950]
    contentHash: 2ce8e5c
    note: "PRD §6 — Subagent Persona Roster + reviewer.md exemplar + ensemble pattern"
  - kind: lines
    path: docs/PRD.md
    range: [302, 305]
    contentHash: 2ce8e5c
    note: "PRD §4 glossary — Persona Spec Format definition"
---

# Skill — `author-persona`

A reusable 7-step procedure for authoring one Tesseract subagent persona spec. The
canonical caller is `src/personas/persona-designer.md`; the Librarian MAY invoke it
directly when proposing an SME draft (M4+).

## Prerequisites

- `/src/memory/handbook/persona-spec.md` SHALL exist and define the Anthropic Claude
  Agent SDK 16-field YAML reference plus the Cursor `.mdc` shim recipe.
- `/src/memory/handbook/glossary.md` SHALL exist; the persona's `description:` and body
  prose draw every domain noun from this file or a code-symbol citation.
- The proposed persona's scope SHALL be captured in an inbox item or in the
  `docs/BOOTSTRAP.md` Phase 1 roster.

## The 7-step authoring loop

Execute these steps in order, once per persona. Do not skip ahead.

### Step 1 — Resolve scope and pick a base persona, if any

When the proposed persona is a specialization (e.g., `frontend-eng` is a `coder`
specialization per PRD §6 M2), you MUST identify the base persona and inherit its
`tools`, `disallowedTools`, and `mcpServers` defaults unless the inbox ask declares
an explicit override.

If the proposed scope overlaps an existing persona's `tesseract-pipeline-stages` by
more than 50%, halt and open an inbox item proposing either a merge or an explicit
scope-split ADR.

### Step 2 — Load the 16-field reference and the glossary

Load `/src/memory/handbook/persona-spec.md` into context. The 16 fields are: `name`,
`description`, `model`, `permissionMode`, `tools`, `disallowedTools`, `mcpServers`,
`maxTurns`, `skills`, `isolation`, `memory`, `effort`, `color`, `hooks`,
`initialPrompt`, `background`.

Load `/src/memory/handbook/glossary.md` so domain nouns resolve at lint time without a
re-read.

### Step 3 — Fill the 16 frontmatter fields

For each field, apply the rule:

- `name` MUST be lowercase-kebab-case and unique across `src/personas/`.
- `description` MUST follow EARS — typically `When <trigger>, the <persona> SHALL
  <response>` — and MUST be at most 50 words. This field is shown to other agents at
  routing time per Anthropic spec; treat it as the persona's elevator pitch.
- `model` defaults to `inherit` unless the persona's `tesseract-risk-tier` is
  `high`, in which case the operator pins a strong model explicitly.
- `permissionMode` defaults to `default`; `read-only` for review-only personas.
- `tools` MUST be the minimal allowlist required for the persona's job. Read,
  write, and bash tool patterns SHALL use the most-restrictive scope (e.g.,
  `"Bash(git diff:*)"` not `"Bash(*)"`).
- `disallowedTools` MUST explicitly forbid `"Bash(rm:*)"`, `"Bash(git push:*)"`, and
  `"Bash(git commit:*)"` for every persona except `supervisor`.
- `mcpServers` MUST list only servers the persona actually uses; drop the rest.
- `maxTurns` defaults to 30; raise only with documented justification.
- `skills` MUST reference skill files that exist OR are scheduled in the same phase.
  When a skill is missing, declare the dependency in the inbox handoff and refuse
  to emit the persona until the skill lands.
- `isolation` defaults to `worktree`; `none` only for read-only personas.
- `memory` defaults to `project`; `private` for SMEs whose notes belong under
  `/src/memory/smes/<name>/`.
- `effort` ∈ `{low, medium, high}`; corresponds to the model's reasoning budget.
- `color` is a UX hint only; pick from the unused palette in `/src/memory/handbook/persona-colors.md`.
- `hooks`, `initialPrompt`, `background` MAY be omitted when no value applies.

### Step 4 — Populate the `metadata` map with Tesseract extensions

Required extensions:

- `tesseract-risk-tier` ∈ `{low, medium, high, any}` — drives default contract
  bundle per PRD §7.
- `tesseract-pipeline-stages` — array of stage IDs the persona is invoked in.
- `tesseract-bootstrap-only` — boolean; `true` means the persona retires after the
  bootstrap; `false` (default) means it persists.
- `tesseract-stability` ∈ `{experimental, stable, deprecated}`; new personas land
  as `experimental` and promote on green dogfood usage for 4 consecutive weeks.
- `tesseract-handbook-anchors` — array of paths the persona reads at invocation.
  Every persona SHOULD anchor `/src/memory/handbook/operator-output-contract.md`
  when the persona emits operator-visible chat output.
- `tesseract-checklist` — array of named conformance checks the reviewer step runs.
  Every checklist MUST include `next-operator-steps-on-completion`.

### Step 5 — Author the body prose

Write the body in second-person ("You author...") per PRD §6 convention. Apply
PRD §4.6 Layer 1 lint to every normative statement:

- RFC 2119 obligation keywords on every normative statement (MUST, SHOULD, MAY, SHALL).
- One obligation per clause; split compound statements.
- EARS templates for every normative statement.
- Active voice; present tense; numeric claims quantified with units.
- No weasel words from the §4.6 ban list.
- Every domain noun resolves to `/src/memory/handbook/glossary.md`.
- Median sentence length ≤ 30 words; p95 ≤ 40 words.

The body MUST contain three sections: "When you are invoked", "What you MUST
produce", and "What you MUST NOT do". The "What you MUST produce" section MUST
require a `## Next operator steps` block on bounded task completion per
`/src/memory/handbook/operator-output-contract.md`. Personas with conformance
gates MUST add a fourth section, "Conformance gates"; personas with non-trivial
failure modes MUST add a fifth, "Failure-handling".

### Step 6 — Emit the Cursor `.mdc` shim

Write `.cursor/rules/<name>.mdc` per the recipe in `/src/memory/handbook/persona-spec.md`.
The shim is exactly 5 lines: a `description:` field copied from the persona,
`globs:` and `alwaysApply:` per the recipe, then a single body line that is an
`@`-include of the canonical persona file (`@src/personas/<name>.md`).

The shim MUST round-trip through the `@tesseract/persona` parser identically once
that package lands (Phase 3 step 5).

### Step 7 — Self-check, then submit

Before handing off, the persona-designer MUST:

1. Run the `tesseract-checklist` items as a hand-checklist; fix violations.
2. Verify every dual-anchor citation resolves against the cited file's current
   content hash. When a hash mismatches, refresh the citation; when a path is gone,
   open an inbox item rather than guess the new location.
3. Stage the two emitted files; do not commit.
4. Open an inbox item to the human (Phases 0–1) or to `reviewer` (M1+) summarizing
   the persona's scope, the skills it depends on, and any open questions.

## Stop conditions

- Halt when 3 consecutive self-correction rounds fail to resolve a Layer 1 lint
  violation; escalate via inbox per the R29 friction-circuit-breaker pattern.
- Halt when a required handbook file is missing or stale; do not guess its
  contents.
- Halt when the proposed persona name collides with an existing persona; ask the
  caller to disambiguate.
