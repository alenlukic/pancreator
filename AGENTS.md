# AGENTS.md — Pancreator operating card

> Cross-tool entry contract (Linux Foundation Agentic AI Foundation).
> This file is the sole repository root operating card for agent harnesses.

## 1 — Repo identity

Pancreator is a simulated product-org agentic Delivery Pipeline (personas,
skills, pipelines, contracts). The repo is in **bootstrap**; see `docs/BOOTSTRAP.md`.
Product requirements live in `docs/PRD.md`, but routine work SHOULD route through
`docs/PRD.summary.md`, `docs/PRD.index.md`, and `docs/M1.index.md` first. Agents SHOULD read
full `docs/PRD.md` or `docs/BOOTSTRAP.md` only when the task needs authoritative wording,
phase-exit detail, citation repair, or line-anchored requirements per
`lib/memory/handbook/context-economy.md`.

## 2 — Routing map (canon and contracts)

Authoring canon sits under `lib/memory/handbook/`; every persona and contract MUST
cite handbook seeds. Quick routes: intent → `lib/memory/handbook/index.md`;
language → `lib/memory/handbook/glossary.md`; persona YAML and Cursor projection →
`lib/memory/handbook/persona-spec.md`; AGENTS change control →
`lib/memory/handbook/agents-md-authoring.md`.

| Topic | Path |
|---|---|
| Default AI context, indexing boundaries, explicit-read rules | `lib/memory/handbook/context-economy.md` |
| Memory-tier taxonomy and tier rules | `lib/memory/handbook/memory-tiers.md` |
| `simple task mode` | `lib/memory/handbook/context-economy.md` |
| M1/bootstrap routing before full PRD/BOOTSTRAP reads | `docs/M1.index.md` |
| Subagent invocation and model escalation | `lib/memory/handbook/context-economy.md` |
| Current context cost audit | `lib/memory/handbook/context-cost-audit.md` |
| `pancreator.yaml` phase and `project_root` config | `lib/memory/handbook/pancreator-config.md` |
| Operator how-to (feature delivery, CLI, validation) | `OPERATION.md` |
| `pan` CLI invocation (`pnpm -w exec pan`) | `lib/memory/handbook/pancreator-config.md` §“CLI invocation in this workspace” |
| Model and context escalation | `lib/memory/handbook/context-economy.md` |
| Active-memory orientation | `lib/memory/active/current.md` |
| Active-memory layout | `lib/memory/active/README.md` |
| Active planning/execution handoff pointers | `lib/memory/active/handoffs.md` |
| Post-task documentation impact | `lib/memory/handbook/documentation-impact-contract.md` |
| Governed-commit policy compliance artifact | `lib/memory/handbook/policy-compliance-contract.md` |
| Inbox lifecycle and operator sandbox | `lib/memory/handbook/inbox-lifecycle.md` |
| Operator completion output (next steps block) | `lib/memory/handbook/operator-output-contract.md` |
| Layer 1 normative style | `lib/memory/handbook/contract-style.md` |
| Clause wrapper schema | `lib/memory/handbook/contract-format.md` |
| Run log schema | `lib/memory/handbook/run-log-schema.md` |
| Contract templates | `lib/memory/handbook/contract-templates/` |
| Compact PRD orientation | `docs/PRD.summary.md` |
| PRD section triggers | `docs/PRD.index.md` |
| Full-source phase/spec authority | `docs/BOOTSTRAP.md`, `docs/PRD.md` |

## 3 — Where agents live

- `lib/personas/<name>.md` — Anthropic 16-field persona specs.
- `.cursor/agents/<name>.md` — canonical Cursor projection (one file per persona).
- `.cursor/rules/<name>.mdc` — Rule-layer projection where Cursor still
  requires it; persona files remain canonical.
- `lib/personas/skills/<name>/SKILL.md` — Agent Skills open-spec packs.
- `/lib/ensembles/<name>.yaml` — M4+ ensembles (no executable definitions yet).
- `/lib/pipelines/<name>.yaml` — M1+ pipeline DAGs (no executable definitions until
  runtime wiring lands).

Bootstrap seeds: `lib/personas/persona-designer.md`, `lib/personas/contract-writer.md`.
Phase-1 MVP roster, compact Cursor projections, rule shims, and MVP skills are present.
`qa-tester` (`lib/personas/qa-tester.md`) is a Phase-5 experimental bootstrap addition
to the MVP roster (`pancreator-stability: experimental`); it owns the `test` stage in
`feature-delivery` and was introduced after Phase 1; it is not a meta-persona and is
not self-protected by the clause below.
Both meta-personas are self-protected: no agent and no persona SHALL modify role
semantics, authority boundaries, tool grants, or safety constraints unless
explicit human ratification is recorded. Deterministic maintenance-only updates
(for example `references[].contentHash` refreshes, citation range realignment,
canonical or mirror parity sync) MAY proceed when policy-compliance and
documentation-impact obligations are satisfied.

## 4 — Pipeline-step delegation rule

When work maps to a persona’s `metadata.pancreator-pipeline-stages`, you SHALL
delegate to that persona rather than perform it directly unless `simple task
mode` forbids delegation.

1. **Planning/execution boundary.** When a planning persona emits a plan, touch-set,
   or ADR draft, the next action SHOULD be a delegated executor invocation with a
   compact generated prompt path, not more parent-agent implementation inside
   the same context window. The handoff card lives at
   `work/<day>/<task-id>/handoff.md`; the delegated prompt lives at
   `work/<day>/<task-id>/next-prompt.md`; `lib/memory/active/handoffs.md`
   stores pointers only. Operators SHOULD paste only `next-prompt.md` into the
   Cursor subagent and SHOULD NOT paste the full spec, prior chat transcript,
   PRD, bootstrap document, archival work, or broad directory listings.
2. **Native subagent invocation.** Each persona has exactly one canonical Cursor
   projection at `.cursor/agents/<name>.md`. Operators SHALL invoke that file
   directly (for example `/coder`). Model and context escalation guidance lives
   in `lib/memory/handbook/context-economy.md`. Claude Code and other harnesses
   SHALL use their equivalent single-projection routing when available.
3. **General-purpose fallback.** When no native invocation exists, when the
   operator is unsure which persona owns the task, or while infrastructure gaps
   prevent normal routing, start `.cursor/agents/general-purpose.md`. The agent
   should discover the route, keep context reads compact, and either delegate to
   the owning persona or perform bounded bridge work when no better owner exists.
4. **Persona-as-prompt fallback.** When a native Cursor projection is missing for
   a known persona, start the general-purpose agent, prepend the persona file
   contents to its system prompt, and name the target persona in the first message.
5. **Loop discipline.** A parent SHOULD NOT run multi-round planning plus
   implementation plus review in one context window. If execution exposes scope
   ambiguity, missing touch-set entries, or repeated validation failure, delegate
   back to the owning persona instead of extending the executor loop.
6. **Cost discipline.** Subagents isolate parent context; they do not guarantee
   lower total tokens. Avoid fan-out when multiple subagents would reload the
   same PRD, handbook, or archival context. When `pan run` or `pan advance`
   emits `nextPromptFile`, use that prompt as the delegated stage scope.

When no persona owns the work (for example bootstrap-only handbook authoring or
configuration scaffolding), use the general-purpose fallback in Cursor when a
separate agent context is useful; otherwise perform the work directly and cite
this section in your response.

## 5 — Working agreement

- **Delegation policy.** When a user prompt begins with an agent invocation token
  such as `/general-purpose`, the parent agent SHALL invoke the specified agent
  with the remainder of the prompt as the delegated task. The parent agent SHALL
  forward that remainder verbatim and SHALL NOT paraphrase, summarize, translate,
  reorder, or rewrite it. The parent agent SHALL NOT inject interpretation,
  inferred intent, assumptions, background context, prior-chat history, file
  contents, or directory listings into the delegated prompt unless the operator
  prompt or a generated `work/<day>/<task-id>/next-prompt.md` names that exact
  artifact. When the parent agent adds an operationally required reference such as
  a generated prompt path, the parent agent SHALL label it as parent-supplied and
  SHALL keep it to the minimal pointer the subagent needs to start. If the prompt
  contains no instructions specifically intended for the parent agent, the parent
  agent SHALL perform no repository reads, edits, or other actions beyond invoking
  the subagent, SHALL wait for the delegated agent to finish, and SHALL then
  report the delegated result to the user without editorializing the subagent
  output. For long-running delegated tasks, the parent agent SHALL perform a
  heartbeat status check every 2 minutes. If the delegated agent crashes, the
  parent agent SHALL retry invocation up to three times before reporting failure
  and the last observed error. If the prompt also contains instructions
  specifically intended for the parent agent, the parent agent SHALL execute only
  those instructions, SHALL sequence them before, during, or after delegation as
  the instructions require, and SHALL NOT expand them into adjacent unrequested
  work.
- **Stage diffs locally; never push.** No agent SHALL run `git push` or
  `git commit --no-verify`. Persona `disallowedTools` enforces this; AGENTS.md
  restates it for out-of-band tooling.
- **Documented durable directories are materialized on demand.** When
  agent-facing documentation names a durable repository directory and that
  directory is absent from the working tree, agents SHALL create the directory
  before reading, writing, listing, or failing on that path. In addition, agent
  SHALL create an empty .gitkeep file within the directory when Git tracks that
  path. This does not apply to generated, local-only, or placeholder-scoped
  paths such as `/lib/inbox/` (gitignored transient comms; see
  `lib/memory/handbook/inbox-lifecycle.md`), `/work/<day>/<task-id>/`,
  archive entries, `.pan/` sandboxes, or other run-specific directories.
- **Inbox is local-only.** `/lib/inbox/` holds transient operator ↔ org comms
  and is listed in `.gitignore`. Agents and tools SHALL materialize
  `/lib/inbox/{in,out,threads,notes}/` on demand; durable archival copies
  belong under `/archive/inbox/`.
- **Operator sandbox is off-limits.** `/lib/inbox/notes/` is human-operator-only.
  No agent SHALL read, traverse, ingest, cite, or modify any file under
  `/lib/inbox/notes/`. Only `/lib/inbox/in/` is the canonical incoming queue; operators
  SHALL promote a notes draft into `/lib/inbox/in/` before any agent acts on it.
  See `lib/memory/handbook/inbox-lifecycle.md` section 1a.
- **Human is the in-loop reviewer at every phase boundary.** The bootstrap
  authorizer is `LocalUserAuthorizer` (PRD section 10). The human ratifies each
  phase exit before the next phase starts.
- **Dual-anchor citations everywhere.** Every cross-reference uses canonical pretty JSON
  (`"kind"`, `"path"`, `"contentHash"`) per `lib/memory/handbook/glossary.md` §4 and
  `lib/personas/tech-writer.md` §Conformance gates. JS-literal `{kind: lines, ...}` form is forbidden.
  URLs without an anchored citation fail Layer 1 lint at `severity: block`.
- **Layer 1 lint is non-negotiable.** Body prose uses RFC 2119 keywords, EARS
  templates, atomic clauses, active voice, present tense, quantified numerics,
  glossary-resolved nouns, and no weasel words. See
  `lib/memory/handbook/contract-style.md`.
- **Documentation impact check is mandatory per task.** Every agent SHALL
  evaluate documentation or reference impact after each task and SHALL either
  apply required updates or record deferral rationale with backlog linkage per
  `lib/memory/handbook/documentation-impact-contract.md`.
- **Next operator steps on task completion.** When a bounded task completes,
  every agent SHALL append a final `## Next operator steps` section to
  operator-visible output per
  `lib/memory/handbook/operator-output-contract.md`. A single follow-up MUST
  state **What** and **How** (commands, paths, persona tokens) explicitly;
  read-only inspection MUST be labeled `Read-only:`. Multiple follow-ups MUST
  add **When to choose** and **Impact** per option. Parent agents summarizing
  delegated work SHALL include the block for the operator even when the
  subagent already emitted one. Shell steps MUST use fully formed copy-paste
  command blocks (explicit paths and flags); prose file shopping lists such as
  "stage X and the other touched files" are disallowed. Agents SHALL perform
  automatable work in-task rather than punt it to the operator when policy
  allows.
- **`pan` CLI invocation prefix.** This workspace does not install `pan` on
  the shell `PATH`. Every runnable command an agent emits for an operator MUST
  use `pnpm -w exec pan <subcommand> …` from the repository root, not bare
  `pan …`. Prose MAY name the logical verb; copy-paste **How** clauses MUST
  use the prefix per `lib/memory/handbook/pancreator-config.md`.
- **Policy-compliance artifact gate is mandatory for governed commits.** Tasks
  that stage structural changes outside active run work SHALL stage
  `/work/<day>/<task-id>/policy-compliance.json` per
  `lib/memory/handbook/policy-compliance-contract.md`; commit-time hooks enforce
  fail-closed behavior when the artifact is missing or invalid.
- **Stage exit criteria are non-negotiable.** This mirrors the PRD R-class
  circuit-breaker pattern; the bootstrap correctness ratchet is its own
  contract.
- **Bootstrap-only affordances are tagged.** Anything pulled forward (manual
  phase boundaries before the runner exists, hand-checked lints) carries
  `metadata.pancreator-bootstrap-only: true | false` so it can be retired or
  formalized later.
- **Commit trailer.** Every bootstrap commit MUST carry
  `Bootstrap-Phase: <N>` so the bootstrap is replayable end-to-end.

## 6 — What to do next

1. Read `lib/memory/active/current.md` for current pointers unless `simple task
   mode` applies. Operators and agents performing operator-facing work SHALL read
   `OPERATION.md` for inbox, feature-delivery, CLI, and pre-close validation
   procedure. For M1/bootstrap routing, read `docs/M1.index.md` before full
   `docs/BOOTSTRAP.md`. Agents SHOULD skim `docs/PRD.summary.md` and `docs/PRD.index.md`
   before loading full `docs/PRD.md`.
2. Check `/lib/inbox/in/` for directives (canonical queue every phase boundary).
3. Check `/lib/inbox/out/` for staged delivery reports.
4. Do NOT read `/lib/inbox/notes/`; it remains human-only per
   `lib/memory/handbook/inbox-lifecycle.md` section 1a.
5. When a directive maps to `metadata.pancreator-pipeline-stages`, follow
   section 4.

### 6.1 — Compliance-run trigger guidance

- During automation-deferred phases, agents SHALL support manual invocation via
  `operator-on-demand` and SHALL run descriptors under `tests/compliance/`
  against `tests/compliance/schemas/latest.yaml`.
- Agents SHALL trigger a compliance run after create, modify, or delete changes
  that touch personas, skills, pipeline definitions, documented operational
  primitives, testing infrastructure, operator interfaces, or milestone
  ratification artifacts.
- Scheduled cadence stays backlog-tracked until runtime scheduler wiring lands;
  agents SHALL NOT assume automatic cadence execution in the first slice.

6. Operators SHALL interpret `pan` JSON envelopes carrying `"status":"deferred"` as the canonical deferral protocol: each deferred verb exits **`125`** and documents `milestone`, `tracking_intake`, and `manual_workaround` in **`lib/internal/packages/@pancreator/cli/src/run.ts`**.
7. Operators SHALL author new **`lib/inbox/in/<utc-day>/<sid_hhmm_slug>.md`** directives with **`pnpm -w exec pan intake new <slug>`**, keeping UTC bucket naming aligned with **`lib/memory/handbook/inbox-lifecycle.md`** and **`lib/memory/features/timestamp-naming-conventions/spec.md`**.
8. Operators SHALL set **`lib/memory/active/current.md`** Active Feature bullets explicitly when work becomes active; the refresher SHALL NOT infer active work from the inbox queue. **`pnpm -w exec pan close-artifacts`** SHALL refresh shipped-feature rows and the managed operator-notes stamp and SHALL clear Active Feature to **`(none)`** when it matched the archived inbox source. Operators SHALL run **`pnpm -w exec pan refresh-active-memory [--dry-run]`** before other governed commits when those derived slices drift outside artifact closure (`lib/memory/features/*/index.json` remain the indexed source of truth).

## 7 — Workspace map

```
/AGENTS.md                       this file
/.cursor/agents/                 Cursor-native compact projections (one file per persona)
/.cursor/rules/                  Cursor rule shims (per-persona where required)
/lib/personas/                       persona specs (Anthropic 16-field)
/lib/personas/skills/                         skill packs (Agent Skills open spec)
/lib/pipelines/                      pipeline DAGs (YAML; M1+)
/lib/ensembles/                      ensemble configurations (M4+)
/lib/memory/handbook/                canonical reference: glossary, persona-spec, context economy
/lib/memory/active/                  active-memory tier (orientation and layout)
/lib/memory/adr/                     architecture decision records (Nygard format)
/lib/memory/rfc/{draft,accepted,rejected}/
/lib/memory/features/<id>/           per-feature artifacts (Spec-Kit aligned)
/lib/memory/smes/<name>/             per-SME private memory (M4+)
/lib/memory/backlog/                 ranked product backlog (M2+); debt via `tags: [debt]` on items
/lib/memory/checkpoints/<task-id>/   pipeline-state snapshots (LangGraph BaseCheckpointSaver v1)
/lib/memory/adoption/                adopter scan reports (M1, US-9)
/lib/memory/runbooks/                per-alert runbooks (M4+)
/lib/memory/postmortems/             blameless RCAs
/lib/memory/research/                founding research lineage
/lib/inbox/{in,out,threads}/         local transient comms (gitignored)
/lib/inbox/notes/                    human-only operator sandbox (gitignored; agents MUST NOT read or write)
/archive/inbox/in/                   durable archived inbound directives
/work/<day>/<task-id>/           active pipeline workspace; completed runs move to /archive/work/
/lib/internal/                        implementation corpus hidden from routine operator surface
/lib/internal/packages/               TypeScript workspace packages
/tests/                  repository-level tests and compliance fixtures
/lib/internal/tools/                  validation and maintenance scripts
/archive/work/           completed run artifacts; explicit-read only
/.pan/{worktrees,sandboxes,scheduler}/  control-plane state
/docs/                         high-level product and bootstrap documents
/docs/README.md                  docs directory guide
/docs/PRD.md                     product spec
/docs/M1.index.md                 compact M1/bootstrap route map
/docs/BOOTSTRAP.md                phase-by-phase bootstrap plan
/pancreator.yaml                  live policy, bootstrap tracking, and project_root
/pancreator-defaults.yaml         risk-tier defaults introduced during Phase 2
```

## 8 — Bootstrap status (live)

`pancreator.yaml` tracks the repo at Bootstrap Phase 5 with status
`m1-ratified`. Phases -1 through 5 are complete for tracking purposes:
scaffold, handbook seeds, persona roster, M1 substrate, static MVP pipelines,
ratified US-1 dogfood exit, US-9 xeremia-sandbox PoC, and embedded-install
operator-loop fixes. Human GO recorded 2026-05-31 in
`lib/memory/features/bootstrap-phase-5-m1-exit-close-docs-bootstrap/m1-closure-ratification-request.md`.
M2 planning opens via inbox.

The US-1 dogfood proof bundle was ratified on 2026-05-19. M1 bootstrap closure
was ratified on 2026-05-31. xeremia-sandbox US-9 greenfield evidence passed
in-repo evaluation on 2026-05-31; AC8 SDK smoke (task `69385_0443_us9-ac8-smoke`)
confirmed feature-delivery restart without rsync, bridge script, or
hand-authored inbox paths. Phoenix trace verification remains deferred per
`lib/memory/features/us-1-dogfood-phase-4-exit/phoenix-trace-evidence.md`.

When `runner.cursor.invocation: sdk` is set, `pnpm -w exec pan run` and
`pnpm -w exec pan advance` invoke CursorRunner for the entering stage. Manual
delegation remains available when SDK mode is omitted. `pnpm -w exec pan run
feature-delivery <inbox-entry>` creates the active-work state machine,
handoff card, bounded next-prompt, and run log. When a run reaches `complete`,
the librarian runs `pnpm -w exec pan close-artifacts <task-id>` after human
validation. `pnpm -w exec pan refresh-prompt <task-id>` regenerates prompt
files without changing state.

## 9 — Stability

This file is bootstrap-canonical. Changes require an inbox item and human
ratification. Promotion to `stability: stable` follows Phase 5 dogfood
validation.
