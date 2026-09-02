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
stage records, review evidence, QA evidence, or a workflow run.

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

The file MUST NOT contain `## Test plan`, `## Testing`, checklists, fenced code
blocks, `## Next operator steps`, subordinate headings, or any other top-level
section.

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
6. Draft the file per the resolved authority mode and run the checks below.
7. Write only the mode-specific output path. In workflow mode, list it in stage
   artifacts.

## Conformance checks

Before saving:

- Target mode uses only target headings in target order.
- Target mode includes every required section and no empty required section.
- Target mode has no body title unless the resolved context permits one.
- Fallback mode has a conventional title on line 1.
- Fallback contains only Summary and Changelist, in that order.
- Fallback Summary is one paragraph, and Changelist contains thematic bullets.
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
