Drive a workflow in this top-level session to validate harness changes.

1. Parse `$ARGUMENTS` for `--workflow`, `--qa-target`, and `--task`. Default `--workflow` to `delivery`. Reject all other arguments.
2. Read `AGENTS.md`. Then run `./bin/pan governance card --mode qa-workflow` and read the card it writes in full. The card is the complete resolved governance for the QA role. Do not assemble policy text by hand and do not generate a second card for the same session.
3. Read `library/personas/orchestrator.md`, `library/personas/harness-workflow-qa.md`, and `library/personas/harness-technician.md`. Adopt the orchestrator and QA persona briefs in this session. Use the harness technician brief for post-run investigation. Do not invoke a supervisor subagent.
4. Use the workspace from `AGENTS.md`. Ask the operator for the QA target when `--qa-target` is absent.
5. Use `--task` when present. Otherwise, select one unimplemented `runtime/inbox/` item. Create an intake only when no item qualifies.
6. Resolve the active model configuration. Start or resume the run through the normal orchestrator procedure. After `./bin/pan init`, or before the first `./bin/pan prepare` of a resumed run, run `./bin/pan governance card --mode supervisor --run <run-id>`, read the card it writes in full, then run `./bin/pan governance attest-supervisor <run-id> --sha256 <digest>` with the digest it reported. `./bin/pan prepare` and `./bin/pan submit` refuse until the current digest is attested. Re-read and re-attest when `./bin/pan prepare` reports a new digest.
7. Write each stage checklist before that stage starts. For each foreground worker delegation, record launch evidence, completion evidence with elapsed time, and a terminal-state inspection; apply a fixed check-in cadence only to asynchronous processes that expose an observation point. Record drift, issues, and remediation immediately.
8. Inspect `pending_action` after every transition. Continue each supervisor-owned action in this top-level session.
9. When away mode is enabled, evaluate through `pan away`, apply the returned `decision_id`, inspect status, and continue.
10. When away mode is disabled, preserve the normal operator stop. Stop enabled mode only for a real blocker or terminal state.
11. Apply the temporary QA waiver only to surgical repair, governance, workflow, and verification work for this case.
12. Expire the temporary QA waiver after the first successful `test` stage record. Record the exact expiry point.
13. After waiver expiry, do not use manual approval, `decide`, `waive-gate`, or `set-stage`. Let away mode complete `ship`.
14. Keep commit, push, merge, publication, deployment, branch deletion, and destructive actions outside the waiver.
15. Write the complete QA record under the run's `operator/qa/` directory. Include the RCA, checklists, check-ins, issues, remediation, waivers, and verdicts.
16. After the run reaches a terminal state, investigate every flagged issue and identify its root cause from preserved evidence.
17. Distinguish root-cause repair from retries, workarounds, configuration patches, rollbacks, reconciliation, and containment. Keep an unconfirmed cause as a hypothesis.
18. If any issue lacks a verified root-cause repair, create one implementation-ready remediation intake under `runtime/inbox/`. Include evidence, causal chains, affected surfaces, acceptance criteria, regression coverage, and validation.
19. Record the intake path or no-remediation result in the QA record. Report the run ID, the card paths, QA record path, intake disposition, and verdict summary.
