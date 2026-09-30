# Run efficiency audit

Use during a harness repair audit to find work that is correct but costs too
much time, too many agents, or too much operator attention. The harness
technician applies it to every workflow run the audit covers, without being
told where to look. The sibling skill `spend-roi-audit.md` measures the same
work in tokens and dollars. Fixing both sets of findings makes the harness
faster and cheaper.

## Principle

A run whose every step passes still produces a finding when a step costs more
than the work it serves. Measure that cost from run records, name the unit of
work it served, and file it only when a trigger fires.

## Procedure

1. Select the runs. For a run investigation, use that run. For an audit window,
   use every run under `runtime/logs/workflows/` whose events fall inside the
   window, and name any run you skipped with the reason.
2. Build the efficiency profile of each run from its records. Compute the values
   in shell or in memory, and write no file other than the intakes.

   | Signal                    | Source                                                                                                                               | Formula                                                                                                     |
   | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
   | Stage and round wall time | `events.jsonl` `invocation_prepared`, `delegated_worker_recorded`, `stage_output_submitted`; `pan worker state <run-id>` write times | prepared to submitted, and launch to output write, per invocation and evidence role                         |
   | Unobserved gaps           | `evidence/<invocation>-watch.jsonl` `recorded_at`                                                                                    | any interval between records longer than three cadences; active time is wall time minus gaps                |
   | Agent count               | `delegated_worker_recorded`, `pan worker record` roles, the stage's `evidence_workers`                                               | distinct handles per stage visit                                                                            |
   | Serial wait               | evidence report write times, verifier `launch.json` `launched_at`                                                                    | verifier launch minus the last report, and last report minus the first                                      |
   | Setup overhead            | `invocation_prepared` to the first `delegated_worker_recorded`                                                                       | seconds, and share of active stage time                                                                     |
   | Contract weight           | `invocations/<invocation>.md` and evidence briefs                                                                                    | lines, bytes, policy bytes, and policies also delivered as always-apply rules in `projection_manifest.json` |
   | Retry loops               | stage sequence in `events.jsonl`, verify outputs                                                                                     | verify-to-remediate cycles, and findings per cycle                                                          |
   | Change size served        | `outputs/*.json` `workspace_changes.paths`, finding ids of the preceding verify                                                      | paths and findings, and lines when commits exist                                                            |

3. Add the transcript signals. `pan worker profile --days <n> --json` is the
   durable source for per-stage turns, tool calls by tool, partial reads and
   re-reads, shell browsing, inline Python, self-run checks, unfiltered test
   output, paperwork calls, and the turn of the first source edit. Cite it
   rather than an ad hoc transcript script. The `suite_cost_advisory` events
   with `scope: "worker_invocation"` in `events.jsonl` give the same gate
   profile and shell browsing counts per invocation. From the transcripts the
   audit already inspects, add an evidence worker that reads the stage card,
   two roles that run the same check or reproduction, and reads of guidance
   the role never applies.
4. Apply the proportionality test to every stage visit. A finding needs all
   three conditions:
   - a cost signal measured from at least two independent sources;
   - the named unit of work that cost served;
   - at least one trigger below.
5. Triggers. Each is a cost rule whose only backing is time and attention, and
   `REPAIR-001` lets a recorded reason override one:
   - T1: a stage costs at least 1.5 times the active time or tool calls of the
     work it verifies or serves.
   - T2: a fixed floor takes at least 50% of round cost for a change of three
     paths or fewer.
   - T3: a contract delivers at least 20% of its bytes as text that binds no
     instruction of the reading role, or as a copy of an always-apply rule.
   - T4: two roles run the same check, or one role reads another role's
     contract.
   - T5: across return rounds, change size falls at least 50% while cost falls
     less than 25%, or cost stops at a floor.
   - T6: a serial wait longer than 5 minutes, or longer than 20% of the round.
   - T7: setup overhead above 20% of a stage's active time.
6. Cite, for each finding: the run id and invocation ids, each timestamp with
   its source file, the metric, formula, and value, the change-size measure,
   the trigger id, and the gaps excluded from active time. Estimate the time
   the remediation saves per run.
7. Put the efficiency profile table inside `## Execution timeline` of the
   intake, and list each triggered signal for each run in the audit report.

## Post-ship observations

A ship output records `release.observations` for each acceptance criterion
that verify deferred to a signal after ship. Each audit checks the items whose
window ended.

1. Run `pan observations --json`. Check each item whose `status` is `due`.
   An `open` item is still inside its window.
   Refute it early only when its signal already shows the regression.
2. Run the item's `check` against its `source`.
   In self-development, the source is run `events.jsonl` advisories,
   `pan-run` shell records under `runtime/logs/shell/`, friction intakes
   under `runtime/inbox/`, or `pan spend`.
   In a target installation, the source is the tool the primer names.
   Record the exact command, the window it covered, and the result.
3. Report the item as `confirmed` when the signal holds for the window.
   Report it as `refuted` when the signal shows the regression.
   File that regression as a finding in the intake of its category.
   Cite the run id and the criterion id in the finding.
4. Report each checked item with its verdict, its evidence, and the intake
   path of a refutation. The supervising repair session resolves it after
   every intake passes its validator:

   ```sh
   pan observations resolve <run-id> <criterion-id> --status confirmed --note "<evidence>"
   pan observations resolve <run-id> <criterion-id> --status refuted --note "<evidence>" --intake <intake-path>
   ```

5. A check that cannot run is an evidence gap. Report it, and leave the item
   unresolved.

## Category boundaries

- Failure categories: something breaks. Inefficiency requires every step to
  succeed.
- Mechanical friction: a mechanic forces a workaround, a retry, or an operator
  action. Inefficiency needs no workaround.
- Performance: the harness code, the suite, or a gate is slow. Inefficiency is
  the cost of agent topology, contracts, and waits around correct code.
- Compliance: an agent breaks a rule. When the rule permits the costly
  behavior, the finding belongs to inefficiency.
- Agentic antipatterns: a qualitative violation of best practice. Inefficiency
  requires a measured cost and the proportionality test.
- Cost/ROI: the same waste measured in tokens and dollars. File a finding under
  the measure its remediation moves most, and name the sibling intake by file
  name when both apply.
