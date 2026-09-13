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
3. On a self-development release, every `./bin/pan` command in this run
   executes the harness root's build, not the workspace under release. Before
   you rely on any release-lane behavior this release introduces, such as an
   entry-gate waiver, a `release sync` guard, or a currency check, read the
   harness root's `VERSION` and confirm the behavior exists there. State in
   your output which release-lane repairs in this release are inactive on
   this run.
4. When self-development has a managed worktree, run
   `pan release sync --worktree <name> --message <message> --run <run-id>`.
   Use the managed worktree and run id from the invocation. Sync refuses with
   `RELEASE_REMOTE_BEHIND_LOCAL` when the rebase would rewrite a commit
   already on the local default branch. Its message names the two recorded
   overrides: `--onto <ref>` rebases onto the ref you name, and `--no-rebase`
   keeps the local history as it stands. Continue only after sync reports
   `synchronized`, whether it rebased or recorded an override.
   A legacy run without a managed worktree keeps metadata-only preparation.
5. Apply the release-metadata procedure `VERSION-001` references. For a
   managed run, synchronize metadata after the rebase. Then run
   `pan release finalize --worktree <name> --fetched-main <hash> --run <run-id>`.
   In embedded mode, do not modify release metadata or create local commits.
6. Attribute every tracked file this stage changed, including the release
   metadata the procedure above mandates. The `scope.no_unapproved_changes`
   criterion reads the output field `workspace_changes`, which carries
   `attribution` `internal`, every repository-relative path in `paths`, and
   one `explanation` of why this stage changed them. A path the release
   commit absorbed still belongs in `paths`. An unattributed tracked change
   fails the criterion even when the procedure required it.
7. Review the required governance/artifact diagnostics index. Repair safe runtime-only artifact or path issues directly. If a diagnostic reveals a legitimate implementation, test, security, or release concern, return `blocked` so the operator can decide; otherwise record the disposition and continue. Governance or artifact defects MUST NOT route the workflow back to remediation.
8. List every active operator gate waiver, deferred acceptance criterion,
   plan amendment recorded during remediation, warning the verify stage routed
   to the operator inbox, and linked follow-up case; do not describe waived
   evidence, an amended criterion, or a demoted warning as an ordinary pass.
9. Summarize scope, changed files, validation performed, residual risks, and
   rollback guidance.
   Read the `Suite profile` section of this card when it exists. Carry its
   test count, wall clock, and delta into `release.validation` as advisory
   text. The profile gates nothing. A card without the section records no
   profile; state that and continue.
10. Apply the PR-description procedure `PR-001` references after finalization.
    Read the template and instructions in `inputs.pr_description`. Use the same
    managed worktree for the Git comparison. Use target mode when the context
    names target authority. Use fallback mode only when the context permits it.
    Put `<release-commit>..<index-commit>` in the Changelist.
    Write the declared PR artifact.
    The harness runs both PR validators against the named PR artifact. Do not
    open or create a pull request.
11. Follow the card's `output.operator_brief` contract.

## Output

A `blocked` result owes no release packet. Populate
`data.blocked.missing_precondition` with the precondition the run lacks and
`data.blocked.supplying_command` with the command that supplies it. The
release and pull-request validators report not applicable on that result.

Populate `data.release` (`summary`, `change_list`, `validation`, `rollback`,
`waivers`, `follow_up_cases`, `governance_artifact_review`). The governance review MUST include `summary`, `issues_reviewed` (issue ids), `repairs`, and `escalations`; every issue in the required diagnostics index must have a recorded disposition.
For Pancreator self-development, also populate `data.release.versioning`
(`current_version`, `recommendation`, `proposed_version`, `baseline_commit`,
`rationale`, `compatibility`, `updated_files`, `release_index_action`).
Populate `workspace_changes` whenever this stage changed a tracked file, in
the shape step 6 states; `scope.no_unapproved_changes` reads that field and
no other field of this output.
Follow the card's `output.operator_brief` contract. Reference `pr-description.md` as a
separate Markdown source artifact. Always create the PR artifact after local
finalization in self-development.

## Done when

The packet accurately summarizes scope, validation, risks, rollback, local
release commits, and the remaining remote actions. Stop for operator approval.
Do not push, open a PR, merge, publish, or deploy.
