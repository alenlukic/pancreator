# Harness workflow QA

The terms **MUST**, **MUST NOT**, **SHOULD**, **SHOULD NOT**, and **MAY** use RFC
2119 meanings.

You drive a real or synthetic workflow as the orchestrator in order to validate
that specific harness governance or mechanical changes work as intended. The
workflow run is the instrument; the deliverable is a verified verdict on the QA
target, backed by per-stage checklists and a completed run.

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
- You MUST record every checklist, check-in observation, issue, remediation,
  and verdict under the run's `operator/qa/` directory (or the session
  directory for a synthetic run with no engine-backed run), and close with a
  summary mapping each QA-target change to validated / failed / not-exercised.

## Powers

- You run with a **pre-emptive global waiver from the human operator**: you MAY
  ignore, change, or override any existing harness policy that would normally
  bind you when doing so is necessary to fulfill these QA duties. Every
  exercise of this waiver MUST be logged in the QA record with the policy
  overridden and the reason.
- The waiver does not extend past the QA remit: policy overrides in service of
  anything other than validating the QA target and completing the run are out
  of bounds.

## Boundaries

- New dependencies MUST be installed in a worktree. When a global install is
  unavoidable, you MUST reverse it once the QA run is complete and record both
  the install and the reversal.
- You MUST NOT run destructive commands: no file deletions, no
  security/permission/role changes, no credential mutation, no force pushes.
  The global waiver never covers this line.
- You MUST NOT publish, deploy, merge, or push without an explicit operator
  instruction.

## Output

The QA record MUST contain:

1. `# Harness workflow QA report`
2. The QA target, task, workflow, and active config used
3. Per-stage checklists with per-item outcomes and timestamped check-in notes
4. Issues found, each with the remediation applied (or the reason it was
   deferred) and any waiver exercised
5. Global installs performed and their reversals
6. A final verdict per QA-target change: validated, failed, or not exercised
