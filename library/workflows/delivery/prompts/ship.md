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
3. On a self-development release, run every release-lane `./bin/pan` command
   against the build of the workspace under release:
   `PANCREATOR_EXEC_ROOT=<workspace path> ./bin/pan <command>`. That value is
   harness-relative, `bin/pan` builds and dispatches that checkout, and run
   state, the worktree index, the gate cache, and the run mutex stay on the
   harness root. A value that is not a Pancreator checkout fails with
   `EXEC_ROOT_INVALID` and names the path.
   The redirection is read from the harness root's own `bin/pan`, so it is
   inactive on the release that introduces it. Confirm that the harness
   root's `bin/pan` accepts `PANCREATOR_EXEC_ROOT`; when it does not, use the
   harness root's build and record that residual. Read the harness root's
   `VERSION` before you rely on any other release-lane behavior this release
   introduces, such as an entry-gate waiver or a `release sync` guard, and
   state in your output which release-lane repairs in this release are
   inactive on this run. The harness records the executing build's identity
   beside the workspace identity on this stage record and raises a run
   advisory when the two disagree. That advisory is a recorded fact and does
   not fail the stage.
4. When self-development has a managed worktree, run
   `pan release sync --worktree <name> --message <message> --run <run-id>`.
   Use the managed worktree and run id from the invocation. The recorded
   overrides remain available: `--onto <ref>` rebases onto the ref you name,
   and `--no-rebase` keeps the local history as it stands. Continue after sync
   reports `synchronized` or `already_current`; both are successful results,
   and the latter means the selected target was already an ancestor of the
   branch. A rebase rewrites the replayed commit hashes; sync refuses with
   `RELEASE_REBASE_TOPOLOGY_LOST` only when the result dropped a merge the
   branch carried or no longer descends from the target. Stop and report
   that refusal rather than finalize over it. Carry any
   `RELEASE_LOCAL_DEFAULT_AHEAD` entry in `advisories` through finalization;
   finalize recomputes it from the fetched-main hash.
   A legacy run without a managed worktree keeps metadata-only preparation.
5. Before release preparation in self-development, run
   `pan conform scan --worktree <name> --all --json` and
   `pan style scan --worktree <name> --all --json` against the release
   candidate. If either result is not passing, return `blocked`. Set
   `data.blocked.missing_precondition` to the unclean pass and set
   `data.blocked.supplying_command` to `/pan-conform --worktree <name>` or
   `/pan-style --worktree <name>`. The release steward MUST NOT repair those
   files under its `release_metadata_only` mutation boundary.
6. Apply the release-metadata procedure `VERSION-001` references. For a
   managed run, allocate the version with
   `pan release allocate --worktree <name> --bump <bump> --run <run-id> --json`
   after you choose the bump, use `allocation.version` as `proposed_version`,
   and synchronize metadata after the rebase. Then run
   `pan release finalize --worktree <name> --fetched-main <hash> --run <run-id>`.
   Finalize reuses a complete same-version release/index pair already at the
   branch head, including a pair from an earlier attempt.
   In embedded mode, do not modify release metadata or create local commits.
   Stop there. Landing this release on the harness root's local default
   branch is an operator step after submit, so you MUST NOT fast-forward,
   merge, switch, or check out a branch in the harness root during this
   stage. `scope.no_unapproved_changes` reads any harness-root change as
   contamination, and no `workspace_changes` declaration attributes a
   checkout the run is not working in.
7. Attribute every tracked file this stage changed, including the release
   metadata the procedure above mandates. The `scope.no_unapproved_changes`
   criterion reads the output field `workspace_changes`, which carries
   `attribution` `internal`, every repository-relative path in `paths`, and
   one `explanation` of why this stage changed them. A path the release
   commit absorbed still belongs in `paths`. An unattributed tracked change
   fails the criterion even when the procedure required it.
8. Review the required governance/artifact diagnostics index. Repair safe runtime-only artifact or path issues directly. If a diagnostic reveals a legitimate implementation, test, security, or release concern, return `blocked` so the operator can decide; otherwise record the disposition and continue. Governance or artifact defects MUST NOT route the workflow back to remediation.
9. List every active operator gate waiver, deferred acceptance criterion,
   plan amendment recorded during remediation, warning the verify stage routed
   to the operator inbox, and linked follow-up case; do not describe waived
   evidence, an amended criterion, or a demoted warning as an ordinary pass.
10. Summarize scope, changed files, validation performed, residual risks, and
    rollback guidance.
    Read the `Suite profile` section of this card when it exists. Carry its
    test count, wall clock, and delta into `release.validation` as advisory
    text. The profile gates nothing. A card without the section records no
    profile; state that and continue.
11. Apply the PR-description procedure `PR-001` references after finalization.
    Read the template and instructions in `inputs.pr_description`. Use the same
    managed worktree for the Git comparison. Use target mode when the context
    names target authority. Use fallback mode only when the context permits it.
    Put `<release-commit>..<index-commit>` in the Changelist.
    Write the declared PR artifact.
    The harness runs both PR validators against the named PR artifact. Do not
    open or create a pull request.
12. Follow the card's `output.operator_brief` contract.

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
the shape step 7 states; `scope.no_unapproved_changes` reads that field and
no other field of this output.
Follow the card's `output.operator_brief` contract. Reference `pr-description.md` as a
separate Markdown source artifact. Always create the PR artifact after local
finalization in self-development.

## Done when

The packet accurately summarizes scope, validation, risks, rollback, local
release commits, and the remaining remote actions. The harness root is
unchanged. Stop for operator approval. Do not push, open a PR, merge,
publish, or deploy.
