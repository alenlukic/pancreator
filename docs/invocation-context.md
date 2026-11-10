# Invocation context and procedural recovery

Fresh contracts use `context_contract_version: 1`. Old invocation JSON,
Markdown, delivery records, and reports remain historical inputs; generation
does not rewrite them.

## Canonical reminders for VS Code with OpenAI

Phase 3 provides a read interface for the complete reminder and its identity:

```bash
./bin/pan governance reminder --host vscode --provider openai --session my-session --role pair
```

The command returns JSON with `content` (the existing reminder plus operating
principles), `deferred_content` (all applicable deferred clauses, still conditional
on their declared triggers), `card`, `content_sha256`, `policy_sha256`, `scope`, and `identity`.
It reuses the existing renderer and selector validation. Reads do not write
conversation state or delivery receipts. No timestamp, live run status, or previous
delivery enters the canonical bytes.

The identity covers both content fields, policy definitions, the contract digest,
and the explicit workspace, session, role, and invocation scope. The policy digest
also invalidates identities when a policy changes outside the selected reminder lines. Child sessions need their own
session identifier. Use `--card <repository-relative-path>` to bind a standalone
session to its resolved governance card. Invocation workers instead use
`--role worker --invocation <repository-relative-invocation-json>`; their reminder,
policies, audience, and capabilities come from that snapshot. Paths must remain
inside the harness workspace. No global active run chooses the contract.

For recovery, repeat the same command. Add `--expect <identity>` to reject a stale
identity with `STALE_CANONICAL_REMINDER`; omit it to read the current reminder after
a change. Missing contracts and stale policy selectors fail visibly.

This interface is explicitly limited to `--host vscode --provider openai`; those
flags identify the intended integration, not a detected or verified provider.
It neither enables an OpenAI cache TTL nor suppresses recurring hook copies.
A digest cannot retrieve omitted text from OpenAI's prompt cache. Actual token
savings require the later host integration to prove that the authoritative body
survives in the effective request before substituting a cue. Until then the
existing hook delivery and its fallback remain in force.

## Guarded request assembly

Phase 4 provides an opt-in local OpenAI relay in
[`relay.ts`](../src/lib/governance/prompt-context/relay.ts). It inspects the final
HTTP request after VS Code or its Copilot SDK has reduced context. It therefore
needs no edit to the installed provider. Full native hook delivery continues;
only redundant copies in the outgoing request become cues. Each scope and
message role retains a complete current body in that same request.

### Native VS Code setup

1. Package the VS Code lifecycle extension from this harness installation and
   install the resulting VSIX into VS Code 1.105 or newer:

   ```bash
   bin/pan-run -- ./bin/package-vscode-relay
   code --install-extension runtime/vscode/pancreator-reminder-relay.vsix
   ```

   Reload VS Code after installation. The extension's `onStartupFinished`
   activation starts the relay in each trusted Pancreator workspace. Its
   `deactivate` hook releases that window's ownership; the relay exits when its
   last owner closes. A process monitor also closes it after an extension host
   crash. These are application lifecycle hooks; Copilot chat session hooks
   cannot represent VS Code startup or exit.

   **Pancreator: Start Reminder Relay** and **Pancreator: Stop Reminder Relay**
   are idempotent palette commands. Multiple windows share one relay per harness.
   Closing one window preserves the relay while another window owns it.
   A relay started manually without an owner remains under manual control.

   The extension detects source checkouts and embedded `.pancreator` installs.
   Set `pancreator.reminderRelay.harnessPath` to an absolute or workspace-relative
   harness path for a detached install. The default port is `4040`; use
   `pancreator.reminderRelay.port` to assign distinct stable ports to different
   workspaces. Port `0` chooses an available port, shown in the **Pancreator
   Reminder Relay** Output channel. A port change takes effect after stopping
   and starting the relay. Set `pancreator.reminderRelay.enabled` to `false`
   to disable automatic startup. Untrusted and virtual workspaces never start it.

   The VSIX includes the compiled relay runtime and needs no npm packages on
   the destination machine. The packaging command and extension sources ship
   in the normal installer payload, so another embedded, detached, or source
   installation can build the same package. Copy the VSIX to another machine
   and use **Extensions: Install from VSIX** there; paths are resolved locally.
   Install a new package after updating the harness to update its bundled runtime.

   For explicit shell control, these commands start a background relay or stop
   it. They succeed without changing process state when already running or down:

   ```bash
   bin/pan-run -- ./bin/pan governance reminder-relay start --port 4040
   bin/pan-run -- ./bin/pan governance reminder-relay stop
   ```

   The original `pan governance reminder-relay --port 4040` command still
   serves in the foreground until interrupted. Startup failures appear in the
   Output channel; the CLI reports a lifecycle error. Native reminders continue
   in full when the relay is unavailable.

2. In VS Code's model manager, configure a **Custom Endpoint** with the same
   OpenAI model ID and capabilities already in use. Set its URL to
   `http://127.0.0.1:4040/v1/responses` and API type to `responses`. Keep the
   existing OpenAI API key in the host's credential store. Chat Completions also
   works at `http://127.0.0.1:4040/v1/chat/completions`. For a Copilot SDK BYOK
   provider that accepts a base URL, use `http://127.0.0.1:4040/v1`.

3. Select that model for the session. The existing hook CLI discovers the running
   relay through its workspace-specific public discovery record. Each hook still
   returns a full reminder. The relay registers its exact bytes under an opaque
   process-local packet ID; no signing key or API credential is persisted.

The [native custom endpoint URL resolver](https://github.com/microsoft/vscode/blob/main/extensions/copilot/src/extension/byok/vscode-node/customEndpointProvider.ts)
accepts an explicit Responses path and API type. The relay forwards only to
`https://api.openai.com`, using the authorization supplied by that request. It
rejects browser-origin and unexpected Host requests, bounds request bodies, and
preserves SSE response bytes, status, tool definitions, message order, and roles.
It does not change the model, tool permissions, cache settings, or credential
storage. The relay's OpenAI-compatible route is opt-in; its loopback smoke uses
synthetic requests and an unpaid local upstream.

### Presence, recovery, and fallback

[`relay-packets.ts`](../src/lib/governance/prompt-context/relay-packets.ts) only
reduces registered reminder frames in known message text fields. A packet in a
tool schema, assistant output, another role, another session, or another invocation
cannot prove presence in the current role and scope. It keeps the earliest exact
full copy in each current identity and message role group and replaces the other
copies with cues, including packets issued before a policy change. Native bootstrap
reminders resolve their card through the installation's own workspace coordinates,
so embedded and detached installations retain the same framing and fallback. A new request is checked independently: no delivery receipt or response ID
proves that a full body survived.

A missing or edited full body is rebuilt before forwarding. Changed canonical
identities restore the current reminder and conditional deferred clauses in the
same message role. A truncated packet or an unknown cue fails visibly with
`REMINDER_RECOVERY_REQUIRED` instead of sending an instruction-free request.
Server-side automatic truncation is rejected for optimized packets because the
relay cannot inspect its result. Unknown complete full packets from a restarted
relay remain full. Child sessions have separate canonical identities; resumed
requests retain their full source hook text and are checked again. Packets and
their source policies stay local to one bounded relay process.

Stopped, unavailable, corrupt, or incompatible relay discovery falls back to the
original full hook output without rerendering or retrying deferred-clause
receipts. Complete native output also remains the fallback for an oversized
packet. Stop the relay and restore the original provider URL to roll back. For
comparison without suppression, start it with `--full`. Neither mode changes
`active_config` or requires a cache migration. Only one relay may serve a
workspace at a time.

The relay logs full hook issuance, full/cue counts, recovery and identity changes,
and bytes saved under `runtime/logs/reminders/`. Logs contain metadata, not
prompts, provider payloads, or credentials. A failed audit write prevents
forwarding. These records establish transport decisions, not model compliance.

### Controlled provider assembly

`ReminderRequestAssembler` in
[`request.ts`](../src/lib/governance/prompt-context/request.ts) remains available
when a provider owns a trusted top-level `instructions` field. This API is
separate from the native relay, which preserves existing message roles.

Create one assembler per session and keep it across tool continuations. Create a
new instance for every child session, resumed session, or role change. Its unique
assembly scope prevents a parent's or previous process's reminder from proving
initial delivery in another session. The canonical reminder identity retains its
Phase 3 meaning.

```typescript
import { ReminderRequestAssembler } from '../src/lib/governance/prompt-context/request.js'

const assembler = new ReminderRequestAssembler(harnessRoot, {
  host: 'vscode',
  provider: 'openai',
  session: sessionId,
  role: 'pair',
  card: resolvedCardPath,
})

// Run after all host context reduction, immediately before serialization/send.
const assembled = assembler.assemble(finalResponsesRequest)
// Send assembled.request without further instruction or context edits.
```

The supported integration places authorized governance in the provider's trusted
`instructions` field. Integration must preserve the contract's instruction
priority and avoid promoting user or tool content into that field. The adapter
preserves existing instructions, input order, tools, model, and other provider
fields. It rejects non-string instructions and server truncation other than
`disabled` (the Responses default). Request validity beyond this boundary remains
the provider's responsibility.

The first assembly appends the complete current reminder and conditional deferred
clauses. Later assemblies append a short cue only when that exact scoped packet
is still in the current request's instructions. Repeated assembly retains at most
one trailing cue. Missing, summarized, truncated, or edited packets restore the
full body. Canonical policy and contract changes restore it with a new identity.
A transcript, past receipt, response ID, cache key, or copy in user/tool content
cannot authorize a cue. Explicit `expectedIdentity` failures and unavailable
contracts fail visibly before returning a request.

Each successful assembly appends metadata to its own
`runtime/logs/reminders/<assembly-id>.jsonl` file before returning. Records include
full/cue selection, recovery reason, identity transitions, scope and instruction
hashes, and appended byte count. They exclude prompt text, provider payloads, and
credentials. These are assembly decisions, not proof of a sent request or model
compliance. Audit write failure throws and leaves delivery state unchanged. Old
logs never establish presence; restarting always creates fresh delivery state.
No state migration is needed. To revert suppression within an integration, call
`assemble(finalResponsesRequest, { mode: 'full' })`.

The synthetic smoke and failure scenarios live in
[`reminder-request.test.ts`](../tests/unit/reminder-request.test.ts). They cover
normal tool continuations (`happy_path`); lost or damaged context and visible
failures (`critical_unhappy_path`); policy edits, isolation, and full fallback
(`probable_edge_case`); and false presence from history or cache metadata
(`hidden_edge_case`). Run the focused check from the selected worktree:

```bash
bin/pan-run -- ./bin/run-built -- ./bin/run-tests -- node --test --test-reporter=spec dist/tests/unit/reminder-request.test.js dist/tests/unit/canonical-reminder.test.js dist/tests/regression/turn-reminder-cycles.test.js
```

### Relay smoke evidence

The end-to-end local smoke in
[`reminder-relay.test.ts`](../tests/integration/reminder-relay.test.ts) invokes the
real hook CLI, sends its output through the production HTTP relay, and captures
the forwarded OpenAI request at a loopback upstream. The three-copy fixture fell
from **24,587 to 8,767 request bytes**, a saving of **15,820 bytes**, while
preserving one full reminder, SSE output, tools, and message roles. It also proves
cue-only recovery, child isolation, visible upstream errors, and full native
fallback after relay shutdown. Packet unit tests separately cover damaged/stale
presence and source/role isolation. These are byte measurements, not token or
billing measurements.

```bash
bin/pan-run -- ./bin/run-built -- ./bin/run-tests -- node --test --test-reporter=spec dist/tests/unit/reminder-relay-packets.test.js dist/tests/integration/reminder-relay.test.js dist/tests/regression/turn-reminder-cycles.test.js
```

The local installation identified on 2026-11-10 is VS Code `1.145.2` with bundled
Copilot `0.73.0`. The earlier assumption that an editable provider checkout was
required is resolved by the loopback transport. Installed application bundles
remain untouched. Actual paid OpenAI requests, installed-host model selection,
cache reuse, and comparative model compliance were not exercised by the smoke.
The relay makes no TTL or provider-cache claim.

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

## Blind agent E2E for deferred loading

`tests/fixtures/jit-agent-e2e/` holds two mock task briefs and an
`expectations.json` the subagent never sees. `jit-agent-e2e-fixture.test.ts`
fails when a brief names the mechanism under test. To run it, launch one
background subagent per brief with the brief text as the whole prompt, then
compare the receipts under `runtime/policy-clauses/` with the expectations.

| Task        | Expected receipts                  | Observed on 2026-11-01                                                         |
| ----------- | ---------------------------------- | ------------------------------------------------------------------------------ |
| Shell count | `BROWSER-001` `tool:shell`, `hook` | One hook receipt after the first shell call; no browser, delegation, edit rows |
| Read-only   | none                               | No receipt file; the answer came from read and search tools only               |

Context measurements report eager and deferred bytes separately. Eager bytes
are policy instruction text delivered with the invocation card. Deferred bytes
are clause text held behind a `load` trigger and delivered through the hook,
pull, or inline route. `src/lib/policy-context-measure.ts` computes the split
per policy and in total. Deferred bytes count only when a trigger fires, so a
total that adds them to eager bytes overstates the typical card.

Context measurements must count cards, initial and recurring reminders, and
triggered reads together. Saved fixture measurements disclose role, executor,
host, capabilities, route, and turn count; they are not evidence of a live
recurring hook. A modeled fallback must not be labeled actual session delivery.
Static and configuration checks remain authoritative for projection and
installer drift. Test evidence does not grant release or publication authority.
