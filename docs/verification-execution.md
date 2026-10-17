# Verification execution evidence

QA and final verification receive file tools and raw observations. The harness
collects authorized operations before it delegates either role. It owns process
execution, repository profiles, scaffolding, and final output validation.
Reviewers and QA independently grade observations against the expected behavior.
An exit code of zero is collection success, never a product verdict.

Read-only workflow contracts resolve scaffold automation to the harness. Their
generated worker cards contain no scaffold command; the supervisor procedure
names the owner. Source-authorized contexts retain their registered automation
obligations. A scaffold's presence alone is not evidence that a worker started.

Cursor and Cursor CLI launches pass the stage's shell policy in the child
environment. The registered `beforeShellExecution` monitor denies every shell
attempt for read-only stage and evidence workers, including allowlisted and
wrapped commands. Payload fields cannot grant shell access. Source-authorized
stages retain the existing command monitor. File tools remain available for
declared runtime reports and observation requests.

Claude Code receives an explicit available tool set for every read-only launch
and resume. Bash is absent. These launches use `default` permission mode even
when the persona requests `bypassPermissions`, so path-scoped runtime Write/Edit
approvals remain effective. Source-authorized launches retain their configured
mode and shell capability.

## Author operations

An approved plan can declare `data.test_plan[].execution.operations`. A
successful source-authorized implementation or remediation can declare
`data.verification_execution_operations`. Only stage outputs declared as
invocation inputs supply definitions. Read-only reports and requests cannot
authorize commands. Preparation pins the source path, invocation identity, and
content digest on `invocation.verification_execution`.

Planning approval carries a pinned plan reference into single-unit delivery,
cohort chunk runs, and the integrated release run. Every invocation declares
that output as a required input. The collector checks its successful planning
record, invocation identity, and routing-time digest before accepting authority;
editing the plan after routing produces an explicit gap.

An unavailable planning run does not prevent an integrated release run from
starting. It supplies no inherited executable authority; live criteria still
require definitions from an available approved plan or source-authorized
handoff. If a pinned planning record disappears after routing, resolution reports
an authority gap instead of accepting its operations or aborting preparation.

Version 1 is defined by
`library/schemas/verification-execution.schema.json` and exported as
`VerificationExecutionOperation` and `VerificationExecutionEvidence`.

```json
{
  "schema_version": 1,
  "id": "terminal-case",
  "criterion": "AC-01",
  "argv": ["node", "examples/check-terminal.js"],
  "cwd": ".",
  "timeout_ms": 10000,
  "write_roots": ["runtime/verification-execution/terminal-case"],
  "evidence_paths": []
}
```

Every operation names a criterion or finding. Omitted `required` means mandatory;
`required: false` makes a declared reproduction available on request. Use
at least one mandatory operation for every live criterion and live case.
Optional reproductions alone cannot remove a missing-evidence gap.
The plan validator reports `plan.execution_required` for an optional-only case;
the canonical refusal registry binds that diagnostic to `data.test_plan[]`.
Use argument arrays, never shell text. Timeouts are between 1 and 120000 milliseconds;
stdout, stderr, and each declared evidence file are bounded to 1 MiB. `cwd` is
workspace-relative. Writes are confined to
`runtime/verification-execution/<operation-id>` or narrower subdirectories.
Declare at least one scratch root; the collector grants no implicit write root.
Evidence paths must fall inside the operation's declared write roots. Paths,
including existing ancestors, cannot traverse symlinks or escape the workspace.
The collector uses strict operating-system write enforcement. Unavailable
enforcement produces an explicit environment gap and executes nothing.
The collector also denies subprocess creation in its operating-system sandbox.
Each operation must run in one process; commands that need child processes must
be replaced by a focused direct executable or remain nonpassing. This prevents
detached descendants from escaping the deadline after a successful parent exit.
Records carry `enforcement.processes: single-process`; legacy records without
that proof are nonpassing and are recollected, with the old record kept in history.

Repository-check profiles remain separate gate evidence. A configured profile
command cannot stand in for a live case.
Configured executable paths and operation argv use the same canonical comparison,
including relative/absolute path spellings in the execution workspace and
package-script aliases. Argument
boundaries are preserved.
Legacy free-text cases remain explicitly
uncollected until an approved plan or source-authorized handoff supplies a
structured definition.

## Request and recover

An evidence role can write `<evidence-report>.execution-request.json`. The final
verifier can write `data.verification_execution_requests`. Each is an array:

```json
[{ "id": "terminal-case", "reason": "Resolve the disputed terminal output." }]
```

No other request fields are accepted. The dispatcher collects newly selected
authorized observations, archives the consuming report, and reruns that role.
Final verifier requests similarly archive its output and prepare a fresh
scaffold. Unchanged requests reuse the same collection within the invocation;
they do not cause another launch. Missing definitions travel through the existing
blocked verification route: set `result: blocked`, supply
`data.verify.blocking_reason` and `missing_evidence_paths`, and omit a product
verdict. A source-authorized stage must supply new authority before the next
visit. Requests are never approval or workflow transitions.

For supervisor-owned launches, run `pan prepare <run-id>` after evidence workers
finish and before launching the verifier. Preparation consumes request sidecars
and archives only the affected reports; relaunch each missing consumer through
the existing worker-attempt command. Repeat preparation when the final verifier
requests observations. New observations archive its prior output and restore its
scaffold. Preparation binds QA and verifier work to the source and mandatory
observations rather than relying on report modification times.

Direct stage and evidence dispatch also honor preparation's invalidation result:
they restore the verifier scaffold after archiving stale work, before launch.
Requests already present in a verifier output are collected before binding the
consumer to the current manifest. Further requests use the same preparation path,
preserving prior grading and avoiding another launch for unchanged observations.

Parallel dispatch restricted to one evidence role consumes only that role's
request sidecar. Collection and report recovery use separate mutexes so sibling
workers retain their in-progress work.

## Currency and independent grading

The manifest is a required invocation reference. Each record retains
run/invocation/attempt, operation and definition identity, source provenance,
workspace source fingerprint, sanitized argv and raw observations, timing,
actual exit code and signal, timeout, and write enforcement. Source changes
invalidate observations. Recollection preserves superseded records in history
and archives previous evidence destinations and consumer reports.

Passing verification is refused for missing, stale, mismatched, failed, or
uncollected required observations. A failed command remains a failed observation;
the collector never rewrites its actual exit to obtain acceptance. The worker
must still assess the content and expected behavior independently.
Incoming evidence availability and gate fingerprint checks are also declared
provenance refusals; they do not impose additional worker output fields.

Browser inspection remains governed by BROWSER-001. Terminal output, capture
files, and collector success do not establish a browser verdict. QA must supply
the genuine isolated browser observation or record an environment gap.

A non-Git workspace with no declared execution operations owes no execution
fingerprint. A declared operation still requires a source fingerprint; without
one, collection records an explicit gap and required evidence cannot pass.
