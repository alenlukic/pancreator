# Write a PR description

Use when the operator invokes `/pan-write-pr` to prepare a GitHub pull-request
body from the current branch and worktree.

The terms **MUST**, **MUST NOT**, **SHOULD**, **SHOULD NOT**, and **MAY** use
RFC 2119 meanings.

`PR-001` governs this skill.

## Principle

The description is for a human reviewer who has not read the diff. Lead with
impact and intent, not file inventory. Save the body for the operator to paste
into `gh pr create`. Never open the PR yourself.

## Standalone command

The `/pan-write-pr` command supplies a validated base ref and a unique output
path under `runtime/pr-descriptions/`. Write only that file. Do not require ship
stage records, review evidence, QA evidence, or a workflow run.

## Authority modes

The standalone command supplies `pan pr-description context --json`. Use the
mode from that result.

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
  `allows_body_title` is true in the resolved context.
- Apply the live target instructions when they conflict with the Pancreator
  fallback format.

### Pancreator fallback mode

Fallback mode applies only when the resolved target context has no template and
no target PR instruction.

## Pancreator fallback format (normative)

In fallback mode, the file MUST contain only the sections below, in this exact
order. The first line is outside the `##` heading structure.

1. **Suggested PR title (line 1).** One line with a Conventional Commits type
   and a concise subject, for example `feat: add workflow artifact
finalization`.
   Use `feat`, `fix`, `docs`, `refactor`, `test`, `chore`, or another type from
   [Conventional Commits](https://www.conventionalcommits.org/).
   The title MUST reflect the headline change, not a file list.
2. **`## Summary`** — always. One prose paragraph only, 2–4 sentences, 40–90
   words typical. Lead with why the change matters. State what changed at
   feature or subsystem level. MUST NOT enumerate paths, modules, or tests.
3. **`## Changelist`** — always. Unordered list (`-` bullets) only, 3–7 bullets
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
2. **Target authority** — the resolved PR template, instruction paths, section
   order, required headings, and optional headings.

Every Summary claim, Changelist bullet, and walkthrough statement MUST be
traceable to the Git delta or an artifact you read.
You MUST NOT invent changes.

Group the Git delta into thematic items for Summary and Changelist.
You MUST NOT emit one bullet per unexplained path.

## Steps

1. Read the validated base ref and output path from the standalone command.
2. Resolve target mode or Pancreator fallback mode before drafting.
3. Read every resolved target template and instruction path in target mode.
4. Resolve the validated base ref, current branch, merge base, and complete Git
   delta per **Git comparison**.
5. Draft the file per the resolved authority mode and run the checks below.
6. Write only the command-supplied output path.

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

- `PR-001` and `ACTION-001` on the active card own the source-control and
  pull-request prohibitions. This skill writes one file and nothing else.
- The operator or supervisor applies the saved body with `gh pr create` or
  `--body-file`. That step is outside this skill.
