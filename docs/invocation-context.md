# Invocation context and procedural recovery

Fresh contracts use `context_contract_version: 1`. Old invocation JSON,
Markdown, delivery records, and reports remain historical inputs; generation
does not rewrite them.

## Delivery audit

| Surface                                          | Applicability and retained value                                            | Delivery and fallback                                                                                                  |
| ------------------------------------------------ | --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Planner                                          | Shellless discovery worker; task, target instructions, engineering judgment | Scoped policy card; available bounded primer before broad discovery                                                    |
| Coder                                            | Explicit plan, named paths, source changes, own shell observations          | Capability-filtered card and snapshotted initial shell reminder; uncovered instructions inline                         |
| Remediator / severe remediator                   | Failure handoff, plan, changed scope, own commands                          | Same worker resolver; severity grants no delegation or authorization                                                   |
| Reviewer / QA evidence worker                    | Read-only inspection and case evidence                                      | Evidence brief, explicit no-child/no-shell boundary, observation requests, pending exception section                   |
| Verifier                                         | Declared evidence, honest verdict, target instructions                      | Shellless stage card; deterministic execution remains harness-owned                                                    |
| Release steward                                  | Bounded release metadata and permitted own commands                         | Scoped card and initial reminder; approvals and landing remain operator-owned                                          |
| Supervisor / orchestrator / QA coordination mode | Fan-out, joining, observation, recovery, decisions                          | Supervisor clauses retain delegation capability; initial worker reminders never prove supervisor delivery              |
| Shepherd reviewer                                | One selected review charter                                                 | Caller resolves charters, launches each reviewer, observes, and joins verdicts                                         |
| Native Cursor / VS Code                          | Host-specific projection paths and session routing                          | Projection existence alone is insufficient; exact matching coverage or inline fallback                                 |
| External / headless executor                     | No assumption of host rules or recurring hooks                              | Exact initial packet plus inline uncovered instructions; readonly adapters omit shell and all workers omit child tools |
| Unknown host or missing/stale receipt            | Preserve essential task and policy context                                  | Explicit diagnostic and scoped inline fallback; no fabricated delivery claim                                           |
| Embedded / detached installation                 | Same semantics, different path roots                                        | Canonical projections and installer mirror use the same capability framing                                             |

The shared resolver checks invocation, role, executor, host, supported route,
verified status, source, content digest, instruction digests, and exact text.
Partial coverage omits only matching instructions. Unknown, duplicated, stale,
or misattributed coverage never suppresses a clause. A receipt validates the
captured delivery content; it is not telemetry proving that a model read it.
Initial packet verification makes no claim about recurring delivery.
Hook errors disclose unavailable delivery without blocking the session. An
indexed worker whose invocation snapshot cannot be resolved receives a pinned
contract recovery instruction, rather than supervisor coordination duties.

For example, coverage of one `PRINCIPLES-001` instruction keeps the remaining
applicable instructions inline. A supervisor reminder with the right policy
ID still fails worker coverage. A prepared hook or a missing projection cannot
justify omission. Snapshotted content and digests remain available for audit.

The following producers own the changed boundaries:

| Producer                                                                                                | Contract owner and verification                                                                                                                    |
| ------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `policy-delivery.ts`, `policy-instructions.ts`, `projection.ts`                                         | Exact instruction provenance, capability applicability, and conservative coverage; invocation-context unit tests                                   |
| `engine/prepare.ts`, `render/invocation-markdown.ts`, `render/delivery-prompt.ts`, `engine/delegate.ts` | Fresh snapshot and launch packet, legacy rendering, agent requirements and target reads; invocation-context unit tests and existing delivery gates |
| `governance/prompt-context/routing.ts`, `cursor-content.ts`, reminder profiles                          | Session-bound recurring route and explicit unavailable-delivery diagnostics; prompt-context integration tests                                      |
| `render/evidence-worker-brief.ts`, `engine/evidence-workers.ts`, `watch-evidence.ts`                    | Shellless report boundaries and verdict-independent recovery import; unit and integration tests                                                    |
| `governance-card/render.ts`, `governance/supervisor-card.ts`                                            | Supervisor-only coordination and bounded unresolved ledger context; supervisor unit contracts                                                      |
| `procedural-exceptions.ts`, `cli/exceptions.ts`, `state.ts`, `workflow-artifacts/layout.ts`             | Closed inputs, trusted artifact ownership, mutex, immutable events and archive lookup; recovery unit and integration tests                         |
| `bin/pan-hook-deny-await-shell`, executor adapters, caller shepherd commands                            | Indexed no-child boundary, adapter tool authority and caller-owned fan-out; hook regression tests and existing adapter gates                       |
| Canonical policies, AGENTS templates, Cursor rules, installer mirror                                    | Primer independence and consistent installed conduct; configuration validation and generated projection checks                                     |

For a bounded coder, the former unconditional primer read becomes a discovery
trigger; the explicit plan, named source and target instructions remain required.
For a shell-capable worker, supervisor child coordination disappears while its
own shell observation moves into the exact pinned launch packet. For a shellless
reviewer, both kinds of shell procedure disappear and the permitted report gains
a pending-record route. These changes describe instruction availability, not
observed model compliance.

## Primer and target instructions

Broad discovery means locating unknown architecture, ownership, or
implementation surfaces beyond supplied paths and direct dependencies. That
activity triggers available bounded primer orientation. Reading an explicit
plan, its inputs, named symbols, direct dependencies, or target instructions
does not trigger a full primer read.

An absent or unbuilt primer alone does not block sufficiently bounded work.
When missing orientation prevents correctness, record the actual information
gap and identify `/pan-build-docs` as the supplying action. This does not waive
target instruction discovery or read validation, including when changed paths
expand. Librarian format and freshness checks retain their existing authority.

## Own commands and caller coordination

Workers cannot launch a child or an alternate agent session. The caller owns
fan-out, observation, crash recovery, and joining. The host hook denies indexed
invocation-worker launch tools, including namespaced alternatives, and denies
launches when supplied identity cannot be checked because the index is broken.
External adapters expose no child-launch tools.

Shell-capable workers retain wrapper/request limits, host bounds, shell
records, heartbeat checks, watch/attach, safe termination, and observation of
their own asynchronous commands. Shellless workers omit those duties.
Supervisors retain delegated-worker observation. A read-only report asks for a
pinned observation instead of executing a shell command.

## Procedural exception ledger

The existing run event journal is the source of truth. There is no separate
authoritative ledger file. `procedural_exception_recorded` and
`procedural_exception_resolved` events use the existing run mutex,
write-ahead persistence, payload externalization, and retention mechanisms.

```sh
./bin/pan exception record <run-id> --file <permitted-json-path>
./bin/pan exception list <run-id> --unresolved
./bin/pan exception list <run-id> --id <entry-id>
./bin/pan exception resolve <run-id> --entry <entry-id> --file <permitted-json-path>
./bin/pan exception reconcile <run-id> --artifact <output-or-report>
```

Each input has version 1, `client_id`, `affected`, `classification`,
`observed_defect`, nonempty `evidence`, `workaround`, `justification`, nonempty
`preserved_constraints`, and `outcome` or `required_follow_up`. Classifications
are `harness_defect`, `procedural_exception`, and `product_failure`. The harness
adds receipt ID, time, run, actor, invocation, and evidence role from declared
artifact ownership. Submitted attribution, authorization, scope, and status
fields are rejected.

Worker JSON evidence uses the invocation ID as its filename prefix in the run
evidence directory. Declared outputs and current/prior evidence-report attempts
derive ownership from retained invocation snapshots. Supervisor JSON evidence
uses `supervisor-exception-<name>.json` in that directory and receives a stable
run-scoped orchestrator identity. This naming route records ownership; it grants
no source-writing permission to a worker.

Stage JSON stores pending inputs in top-level `procedural_exceptions`. Revision
envelopes import only records explicitly supplied in
`patch.procedural_exceptions`; omitted or null patch fields import nothing.
Materialization does not copy omitted pending inputs into the new invocation's
output. The original output and ledger retain those inputs and their attribution;
later reconciliation or resubmission cannot reattribute them. Explicit new patch
inputs remain in the new output and replay under its own actor, even when
another invocation used the same client ID. Markdown
reports use one `## Procedural exceptions` section containing one JSON fence
with `{"procedural_exceptions":[...]}`, before verdict and completion markers.
Import is independent of product success. Submission imports before validating
product claims; external and native report ingestion import both pass and fail
reports. Reports without records remain unchanged.

Identical client ID, actor invocation, identity, and evidence role replay returns
the original receipt; conflicting reuse errors. Public record, resolution, and
reconciliation mutations wait up to ten seconds for the existing run mutex;
exhaustion reports `RUN_OPERATION_IN_PROGRESS`. Resolutions append linked
events and preserve the original entry. Retried reconciliation can use retired
invocation snapshots. Queries read retained archived journals and externalized
payloads, checking payload digests. Cards show at most five relevant unresolved
entries plus a retrieval command, rather than the whole journal.

If recording fails, keep the complete pending input and exact error in the
allowed output/report. An authorized caller reconciles that artifact after
repair. Recording never grants a waiver, approval, broader scope, changed
active configuration, fabricated evidence, gate bypass, or destructive action.
Justified recovery preserves correctness, security, authorization, target
instructions, and enforceable checks. Ordinary success needs no exception.

## Evidence and limits

`tests/unit/invocation-context.test.ts` proves exact partial coverage, negative
receipt diagnostics, legacy behavior, capability filtering, and snapshot bytes.
`tests/regression/await-shell-hook.test.ts` proves indexed worker launch denial,
including unavailable Python. When the hook cannot evaluate authority, it
denies agent launches and alternate sessions while allowing ordinary tools.
Delegation validation compares fresh external delivery against the verified
initial reminder plus canonical card. Native delivery and resumed directives
keep their own exact bodies; historical invocations without a reminder keep
the original card comparison.
`tests/unit/procedural-exceptions.test.ts` proves closed input shapes and
pending-record parsing independent of product outcome.
`tests/integration/procedural-exceptions.test.ts` covers checkpoint-driven
attribution, replay/conflict, append-only resolution, failed-output import,
retired invocation ownership, concurrent imports, payload externalization,
and retrieval after a retention move. Integration execution belongs to gates.
The recovery suite also simulates a stale materialized state after journal
persistence and checks replay without a duplicate receipt. Small and large
exception payloads are externalized immutably so archive path rewriting cannot
change original attribution or evidence.

## Fixture context measurements

The delivery run `63261_Oct-18-0318_ch` retains reproducible snapshots under
`agent/evidence/context-comparison/`, including `results.json` and separate
card, initial-packet and read files. Its run-local
`scripts/context-comparison.mjs` compares the renderer at
`6da05c3dbc2ede6fe1e9efb331119eb41cfd5ca8` with the changed producers.

| Role            | Before bytes | After bytes | Change bytes |
| --------------- | -----------: | ----------: | -----------: |
| Planner         |       265231 |      249006 |       -16225 |
| Coder           |       282042 |      171544 |      -110498 |
| Remediator      |       276908 |      166420 |      -110488 |
| Verifier        |       292065 |      179987 |      -112078 |
| Release steward |       279715 |      169823 |      -109892 |
| Reviewer        |       213479 |      118537 |       -94942 |
| QA              |       213478 |      118537 |       -94941 |
| Supervisor      |       315331 |      317001 |        +1670 |

These are self-development, headless Copilot fixtures with no host. Counts
include cards, exact constructed initial packets, bootstrap/target AGENTS once,
repository-check authority, the same request and ratified plan, all selected
guidance as a disclosed conservative read upper bound, and triggered primer
orientation. Planner and supervisor assume broad discovery; other roles assume
bounded named paths. Much of the worker reduction comes from omitting an
unconditional full primer read. Supervisor growth retains coordination and
accountable recovery.

Recurring delivery is unsupported in this fixture, so its measured recurring
component is zero on both sides and one-turn/five-turn totals match. Baseline
renderers and canonical instructions come from Git; shared helpers are reused.
Named source reads, parent-context reads, installation-specific instructions,
native host recurring delivery, live model reads and tokenizer counts are
unmeasured. These numbers are fixture accounting, not a live total-context
savings claim; native and installed-path evidence remains a gate/host obligation.

Context measurements must count cards, initial and recurring reminders, and
triggered reads together. Saved fixture measurements disclose role, executor,
host, capabilities, route, and turn count; they are not evidence of a live
recurring hook. A modeled fallback must not be labeled actual session delivery.
Static and configuration checks remain authoritative for projection and
installer drift. Test evidence does not grant release or publication authority.
