---
title: Persona Spec Format Reference
slug: persona-spec
stability: experimental
bootstrap-only: false
phase: 0b
owners: [persona-designer, librarian]
purpose: |
  The Anthropic Claude Agent SDK 16-field YAML reference, the Tesseract
  metadata extension map, and the Cursor projection contract
  (`.cursor/agents/<name>.md` compact projection plus standard/complex variants
  and `.cursor/rules/<name>.mdc` rule-layer projection where required). The canonical reference for `persona-designer` and the
  `author-persona` skill.
references:
  - kind: lines
    path: docs/PRD.md
    range: [460, 500]
    contentHash: 6fb6f2f1bdf21fd61c39ac2d312224ef18c077a039a5d65342f4faed62749dbd
    note: "PRD §6 — Subagent Persona Roster: header + 16-field example."
  - kind: lines
    path: docs/PRD.md
    range: [278, 278]
    contentHash: 4640a5ac6a986a4c33c18db710bf2fa9c9a491b01852d5fe5022232fc23c350d
    note: "PRD §4 glossary — Persona Spec Format definition."
  - kind: lines
    path: docs/PRD.md
    range: [462, 462]
    contentHash: de82bd2c4925e26ab40d565012f442b6784d0b5fe96b211f6cf9ed2a3390bfd1
    note: "PRD §6 — Anthropic Claude Agent SDK subagents reference URL."
related:
  - /src/memory/handbook/glossary.md
  - /src/memory/handbook/contract-style.md
  - /src/skills/author-persona/SKILL.md
external:
  - https://code.claude.com/docs/en/subagents
  - https://docs.cursor.com/context/rules
  - https://www.rfc-editor.org/info/bcp14
---

# Persona Spec Format

A persona spec is one Markdown file under `src/personas/<name>.md`. Frontmatter is
YAML conforming to the Anthropic Claude Agent SDK 16-field per-agent format
plus a Tesseract `metadata` extension map. Body prose is RFC-2119-disciplined
second-person.

The target integration contract is a compact Cursor projection under
`.cursor/agents/<name>.md` plus standard and complex variants from the same
source persona. Where rule-layer loading still requires it, a
`.cursor/rules/<name>.mdc` projection is also maintained. The persona file
remains canonical.

## 1 — File anatomy

```
src/personas/<name>.md
├── YAML frontmatter
│   ├── 16 Anthropic-spec fields
│   └── metadata: { Tesseract extensions }
└── Markdown body (second-person prose; sections enumerated below)
```

The YAML frontmatter MUST be the first content in the file, fenced by `---`
delimiters. The body MUST follow the closing fence.

## 2 — The 16 Anthropic frontmatter fields

The fields are defined by the Anthropic Claude Agent SDK subagent format. The
table records each field's domain and Tesseract default.

| # | Field | Type | Tesseract default | Notes |
|---|---|---|---|---|
| 1 | `name` | string | required | Lowercase-kebab-case, unique across `src/personas/`. |
| 2 | `description` | string | required | EARS one-liner; at most 50 words; shown to other agents at routing time. |
| 3 | `model` | enum | `inherit` | Pin only when `tesseract-risk-tier: high`. |
| 4 | `permissionMode` | enum | `default` | `read-only` for review-only personas. |
| 5 | `tools` | string[] | required | Minimal allowlist; most-restrictive Bash scope. |
| 6 | `disallowedTools` | string[] | required | MUST include `Bash(rm:*)`, `Bash(git push:*)`, `Bash(git commit:*)` for every persona except `supervisor`. |
| 7 | `mcpServers` | string[] | `[]` | List only servers the persona uses. |
| 8 | `maxTurns` | integer | `30` | Raise only with documented justification. |
| 9 | `skills` | string[] | `[]` | Each entry MUST resolve to an existing `src/skills/<name>/SKILL.md`. |
| 10 | `isolation` | enum | `worktree` | `none` only for read-only personas. |
| 11 | `memory` | enum | `project` | `private` for SMEs writing to `/src/memory/smes/<name>/`. |
| 12 | `effort` | enum | `medium` | `{low, medium, high}`. Maps to the model's reasoning budget. |
| 13 | `color` | enum | required | UX hint; pick from the unused palette in §6 below. |
| 14 | `hooks` | object | omit | Per-event scripts; omit when no value applies. |
| 15 | `initialPrompt` | string | omit | One-shot bootstrap prompt; omit when no value applies. |
| 16 | `background` | string | omit | Long-form persona backstory; omit when no value applies. |

`model`, `permissionMode`, `isolation`, `memory`, and `effort` carry closed
enums. Values outside the enum cause the parser to reject the file.

## 3 — The Tesseract `metadata` extension map

The `metadata` map is the open-extension surface. Required keys for every
persona:

```yaml
metadata:
  tesseract-risk-tier: medium                  # low | medium | high | any
  tesseract-pipeline-stages: [intake]          # array of stage IDs the persona is invoked in
  tesseract-bootstrap-only: false              # true if the persona retires after bootstrap
  tesseract-stability: experimental            # experimental | stable | deprecated
  tesseract-handbook-anchors:                  # files the persona reads at invocation
    - /src/memory/handbook/glossary.md
  tesseract-checklist:                         # named conformance checks the reviewer runs
    - sixteen-field-yaml-complete
    - description-uses-EARS
```

Optional keys:

- `tesseract-allowed-kinds-mvp` / `-m2` / `-m3plus` — milestone allowlists for
  contract-authoring personas. Encodes the M1 → M3 ratchet machine-readably.
- `tesseract-cost-ceiling-usd` — per-invocation cost cap. Defaults to `1.00`.
- `tesseract-base-persona` — the persona this one specializes (e.g.,
  `frontend-eng` declares `tesseract-base-persona: coder`).
- `tesseract-self-protection` — `true` blocks the persona and any other agent
  from modifying the file without explicit human ratification.

The full open list lives under §7 below. Layer 1 lint warns on unknown keys
not declared in §7; the warning escalates to error in M3.

## 4 — Body prose discipline

The body MUST contain three sections:

1. **When you are invoked.** Trigger conditions in EARS form.
2. **What you MUST produce, every invocation.** The artifacts the persona
   emits, with paths and shape. On every bounded task completion, the
   operator-visible response MUST also end with a `## Next operator steps`
   section per `/src/memory/handbook/operator-output-contract.md` (single-option
   or multi-option layout, explicit **What** / **How**, read-only labeling,
   and **When to choose** / **Impact** when multiple options exist).
3. **What you MUST NOT do.** Negative obligations and self-protection clauses.

Personas with conformance gates MUST add a fourth section, **Conformance
gates**. Personas with non-trivial failure modes MUST add a fifth section,
**Failure-handling**.

The body uses second-person voice ("You author..."). RFC 2119 obligation
keywords appear on every normative statement. Style discipline is enumerated
in `/src/memory/handbook/contract-style.md` Layer 1.

## 5 — Cursor integration projections

The primary Cursor analogue of a persona spec is a compact projection family
under `.cursor/agents/`, projected from `src/personas/<name>.md`.

When rule-layer context loading requires a rule file, maintain a secondary
projection at `.cursor/rules/<name>.mdc`.

### 5.1 — `.cursor/agents` compact projections (primary)

Rules:

- `src/personas/<name>.md` MUST remain canonical for authoring and review.
- `.cursor/agents/<name>.md` MUST remain a backward-compatible standard alias
  for the standard tier. It SHOULD use `model: auto` unless a human ratifies a
  different default model for that persona.
- `.cursor/agents/<name>-standard.md` MUST remain the default bounded-work
  variant. It SHOULD use Cursor `auto` when that is the best economical default,
  but the suffix does not mandate a specific model.
- `.cursor/agents/<name>-complex.md` MUST preserve the prior fixed model for
  reasoning-heavy work unless a human ratifies a model-policy change.
- Cursor projection bodies SHOULD point to `src/personas/<name>.md` instead of
  duplicating persona prose, PRD references, or handbook excerpts.
- Until emitter tooling is wired in this repo, maintainers MAY update
  projections manually, but they MUST preserve canonical persona semantics and
  tier metadata.

Subagent tier selection policy lives in
`/src/memory/handbook/subagent-model-tiers.md`. Standalone catch-all agents such
as `.cursor/agents/general-purpose.md` are allowed when they are explicitly
documented as non-persona projections and route to canonical personas whenever
one owns the work.

### 5.2 — `.mdc` rule-layer projection (where required)

The `.mdc` projection uses Cursor's per-rule format (`description`, `globs`,
`alwaysApply`) and is retained only where rule-layer loading still requires it.

The projection shape is exactly five non-blank lines plus the body include
line:

```
---
description: <copied from persona frontmatter, verbatim>
globs: [<glob patterns the rule applies to>]
alwaysApply: <true | false>
---

@src/personas/<name>.md
```

Projection rules:

- `description` MUST equal the persona's `description` field exactly. The
  parser refuses any divergence.
- `globs` MUST be a YAML array of strings. The default for an authoring
  persona is the path glob the persona writes to.
- `alwaysApply: true` is reserved for `00-*.mdc` priority rules.
  Personas use `alwaysApply: false`.
- The body MUST be a single `@src/personas/<name>.md` import line. Cursor expands
  the import at activation time.

The emitter target (`@tesseract/persona`) SHOULD remain round-trip-stable:
parse-then-emit SHOULD produce a byte-identical `.mdc` file once tooling is
wired. Until then, this projection remains hand-checked.

## 6 — Color palette

The `color` field is a UX hint shown in pipeline timelines. Pick from the
unused palette below. Reserve `red` for `ombudsperson`-class personas to
preserve operator legibility.

| Color | Reserved for | Status |
|---|---|---|
| `violet` | `persona-designer` | used |
| `amber` | `contract-writer` | used |
| `blue` | review-class personas (`reviewer`, `appsec`) | guideline |
| `green` | implementation-class personas (`coder`, `frontend-eng`) | guideline |
| `cyan` | planning-class personas (`tech-lead`, `intake-analyst`) | guideline |
| `purple` | pm, backlog, and pipeline orchestration (`pm`, `groomer`, `supervisor`) | guideline |
| `teal` | librarian-class | guideline |
| `slate` | tech-writer-class | guideline |
| `orange` | scout-class | guideline |
| `red` | ombudsperson, watchdog | reserved |

When the palette runs out, append a row here; do not improvise.

## 7 — Recognized `metadata.tesseract-*` keys

The keys below are recognized by `@tesseract/persona`'s parser (Phase 3 step 5
onward). Keys not in this list raise a Layer 1 warning; M3 promotes the
warning to an error.

- `tesseract-risk-tier` — required.
- `tesseract-pipeline-stages` — required.
- `tesseract-bootstrap-only` — required.
- `tesseract-stability` — required.
- `tesseract-handbook-anchors` — required when the persona reads the handbook.
- `tesseract-checklist` — required. Every persona checklist SHOULD include
  `next-operator-steps-on-completion` unless a ratified exception is recorded.
- `tesseract-allowed-kinds-mvp` / `-m2` / `-m3plus` — milestone allowlists.
- `tesseract-cost-ceiling-usd` — per-invocation cost cap.
- `tesseract-base-persona` — specialization parent.
- `tesseract-self-protection` — boolean. `true` requires human ratification to
  modify.
- `tesseract-deprecated-by` — string. Names the superseding persona.

## 8 — Worked example

The example below is a minimal, lintable persona. It uses every required
field. Use it as a copy-paste starting point.

```yaml
---
name: example-persona
description: When the human runs `tess persona example`, the example-persona SHALL emit a stub artifact under `/src/work/<day>/<id>/example.md` and stage it for review.
model: inherit
permissionMode: default
tools:
  - Read
  - Grep
  - Glob
  - Write
  - "Bash(git diff:*)"
  - "Bash(git status:*)"
disallowedTools:
  - "Bash(rm:*)"
  - "Bash(git push:*)"
  - "Bash(git commit:*)"
mcpServers: []
maxTurns: 30
skills: []
isolation: worktree
memory: project
effort: medium
color: slate
metadata:
  tesseract-risk-tier: low
  tesseract-pipeline-stages: [example]
  tesseract-bootstrap-only: false
  tesseract-stability: experimental
  tesseract-handbook-anchors:
    - /src/memory/handbook/glossary.md
  tesseract-checklist:
    - sixteen-field-yaml-complete
    - description-uses-EARS
references:
  - kind: lines
    path: /src/memory/handbook/persona-spec.md
    range: [1, 1]
    contentHash: cb3f91d54eee30e53e35b2b99905f70f169ed549fd78909d3dac2defc9ed8d3b
    note: "Persona Spec Format reference."
---

# Example Persona

You author a stub artifact whenever the human invokes the example pipeline.

## When you are invoked

1. **Manual.** When a human runs `tess persona example`, you produce one stub
   artifact under `/src/work/<day>/<id>/example.md`.

## What you MUST produce, every invocation

You MUST emit a one-paragraph Markdown stub at `/src/work/<day>/<id>/example.md` that
cites this Persona Spec Format reference and stages the file for human review.

## What you MUST NOT do

You MUST NOT push to `main`. You MUST NOT modify your own persona file.
```

## 9 — Round-trip verification

The Phase 0c verification gate uses `persona-designer` to author
`src/personas/tech-writer.md` against this spec. Human reviews:

1. The 16 required fields populate.
2. The `description` is EARS and at most 50 words.
3. The body's three required sections are present.
4. Layer 1 lint passes by hand-checklist.
5. The `.cursor/agents/tech-writer.md`,
   `.cursor/agents/tech-writer-standard.md`, and
   `.cursor/agents/tech-writer-complex.md` projections match canonical persona
   semantics without duplicating the canonical body, and any required
   `.cursor/rules/tech-writer.mdc` projection is exactly five non-blank lines
   plus the body include.

A clean round-trip discharges BR1 (persona format drift) before Phase 1
multiplies the error.

## 10 — Stability

This file is the Phase 0b handbook seed. The 16-field structure tracks the
upstream Anthropic Claude Agent SDK; field-level drift is reconciled here when
the upstream spec changes. Promotion to `stability: stable` occurs after
Phase 5 dogfood validates the round-trip across the full MVP roster.
