# Operator section
- 👀 **In this file:** Persona Spec Format Reference
- ⚖️ **Why it matters:** Quick orientation for Persona Spec Format Reference before agents load the full contract.
- 🧭 **See also:**
  - /lib/memory/handbook/glossary.md
  - /lib/memory/handbook/contract-style.md
  - /lib/memory/handbook/persona-contracts.md
---
pancreator-section-index:
  format: operator-agent-v1
  agent_section_start_line: 8
title: Persona Spec Format Reference
slug: persona-spec
stability: experimental
bootstrap-only: false
phase: 0b
owners: [persona-designer, librarian]
purpose: |
  The Anthropic Claude Agent SDK 16-field YAML reference, the Pancreator
  metadata extension map, and the Cursor projection contract
  (`.cursor/agents/<name>.md` compact projection plus standard/complex variants
  and `.cursor/rules/<name>.mdc` rule-layer projection where required). The canonical reference for `persona-designer` and the
  `author-persona` skill.
related:
  - /lib/memory/handbook/glossary.md
  - /lib/memory/handbook/contract-style.md
  - /lib/memory/handbook/persona-contracts.md
  - /lib/memory/handbook/output-manifest-contract.md
  - /lib/memory/handbook/agent-document-registry.md
  - /lib/personas/skills/author-persona/SKILL.md
external:
  - https://code.claude.com/docs/en/subagents
  - https://docs.cursor.com/context/rules
  - https://www.rfc-editor.org/info/bcp14
---

# Persona Spec Format

A persona spec is one Markdown file under `lib/personas/<name>.md`. Frontmatter is
YAML conforming to the Anthropic Claude Agent SDK 16-field per-agent format
plus a Pancreator `metadata` extension map. Body prose is RFC-2119-disciplined
second-person.

The target integration contract is a compact Cursor projection under
`.cursor/agents/<name>.md` plus standard and complex variants from the same
source persona. Where rule-layer loading still requires it, a
`.cursor/rules/<name>.mdc` projection is also maintained. The persona file
remains canonical.

## 1 — File anatomy

```
lib/personas/<name>.md
├── YAML frontmatter
│   ├── 16 Anthropic-spec fields
│   └── metadata: { Pancreator extensions }
└── Markdown body (second-person prose; sections enumerated below)
```

The YAML frontmatter MUST be the first content in the file, fenced by `---`
delimiters. The body MUST follow the closing fence.

## 2 — The 16 Anthropic frontmatter fields

The fields are defined by the Anthropic Claude Agent SDK subagent format. The
table records each field's domain and Pancreator default.

| #   | Field             | Type     | Pancreator default | Notes                                                                                                      |
| --- | ----------------- | -------- | ------------------ | ---------------------------------------------------------------------------------------------------------- |
| 1   | `name`            | string   | required           | Lowercase-kebab-case, unique across `lib/personas/`.                                                       |
| 2   | `description`     | string   | required           | EARS one-liner; at most 50 words; shown to other agents at routing time.                                   |
| 3   | `model`           | enum     | `inherit`          | Pin only when `pancreator-risk-tier: high`.                                                                |
| 4   | `permissionMode`  | enum     | `default`          | `read-only` for review-only personas.                                                                      |
| 5   | `tools`           | string[] | required           | Minimal allowlist; most-restrictive Bash scope.                                                            |
| 6   | `disallowedTools` | string[] | required           | MUST include `Bash(rm:*)`, `Bash(git push:*)`, `Bash(git commit:*)` for every persona except `supervisor`. |
| 7   | `mcpServers`      | string[] | `[]`               | List only servers the persona uses.                                                                        |
| 8   | `maxTurns`        | integer  | `30`               | Raise only with documented justification.                                                                  |
| 9   | `skills`          | string[] | `[]`               | Each entry MUST resolve to an existing `lib/personas/skills/<name>/SKILL.md`.                              |
| 10  | `isolation`       | enum     | `worktree`         | `none` only for read-only personas.                                                                        |
| 11  | `memory`          | enum     | `project`          | `private` for SMEs writing to `/lib/memory/smes/<name>/`.                                                  |
| 12  | `effort`          | enum     | `medium`           | `{low, medium, high}`. Maps to the model's reasoning budget.                                               |
| 13  | `color`           | enum     | required           | UX hint; pick from the unused palette in §6 below.                                                         |
| 14  | `hooks`           | object   | omit               | Per-event scripts; omit when no value applies.                                                             |
| 15  | `initialPrompt`   | string   | omit               | One-shot bootstrap prompt; omit when no value applies.                                                     |
| 16  | `background`      | string   | omit               | Long-form persona backstory; omit when no value applies.                                                   |

`model`, `permissionMode`, `isolation`, `memory`, and `effort` carry closed
enums. Values outside the enum cause the parser to reject the file.

## 3 — The Pancreator `metadata` extension map

The `metadata` map is the open-extension surface. Required keys for every
persona:

```yaml
metadata:
  pancreator-risk-tier: medium # low | medium | high | any
  pancreator-pipeline-stages: [intake] # array of stage IDs the persona is invoked in
  pancreator-bootstrap-only: false # true if the persona retires after bootstrap
  pancreator-stability: experimental # experimental | stable | deprecated
  pancreator-contract-key: PERSONA.INTAKE_ANALYST
  pancreator-required-docs: # DOC.* / PIPE.* keys resolved through DOC.REGISTRY
    - DOC.AGENTS
    - DOC.REGISTRY
    - DOC.PERSONA_CONTRACTS
    - DOC.OUTPUT_MANIFEST
    - DOC.GLOSSARY
    - DOC.CONTRACT_STYLE
  pancreator-output-manifest: required # required | forbidden
```

Optional keys:

- `pancreator-allowed-kinds-mvp` / `-m2` / `-m3plus` — milestone allowlists for
  contract-authoring personas. Encodes the M1 → M3 ratchet machine-readably.
- `pancreator-cost-ceiling-usd` — per-invocation cost cap. Defaults to `1.00`.
- `pancreator-base-persona` — the persona this one specializes (e.g.,
  `frontend-eng` declares `pancreator-base-persona: coder`).
- `pancreator-self-protection` — `true` blocks the persona and any other agent
  from modifying the file without explicit human ratification.

The full open list lives under §7 below. Layer 1 lint warns on unknown keys
not declared in §7; the warning escalates to error in M3.

## 4 — Body prose discipline

The body MUST contain four sections:

1. **Static execution contract.** Required context, responsibilities, definition
   of done, output manifest, and gate validator. This section is mandatory and
   MUST NOT ask the agent to invent a new per-run contract.
2. **When you are invoked.** Trigger conditions in EARS form.
3. **What you MUST produce, every invocation.** The artifacts the persona
   emits, with paths and shape. On every bounded task completion, the
   operator-visible response MUST also include or reference the `## Output
manifest` required by `/lib/memory/handbook/output-manifest-contract.md`.
   Operator-facing responses MUST also end with a `## Next operator steps`
   section per `/lib/memory/handbook/operator-output-contract.md` unless the
   persona contract explicitly forbids operator next steps. Runnable `pan`
   commands in **How** MUST use `pnpm -w exec pan …` per
   `/lib/memory/handbook/pancreator-config.md`. Shell **How** clauses MUST use
   fully formed copy-paste command blocks per
   `/lib/memory/handbook/operator-output-contract.md` §3.4.
4. **What you MUST NOT do.** Negative obligations and self-protection clauses.

Persona bodies MUST follow `/lib/memory/handbook/persona-contracts.md` and
`/lib/memory/handbook/output-manifest-contract.md`. Required docs MUST be named
as global keys in `metadata.pancreator-required-docs`; do not add
`pancreator-handbook-anchors` to new or edited personas.

Personas with conformance gates MUST add a fourth section, **Conformance
gates**. Personas with non-trivial failure modes MUST add a fifth section,
**Failure-handling**.

The body uses second-person voice ("You author..."). RFC 2119 obligation
keywords appear on every normative statement. Style discipline is enumerated
in `/lib/memory/handbook/contract-style.md` Layer 1.

## 5 — Cursor integration projections

Cursor runtime files under `.cursor/` are **local-only** (gitignored). They are
materialized by `pnpm -w exec pan cursor-sync` or `pan init --apply` from tracked
sources under `lib/personas/` (agents and rules).

The primary Cursor analogue of a persona spec is a compact projection family
under `.cursor/agents/`, projected from `lib/personas/<name>.md`.

When rule-layer context loading requires a rule file, author the tool-agnostic
spec at `lib/personas/rules/<name>.yaml` and emit it to `.cursor/rules/<name>.mdc`
via `cursor-sync`.

### 5.1 — `.cursor/agents` compact projections (primary)

Rules:

- `lib/personas/<name>.md` MUST remain canonical for authoring and review.
- `.cursor/agents/<name>.md` MUST be the sole Cursor agent projection for
  each persona. It SHOULD encode the economical default model policy previously
  carried by retired `-standard` variants unless a human ratifies a change.
- Cursor projection bodies SHOULD point to `lib/personas/<name>.md` instead of
  duplicating persona prose, PRD references, or handbook excerpts.
- Maintainers MUST regenerate agent projections with `pan cursor-sync` after
  persona spec changes; they MUST NOT edit `.cursor/agents/` in git (it is not
  tracked).

Model and context escalation guidance lives in
`/lib/memory/handbook/context-economy.md`. Standalone catch-all agents such
as `.cursor/agents/general-purpose.md` are allowed when they are explicitly
documented as non-persona projections and route to canonical personas whenever
one owns the work.

### 5.2 — Persona rule specs and Cursor `.mdc` projection

Author tool-agnostic persona rule specs at `lib/personas/rules/<name>.yaml`.
`pan cursor-sync` emits Cursor `.cursor/rules/<name>.mdc` from each spec.

Required YAML fields:

```yaml
persona: <name> # MUST match lib/personas/<name>.md and the file basename
description: <string> # activation description for the rule layer
globs: # non-empty string array of path globs
  - <glob>
alwaysApply: false # true reserved for priority rules only
```

The Cursor `.mdc` projection uses Cursor's per-rule format (`description`, `globs`,
`alwaysApply`) and is retained only where rule-layer loading still requires it.

The projection shape is exactly five non-blank lines plus the body include
line:

```
---
description: <copied from persona frontmatter, verbatim>
globs: [<glob patterns the rule applies to>]
alwaysApply: <true | false>
---

@lib/personas/<name>.md
```

Projection rules:

- `description` MUST equal the persona's `description` field exactly. The
  parser refuses any divergence.
- `globs` MUST be a YAML array of strings. The default for an authoring
  persona is the path glob the persona writes to.
- `alwaysApply: true` is reserved for `00-*.mdc` priority rules.
  Personas use `alwaysApply: false`.
- The body MUST be a single `@lib/personas/<name>.md` import line. Cursor expands
  the import at activation time.

The emitter target (`@pancreator/persona`) SHOULD remain round-trip-stable:
parse-then-emit SHOULD produce a byte-identical `.mdc` file once tooling is
wired. Until then, this projection remains hand-checked.

## 6 — Color palette

The `color` field is a UX hint shown in pipeline timelines. Pick from the
unused palette below. Reserve `red` for `ombudsperson`-class personas to
preserve operator legibility.

| Color    | Reserved for                                                            | Status    |
| -------- | ----------------------------------------------------------------------- | --------- |
| `violet` | `persona-designer`                                                      | used      |
| `amber`  | `contract-writer`                                                       | used      |
| `blue`   | review-class personas (`reviewer`, `appsec`)                            | guideline |
| `green`  | implementation-class personas (`coder`, `frontend-eng`)                 | guideline |
| `cyan`   | planning-class personas (`tech-lead`, `intake-analyst`)                 | guideline |
| `purple` | pm, backlog, and pipeline orchestration (`pm`, `groomer`, `supervisor`) | guideline |
| `teal`   | librarian-class                                                         | guideline |
| `slate`  | tech-writer-class                                                       | guideline |
| `orange` | scout-class                                                             | guideline |
| `red`    | ombudsperson, watchdog                                                  | reserved  |

When the palette runs out, append a row here; do not improvise.

## 7 — Recognized `metadata.pancreator-*` keys

The keys below are recognized by `@pancreator/persona`'s parser (Phase 3 step 5
onward). Keys not in this list raise a Layer 1 warning; M3 promotes the
warning to an error.

- `pancreator-risk-tier` — required.
- `pancreator-pipeline-stages` — required.
- `pancreator-bootstrap-only` — required.
- `pancreator-stability` — required.
- `pancreator-contract-key` — required.
- `pancreator-required-docs` — required for every persona; names the binding `DOC.*`, `PIPE.*`, and `PERSONA.*` keys the persona MUST resolve and apply.
- `pancreator-output-manifest` — required.
- `pancreator-allowed-kinds-mvp` / `-m2` / `-m3plus` — milestone allowlists.
- `pancreator-cost-ceiling-usd` — per-invocation cost cap.
- `pancreator-base-persona` — specialization parent.
- `pancreator-self-protection` — boolean. `true` requires human ratification to
  modify.
- `pancreator-deprecated-by` — string. Names the superseding persona.

## 8 — Worked example

The example below is a minimal, lintable persona. It uses every required
field. Use it as a copy-paste starting point.

```yaml
---
name: example-persona
description: When the human runs `pan persona example`, the example-persona SHALL emit a stub artifact under `/.pan/work/<day>/<id>/example.md` and stage it for review.
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
  pancreator-risk-tier: low
  pancreator-pipeline-stages: [example]
  pancreator-bootstrap-only: false
  pancreator-stability: experimental
  pancreator-contract-key: PERSONA.EXAMPLE
  pancreator-required-docs:
    - DOC.AGENTS
    - DOC.REGISTRY
    - DOC.OUTPUT_MANIFEST
    - DOC.GLOSSARY
  pancreator-output-manifest: required
---

# Example Persona

You author a stub artifact whenever the human invokes the example pipeline.

## When you are invoked

1. **Manual.** When a human runs `pan persona example`, you produce one stub
   artifact under `/.pan/work/<day>/<id>/example.md`.

## What you MUST produce, every invocation

You MUST emit a one-paragraph Markdown stub at `/.pan/work/<day>/<id>/example.md` that
cites this Persona Spec Format reference and stages the file for human review.

## What you MUST NOT do

You MUST NOT push to `main`. You MUST NOT modify your own persona file.
```

## 9 — Round-trip verification

The Phase 0c verification gate uses `persona-designer` to author
`lib/personas/tech-writer.md` against this spec. Human reviews:

1. The 16 required fields populate.
2. The `description` is EARS and at most 50 words.
3. The body's three required sections are present.
4. Layer 1 lint passes by hand-checklist.
5. The `.cursor/agents/tech-writer.md`,
   `.cursor/agents/tech-writer.md` projection matches canonical persona
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
