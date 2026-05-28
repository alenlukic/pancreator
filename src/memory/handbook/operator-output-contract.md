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
    contentHash: e037427
    note: "AGENTS working agreement binds all agents to this contract at task completion."
  - kind: lines
    path: src/memory/handbook/persona-spec.md
    range: [124, 140]
    contentHash: 4c164cf
    note: "Persona body discipline extends to operator-visible completion output."
  - kind: lines
    path: src/memory/handbook/inbox-lifecycle.md
    range: [114, 128]
    contentHash: 546e807
    note: "Manual inbox archival and ratification are common next-step targets."
related:
  - /AGENTS.md
  - /src/memory/handbook/tesseract-config.md
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

## 2.1 — Automated conformance check

Maintainers SHALL run `node src/internal/tools/check-operator-output.mjs` from the
repository root before governed commits that touch operator-visible surfaces.
The checker scans runnable fenced code blocks in `AGENTS.md`, `README.md`,
`OPERATION.md`, `src/personas/`, `.cursor/agents/`, `.cursor/rules/`, and
`src/memory/handbook/` and exits non-zero when a line invokes bare `tess …`
without the `pnpm -w exec tess …` prefix. Repository tests include
`tests/operator-output-contract.test.mjs`.

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

### 3.1 — `tess` CLI invocation prefix

This workspace does not expose bare `tess` on the shell `PATH`. When a step
invokes the CLI, the **How** clause MUST use the workspace exec form from the
repository root:

```bash
pnpm -w exec tess <subcommand> [arguments...]
```

Agents MUST NOT tell the operator to run bare `tess …` in copy-paste commands.
Prose MAY name the logical verb (`tess advance`) when explaining behavior; only
runnable shell lines require the prefix. See
`/src/memory/handbook/tesseract-config.md` §“CLI invocation in this workspace”.

### 3.2 — Command and path specificity

When a step invokes the CLI, the **How** clause MUST state the full invocation,
for example:

```bash
pnpm -w exec tess advance 67055_0522_json-formatting --artifact src/work/172983_05-23-26/67055_0522_json-formatting/review.md
```

When a step edits files, the **How** clause MUST list every path the operator
or agent may touch.

When a step delegates to a persona, the **How** clause MUST state the Cursor
invocation (`/reviewer-standard`, `/tech-lead-complex`, etc.) and the file the
operator pastes (`src/work/<day>/<task-id>/next-prompt.md` only per AGENTS §4).

### 3.2a — `feature-delivery` inbox entry paths

`pnpm -w exec tess run feature-delivery` and `pnpm -w exec tess feature new`
take `<inbox-entry>` relative to `src/inbox/in/` (day bucket + filename). **How**
clauses MUST NOT prefix `src/inbox/in/` on that argument—the CLI prepends it.

Canonical example:

```bash
pnpm -w exec tess run feature-delivery 172979_05-27-26/16605_1923_bootstrap-de-hacking-pass.md
```

See `/src/memory/handbook/tesseract-config.md` §“`feature-delivery` inbox entry
argument”.

### 3.3 — Read-only versus mutating actions

- **Read-only** steps MUST be labeled `Read-only:` at the start of the **How**
  clause or in the item title.
- Mutating steps (commit, `pnpm -w exec tess advance`, inbox promotion, file edit) MUST NOT
  use the read-only label.
- Steps that only open or read files for human judgment (diff review, delivery
  report read, compliance audit read) are read-only even when the operator
  later chooses to act.

### 3.4 — Copy-paste commands (fully formed)

When a step is automatable with a shell command, the **How** clause MUST give
the operator a **fully formed, copy-paste-ready** command block. The operator
MUST be able to run the step without inventing paths, flags, or file lists.

Rules:

1. **Fenced `bash` blocks.** Put runnable commands in a fenced code block on
   their own lines. Inline backticks are for single paths or flags inside
   prose, not for multi-command procedures.
2. **Complete invocations.** Every `git add`, `git commit`, `pnpm`, and `tess`
   line MUST list explicit paths and arguments. The operator MUST NOT need to
   infer "and the other touched files" or "etc."
3. **No manual assembly steps.** Phrases such as "stage the changed files",
   "commit the updates", or "run the usual tests" are **disallowed** when the
   agent can enumerate the exact paths from the task diff or touch-set.
4. **Do the work in-task when policy allows.** If the completing agent has
   authority and tooling to run an action (write files, run `pnpm test`, run
   `git add` for verification), the agent SHALL perform it during the task
   and MUST NOT punt it to **Next operator steps** unless repository policy
   reserves the action for the operator (for example human-only `git commit`
   per AGENTS §5).
5. **Operator-reserved actions still get full commands.** When only the
   operator may commit, push, or ratify, **Next operator steps** MUST still
   supply the complete `git add …` and `git commit -m "$(cat <<'EOF' … EOF)"`
   (or equivalent) with every path and the full message body—never a prose
   shopping list of filenames.

**Disallowed example:**

```markdown
**How:** Stage `AGENTS.md`, `src/memory/handbook/tesseract-config.md`,
`src/memory/handbook/operator-output-contract.md`, and the other touched
handbook/persona files, then `git commit` with a message describing the change.
```

**Allowed example (operator-visible **How** embeds a fence like this):**

**What:** Commit the governance updates when satisfied.

**How:** From the repository root:

```bash
git add AGENTS.md \
  src/memory/handbook/tesseract-config.md \
  src/memory/handbook/operator-output-contract.md

git commit -m "$(cat <<'EOF'
Document copy-paste next-step command policy.

EOF
)"
```

When the file set is long (>15 paths), the agent MAY split into (a) a
read-only `git status` / `git diff --stat` verification step with exact
commands and (b) a `git add` block generated from the actual changed-path
list—still fully enumerated, never "other touched files".

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
   **How:** Run `pnpm -w exec tess advance 67055_0522_json-formatting --artifact src/work/172983_05-23-26/67055_0522_json-formatting/review.md`. Confirm `src/work/172983_05-23-26/67055_0522_json-formatting/state.json` shows `current_stage: report` before delegating `tech-writer`.
```

**Example (single read-only step):**

```markdown
## Next operator steps

1. **What:** Confirm the compliance audit gate recommendation before merging.
   **How:** Read-only: open `src/internal/work_archive/172981_05-25-26/69180_0447_broad-sweep-compliance/compliance-audit.md` section 7 and verify `compliance_passes: true`.
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
   **How:** Add a new thread round under `src/inbox/threads/<day>/<feature-slug>/` with required edits; do not run `pnpm -w exec tess advance …` until a superseding plan artifact exists.
   **When to choose:** The touch-set is incomplete or the ADR draft misses a constraint.
   **Impact:** The run stays at `plan`; no implementation work should start.
```

## 6 — Common step patterns

Agents SHOULD reuse these patterns when they apply; adapt paths and IDs to the
active task.

| Situation | What (typical) | How (typical) |
|---|---|---|
| Pipeline stage complete | Advance to next stage | `pnpm -w exec tess advance <task-id> --artifact <path>` |
| Human gate | Ratify or reject | Read-only: inspect artifact; mutating: reply in inbox thread or run `pnpm -w exec tess approve <task-id>` when wired |
| Delegate next persona | Hand off execution | Paste `src/work/<day>/<task-id>/next-prompt.md` into `/<persona>-standard` |
| Pick up inbox work | Start next feature | Read-only: `ls src/inbox/in/`; mutating: `pnpm -w exec tess run feature-delivery <day-bucket>/<file>.md` |
| Verify only | Confirm artifact | Read-only: open cited path(s) and check acceptance criteria |
| Governed commit | Stage and commit (operator) | Full `git add <every-path>` then `git commit -m "$(cat <<'EOF' … EOF)"`; verify `src/work/<day>/<task-id>/policy-compliance.json` when required |
| Run tests before commit | Verify green | `pnpm test` (or the exact `pnpm` script named in `package.json`) |
| Close run | Archive after acceptance | `pnpm -w exec tess close-artifacts <task-id>` after human validates index |
| Blocked task | Unblock or escalate | State owner persona and the file the operator must edit or the ratification required |

## 7 — Prohibited content

The **Next operator steps** block MUST NOT:

- Repeat the full task summary (that belongs in earlier sections).
- List options the agent cannot support with a concrete **How** clause.
- Suggest `git push` or bypass human gates.
- Reference `src/inbox/notes/` as an action target.
- Tell the operator to paste PRD, bootstrap docs, or full chat transcripts into
  subagents (per AGENTS §4).
- Use underspecified file lists ("stage the touched files", "and other
  handbook/persona files", "etc.") instead of a complete `git add` or copy-paste
  command block (§3.4).
- Offload automatable shell work to the operator when the completing agent could
  have run the same command during the task (§3.4 item 4).

## 8 — Stability

This page is bootstrap-canonical for operator-facing agent output. Promotion to
`stability: stable` follows Phase 5 dogfood validation that operators receive
consistent blocks across personas.
