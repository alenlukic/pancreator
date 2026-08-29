## Objective

Prepare an operator-readable release packet from the ratified plan,
implementation, joint verification evidence, and current workspace.

## Steps

1. Read the card and required inputs. Treat the resolved effective records as authoritative; expand conditional or indexed history only to resolve a named inconsistency, missing disposition, active exception, or provenance requirement.
2. Confirm verification is satisfied by successful current evidence or explicit
   operator waiver directives. Fingerprint currency applies to unwaived
   evidence, not to the validity of an operator directive.
3. When `config.json.installation_mode` is `self_development`, apply the
   release-metadata procedure `VERSION-001` references: inspect the complete
   delta since the last committed release bump, choose `major`, `minor`, or
   `patch`, author or regenerate the release notes, and synchronize all
   version-bearing files.
   In embedded mode, do not modify release metadata.
4. Review the required governance/artifact diagnostics index. Repair safe runtime-only artifact or path issues directly. If a diagnostic reveals a legitimate implementation, test, security, or release concern, return `blocked` so the operator can decide; otherwise record the disposition and continue. Governance or artifact defects MUST NOT route the workflow back to remediation.
5. List every active operator gate waiver, deferred acceptance criterion,
   plan amendment recorded during remediation, warning the verify stage routed
   to the operator inbox, and linked follow-up case; do not describe waived
   evidence, an amended criterion, or a demoted warning as an ordinary pass.
6. Summarize scope, changed files, validation performed, residual risks, and
   rollback guidance.
   Read the `Suite profile` section of this card when it exists. Carry its
   test count, wall clock, and delta into `release.validation` as advisory
   text. The profile gates nothing. A card without the section records no
   profile; state that and continue.
7. When Git metadata is available, draft a proposed commit message that
   accurately describes the diff.
8. When `output.operator_brief` exists, apply the PR-description procedure
   `PR-001` references. Read the template and instructions in
   `inputs.pr_description`. Use target mode when that context names target
   authority. Use Pancreator fallback mode only when the context permits it.
   Save the description to `output.artifacts[1].path`, and preserve the declared
   artifact order. The harness runs `PR-DESCRIPTION-VALIDATE-001` before the
   operator gate. Do not open or create a pull request.
   When the contract omits `output.operator_brief`, do not create workflow PR
   copy. The separate `/pan-write-pr` command remains available.

## Output

Populate `data.release` (`summary`, `change_list`, `validation`, `rollback`,
`waivers`, `follow_up_cases`, `governance_artifact_review`). The governance review MUST include `summary`, `issues_reviewed` (issue ids), `repairs`, and `escalations`; every issue in the required diagnostics index must have a recorded disposition.
For Pancreator self-development, also populate `data.release.versioning`
(`current_version`, `recommendation`, `proposed_version`, `baseline_commit`,
`rationale`, `compatibility`, `updated_files`, `release_index_action`).
Include optional Git metadata field `commit_message` when it is available.
When `output.operator_brief` exists, edit its declared source and reference the
rendered HTML. Do not run the renderer. Reference `pr-description.md` as a
separate Markdown source artifact. When the contract omits
`output.operator_brief`, do not create either brief file or workflow PR copy.

## Done when

The packet accurately summarizes scope, validation, risks, rollback, inbox
warnings, and the completed release-metadata update when applicable, and every
unresolved non-blocking risk is surfaced. Stop for operator approval; do not
edit `release/index.json`, commit, push, open a PR, merge, publish, or deploy.
