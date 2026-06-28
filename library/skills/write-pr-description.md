# Write a PR description

Use when preparing a merge-ready GitHub pull-request body from workflow
artifacts and the current git worktree. The release steward applies this skill
during the ship stage.

The terms **MUST**, **MUST NOT**, **SHOULD**, **SHOULD NOT**, and **MAY** use
RFC 2119 meanings.

## Principle

The description is for a human reviewer who has not read the diff. Lead with
impact and intent, not file inventory. Save the body for the operator to paste
into `gh pr create`; never open the PR yourself.

## Output

Write one Markdown file at:

`runtime/logs/workflows/<run-id>/artifacts/markdown/pr-description.md`

The invocation card supplies `<run-id>`. Reference this path in the stage JSON
output `artifacts` list.

## File format (normative)

The file MUST contain only the sections below, in this exact order. The first
line is outside the `##` heading structure and is the only exception to the
top-level `##` section rule.

1. **Suggested PR title (line 1).** One line with a conventional-commits
   prefix verb and a concise subject (for example `feat: add workflow artifact
   finalization`). Use `feat`, `fix`, `docs`, `refactor`, `test`, `chore`, or
   another appropriate [Conventional Commits](https://www.conventionalcommits.org/)
   type. The title MUST reflect the headline change, not a file list.
2. **`## Summary`** — always. One prose paragraph only; 2–4 sentences; 40–90
   words typical. Lead with why the change matters. State what changed at
   feature or subsystem level. MUST NOT enumerate paths, modules, or tests.
3. **`## Changelist`** — always. Unordered list (`-` bullets) only; 3–7 bullets
   typical (8 only when distinct user-visible capabilities ship together). Each
   bullet is one thematic outcome or capability, not one touched file.
4. **`## Delivery Pipeline Manifest`** — when run history resolves. Markdown
   table only. Omit the section entirely when no stage records resolve.

The file MUST NOT contain `## Test plan`, `## Testing`, checklists, subordinate
`###` headings, fenced code blocks, or `## Next operator steps`.

### Delivery Pipeline Manifest

Resolve stage rows from the active run directory
`runtime/logs/workflows/<run-id>/`:

- Read `artifacts/json/<invocation-id>.json` task records when present. Each row
  MUST correspond to a record you read: Stage from `stage.slug` or
  `stage.title`, Persona from `stage.persona`, Outcome from `outcome` mapped to
  operator-facing labels (for example `success` → `pass`, `blocked` → `blocked`).
- You MAY supplement from `events.jsonl` only when a row anchors to a task
  record or `harness_stage_executed` event for that invocation.
- You MUST NOT fabricate rows from advance, escalation, or non-stage events.

| Stage | Persona | Outcome | Notes |
| ----- | ------- | ------- | ----- |
| …     | …       | …       | …     |

Notes MUST capture duration estimates, outcome transitions, and retry counts
only. Notes MUST NOT include file paths, function names, or CLI parameters.

## Inputs

1. **Run artifacts** — from `runtime/logs/workflows/<run-id>/`: prior stage JSON
   outputs under `artifacts/json/`, markdown artifacts under
   `artifacts/markdown/`, and `events.jsonl` when building the manifest.
2. **Git worktree** — run `git status` and `git diff` against the PR base
   branch or `main`. When staged changes exist, also run `git diff --staged`.
3. **Release context** — the ship-stage inputs (spec, plan, implementation,
   review, QA, and release packet draft) when present.

Every Summary claim and Changelist bullet MUST be traceable to a `git diff`
entry or an artifact you read. You MUST NOT invent changes. When `git diff`
reveals paths not explained by prior stage artifacts, fold them into Summary and
Changelist as grouped thematic items; MUST NOT emit one bullet per unexplained
path.

## Steps

1. Resolve `<run-id>` from the invocation card.
2. Read run artifacts and git worktree delta per **Inputs**.
3. Draft the file per **File format**, running the conformance checks below.
4. Write `pr-description.md` to the output path and list it in stage artifacts.

## Conformance checks

Before saving:

- Line 1 is a conventional-commits-style suggested title.
- Sections appear in order: Summary, Changelist, optional Delivery Pipeline
  Manifest.
- Summary is one paragraph focused on impact; Changelist is thematic bullets
  only.
- Manifest rows are sourced from task records; section omitted when none resolve.
- No Test plan section and no invented changes.

## Boundaries

- You MUST NOT run `gh pr create`, `gh pr merge`, or any command that opens,
  updates, or merges a pull request.
- You MUST NOT commit, push, publish, or deploy.
- The operator or supervisor applies the saved body with `gh pr create` or
  `--body-file`; that step is outside this skill.
