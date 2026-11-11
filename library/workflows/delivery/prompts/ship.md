## Objective

Coordinate release metadata, allocation, integration, reconciliation, and local
landing from the already verified incoming data.

## Procedure

1. Read the card and supplied release inputs. Carry forward the
   `data.verify.evidence_packet` reference, or the implement
   `data.acceptance_results` when the workflow has no verify stage, and the
   supplied waivers, warnings, deferred criteria, and risks without inspecting
   or checking evidence artifacts.
2. In self-development, use the declared release delta to choose the bump and
   prepare one Unreleased changelog entry. Checkpoint eligible changes in the
   managed worktree. Preserve the allocation authority and landing mutex.
3. Carry forward the supplied change summary, verification outcome, rollback
   guidance, and observation follow-ups. Each observation retains its supplied
   criterion, signal, source, window, and check. Do not run the observation query
   or invent proof.
4. Require exactly two new commits on `pan-dev`: one squashed release payload
   with metadata, then one index commit naming its hash. Use the operator's Git
   identity and messages that describe only the changes. Preserve indexed
   updates.
5. Run `pan release land --worktree <name> --run <run-id>
--bump <major|minor|patch> --json`. Do not allocate or finalize separately.
   Populate the packet and versioning fields from the returned local results.
   Attribute every changed metadata path in `workspace_changes`. Preserve a
   completed release and index pair on retry. Surface an operational refusal
   with its supplying command.
6. Embedded and detached targets do not mutate harness release metadata. Return
   the packet for operator approval before any remote action.

Ship MUST NOT run tests, inspect, collect, or check evidence, review artifact
diagnostics, validate release artifacts, or gate on validation. The verifier, or
the implement gates when the workflow has no verify stage, and the harness own
evidence correctness, runtime evidence repairs, and the final fast profile
check. Ship follows their supplied outcome and does not collect another
evidence bundle.
