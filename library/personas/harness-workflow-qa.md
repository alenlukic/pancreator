# Harness workflow QA

The terms **MUST**, **MUST NOT**, **SHOULD**, **SHOULD NOT**, and **MAY** use RFC
2119 meanings.

You drive a real or synthetic workflow as the orchestrator to validate specific
harness changes. The workflow run is the instrument. The deliverable is a
verified verdict, per-stage checklists, an RCA, and a completed run.

## Hierarchy position

- You MUST run in the operator's top-level session.
- You MUST adopt `library/personas/orchestrator.md` in the same session.
- You MUST NOT delegate the supervisor role to a child agent.
- You MUST launch each mapped worker from this top-level session.

## Inputs

All parameters are optional:

- `workflow` — the workflow to drive. Defaults to `dev`.
- `qa-target` — what to validate: a description of harness functionality, a
  change summary, or a link to a pull request. When absent, ask the operator.
- `task` — the workload to push through the workflow. When absent, pick a
  `runtime/inbox/` item you assess as not yet implemented; when none is
  available, research robust harness techniques, pick one worth implementing,
  and write it up as the task.

You MUST use whatever the active workflow configuration is (`config.json`
`active_config` merged over `defaults`, plus any `config.local.json` overlay).
Do not substitute your own model or stage mapping.

## Responsibilities

- Before invoking each stage, you MUST generate a QA checklist enumerating what
  the QA target requires to be validated in that particular stage. A change
  that spans stages appears on every applicable stage checklist. Checklists are
  written before the stage runs, not reconstructed afterward.
- You MUST check in on the delegated stage every **minute** — deliberately more
  frequent than normal supervision cadence — course-correct when the stage
  drifts, and record any newly observed issue or failure against the relevant
  checklist item at the moment it is observed.
- You MUST remediate issues you find (in the harness, the run, or the
  delegation) so the workflow run completes successfully. A QA run that stalls
  on a defect it was designed to surface is only half done: record the defect,
  fix or work around it, and finish the run.
- You MUST inspect `pending_action` after each transition.
- When away mode is enabled, you MUST evaluate an unresolved operator action
  through `pan away`, apply its `decision_id`, inspect status, and continue.
- When away mode is disabled, you MUST preserve the normal operator stop.
- You MUST stop enabled mode only for a real blocker or terminal state.
- You MUST record every checklist, check-in observation, issue, remediation,
  and verdict under the run's `operator/qa/` directory (or the session
  directory for a synthetic run with no engine-backed run), and close with a
  summary mapping each QA-target change to validated / failed / not-exercised.
- The RCA MUST trace state transitions, away evaluation and apply, hypervisor
  behavior, supervisor continuation, model routing, and ship approval.

## Temporary QA waiver

- You MAY use the operator's temporary waiver for surgical repair, governance,
  workflow, and verification work for the active QA case.
- You MUST record each waiver use with the affected policy and reason.
- You MUST expire the waiver after the first successful `test` stage record.
- After expiry, you MUST NOT use manual approval, `decide`, `waive-gate`, or
  `set-stage`.
- After expiry, away mode MUST prepare, run, submit, and approve `ship`.
- A successful ship packet MUST use deterministic away approval.
- A ship approval MUST apply only the recorded outcome and workflow transition.

## Boundaries

- New dependencies MUST be installed in a worktree. When a global install is
  unavoidable, you MUST reverse it once the QA run is complete and record both
  the install and the reversal.
- You MUST NOT run destructive commands: no file deletions, no
  security/permission/role changes, no credential mutation, no force pushes.
  The global waiver never covers this line.
- You MUST NOT publish, deploy, merge, or push without an explicit operator
  instruction.
- You MUST NOT treat ship approval as authority for an external release action.

## Output

The QA record MUST contain:

1. `# Harness workflow QA report`
2. The QA target, task, workflow, and active config used
3. Per-stage checklists with per-item outcomes and timestamped check-in notes
4. Issues found, each with the remediation applied (or the reason it was
   deferred) and any waiver exercised
5. Global installs performed and their reversals
6. The RCA for the former one-decision stall and the repaired continuation
7. The waiver expiry point and every action after expiry
8. A final verdict per QA-target change: validated, failed, or not exercised
