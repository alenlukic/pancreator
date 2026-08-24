# Write a PR description

Use when preparing a merge-ready GitHub pull-request body from workflow
artifacts or directly from the current branch and worktree. The release steward
applies this skill during the ship stage and in standalone `/pan-write-pr`
invocations.

The terms **MUST**, **MUST NOT**, **SHOULD**, **SHOULD NOT**, and **MAY** use
RFC 2119 meanings.

`PR-001` governs this skill.

## Principle

The description is for a human reviewer who has not read the diff. Lead with
impact and intent, not file inventory. Save the body for the operator to paste
into `gh pr create`; never open the PR yourself.

## Invocation modes

### Workflow ship

The invocation card supplies `<run-id>` and MAY supply a PR base ref. Default the
base to `main` when none is supplied. Write one Markdown file at the path for
the run layout:

- Layout v2:
  `runtime/logs/workflows/<run-id>/operator/pr-description.md`
- Layout v1:
  `runtime/logs/workflows/<run-id>/artifacts/markdown/pr-description.md`

Reference this path in the stage JSON output `artifacts` list.

### Standalone command

The `/pan-write-pr` command supplies a validated base ref and a unique output
path under `runtime/pr-descriptions/`. Write only that file. Do not require ship
stage records, review evidence, QA evidence, or a workflow run. Omit the delivery
pipeline manifest unless the command explicitly supplies a run whose records you
read.

## Authority modes

The invocation supplies `inputs.pr_description`, or the standalone command
supplies `pan pr-description context --json`. Use the mode from that result.

### Target mode

Target mode applies when a target template or target PR instruction exists.
Read every resolved template and instruction path before drafting.

- Preserve the template's visible `##` headings and their order.
- Treat each heading as required unless its section comment starts with
  `Optional:`.
- Omit an optional section when the change does not need it.
- Do not add Summary, Changelist, How to read this PR, or a delivery manifest
  unless the target template contains that heading.
- Do not put a suggested title in the body unless
  `inputs.pr_description.allows_body_title` is true.
- Apply the live target instructions when they conflict with the Pancreator
  fallback format.

### Pancreator fallback mode

Fallback mode applies only when the resolved target context has no template and
no target PR instruction.

## Pancreator fallback format (normative)

In fallback mode, the file MUST contain only the sections below, in this exact
order. The first line is outside the `##` heading structure.

1. **Suggested PR title (line 1).** One line with a Conventional Commits type
   and a concise subject (for example `feat: add workflow artifact
finalization`). Use `feat`, `fix`, `docs`, `refactor`, `test`, `chore`, or
   another appropriate [Conventional Commits](https://www.conventionalcommits.org/)
   type. The title MUST reflect the headline change, not a file list.
2. **`## Summary`** — always. One prose paragraph only; 2–4 sentences; 40–90
   words typical. Lead with why the change matters. State what changed at
   feature or subsystem level. MUST NOT enumerate paths, modules, or tests.
3. **`## Changelist`** — always. Unordered list (`-` bullets) only; 3–7 bullets
   typical (8 only when distinct user-visible capabilities ship together). Each
   bullet is one thematic outcome or capability, not one touched file.
4. **`## How to read this PR`** — only when the change meets the applicability
   test below. A high-level walkthrough that orients a human reviewer before
   they open the diff.
5. **`## Delivery Pipeline Manifest`** — only when workflow run history
   resolves. Markdown table only. Omit the section entirely for ordinary
   standalone invocations and whenever no stage records resolve.

The file MUST NOT contain `## Test plan`, `## Testing`, checklists, fenced code
blocks, or `## Next operator steps`. Subordinate `###` headings are permitted
only as the registered subheadings of `## How to read this PR`.

### How to read this PR

Include this section when at least one of these is true:

- The change adds, removes, renames, or relocates an abstraction, such as a
  module, class, interface, schema, policy, command, or persona.
- The change alters architecture, a data flow, or a control flow across more than
  one component.
- The diff spans more than one subsystem, or enough files that reading order is
  not obvious.
- A reviewer needs to know where to start.

Omit the section entirely for a single-file fix, a copy or documentation edit, a
dependency bump, a formatting pass, or any change whose Changelist already tells
the whole story. A thin or padded walkthrough is worse than no walkthrough.

Use only the `###` subheadings below, in this order, and include only those that
apply. An empty subheading MUST be omitted rather than filled with a placeholder.

- **`### Core changes`** — the substantive changes in the order a reviewer should
  read them, each anchored to the component or path that carries it. 2–5 bullets.
- **`### Architecture decisions`** — the decisions this change commits to, each
  with the reason. 1–4 bullets.
- **`### Component changes`** — abstractions added, removed, renamed, relocated,
  or reassigned, and what now depends on them. Prefix each bullet with `Added`,
  `Removed`, `Renamed`, or `Moved`. 1–6 bullets.
- **`### End-to-end flows`** — the data or usage path through the change, from
  entry point to observable outcome. Write each flow as `A → B → C` followed by
  one line of prose. 1–3 flows.

Each bullet MUST be one or two sentences. The whole section SHOULD stay under 250
words. A reviewer who wants more detail reads the diff.

This section describes the change at a level the diff does not show, so it is the
section most exposed to invention. These limits are normative:

- Every statement MUST be traceable to the Git delta or an artifact that was
  read.
- A reason for a decision MAY be stated only when the delta or a read artifact
  evidences it. When the reason is not evidenced, describe the change and omit
  the reason.
- A rejected alternative MAY be named only when an artifact records it. The
  release steward MUST NOT reconstruct a rejected alternative from the shape of
  the final code.
- The release steward MUST NOT claim a performance, security, scalability, or
  maintainability benefit that the delta does not demonstrate.
- The walkthrough MUST NOT restate Changelist bullets. Changelist says what
  shipped; this section says how the pieces fit together.

### Delivery Pipeline Manifest

Resolve stage rows from the active run directory
`runtime/logs/workflows/<run-id>/`:

- For layout v2, read `agent/artifacts/json/<invocation-id>.json` task records.
- For layout v1, read `artifacts/json/<invocation-id>.json` task records.
- Each row MUST correspond to a record you read. Use `stage.slug` or
  `stage.title` for Stage. Use `stage.persona` for Persona.
- Map `outcome` to an operator-facing label. For example, map `success` to
  `pass`.
- For layout v2, you MAY supplement from `agent/events.jsonl`.
- For layout v1, you MAY supplement from `events.jsonl`.
- An event MUST anchor to a task record or `harness_stage_executed` event for
  that invocation.
- You MUST NOT fabricate rows from advance, escalation, or non-stage events.

| Stage | Persona | Outcome | Notes |
| ----- | ------- | ------- | ----- |
| …     | …       | …       | …     |

Notes MUST capture duration estimates, outcome transitions, and retry counts
only. Notes MUST NOT include file paths, function names, or CLI parameters.

## Git comparison (normative)

1. Resolve the selected base ref to a commit and compute `git merge-base <base>
HEAD`.
2. Read `git status --short --branch` and `git log --oneline <merge-base>..HEAD`
   to understand branch state and committed intent.
3. Read `git diff --stat <merge-base>` and `git diff <merge-base>`. With no
   right-hand commit, this comparison includes committed branch changes plus
   staged and unstaged tracked worktree changes.
4. Read `git ls-files --others --exclude-standard` and inspect relevant
   untracked files directly. Untracked files are not included in `git diff`.
5. Stop rather than draft a PR description when the complete comparison has no
   changes or when the selected base, merge base, or current branch cannot be
   resolved accurately.

Never interpolate an unvalidated base argument into a shell command. The caller
MUST validate it as one literal Git ref before this skill runs.

## Inputs

1. **Git delta** — the complete comparison defined above, using `main` by
   default or the caller-supplied base ref.
2. **Run artifacts** — in workflow mode, use paths for the active run layout.
   Layout v2 uses `agent/artifacts/json/`, `operator/`, and `agent/events.jsonl`.
   Layout v1 uses `artifacts/json/`, `artifacts/markdown/`, and `events.jsonl`.
3. **Target authority** — the resolved PR template, instruction paths, section
   order, required headings, and optional headings.
4. **Release context** — in workflow mode, the ship-stage inputs (spec, plan,
   implementation, review, QA, and release packet draft) when present.

Every Summary claim, Changelist bullet, and walkthrough statement MUST be
traceable to the Git delta or an artifact you read. You MUST NOT invent changes.
When the Git delta reveals paths not explained by prior stage artifacts, fold
them into Summary and Changelist as grouped thematic items; MUST NOT emit one
bullet per unexplained path.

## Steps

1. Determine whether the invocation is workflow ship or standalone command.
2. Resolve target mode or Pancreator fallback mode before drafting.
3. Read every resolved target template and instruction path in target mode.
4. Resolve the validated base ref, current branch, merge base, and complete Git
   delta per **Git comparison**.
5. In workflow mode, read the applicable run artifacts and release context.
6. In fallback mode, apply the **How to read this PR** applicability test.
7. Draft the file per the resolved authority mode and run the checks below.
8. Write only the mode-specific output path. In workflow mode, list it in stage
   artifacts.

## Conformance checks

Before saving:

- Target mode uses only target headings in target order.
- Target mode includes every required section and no empty required section.
- Target mode has no body title unless the resolved context permits one.
- Fallback mode has a conventional title on line 1.
- Fallback sections appear in the registered order.
- Fallback Summary is one paragraph, and Changelist contains thematic bullets.
- Fallback How to read this PR obeys its applicability test.
- No walkthrough statement invents a reason, a rejected alternative, or a benefit
  the delta does not demonstrate, and none restates a Changelist bullet.
- Manifest rows are sourced from task records; section omitted when none resolve.
- Every claim is grounded in the complete base-to-worktree comparison or an
  artifact that was read.
- No Test plan section and no invented changes.

## Boundaries

- You MUST NOT run `gh pr create`, `gh pr merge`, or any command that opens,
  updates, or merges a pull request.
- You MUST NOT commit, push, publish, deploy, change branches, or modify source
  and release metadata.
- The operator or supervisor applies the saved body with `gh pr create` or
  `--body-file`; that step is outside this skill.
