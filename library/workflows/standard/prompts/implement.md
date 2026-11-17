## Objective

Join the parallel implementer and test author against the ratified shared
interface contract. Validate first; reconcile only a demonstrated mismatch.
The supervisor launched both workers in one turn and watched both reports.

## Steps

1. Read the ratified plan, including `data.interface_contract`, and both
   evidence reports. Honor the intake record and any approved interface
   schema. Do not re-derive classification. If either report or your own
   work identifies a concrete M hard-max breach (1000 implementation SLOC)
   or an unplanned new integration point, return `blocked` with the evidence
   and `pan intake classify --reason <reason>` as the supplying command.
   Recommend decomposition or prototype-trace, respectively. Preserve both
   reports; the supervisor reclassifies and the operator owns the reroute.
   A completed worker report can carry a blocking contract or scope
   discovery; a pass marker means the report was delivered, not that the
   source is complete. If a worker reports a materially inadequate contract,
   return `blocked` with the affected interface, evidence, proposed amendment,
   and the operator-owned resume-to-plan action in
   `data.blocked.supplying_command`. Do not run checks on incomplete work.
2. Before editing source or tests, read `runtime/repository-checks.json` and
   run the configured `impacted` profile through
   `./bin/pan repository-check impacted --run <run-id>`. Use the configured
   `static` profile if impacted is unavailable. Run the tests that landed
   using the declared test entry points if the profile does not cover them.
   Do not run `fast` or the integration lane; the gates own those suites.
3. If the checks pass and the reports agree with the contract, leave the
   independently authored tests untouched. There is no marshaling phase.
   If a check fails, diagnose against the ratified contract and the original
   acceptance criteria, not against whatever implementation happens to exist:
   - Production code violates the contract: correct production code.
   - A test invokes the contract incorrectly: reconcile its call sites,
     imports, names, or fixture shapes only. Record the actual failed check
     profile (`impacted` or `static`) in `data.marshaling.check_profile`, the
     concrete mismatch and affected interface id in `data.marshaling.mismatch`,
     and each edited test path, `kind`, and `note` in `data.marshaling.edits`.
     Kinds are `call_site`, `import`, `name`, or `fixture_shape`. The automatic
     guard accepts unchanged bodies and fixtures and static named-import
     corrections that preserve the implementation module path and local bindings, used only
     for direct subject calls assigned to a local value (e.g.
     `import { actualName as plannedName } from './module.js'`). For other
     changes, preserve the authored tests and correct the implementation,
     or return to planning for an independently reviewed contract amendment.
     Do not treat an unchanged assertion line as proof of equivalent behavior.
   - The agreed contract is materially inadequate: return `blocked`, cite
     the affected interface and evidence, propose the smallest amendment,
     and request a new ratified plan before resuming parallel delivery.
     Name the operator-owned resume-to-plan action in
     `data.blocked.supplying_command` (the supervisor owns execution). Do not silently revise the approved contract.
   - A behavioral test fails: treat it as a product defect for remediation,
     never as permission to weaken or replace the test. Fix the defect within
     scope or report failure for the existing recovery route.
4. Re-run the appropriate configured checks after any correction. Do not
   delete a scenario, loosen an assertion, or change an expected outcome.
   Leave `data.marshaling` absent when no test reconciliation was necessary.
5. Map evidence to every acceptance criterion. Record
   `implementation.changed_files`, `implementation.tests_added`, and
   `acceptance_results`. The ordinary read-only verify stage retains its
   verdict and remediation routing.

## Output

Write the stage output the card names. Populate every required data field.
