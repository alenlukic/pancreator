---
title: Operator Output Contract — Next Operator Steps
slug: operator-output-contract
stability: experimental
bootstrap-only: false
phase: bootstrap
owners: [supervisor, tech-writer, librarian]
purpose: |
  The canonical format every agent SHALL append to operator-visible output when
  a bounded task completes, enumerating what the operator can or should do
  next with explicit what/how guidance and read-only versus mutating actions.
references:
  - kind: lines
    path: AGENTS.md
    range: [116, 174]
    contentHash: e0374274c6e58a21d247230cb4da6f2d24a2997c6666d6cd56ad13e9dd03015a
    note: "AGENTS working agreement binds all agents to this contract at task completion."
  - kind: lines
    path: src/memory/handbook/persona-spec.md
    range: [124, 140]
    contentHash: 4c164cf34e880be6546c00245fea8fe790123d9a33c32370d4ededf05391c6e9
    note: "Persona body discipline extends to operator-visible completion output."
  - kind: lines
    path: src/memory/handbook/inbox-lifecycle.md
    range: [114, 128]
    contentHash: 546e807108a1ef4caa505fba99667e2a65c27407561d35a436829a5072878371
    note: "Manual inbox archival and ratification are common next-step targets."
related:
  - /AGENTS.md
  - /src/memory/handbook/persona-spec.md
  - /src/memory/handbook/inbox-lifecycle.md
  - /src/memory/handbook/documentation-impact-contract.md
  - /src/memory/active/handoffs.md
---

# Operator Output Contract — Next Operator Steps

This page defines the standardized **Next operator steps** block that every
agent SHALL append to the end of operator-visible output when a bounded task
completes.

## 1 — When the block is required

An agent SHALL append **Next operator steps** when all conditions below are
true:

- The agent reached a task boundary (deliverable produced, gate outcome
  recorded, explicit blocker reported, or delegated work returned to the parent).
- The operator is the intended audience for the response (chat reply, inbox
  outbox artifact body, delivery report section, or parent-agent summary).
- At least one plausible follow-up action exists for the operator (verify,
  ratify, advance pipeline, pick up inbox item, commit, delegate next persona).

An agent MAY omit the block only when the response is a single factual answer
with no follow-up action (for example "the file exists at `<path>`") and the
operator did not request next-step guidance.

Parent agents that summarize a delegated subagent result SHALL still append
**Next operator steps** for the operator; the parent MUST NOT assume the
subagent block was visible in the parent chat surface.

## 2 — Section heading and placement

- The block MUST use the level-2 heading exactly: `## Next operator steps`.
- The block MUST be the final section of the operator-visible response unless
  the harness appends system metadata after agent prose.
- Earlier sections MAY summarize work performed; this block MUST contain only
  forward-looking operator actions.

## 3 — Action entry shape

Each step MUST be one numbered list item. Every item MUST include:

| Field | Required | Content |
|---|---|---|
| **What** | always | One imperative sentence: the outcome the operator pursues. |
| **How** | always | Concrete procedure: exact command with arguments, exact file path(s), persona invocation token, or manual UI action. |
| **Read-only** | when applicable | Prefix or tag `Read-only:` when the step inspects artifacts without mutating the repo, inbox, or run state. |
| **When to choose** | multi-option only | One or two sentences: scenario that makes this option the right choice. |
| **Impact** | multi-option only | One sentence: what changes in repo state, pipeline stage, or risk if the operator selects this option. |

Agents MUST NOT use vague verbs ("review as needed", "check things") without
naming the path, command, or gate.

### 3.1 — Command and path specificity

When a step invokes the CLI, the **How** clause MUST state the full invocation,
for example:

```bash
tess advance 67055_0522_json-formatting --artifact src/work/172983_05-23-26/67055_0522_json-formatting/review.md
```

When a step edits files, the **How** clause MUST list every path the operator
or agent may touch.

When a step delegates to a persona, the **How** clause MUST state the Cursor
invocation (`/reviewer-standard`, `/tech-lead-complex`, etc.) and the file the
operator pastes (`src/work/<day>/<task-id>/next-prompt.md` only per AGENTS §4).

### 3.2 — Read-only versus mutating actions

- **Read-only** steps MUST be labeled `Read-only:` at the start of the **How**
  clause or in the item title.
- Mutating steps (commit, `tess advance`, inbox promotion, file edit) MUST NOT
  use the read-only label.
- Steps that only open or read files for human judgment (diff review, delivery
  report read, compliance audit read) are read-only even when the operator
  later chooses to act.

## 4 — Single-option layout

When exactly one sensible follow-up exists, the block MUST contain one numbered
item. Do not invent optional branches.

**Template:**

```markdown
## Next operator steps

1. **What:** <imperative outcome>.
   **How:** <exact command, path, or procedure>.
```

If the step is read-only, prefix **How** with `Read-only:`.

**Example (single mutating step):**

```markdown
## Next operator steps

1. **What:** Record the accepted review artifact and advance the feature-delivery run to the report stage.
   **How:** Run `tess advance 67055_0522_json-formatting --artifact src/work/172983_05-23-26/67055_0522_json-formatting/review.md`. Confirm `src/work/172983_05-23-26/67055_0522_json-formatting/state.json` shows `current_stage: report` before delegating `tech-writer`.
```

**Example (single read-only step):**

```markdown
## Next operator steps

1. **What:** Confirm the compliance audit gate recommendation before merging.
   **How:** Read-only: open `src/work/172981_05-25-26/69180_0447_broad-sweep-compliance/compliance-audit.md` section 7 and verify `compliance_passes: true`.
```

## 5 — Multi-option layout

When two or more distinct follow-ups exist, the block MUST contain one numbered
item per option. Each item MUST include **When to choose** and **Impact** after
**How**.

**Template:**

```markdown
## Next operator steps

1. **What:** <option A outcome>.
   **How:** <procedure A>.
   **When to choose:** <scenario A>.
   **Impact:** <state change A>.

2. **What:** <option B outcome>.
   **How:** <procedure B>.
   **When to choose:** <scenario B>.
   **Impact:** <state change B>.
```

Order options from lowest blast radius to highest unless a pipeline gate
requires a strict sequence; when sequence matters, state that in option 1
**Impact** ("blocks all later options until complete").

**Example (ratify versus defer):**

```markdown
## Next operator steps

1. **What:** Ratify the plan and delegate implementation to the coder persona.
   **How:** Reply on the inbox thread with approval, then paste `src/work/172983_05-23-26/67055_0522_json-formatting/next-prompt.md` into `/coder-standard`.
   **When to choose:** Scope, touch-set, and ADR draft match your intent.
   **Impact:** The run advances to `implement`; the coder may modify paths listed in `touch-set.json` only.

2. **What:** Send the plan back for revision without advancing the run.
   **How:** Add a new thread round under `src/inbox/threads/<day>/<feature-slug>/` with required edits; do not run `tess advance` until a superseding plan artifact exists.
   **When to choose:** The touch-set is incomplete or the ADR draft misses a constraint.
   **Impact:** The run stays at `plan`; no implementation work should start.
```

## 6 — Common step patterns

Agents SHOULD reuse these patterns when they apply; adapt paths and IDs to the
active task.

| Situation | What (typical) | How (typical) |
|---|---|---|
| Pipeline stage complete | Advance to next stage | `tess advance <task-id> --artifact <path>` |
| Human gate | Ratify or reject | Read-only: inspect artifact; mutating: reply in inbox thread or run `tess approve <task-id>` when wired |
| Delegate next persona | Hand off execution | Paste `src/work/<day>/<task-id>/next-prompt.md` into `/<persona>-standard` |
| Pick up inbox work | Start next feature | Read-only: `ls src/inbox/in/`; mutating: `tess run feature-delivery src/inbox/in/<day>/<file>.md` |
| Verify only | Confirm artifact | Read-only: open cited path(s) and check acceptance criteria |
| Governed commit | Stage policy compliance | Create or verify `src/work/<day>/<task-id>/policy-compliance.json` before `git commit` |
| Close run | Archive after acceptance | `tess close-artifacts <task-id>` after human validates index |
| Blocked task | Unblock or escalate | State owner persona and the file the operator must edit or the ratification required |

## 7 — Prohibited content

The **Next operator steps** block MUST NOT:

- Repeat the full task summary (that belongs in earlier sections).
- List options the agent cannot support with a concrete **How** clause.
- Suggest `git push` or bypass human gates.
- Reference `src/inbox/notes/` as an action target.
- Tell the operator to paste PRD, bootstrap docs, or full chat transcripts into
  subagents (per AGENTS §4).

## 8 — Stability

This page is bootstrap-canonical for operator-facing agent output. Promotion to
`stability: stable` follows Phase 5 dogfood validation that operators receive
consistent blocks across personas.
