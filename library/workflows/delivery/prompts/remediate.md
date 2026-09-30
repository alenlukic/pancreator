## Objective

Repair the recorded failures in one focused pass and hand the workspace back
to the stage that routed you here. A verify verdict routes to this stage with
its findings; the ship release gate routes here with its failed `full` run.
Either way the run returns through verify, which retakes its evidence at the
repaired workspace before the release gate runs again. The routing stage's
evidence is your primary input.

## Steps

1. Read the failure evidence first. After a verify verdict: the verdict, every
   blocking finding, every failed acceptance criterion or QA case, and the
   remediation guidance. After a release-gate failure: the failed gate's
   evidence log the card lists as required input, which carries the `full`
   profile output.
2. Read the ratified plan. The plan is the `plan` stage output when the card
   lists one under its required inputs, otherwise the request the card
   delivers. A request that is the plan is the child specification, with the
   parent specification reachable through its audited context reference. Read
   the implementation record only when the verify evidence does not explain
   the workspace you find.
3. Reproduce each failure before changing anything. A failure you cannot
   reproduce is a finding to dispute with evidence, not to patch blindly.
4. Repair each failure within the ratified plan's scope. Fix causes, not
   symptoms; do not weaken, skip, or delete tests to make a failure pass.
5. Only under a `fail_severe` verdict, and only when the verify evidence shows
   the plan itself is wrong: amend the plan minimally. Record every amendment
   in `data.plan_amendments` with the original statement, the amended
   statement, a justification, and the verify evidence that forced it.
   Amendments must preserve ratified product intent; reversing intent or
   removing a criterion stays with the operator. Under a `fail_remedial`
   verdict you have no amendment authority.
6. After each group of repairs, run the declared `impacted` profile plus any
   tests you added. In self-development that is `./bin/pan tests impacted`
   (static import-graph analysis selects the test modules your change set
   reaches). In a target installation, use the target's `impacted` profile
   from `runtime/repository-checks.json`. Only when no `impacted` profile is
   declared, pick the tests in the blast radius yourself. Derive every
   command from `runtime/repository-checks.json` or the target's documented
   entry points. Static checks are cheap; run them freely.
7. Run a repository-check profile only through the sanctioned path
   `./bin/pan repository-check <profile> --run <run-id>` so the execution is
   recorded in the run ledger. It and `./bin/pan tests impacted` print a pass
   line, or the failing tests with the path of the full log. Open that log
   only to diagnose a failure, and do not pipe raw suite output such as
   `npm test 2>&1` into your context. The gates own the suites: do not run
   the `fast` profile or the integration lane yourself, and never run the
   `full` profile. When the impacted selection, your new tests, and the
   static checks pass, submit. The remediate exit gate runs the static,
   configuration, and affected integration checks, and verify refreshes
   every interior gate profile before it starts. A failure of either returns
   the run to you with its log. The ship release gate runs `full` when the
   run enters ship. This saves worker turns and context; the gates rerun
   every profile anyway.
8. Map evidence to every acceptance criterion honestly, including the ones
   verify marked as failed.

## Gate-cache acceptance

This statement is `GATE_CACHE_ACCEPTANCE_RULE` in `src/lib/gate-cache.ts`, the
one source the operator guide, the verify prompt, and every worker card that
meets the mark also carry:

A gate marked `cached` is a real pass, not a skipped one: the identical gate
command passed cleanly at this same Git workspace fingerprint and
repository-check configuration within the last 24 hours, against a resolved
run baseline, and its evidence log carries that original captured output.
Treat it as evidence of the same strength as a pass the harness executed just
now, and do not order a rerun to replace it. A failure, timeout, skip,
override, or baseline-relative credit is never accepted this way.

## Tool habits

- Read files with the Read and Grep tools, and batch independent reads in
  parallel.
- Do not browse files through the shell (`cat`, `sed`, `grep`, `ls`).
- Edit the stage output with the file-editing tools, never with `python3` or
  another inline script.

## Output

Populate `data.implementation` (`changed_files`, `tests_added`, `notes`,
`remediation`) and `data.acceptance_results`. Each `tests_added` entry is
`{ path, contract }`: the test file path and one sentence that names the
contract the test proves. Every new test file and every net-positive test
delta needs an entry. Each remediation entry states
the `cause` from the verify evidence, the `action` taken, and non-empty
`evidence`. A disputed finding gets a remediation entry whose action states
the dispute and whose evidence proves it. Under `fail_severe`, record any plan
amendments in `data.plan_amendments`. Follow the card's `output.operator_brief` contract.

## Landing-conflict procedure

When the prior ship output carries `data.landing.status` of `conflict`:

1. Merge pan-dev into the managed worktree branch:
   `git merge --no-ff --no-edit pan-dev` in the candidate worktree.
2. Resolve each source path the land result lists in `source_conflicts`.
   Acceptance criteria, implementation logic, and tests are source paths; take
   the tip's release metadata files (`VERSION`, `CHANGELOG.md`, `package.json`,
   `package-lock.json`, `docs/embedded-installation.md`, `release/index.json`)
   exactly as the tip has them — do not hand-merge release metadata.
3. Stage all resolved paths and commit.
4. Run the impacted profile to confirm the resolution is clean.
5. The run then returns to verify and ship. `pan release land` re-reads the
   tip, so a tip that moved again is merged too, and verification reruns.

When `data.landing.status` is `verification_failed`:

1. Repair each failure named in the land result's `verification_output`.
2. Run the impacted profile; fix any remaining failures.
3. The run returns to verify and ship. `pan release land` re-runs finalize and
   verification from the repaired state.

## Done when

Every blocking verify finding is repaired or disputed with evidence, the
static checks, the impacted selection, and your new tests pass, and every
acceptance criterion has an honest evidence-backed result ready for
re-verification.
