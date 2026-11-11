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

## Hook state

Lifecycle hooks keep their conversation-role cache in
`runtime/reminders/conversations.json`, inside the harness runtime write grant.
This allows full reminder delivery when an external executor has read-only
access to the harness source. Existing
`.cursor/hooks/state/conversations.json` data is read only when the runtime
cache is absent; subsequent writes use the runtime path and preserve the legacy
file. An existing runtime cache remains authoritative.

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
It preserves the model, tool permissions, and credential storage. On supported
Responses models it adds the cache boundaries described below. The relay's
OpenAI-compatible route is opt-in; its loopback smoke uses
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
same message role. A truncated frame with a recognizable registered header
recovers its complete authoritative body in the current request. Received live
text remains intact, and adjacent frames retain their own scope. An unknown cue
fails visibly with
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

### Responses cache lifetimes

The relay is the controlled integration point after the editor or Agents window
bridge constructs its outbound request. Inspection on 2026-11-11 identified VS
Code `1.145.2`, bundled Copilot Chat `0.73.0`, and a mode-only
`prompt_cache_options` builder without TTL. The inspected provider bundle SHA-256
was `666992c43cdfc2e7e5c559bbffdff1b99cc2b6d77ff782d1b9641dfed84f8735`.
This inspection pins installed source behavior; it does not establish the active
session's selected provider, model, or final request. Configure and verify the
custom endpoint independently for editor chat and the Agents window.

For `/v1/responses` with GPT-5.6 and later, the relay sets:

- `prompt_cache_options: { "mode": "implicit", "ttl": "30m" }`. Implicit
  caching remains enabled for the latest user message and consecutive tool
  results, alongside the explicit foundation and history markers. Explicit-only
  mode would repeatedly bill the growing tool-loop history as uncached input.
- A `12h` breakpoint on the last text block in the initial consecutive system
  and developer messages. Tools and preceding instructions belong to that
  prefix. When an initial block contains a registered full reminder, its end
  becomes the stable boundary and trailing live hook text stays after it.
- A `30m` breakpoint on the last eligible text block after that foundation and
  before the latest user question, when such history exists. Tool continuations
  retain the early boundary; implicit boundaries cover the growing conversation,
  including the current user message and the latest tool-result group.

Roles, text order, tools, `store`, and response lineage remain intact. Selected
string messages become equivalent `input_text` arrays so they can hold markers.
Top-level `instructions` alone cannot hold a marker: without an initial developer
or system text block, the relay reports `missing_developer_prefix` and still
selects implicit `30m` caching. It never promotes user or tool content to developer
instructions. Provider timestamps or other changing material before the selected
boundary still invalidate that prefix; the relay does not reorder them.

Earlier or unknown models and Chat Completions retain their existing cache
shape, with `unsupported_model` or `unsupported_transport` in the request audit.
Invalid request or block TTLs fail locally with `INVALID_PROMPT_CACHE_OPTIONS`
before an upstream call. Use `30m` or `12h`; explicit block markers require
`mode: "explicit"`. Existing caller markers are preserved except at the selected
boundaries. A registered block split keeps its live suffix outside that marker.

Request audit records include the selected model, lifetimes, and a SHA-256 of the
local foundation prefix. This fingerprint is diagnostic; it is not an API token
count or proof of a cache write. A short prefix may miss OpenAI's 1,024-token
minimum. Requests always report cache hits as unverified until response usage
supplies evidence.

#### Cache efficiency regression and repair

The initial explicit-only configuration disabled automatic caching after the
selected foundation and earlier-user boundaries. During a long tool loop, most
history follows the latest user message, so it was repeatedly billed as ordinary
input. Passing the native smoke and observing some cache reads did not validate
acceptable reuse or spend. The relay now retains implicit caching alongside the
explicit `12h` foundation.

A bounded six-request comparison on 2026-11-11 reproduced this failure with
synthetic growing tool history on GPT-6.1 Sol. Across two warm turns, both modes
processed 11,343 input tokens. Explicit-only reused 2,606 tokens (22.97%) and
billed 8,737 ordinary tokens; the repaired relay reused 11,127 (98.10%) and billed
150 ordinary tokens. Using the documented input multipliers, normalized warm
input cost fell from 8,867.30 to 788.85 ordinary-token price units (91.10%).
These are experimental input costs, not a claim about the operator's account
bill or future workload. Evidence: [paired measurements](../runtime/logs/cache-mode-ab.json).

Three further real requests validated the diagnostics integration: the automatic
streaming comparison returned `cache_hit` and 1,300 billed reads; a deliberate
tool-name change against the pinned baseline returned `cache_miss`,
`tools_changed`, and 1,806 estimated missed tokens. Evidence:
[provider diagnostics](../runtime/logs/cache-diagnostics-live.json).
All experimental relays were closed after measurement.

#### Ongoing cache diagnostics

Following [OpenAI's diagnostics guide](https://developers.openai.com/api/docs/guides/prompt-caching/diagnostics),
the relay automatically requests `prompt_cache_options.comparison_response_id`
on subsequent supported requests. A caller-supplied comparison remains intact,
so a validation run can pin one baseline while changing individual settings.
The previous completed response supplies the automatic baseline; failed and
incomplete responses do not replace it. No extra generation requests are made.

Baselines are scoped by the credential, organization, and project, then by the
conversation ID, cache key, or normalized first user message. Only hashes and
bounded response IDs remain in memory. At most 128 baselines survive, each for
ten minutes; restarting the relay starts without baselines. A changed key or
first user message can start a new automatic comparison group. Pin the baseline
explicitly to diagnose such a change, ambiguous identical starting tasks, or
context compaction.

JSON responses and streaming terminal events supply sanitized
`prompt_cache_diagnostics`: type, known reason, `comparison_reusable_tokens`,
and `cache_missed_tokens`. Audit entries pair these with actual billing usage
and `cache_validation`: `matched`, `miss`, `unavailable`, or `no_baseline`.
Unknown, absent, expired, or unsupported diagnostics never become a successful
validation. Diagnostic estimates are distinct from billed cache reads.

Inspect `/pan/health` for cumulative `cache_validation` comparison outcomes,
usage coverage, and `cached_input_share`. Read the correlated `cache_usage`
audit records for the reason behind each miss. These counters reset when the
relay restarts; persisted audit records remain available. They cover only
requests forwarded through this relay. A diagnosis does not alter request
content or automatically retry a billed request.

The relay observes JSON and SSE responses without changing their bytes. Records
with `event: "cache_usage"` correlate by `request_id` and contain latency, HTTP
status, a provider response ID when valid, and these numeric usage fields:

- `input_tokens`, `cached_tokens`, and `cache_write_tokens`.
- `ttl_30m_tokens` and `ttl_12h_tokens` from the write-lifetime details.
- `ordinary_input_tokens = input_tokens - cached_tokens - cache_write_tokens`
  when all counters exist and the result is nonnegative.

Missing, malformed, oversized, or interrupted evidence stays unavailable; missing
counters never become zeros. Prompts, generated text, and credentials are excluded.
The observer bounds each JSON response or SSE event to 1 MiB. Request audit writes
must succeed before forwarding. A response ID or `comparison_response_id` can
support diagnostics, but neither retrieves omitted context. Caller diagnostic
fields pass through unchanged.

At current published rates, 30-minute writes cost 1.25 times ordinary input and
12-hour writes cost 2.5 times ordinary input. These are total write rates, not
additional surcharges. Billed reads use the model's cached-input rate. Compute
cost from ordinary input, reads, and each lifetime's writes separately; adding
`cache_write_tokens` again would double charge writes. A valid read does not
restart the 12-hour clock. Cache hits still occupy context and incur input cost.
See the [OpenAI cache guide](https://developers.openai.com/api/docs/guides/prompt-caching)
for current model support, pricing, and retention semantics.

For comparison or rollback, stop the relay and restart it with cache changes
and reminder suppression disabled:

```bash
bin/pan-run -- ./bin/pan governance reminder-relay stop
bin/pan-run -- ./bin/pan governance reminder-relay start --port 4040 --full --no-prompt-cache
```

`--no-prompt-cache` leaves the caller's cache fields intact. Startup options take
effect only on a new relay; inspect `/pan/health` for `prompt_cache`. Disable the
extension's automatic startup before a manual comparison. Restoring the original
provider URL also bypasses the relay. Native full reminders remain the fallback.

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
The cache regression in
[`reminder-cache-wire.test.ts`](../tests/regression/reminder-cache-wire.test.ts)
separately captures the final synthetic Responses body and verifies the `12h`
foundation, `30m` history, tool continuation, local TTL rejection, and unchanged
Chat Completions and unsupported models. Synthetic usage proves counter
preservation and excludes prompt text and credentials from audit records. Unit
checks cover prefix changes, split live tails, missing prefixes, incomplete SSE,
and bounded parsing. Existing reminder tests cover full delivery, cues, context
loss, role and child isolation, identity changes, and failed recovery.

```bash
bin/pan-run -- ./bin/run-built -- ./bin/run-tests -- node --test dist/tests/unit/reminder-cache.test.js dist/tests/unit/reminder-cache-usage.test.js dist/tests/regression/reminder-cache-wire.test.js dist/tests/unit/reminder-relay-packets.test.js dist/tests/unit/reminder-request.test.js dist/tests/unit/canonical-reminder.test.js dist/tests/regression/turn-reminder-cycles.test.js
```

Configured TTLs and synthetic billing records alone are not observed OpenAI
cache writes or reads. The separate native measurement below supplies live
Responses evidence. Before release, complete release verification and inspect the
editor-chat and Agents-window bridge paths independently. Observe reuse after a
gap greater than 30 minutes and less than 12 hours. Compare full reminders and
cues on the same governance tasks; restore full mode if behavior regresses.
Those delayed, bridge, and comparative checks remain outstanding. Direct executor
support remains separate; its local replay and `store: false` remain as before.

### Native development observation

On 2026-11-11, delivery run `63237_Nov-11-0839_native-cache` executed a synthetic
two-file task through Copilot CLI `1.0.107`, the OpenAI Responses provider, and
the workspace relay. The initial phase used the main checkout executor containing
the separately verified VS Code authentication repair. Subsequent phases use the
repaired `rem-cache-work` executor and relay, with model overrides and run state
in the same worktree. The selected model was `gpt-6.1-sol`; the harness compared
the CLI's reported model with that mapping. Its existing VS Code credential
source supplied authentication without exposing the key. The relay retained
counter and prefix metadata, excluding prompts, response bodies, and credentials.

The first request and its continuation returned these actual counters:

| Response        | Input tokens | Billed cache reads | 30m writes | 12h writes |
| --------------- | -----------: | -----------------: | ---------: | ---------: |
| Initial request |       21,021 |                  0 |        114 |      6,347 |
| Next request    |       23,315 |              6,461 |          0 |          0 |

Across the initial phase's two worker attempts, 25 responses supplied complete usage: **1,053,890
input tokens**, **148,614 billed cache-read tokens**, **228 tokens written for
30m**, and **12,695 tokens written for 12h**. There were 23 requests with billed
reads and two foundation identities across the fresh CLI processes. One
interrupted response had unavailable usage and is excluded from these totals.
This observation established cache activity, not acceptable cache efficiency.
Its explicit-only mode was subsequently found to leave growing tool-loop
history uncached. The correction and validation are documented below.

The measured cached share was **14.1% of input tokens**; an early cache boundary
does not imply that the whole growing conversation is cached.

The [measurement record](../runtime/logs/workflows/63237_Nov-11-0839_native-cache/agent/evidence/native-cache-observation.json)
aggregates the three explicitly owned relay logs while retaining each phase's
source digest, counters, coverage, request/response correlation, and foundation
identities. The 14.1% figure belongs only to the initial phase. The record derives
verification acceptance from the run's actual stage history rather than process
exit codes, and retains historical failures and observation gaps.

The first worker exceeded its 180-second allowance after the dummy test passed;
its retry completed in 212,244 ms. The resulting retry/watch/audit mismatch is
repaired with guarded retry rollover and protected sequential controller lineage.
Thirty-seven focused tests cover the observer repair. Subsequent native
implementation and remediation submissions were accepted.

Native recurring reminders also exposed a routing-cache write outside the
executor's writable runtime boundary. Moving that cache into runtime changed a
real sandbox probe from failed delivery (145 bytes) to full delivery (8,164 bytes);
17 focused tests cover persistence, migration, and recurrence. Actual native
review, QA, and verifier processes then completed through the relay after a
registered-frame truncation repair covered by 12 focused transport tests. The
relay records repeated full hook deliveries and request reminder counts without
retaining reminder content. Unknown cue identities still fail closed.

Independent QA collected the exact `CACHE_SMOKE_OK` result and complete tracked
diff from authorized harness operations. Historical byte preservation for
inherited untracked inputs remains unavailable and is retained as a nonblocking
risk. Final verification acceptance and its actual invocation are recorded in
the measurement record; a worker's pass alone does not establish acceptance.

This establishes live 12h writes, subsequent billed reads, and recurring native
hook delivery through the development executor. It does not establish elapsed
12h retention, cache reuse after an idle 30-minute gap, editor/Agents bridge
behavior, or reminder-compliance equivalence. Cached tokens still occupy context
and incur charges; a cache key cannot retrieve omitted prompt text.

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
