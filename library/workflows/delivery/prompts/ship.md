## Objective

Prepare an operator-readable release packet from the ratified plan,
implementation, joint verification evidence, and current workspace. The plan
is the `plan` stage output when the card lists one under its required inputs,
otherwise the request the card delivers, which is the ratified specification.

## Steps

1. Read the card and required inputs. Treat the resolved effective records as authoritative; expand conditional or indexed history only to resolve a named inconsistency, missing disposition, active exception, or provenance requirement.
2. Confirm verification is satisfied by successful current evidence or explicit
   operator waiver directives. Fingerprint currency applies to unwaived
   evidence, not to the validity of an operator directive.
3. When self-development has a managed worktree, run
   `pan release sync --worktree <name> --message <message> --run <run-id>`.
   Use the managed worktree and run id from the invocation. Continue only after
   the rebase completes.
   A legacy run without a managed worktree keeps metadata-only preparation.
4. Apply the release-metadata procedure `VERSION-001` references. For a
   managed run, synchronize metadata after the rebase. Then run
   `pan release finalize --worktree <name> --fetched-main <hash> --run <run-id>`.
   In embedded mode, do not modify release metadata or create local commits.
5. Review the required governance/artifact diagnostics index. Repair safe runtime-only artifact or path issues directly. If a diagnostic reveals a legitimate implementation, test, security, or release concern, return `blocked` so the operator can decide; otherwise record the disposition and continue. Governance or artifact defects MUST NOT route the workflow back to remediation.
6. List every active operator gate waiver, deferred acceptance criterion,
   plan amendment recorded during remediation, warning the verify stage routed
   to the operator inbox, and linked follow-up case; do not describe waived
   evidence, an amended criterion, or a demoted warning as an ordinary pass.
7. Summarize scope, changed files, validation performed, residual risks, and
   rollback guidance.
   Read the `Suite profile` section of this card when it exists. Carry its
   test count, wall clock, and delta into `release.validation` as advisory
   text. The profile gates nothing. A card without the section records no
   profile; state that and continue.
8. Apply the PR-description procedure `PR-001` references after finalization.
   Read the template and instructions in `inputs.pr_description`. Use the same
   managed worktree for the Git comparison. Use target mode when the context
   names target authority. Use fallback mode only when the context permits it.
   Put `<release-commit>..<index-commit>` in the Changelist.
   Write the declared PR artifact.
   The harness runs both PR validators against the named PR artifact. Do not
   open or create a pull request.
9. When `output.operator_brief` exists, edit its declared source.

## Output

Populate `data.release` (`summary`, `change_list`, `validation`, `rollback`,
`waivers`, `follow_up_cases`, `governance_artifact_review`). The governance review MUST include `summary`, `issues_reviewed` (issue ids), `repairs`, and `escalations`; every issue in the required diagnostics index must have a recorded disposition.
For Pancreator self-development, also populate `data.release.versioning`
(`current_version`, `recommendation`, `proposed_version`, `baseline_commit`,
`rationale`, `compatibility`, `updated_files`, `release_index_action`).
When `output.operator_brief` exists, edit its declared source and reference the
rendered HTML. Do not run the renderer. Reference `pr-description.md` as a
separate Markdown source artifact. Always create the PR artifact after local
finalization in self-development.

## Done when

The packet accurately summarizes scope, validation, risks, rollback, local
release commits, and the remaining remote actions. Stop for operator approval.
Do not push, open a PR, merge, publish, or deploy.
