# AGENTS.md — Tesseract operating card

> Cross-tool entry contract (Linux Foundation Agentic AI Foundation).
> This file is the sole repository root operating card for agent harnesses.

## 1 — Repo identity

Tesseract is a simulated product-org agentic Delivery Pipeline (personas,
skills, pipelines, contracts). The repo is in **bootstrap**; see `docs/BOOTSTRAP.md`.
Product requirements live in `docs/PRD.md`, but routine work SHOULD route through
`docs/PRD.summary.md`, `docs/PRD.index.md`, and `docs/M1.index.md` first. Agents SHOULD read
full `docs/PRD.md` or `docs/BOOTSTRAP.md` only when the task needs authoritative wording,
phase-exit detail, citation repair, or line-anchored requirements per
`src/memory/handbook/context-economy.md`.

## 2 — Routing map (canon and contracts)

Authoring canon sits under `src/memory/handbook/`; every persona and contract MUST
cite handbook seeds. Quick routes: intent → `src/memory/handbook/index.md`;
language → `src/memory/handbook/glossary.md`; persona YAML and Cursor projection →
`src/memory/handbook/persona-spec.md`; AGENTS change control →
`src/memory/handbook/agents-md-authoring.md`.

| Topic | Path |
|---|---|
| Default AI context, indexing boundaries, explicit-read rules | `src/memory/handbook/context-economy.md` |
| Memory-tier taxonomy and tier rules | `src/memory/handbook/memory-tiers.md` |
| `simple task mode` | `src/memory/handbook/context-economy.md` |
| M1/bootstrap routing before full PRD/BOOTSTRAP reads | `docs/M1.index.md` |
| Subagent standard/complex model tiers | `src/memory/handbook/subagent-model-tiers.md` |
| Current context cost audit | `src/memory/handbook/context-cost-audit.md` |
| `tesseract.yaml` phase and `project_root` config | `src/memory/handbook/tesseract-config.md` |
| `tess` CLI invocation (`pnpm -w exec tess`) | `src/memory/handbook/tesseract-config.md` §“CLI invocation in this workspace” |
| Model and context escalation | `src/memory/handbook/context-economy.md` |
| Active-memory orientation | `src/memory/active/current.md` |
| Active-memory layout | `src/memory/active/README.md` |
| Active planning/execution handoff pointers | `src/memory/active/handoffs.md` |
| Post-task documentation impact | `src/memory/handbook/documentation-impact-contract.md` |
| Governed-commit policy compliance artifact | `src/memory/handbook/policy-compliance-contract.md` |
| Inbox lifecycle and operator sandbox | `src/memory/handbook/inbox-lifecycle.md` |
| Operator completion output (next steps block) | `src/memory/handbook/operator-output-contract.md` |
| Layer 1 normative style | `src/memory/handbook/contract-style.md` |
| Clause wrapper schema | `src/memory/handbook/contract-format.md` |
| Run log schema | `src/memory/handbook/run-log-schema.md` |
| Contract templates | `src/memory/handbook/contract-templates/` |
| Compact PRD orientation | `docs/PRD.summary.md` |
| PRD section triggers | `docs/PRD.index.md` |
| Full-source phase/spec authority | `docs/BOOTSTRAP.md`, `docs/PRD.md` |

## 3 — Where agents live

- `src/personas/<name>.md` — Anthropic 16-field persona specs.
- `.cursor/agents/<name>.md` — backward-compatible standard Cursor projection.
- `.cursor/agents/<name>-standard.md` and `<name>-complex.md` — economical and escalated Cursor variants.
- `.cursor/rules/<name>.mdc` — Rule-layer projection where Cursor still
  requires it; persona files remain canonical.
- `src/skills/<name>/SKILL.md` — Agent Skills open-spec packs.
- `/src/ensembles/<name>.yaml` — M4+ ensembles (no executable definitions yet).
- `/src/pipelines/<name>.yaml` — M1+ pipeline DAGs (no executable definitions until
  runtime wiring lands).

Bootstrap seeds: `src/personas/persona-designer.md`, `src/personas/contract-writer.md`.
Phase-1 MVP roster, compact Cursor projections, rule shims, and MVP skills are present.
Both meta-personas are self-protected: no agent and no persona SHALL modify role
semantics, authority boundaries, tool grants, or safety constraints unless
explicit human ratification is recorded. Deterministic maintenance-only updates
(for example `references[].contentHash` refreshes, citation range realignment,
canonical or mirror parity sync) MAY proceed when policy-compliance and
documentation-impact obligations are satisfied.

## 4 — Pipeline-step delegation rule

When work maps to a persona’s `metadata.tesseract-pipeline-stages`, you SHALL
delegate to that persona rather than perform it directly unless `simple task
mode` forbids delegation.

1. **Planning/execution boundary.** When a planning persona emits a plan, touch-set,
   or ADR draft, the next action SHOULD be a delegated executor invocation with a
   compact generated prompt path, not more parent-agent implementation inside
   the same context window. The handoff card lives at
   `src/work/<day>/<task-id>/handoff.md`; the delegated prompt lives at
   `src/work/<day>/<task-id>/next-prompt.md`; `src/memory/active/handoffs.md`
   stores pointers only. Operators SHOULD paste only `next-prompt.md` into the
   Cursor subagent and SHOULD NOT paste the full spec, prior chat transcript,
   PRD, bootstrap document, archival work, or broad directory listings.
2. **Native subagent invocation.** Cursor exposes standard and complex variants:
   `.cursor/agents/<name>-standard.md` is the default bounded-work variant and
   should use Cursor `auto` when that is the best economical default, but the
   suffix does not mandate a specific model; `.cursor/agents/<name>-complex.md`
   preserves the prior fixed model for that persona unless a human ratifies a
   model-policy change; `.cursor/agents/<name>.md` is a backward-compatible
   standard alias. Use standard by default. Use complex only for the escalation
   triggers in `src/memory/handbook/subagent-model-tiers.md`. Claude Code and
   other harnesses SHALL use their equivalent tiering when available.
3. **General-purpose fallback.** When no native invocation exists, when the
   operator is unsure which persona owns the task, or while infrastructure gaps
   prevent normal routing, start `.cursor/agents/general-purpose.md`. The agent
   should discover the route, keep context reads compact, and either delegate to
   the owning persona or perform bounded bridge work when no better owner exists.
4. **Persona-as-prompt fallback.** When a native Cursor projection is missing for
   a known persona, start the general-purpose agent, prepend the persona file
   contents to its system prompt, and name the persona plus intended tier in the
   first message.
5. **Loop discipline.** A parent SHOULD NOT run multi-round planning plus
   implementation plus review in one context window. If execution exposes scope
   ambiguity, missing touch-set entries, or repeated validation failure, delegate
   back to the owning persona instead of extending the executor loop.
6. **Cost discipline.** Subagents isolate parent context; they do not guarantee
   lower total tokens. Avoid fan-out when multiple subagents would reload the
   same PRD, handbook, or archival context. When `tess run` or `tess advance`
   emits `nextPromptFile`, use that prompt as the delegated stage scope.

When no persona owns the work (for example bootstrap-only handbook authoring or
configuration scaffolding), use the general-purpose fallback in Cursor when a
separate agent context is useful; otherwise perform the work directly and cite
this section in your response.

## 5 — Working agreement

- **Delegation policy.** When a user prompt begins with an agent invocation token
  such as `/general-purpose`, the parent agent SHALL invoke the specified agent
  with the remainder of the prompt as the delegated task. If the prompt contains
  no instructions specifically intended for the parent agent, the parent agent
  SHALL wait for the delegated agent to finish, then report the delegated result
  to the user. For long-running delegated tasks, the parent agent SHALL perform
  a heartbeat status check every 2 minutes. If the delegated agent crashes, the
  parent agent SHALL retry invocation up to three times before reporting failure
  and the last observed error. If the prompt also contains parent-agent
  instructions, the parent agent SHALL determine whether those instructions
  should run before, during, or after delegation, then execute them accordingly.
- **Stage diffs locally; never push.** No agent SHALL run `git push` or
  `git commit --no-verify`. Persona `disallowedTools` enforces this; AGENTS.md
  restates it for out-of-band tooling.
- **Documented durable directories are materialized on demand.** When
  agent-facing documentation names a durable repository directory and that
  directory is absent from the working tree, agents SHALL create the directory
  before reading, writing, listing, or failing on that path. In addition, agent
  SHALL create an empty .gitkeep file within the directory. This applies to
  canonical paths such as `/src/inbox/in/`, which Git may omit when empty. It
  does not apply to generated or placeholder-scoped paths such as
  `/src/work/<day>/<task-id>/`, archive entries, `.tess/` sandboxes, or other
  run-specific directories.
- **Operator sandbox is off-limits.** `/src/inbox/notes/` is human-operator-only.
  No agent SHALL read, traverse, ingest, cite, or modify any file under
  `/src/inbox/notes/`. Only `/src/inbox/in/` is the canonical incoming queue; operators
  SHALL promote a notes draft into `/src/inbox/in/` before any agent acts on it.
  See `src/memory/handbook/inbox-lifecycle.md` section 1a.
- **Human is the in-loop reviewer at every phase boundary.** The bootstrap
  authorizer is `LocalUserAuthorizer` (PRD section 10). The human ratifies each
  phase exit before the next phase starts.
- **Dual-anchor citations everywhere.** Every cross-reference is
  `{kind: 'symbol' | 'lines', path, contentHash}`. URLs without an anchored
  citation fail Layer 1 lint at `severity: block`.
- **Layer 1 lint is non-negotiable.** Body prose uses RFC 2119 keywords, EARS
  templates, atomic clauses, active voice, present tense, quantified numerics,
  glossary-resolved nouns, and no weasel words. See
  `src/memory/handbook/contract-style.md`.
- **Documentation impact check is mandatory per task.** Every agent SHALL
  evaluate documentation or reference impact after each task and SHALL either
  apply required updates or record deferral rationale with backlog linkage per
  `src/memory/handbook/documentation-impact-contract.md`.
- **Next operator steps on task completion.** When a bounded task completes,
  every agent SHALL append a final `## Next operator steps` section to
  operator-visible output per
  `src/memory/handbook/operator-output-contract.md`. A single follow-up MUST
  state **What** and **How** (commands, paths, persona tokens) explicitly;
  read-only inspection MUST be labeled `Read-only:`. Multiple follow-ups MUST
  add **When to choose** and **Impact** per option. Parent agents summarizing
  delegated work SHALL include the block for the operator even when the
  subagent already emitted one. Shell steps MUST use fully formed copy-paste
  command blocks (explicit paths and flags); prose file shopping lists such as
  "stage X and the other touched files" are disallowed. Agents SHALL perform
  automatable work in-task rather than punt it to the operator when policy
  allows.
- **`tess` CLI invocation prefix.** This workspace does not install `tess` on
  the shell `PATH`. Every runnable command an agent emits for an operator MUST
  use `pnpm -w exec tess <subcommand> …` from the repository root, not bare
  `tess …`. Prose MAY name the logical verb; copy-paste **How** clauses MUST
  use the prefix per `src/memory/handbook/tesseract-config.md`.
- **Policy-compliance artifact gate is mandatory for governed commits.** Tasks
  that stage structural changes outside active run work SHALL stage
  `/src/work/<day>/<task-id>/policy-compliance.json` per
  `src/memory/handbook/policy-compliance-contract.md`; commit-time hooks enforce
  fail-closed behavior when the artifact is missing or invalid.
- **Stage exit criteria are non-negotiable.** This mirrors the PRD R-class
  circuit-breaker pattern; the bootstrap correctness ratchet is its own
  contract.
- **Bootstrap-only affordances are tagged.** Anything pulled forward (manual
  phase boundaries before the runner exists, hand-checked lints) carries
  `metadata.tesseract-bootstrap-only: true | false` so it can be retired or
  formalized later.
- **Commit trailer.** Every bootstrap commit MUST carry
  `Bootstrap-Phase: <N>` so the bootstrap is replayable end-to-end.

## 6 — What to do next

1. Read `src/memory/active/current.md` for current pointers unless `simple task
   mode` applies. For M1/bootstrap routing, read `docs/M1.index.md` before full
   `docs/BOOTSTRAP.md`. Agents SHOULD skim `docs/PRD.summary.md` and `docs/PRD.index.md`
   before loading full `docs/PRD.md`.
2. Check `/src/inbox/in/` for directives (canonical queue every phase boundary).
3. Check `/src/inbox/out/` for staged delivery reports.
4. Do NOT read `/src/inbox/notes/`; it remains human-only per
   `src/memory/handbook/inbox-lifecycle.md` section 1a.
5. When a directive maps to `metadata.tesseract-pipeline-stages`, follow
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

6. Operators SHALL interpret `tess` JSON envelopes carrying `"status":"deferred"` as the canonical deferral protocol: each deferred verb exits **`125`** and documents `milestone`, `tracking_intake`, and `manual_workaround` in **`src/internal/packages/@tesseract/cli/src/run.ts`**.
7. Operators SHALL author new **`src/inbox/in/<utc-day>/<sid_hhmm_slug>.md`** directives with **`pnpm -w exec tess intake new <slug>`**, keeping UTC bucket naming aligned with **`src/memory/handbook/inbox-lifecycle.md`** and **`src/memory/features/timestamp-naming-conventions/spec.md`**.
8. Operators SHALL set **`src/memory/active/current.md`** Active Feature bullets explicitly when work becomes active; the refresher SHALL NOT infer active work from the inbox queue. **`pnpm -w exec tess close-artifacts`** SHALL refresh shipped-feature rows and the managed operator-notes stamp and SHALL clear Active Feature to **`(none)`** when it matched the archived inbox source. Operators SHALL run **`pnpm -w exec tess refresh-active-memory [--dry-run]`** before other governed commits when those derived slices drift outside artifact closure (`src/memory/features/*/index.json` remain the indexed source of truth).

## 7 — Workspace map

```
/AGENTS.md                       this file
/.cursor/agents/                 Cursor-native compact projections and standard/complex variants
/.cursor/rules/                  Cursor rule shims (per-persona where required)
/src/personas/                       persona specs (Anthropic 16-field)
/src/skills/                         skill packs (Agent Skills open spec)
/src/pipelines/                      pipeline DAGs (YAML; M1+)
/src/ensembles/                      ensemble configurations (M4+)
/src/memory/handbook/                canonical reference: glossary, persona-spec, context economy, subagent tiers
/src/memory/active/                  active-memory tier (orientation and layout)
/src/memory/adr/                     architecture decision records (Nygard format)
/src/memory/rfc/{draft,accepted,rejected}/
/src/memory/features/<id>/           per-feature artifacts (Spec-Kit aligned)
/src/memory/smes/<name>/             per-SME private memory (M4+)
/src/memory/backlog/                 ranked product backlog (M2+)
/src/memory/debt/                    technical-debt inventory (M3+, US-7)
/src/memory/checkpoints/<task-id>/   pipeline-state snapshots (LangGraph BaseCheckpointSaver v1)
/src/memory/adoption/                adopter scan reports (M1, US-9)
/src/memory/runbooks/                per-alert runbooks (M4+)
/src/memory/postmortems/             blameless RCAs
/src/memory/research/                founding research lineage
/src/inbox/{in,out,threads}/         human ↔ org message queue
/src/inbox/notes/                    human-only operator sandbox (agents MUST NOT read or write)
/src/work/<day>/<task-id>/           active pipeline workspace; completed runs move to /src/internal/work_archive/
/src/internal/                        implementation corpus hidden from routine operator surface
/src/internal/packages/               TypeScript workspace packages
/tests/                  repository-level tests and compliance fixtures
/src/internal/tools/                  validation and maintenance scripts
/src/internal/work_archive/           completed run artifacts; explicit-read only
/.tess/{worktrees,sandboxes,scheduler}/  control-plane state
/docs/                         high-level product and bootstrap documents
/docs/README.md                  docs directory guide
/docs/PRD.md                     product spec
/docs/M1.index.md                 compact M1/bootstrap route map
/docs/BOOTSTRAP.md                phase-by-phase bootstrap plan
/tesseract.yaml                  live policy, bootstrap tracking, and project_root
/tesseract-defaults.yaml         risk-tier defaults introduced during Phase 2
```

## 8 — Bootstrap status (live)

`tesseract.yaml` tracks the repo at Bootstrap Phase 4 with status
`phase-4-ratified`. Phases -1 through 3 are treated as complete for
tracking purposes: the repo contains the scaffold, handbook seeds, persona
roster, Cursor projections, M1 contract feature folders, substrate package
implementations, and static MVP pipeline definitions. The US-1 dogfood exit is
ratified: the proof bundle is accepted, pause/resume/abort evidence is captured,
and the nested runs `77373_0230_phase-4-dogfood-proof-bundle-evidence-index`
and `71096_0415_phase-4-intervention-probe-pause-resume-abort` are closed.
Phoenix trace verification remains deferred per
`src/memory/features/us-1-dogfood-phase-4-exit/phoenix-trace-evidence.md` as
an `@tesseract/run-logger` and `tesseract-engineer` backlog item. `pnpm -w exec
tess run feature-delivery <inbox-entry>` now creates a Phase-4 active-work
state machine, handoff card, bounded next-prompt, and run log. Operators still
invoke Cursor personas manually, then use `pnpm -w exec tess advance` with the
accepted stage artifact; `repair-state` is reserved for explicit ledger recovery
after out-of-band work. When a run reaches `complete`, `next-prompt.md` is a
bounded librarian handoff for agent-executed artifact closure. The librarian
runs `pnpm -w exec tess close-artifacts <task-id>` to archive the active work
directory and source inbox item after human validation/indexing are complete.
`pnpm -w exec tess refresh-prompt <task-id>` regenerates prompt files from the
current ledger without changing state. It does not yet automate Cursor/model
transport or LangGraph execution.

## 9 — Stability

This file is bootstrap-canonical. Changes require an inbox item and human
ratification. Promotion to `stability: stable` follows Phase 5 dogfood
validation.
