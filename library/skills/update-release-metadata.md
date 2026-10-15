# Update release metadata

Use for a Pancreator self-development ship stage or `/pan-release`.
Embedded and detached target releases do not change harness metadata.

## Outcome

Coordinate the release, choose the Semantic Versioning bump, and construct the
release notes and version metadata. Use the local release command for integration,
reconciliation, allocation, commit creation, and landing.

## Establish the baseline

Read the committed version and the commit that introduced it. Use the complete
committed and working release delta, including existing Unreleased notes, to
construct metadata. Stop without edits when there is no releasable change.
Checkpoint eligible changes. Use the declared local phases for integration and
reconciliation. Product verification belongs to the verifier and harness.

## Choose the bump

Choose `major` for incompatible contracts or migrations, `minor` for compatible
capabilities, and `patch` for compatible fixes, documentation, or maintenance.
Record the decision without allocating a number. Regenerate an existing draft
in place. Preserve a completed release pair on a retry.

## Author release notes

Write one `## [Unreleased]` entry grounded in the declared release delta. Use
Changed, Added, Removed, and Fixed groups in that order when applicable. Use the
supplied commit, pull-request, issue, or document links. Do not invent hashes.
Preserve historical entries. Checkpoint the notes.

## Workflow handoff

Carry forward the incoming `data.verify.evidence_packet` reference and the
verifier's supplied disclosures without checking their evidence. The verifier
owns evidence correctness, runtime evidence repairs, and the final fast profile
check. Release does not collect a separate bundle or open the evidence artifacts.
Standalone `/pan-release` works without workflow verification records. Do not
invent a run, a stage proof, or a packet to satisfy release coordination.

## Final local operation

Run `pan release land --worktree <name> --bump <major|minor|patch> --json`.
In a workflow, also pass its supplied `--run <run-id>`. Standalone release does
not require that argument. Under the landing mutex and allocation authority, the
command coordinates integration, reconciliation, allocation, metadata construction,
the release and index commits, and local landing on `pan-dev`. Preserve candidate
dependency and documentation changes. Create the release commit before the index
commit.

Record the returned version, release commit, index commit, and tip. Populate
`release.versioning` from these results when the workflow declares that field:
current_version, recommendation, proposed_version, baseline_commit, rationale,
compatibility, updated_files, and release_index_action. Do not run a separate
allocate or finalize beforehand.

## Boundaries

The release steward and release commands MUST NOT run tests, inspect, collect,
or check evidence, review artifact diagnostics, validate release artifacts, or
gate on validation. Only the release commands may create the immutable release
and index commits. Only `pan release land` may advance `pan-dev`. The landing
mutex and allocation authority serialize shared release resources. Remote actions
require the operator.
