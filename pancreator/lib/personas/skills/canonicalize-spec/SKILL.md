---
name: canonicalize-spec
description: Converts one informal Markdown spec posted under `lib/inbox/in/` into one canonical Engineering Spec at `/.pan/work/<day>/<task-id>/spec.md`. Scaffolds the Feature folder, parses the informal source, runs an inbox-borne clarifying-question dialogue at most 5 rounds, folds each human reply into the working draft, then stages the spec for the `human_approval` gate.
license: Apache-2.0
metadata:
  pancreator-stability: experimental
  pancreator-bootstrap-only: false
  pancreator-pipeline-stages: [intake]
  pancreator-risk-tier: medium
  pancreator-required-handbook:
    - /lib/memory/handbook/glossary.md
    - /lib/memory/handbook/contract-style.md
  pancreator-emits:
    - /.pan/work/<day>/<task-id>/spec.md
    - /lib/memory/features/<category>/<id>/index.json
    - lib/inbox/threads/<thread-id>/<round>.md
    - lib/memory/active/current.md
references:
  - kind: lines
    path: .docs/PRD.md
    range: [505, 505]
    contentHash: 2eb6aa4
    note: "PRD §6 — MVP roster: intake-analyst runs the spec-canonicalization sub-pipeline, ingests informal markdown, conducts a clarifying-question dialogue through the inbox at most N rounds, and emits a canonical Engineering Spec."
  - kind: lines
    path: .docs/PRD.md
    range: [113, 121]
    contentHash: 2eb6aa4
    note: "PRD §3.5 US-1 — Deliver the backend for feature A: the user story whose intake step this skill owns, with the coordinating agent clearing up ambiguities through the inbox."
  - kind: lines
    path: .docs/PRD.md
    range: [641, 648]
    contentHash: 2eb6aa4
    note: "PRD §7 — feature-delivery `intake` stage YAML declaring inputs `[inbox_message]`, outputs `[/.pan/work/<day>/<task-id>/spec.md]`, `loop.max_rounds: 5`, and `gate: human_approval`."
  - kind: lines
    path: .docs/PRD.md
    range: [921, 931]
    contentHash: 2eb6aa4
    note: "PRD §8 — Memory architecture: per-Feature folder layout where the canonical spec is `spec.md` per Spec Kit v0.8 alignment."
  - kind: lines
    path: AGENTS.md
    range: [212, 212]
    contentHash: b953d77
    note: "AGENTS §6.8 — Active Feature promotion at intake; closure clears on archive."
---

# Skill — `canonicalize-spec`

A reusable 6-step procedure that converts one informal Markdown spec into
one canonical Engineering Spec the rest of the `feature-delivery` pipeline
can act on. The canonical caller is `lib/personas/intake-analyst.md`. The
clarifying-question loop is capped at 5 rounds per PRD §7 line 647 and the
output MUST satisfy the Spec Kit v0.8 layout cited in
`/lib/memory/handbook/glossary.md` §5.

## Prerequisites

- `lib/inbox/in/` SHALL contain exactly one Markdown file the human posted to
  trigger the `intake` stage; an empty queue MUST halt and route an inbox
  item per the Failure-handling section.
- `/lib/memory/features/` SHALL exist; the skill scaffolds
  `/lib/memory/features/<category>/<id>/` on first invocation.
- `/lib/memory/handbook/glossary.md` SHALL exist; every domain noun in the
  canonical spec resolves through this file.
- `/lib/memory/handbook/contract-style.md` SHALL exist; the spec body satisfies
  Layer 1 lint per PRD §4.6.

## The 6-step canonicalization loop

Execute these steps in order, once per Feature.

### Step 1 — Allocate a Feature id and scaffold the folder

Pick `<id>` as a lowercase-kebab-case slug at most 6 words drawn from the
informal spec's first heading. When the slug already exists under
`/lib/memory/features/`, you MUST append a numeric suffix (`-v2`, `-v3`, ...)
rather than overwrite.

Scaffold the directory layout per PRD §8 lines 921 through 931:

```
/lib/memory/features/<category>/<id>/
  index.json          # empty placeholder; librarian populates at post_run
  spec.md             # this skill's canonical output
```

You MUST NOT scaffold sibling files (`plan.md`, `tasks.md`,
`ux-spec.md`, `delivery-report.md`, `contracts/`); each downstream stage
emits its own artifact at the path declared in PRD §7 lines 641 through
696.

When `pan feature new` or `pan run feature-delivery` has already assigned
a task id, you MUST read `.pan/work/<day>/<task-id>/state.json` and use
`source.inboxPath` as the canonical inbox source. When no run state exists
yet, you MUST derive the path from the informal spec file under
`lib/inbox/in/`.

Immediately after `<id>` and the inbox source path are known, you MUST
update `lib/memory/active/current.md` § **Active Feature** before Step 2.
You MUST set exactly one bullet to `- \`{inboxPath}\`` using the path from
`state.source.inboxPath` or the informal source file. You MUST edit only
the Active Feature section; you MUST NOT rewrite shipped-feature rows or
operator-note stamps.

### Step 2 — Parse the informal source and classify ambiguities

Read the informal spec at `lib/inbox/in/<file>.md`. For each ambiguity, record
a row in the open-question list under one of the four classes below.

- **`scope`.** What the Feature does and does not do.
- **`acceptance`.** How the human will know the Feature is done.
- **`constraints`.** Performance, security, accessibility, or compatibility
  bounds.
- **`prior-art`.** Existing personas, ADRs, RFCs, or third-party APIs the
  Feature MUST integrate with.

Each open question MUST cite the source paragraph in the informal spec via
dual-anchor citation per PRD §8. A question without a dual-anchor citation
fails the gate.

### Step 3 — Emit one clarifying round per cycle

For each round in the loop, you MUST append exactly one Markdown file under
`lib/inbox/threads/<thread-id>/<round-NN>.md`. The file MUST list at most 7
questions; one question per bullet. The thread MUST quote the informal
spec's source paragraph the question targets.

The loop MUST terminate within 5 rounds per `loop.max_rounds: 5` declared
at PRD §7 line 647. When round 5 closes with the spec still ambiguous,
you MUST escalate per the Failure-handling section.

### Step 4 — Fold every human reply into the working draft

When the human replies in the same inbox thread, you MUST:

1. Read the reply, parse the answers, and update the working draft.
2. Resolve every open question the reply closes; mark each closed
   question with `[resolved-round-NN]`.
3. Regenerate the open-question list against the new draft; questions the
   reply opened MUST appear in the list.
4. Append the next round's clarifying file under
   `lib/inbox/threads/<thread-id>/<round-NN>.md`.

You MUST NOT invent answers the human did not provide; an unanswered
question SHALL persist into the next round.

### Step 5 — Author the canonical Engineering Spec

When the open-question list is empty, you MUST overwrite
`/.pan/work/<day>/<task-id>/spec.md` with the four `##` sections below in this
order. Missing sections fail the gate.

1. **Spec.** One paragraph at most 120 words stating the Feature's intent,
   the user story it serves, and the user-visible outcome. Every external
   claim MUST carry a dual-anchor citation per PRD §8.
2. **Acceptance criteria.** A bulleted list. Each criterion MUST follow an
   EARS template (default: `When <trigger>, the <subject> SHALL <response>`;
   alternates per `/lib/memory/handbook/contract-style.md` Rule 1.5) and MUST be
   machine-checkable.
3. **Out of scope.** A bulleted list of capabilities the Feature
   explicitly does not deliver. Each bullet MUST cite the informal spec or
   the clarifying thread that established the boundary.
4. **Open questions.** A bulleted list. The list MUST be empty when the
   spec stages for `human_approval`; a non-empty list fails the gate.

The full body MUST stay at most 1500 words across the four sections.

### Step 6 — Run Layer 1 lint and stage the spec

Apply the Layer 1 lint discipline declared in
`/lib/memory/handbook/contract-style.md` to every normative clause. Each rule
MUST hold:

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

When all gates are green, you MUST:

1. Stage `/.pan/work/<day>/<task-id>/spec.md`. You MUST NOT commit; you MUST
   NOT push.
2. Open one inbox item at
   `lib/inbox/in/<timestamp>-intake-<id>-ratification.md` summarizing the
   spec, the closed-question count, and any open questions the spec
   defers to a future Feature.
3. Mark the inbox thread closed; the supervisor advances the `intake`
   stage only after the human ratifies the inbox item per PRD §7
   line 648.

## Stop conditions

- Halt when `lib/inbox/in/` carries no Markdown file at intake start; route an
  empty-queue inbox item per the Failure-handling section.
- Halt when the human does not reply within 7 calendar days of a
  clarifying round; mark the Feature `status: dormant` in the spec
  frontmatter, post one reminder under `lib/inbox/out/`, and stop. The Feature
  MAY resume at any time without restarting the round counter.
- Halt when round 5 closes with the spec still ambiguous; escalate per
  the Failure-handling section.
- Halt when 3 consecutive Layer 1 lint rounds fail; escalate via inbox.
- Halt when any dual-anchor citation reports `gone` per the content-hash
  verifier; refresh the anchor or open an inbox item.

## Failure-handling

- If `lib/inbox/in/` is empty at intake start, the skill MUST halt and open an
  inbox item at `lib/inbox/in/<timestamp>-intake-empty-queue.md` to the
  human. The skill MUST NOT invent a Feature.
- If round 5 closes with the spec still ambiguous, the skill MUST stage
  the partial spec with `status: needs-human-resolution` and open an
  escalation inbox item per the R29 friction-circuit-breaker pattern from
  PRD §13.

## Cost guards

- Per-round token budget defaults to 8 000 tokens. A budget exhaustion
  mid-round MUST halt and route an inbox item; the skill MUST NOT silently
  truncate the clarifying file.
- Per-Feature draft default `max_tokens: 32000` across all 5 rounds plus
  the canonical spec. A breach trips the circuit breaker and routes via
  inbox.
