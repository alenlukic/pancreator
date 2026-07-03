## Objective

Prepare an operator-readable release packet from the approved spec, plan,
implementation, review, QA evidence, and current workspace.

## Steps

1. Read the card and required inputs. Treat the resolved effective records as authoritative; expand conditional or indexed history only to resolve a named inconsistency, missing disposition, active exception, or provenance requirement.
2. Confirm review and QA are satisfied by successful current evidence or explicit
   operator waiver directives. Fingerprint currency applies to unwaived evidence,
   not to the validity of an operator directive.
3. When `project.json.installation_mode` is `self_development`, apply the
   release-metadata procedure unrolled under `VERSION-001`: inspect the complete
   delta since the last committed release bump, choose `major`, `minor`, or
   `patch`, author or regenerate the release notes, and synchronize all
   version-bearing files.
   In embedded mode, do not modify release metadata.
4. List every active operator gate waiver, deferred acceptance criterion, and
   linked follow-up case; do not describe waived evidence as an ordinary pass.
5. Summarize scope, changed files, validation performed, residual risks, and
   rollback guidance.
6. When Git metadata is available, draft a proposed commit message that
   accurately describes the diff.
7. Apply the PR-description procedure unrolled under `PR-001`: save the PR
   description to
   `runtime/logs/workflows/<run-id>/artifacts/markdown/pr-description.md` and
   reference it in stage artifacts. Do not open or create a pull request.

## Output

Populate `data.release` (`summary`, `change_list`, `validation`, `rollback`,
`waivers`, `follow_up_cases`).
For Pancreator self-development, also populate `data.release.versioning`
(`current_version`, `recommendation`, `proposed_version`, `baseline_commit`,
`rationale`, `compatibility`, `updated_files`, `release_index_action`).
Include optional Git metadata field `commit_message` when it is available.
Author the release packet as the invocation's schema-valid brief JSON, render
it to the exact HTML path from the output contract, and reference the HTML first
and the brief JSON second. Reference `pr-description.md` separately as a
Markdown source artifact intended for direct use in a pull request.

## Done when

The packet accurately summarizes scope, validation, risks, rollback, and the
completed release-metadata update when applicable, and every unresolved
non-blocking risk is surfaced. Stop for operator approval; do not edit
`release/index.json`, commit, push, open a PR, merge, publish, or deploy.
