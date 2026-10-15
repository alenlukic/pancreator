## Objective

Coordinate release metadata, allocation, integration, reconciliation, and local
landing from the already verified incoming data.

## Procedure

1. Read the card and supplied release inputs. Carry forward the
   `data.verify.evidence_packet` reference and the supplied waivers, warnings,
   deferred criteria, and risks without inspecting or checking evidence artifacts.
2. In self-development, use the declared release delta to choose the bump and
   prepare one Unreleased changelog entry. Checkpoint eligible changes in the
   managed worktree. Preserve the allocation authority and landing mutex.
3. Carry forward the supplied change summary, verification outcome, rollback
   guidance, and observation follow-ups. Each observation retains its supplied
   criterion, signal, source, window, and check. Do not run the observation query
   or invent proof.
4. Run `pan release land --worktree <name> --run <run-id>
--bump <major|minor|patch> --json` for integration, reconciliation, allocation,
   metadata construction, release and index commits, and local landing on
   `pan-dev`. Do not allocate or finalize a separate candidate beforehand.
5. Populate the packet and versioning fields from the returned local results.
   Attribute every changed metadata path in `workspace_changes`. Preserve a
   completed release and index pair on retry. Surface an operational refusal
   with its supplying command.
6. Embedded and detached targets do not mutate harness release metadata. Return
   the packet for operator approval before any remote action.

Ship MUST NOT run tests, inspect, collect, or check evidence, review artifact
diagnostics, validate release artifacts, or gate on validation. The verifier and
harness own evidence correctness, runtime evidence repairs, and the final fast
profile check. Ship follows their supplied outcome and does not collect another
evidence bundle.
