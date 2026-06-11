# AGENTS.md — Agent operating card

> Internal surface (explicit-read). Cross-tool entry contract (Linux Foundation
> Agentic AI Foundation). Human operators use [`OPERATION.md`](OPERATION.md);
> embedded installs mirror this card at `.pancreator/AGENTS.md`.

## 1 — Repo identity

Pancreator is a simulated product-org agentic Delivery Pipeline (personas,
skills, pipelines, contracts). Runtime policy lives in `pancreator.yaml`
(`project_root`, `runner`, `risk_tier`). Current work routes through inbox,
`lib/memory/active/current.md`, and feature indexes.

Product requirements for Pancreator self-development live in `.docs/PRD.md`.
Route through `.docs/PRD.summary.md`, `.docs/PRD.index.md`, and `.docs/M1.index.md`
before full `.docs/PRD.md` or `.docs/BOOTSTRAP.md` when the task needs product
authority per `lib/memory/handbook/context-economy.md`.

## 2 — Routing map

Authoring canon sits under `lib/memory/handbook/`; every persona and contract
MUST cite handbook seeds. Quick routes: intent → `lib/memory/handbook/index.md`;
language → `lib/memory/handbook/glossary.md`; persona spec →
`lib/memory/handbook/persona-spec.md`; AGENTS change control →
`lib/memory/handbook/agents-md-authoring.md`.

| Topic | Path |
|---|---|
| External vs internal surfaces | `lib/memory/adr/0008-external-vs-internal-surfaces.md` |
| Default AI context and indexing | `lib/memory/handbook/context-economy.md` |
| Engineering standards (write/review/test code) | `lib/memory/handbook/engineering/index.md` |
| Memory-tier taxonomy | `lib/memory/handbook/memory-tiers.md` |
| `simple task mode` | `lib/memory/handbook/context-economy.md` |
| Human operator procedures | `OPERATION.md` |
| `pan` CLI invocation | `lib/memory/handbook/pancreator-config.md` §“CLI invocation in this workspace” |
| Feature-delivery SDK progress relay | `AGENTS.md` §5 | `OPERATION.md` § SDK mode |
| Compliance run triggers | `lib/memory/handbook/compliance-runs.md` |
| Active-memory orientation | `lib/memory/active/current.md` |
| Inbox lifecycle | `lib/memory/handbook/inbox-lifecycle.md` |
| Operator completion output | `lib/memory/handbook/operator-output-contract.md` |
| Operator verification at close | `lib/memory/handbook/contract-templates/operator-verification.template.md` |
| Layer 1 contract style | `lib/memory/handbook/contract-style.md` |
| Documentation impact | `lib/memory/handbook/documentation-impact-contract.md` |
| Compact PRD orientation (self-dev) | `.docs/PRD.summary.md` |
| PRD section triggers (self-dev) | `.docs/PRD.index.md` |
| Full product spec (self-dev) | `.docs/PRD.md`, `.docs/BOOTSTRAP.md` |

## 3 — Where agents live

- `lib/personas/<name>.md` — Anthropic 16-field persona specs (canonical source).
- `lib/personas/rules/<name>.yaml` — tool-agnostic persona rule specs; emitted to `.cursor/rules/` by `pan cursor-sync`.
- `.cursor/agents/<name>.md` — local Cursor agent projection (gitignored); emitted from personas by `pan cursor-sync` or `pan init --apply`.
- `.cursor/rules/<name>.mdc` — local Cursor rule projection (gitignored); emitted from `lib/personas/rules/`.
- `lib/personas/skills/<name>/SKILL.md` — Agent Skills open-spec packs.
- `lib/pipelines/<name>.yaml` — pipeline DAGs (YAML).
- `lib/ensembles/<name>.yaml` — M4+ ensembles (no executable definitions yet).

Bootstrap seeds: `lib/personas/persona-designer.md`, `lib/personas/contract-writer.md`.
`qa-tester` is experimental (`pancreator-stability: experimental`); it owns the
`test` stage in `feature-delivery` and is not a meta-persona.

Meta-personas (`persona-designer`, `contract-writer`) are self-protected: no agent
SHALL modify role semantics, authority boundaries, tool grants, or safety constraints
unless explicit human ratification is recorded. Deterministic maintenance-only updates
(for example `references[].contentHash` refreshes, citation range realignment,
canonical or mirror parity sync) MAY proceed when documentation-impact obligations
are satisfied.

## 4 — Pipeline-step delegation rule

When work maps to a persona's `metadata.pancreator-pipeline-stages`, you SHALL
delegate to that persona rather than perform it directly unless `simple task
mode` forbids delegation.

1. **Planning/execution boundary.** Handoff at `.pan/work/<day>/<task-id>/handoff.md`;
   delegated prompt at `.pan/work/<day>/<task-id>/next-prompt.md`; pointers only in
   `lib/memory/active/handoffs.md`. Paste only `next-prompt.md` into subagents.
2. **Native subagent invocation.** One canonical `.cursor/agents/<name>.md` per persona
   (for example `/coder`, `/tech-lead`). Model escalation:
   `lib/memory/handbook/context-economy.md`.
3. **General-purpose fallback.** Start `.cursor/agents/general-purpose.md` when routing
   is unclear.
4. **Persona-as-prompt fallback.** Prepend persona file to general-purpose when projection
   is missing; name the target persona in the first message.
5. **Loop discipline.** Do not run multi-round plan + implement + review in one context.
6. **Cost discipline.** Avoid fan-out that reloads the same handbook or archival context.
   Use `nextPromptFile` from `pan run` / `pan advance` as delegated scope.
7. **Persona supremacy on delegation.** When a parent agent invokes a named persona
   (operator `/name` token or native subagent routing), the target persona spec at
   `lib/personas/<name>.md` and its Cursor projection at `.cursor/agents/<name>.md`
   are the **sole authority** for role semantics, authority boundaries, tool grants,
   forbidden actions, and output shape. The parent SHALL forward only the operator
   remainder or `next-prompt.md` scope; it SHALL NOT inject goals, workflows, or
   constraints that contradict the target persona. Parent projections, user rules,
   skills, and parent-composed Task prompts **never** override the target persona.
   On any conflict, the target persona wins unconditionally.

When no persona owns the work (for example bootstrap-only handbook authoring or
configuration scaffolding), use the general-purpose fallback when a separate agent
context is useful; otherwise perform the work directly and cite this section.

## 5 — Working agreement

- **Delegation policy.** When a user prompt begins with an agent invocation token
  such as `/general-purpose`, `/coder`, or another `.cursor/agents/<name>.md`
  slug, the parent agent SHALL invoke the specified agent with the remainder of
  the prompt as the delegated task. The parent SHALL forward that remainder
  verbatim and SHALL NOT paraphrase, summarize, translate, reorder, or rewrite
  it. The parent SHALL NOT inject interpretation, inferred intent, assumptions,
  background context, prior-chat history, file contents, or directory listings
  into the delegated prompt unless the operator prompt or a generated
  `.pan/work/<day>/<task-id>/next-prompt.md` names that exact artifact. When the parent
  adds an operationally required reference such as a generated prompt path, the
  parent SHALL label it as parent-supplied and keep it to the minimal pointer the
  subagent needs to start.
  **Persona supremacy:** the invoked persona spec and its Cursor projection always
  govern what the subagent may do, forbid, and emit. The parent MUST NOT override,
  reinterpret, or substitute the target persona's contract—not via Task prompt
  text, not via parent `.cursor/agents/*.md` prose, and not by applying user
  rules or skills meant for the parent. Delegated scope (`next-prompt.md`, operator
  remainder) bounds *what* to work on; it does not redefine *how* the persona
  operates. If the prompt contains no instructions specifically intended for the
  parent agent, the parent SHALL perform no repository reads, edits, or other
  actions beyond invoking the subagent, SHALL wait for the delegated agent to
  finish, and SHALL report the delegated result without editorializing the
  subagent output. For long-running delegated tasks, the parent SHALL perform a
  heartbeat status check every 2 minutes. If the delegated agent crashes, the
  parent SHALL retry invocation up to three times before reporting failure and the
  last observed error. If the prompt also contains instructions specifically
  intended for the parent agent, the parent SHALL execute only those instructions
  and SHALL NOT expand them into adjacent unrequested work.
- **Pipeline env (mandatory).** Before any `pnpm -w exec pan run`, `pan advance`,
  or other pipeline invocation on the operator's behalf, agents SHALL run
  `set -a && source .env && set +a` from repository root. Feature-delivery runs
  execute as single runs from the main checkout; parallel delivery and batch
  orchestration are disabled.
- **Feature-delivery SDK progress in chat.** When an agent runs
  `pnpm -w exec pan run feature-delivery`, `pnpm -w exec pan feature new`,
  `pnpm -w exec pan advance`, or `pnpm -w exec pan repair-state` on the
  operator's behalf while `runner.cursor.invocation: sdk` is set, the agent
  SHALL prefix the command with `PAN_FD_PROGRESS=ndjson`, monitor stderr for
  `"event":"feature_delivery_progress"` lines, and post a concise
  operator-visible chat update for each `stage_enter`, `stage_transition`,
  `heartbeat`, and `stage_complete` event before the command finishes. The agent
  SHALL treat **stderr** as progress-only and **stdout** as the final JSON
  envelope. Chat updates MUST NOT paste raw NDJSON; they SHALL name `taskId`,
  `stageId`, optional `persona`, elapsed time on heartbeats (from `elapsedMs`),
  and transition targets (`fromStage`, `toStage`, `transitionEvent`) when
  present. Operators in an interactive terminal receive `[pan fd] …` on stderr
  automatically; see `OPERATION.md` § SDK mode.

  | Progress `kind` | Chat update (example) |
  |---|---|
  | `stage_enter` | Feature-delivery `task-1`: entering `plan` (tech-lead) |
  | `heartbeat` | Feature-delivery `task-1`: `plan` (tech-lead) still running — 4m 0s |
  | `stage_complete` | Feature-delivery `task-1`: finished `plan` (tech-lead) in 6m 12s |
  | `stage_transition` | Feature-delivery `task-1`: `plan` → `implement` (human_approval) |

  Example invocation:

  ```bash
  set -a && source .env && set +a
  PAN_FD_PROGRESS=ndjson pnpm -w exec pan run feature-delivery 172979_05-27-26/16605_1923_bootstrap-de-hacking-pass.md
  ```
- **Build-mode inbox scaffolding.** When an operator submits a net-new product or
  pipeline request through Cursor Build mode without naming an existing
  `lib/inbox/in/` directive, the agent SHALL present a plan before implementation
  edits. Upon plan completion and before the first repository edit that implements
  the plan, the agent SHALL run
  `pnpm -w exec pan intake from-build-plan <slug>` with `--title`,
  `--operator-prompt`, and `--plan-text` (or `--prompt-file` / `--plan-file`
  when shell-escaping is awkward). The agent SHALL choose `<slug>` as a lowercase
  hyphenated feature id derived from the request title. When the operator named
  an existing inbox path or an active `.pan/work/<day>/<task-id>/` run owns the work,
  the agent SHALL NOT create a duplicate directive. When `simple task mode`
  applies, the agent SHALL NOT create an inbox directive. Human procedure detail:
  `OPERATION.md` § Inbox lifecycle.
- **Engineering standards.** Agents that write, review, refactor, debug, or test
 code SHALL apply `lib/memory/handbook/engineering/software-engineering.md`; agents
 that author or modify TypeScript, ES2022+, or ESM-aware tooling SHALL also apply
 `lib/memory/handbook/engineering/typescript.md`. Route through
 `lib/memory/handbook/engineering/index.md` to select the minimum applicable set.
- **Stage diffs locally; never push.** No `git push` or `git commit --no-verify`.
- **No agent opens pull requests.** No agent or subagent SHALL run `gh pr create`,
  `gh pr merge`, or any command that creates, opens, or publishes a remote pull
  request. Remote PR creation is a human-operator action only.
- **`/pr-writer` is draft-only.** When the operator invokes `/pr-writer`, the parent
  agent SHALL delegate with the remainder of the prompt only (which MAY be empty)
  and SHALL NOT add create/push/open-PR instructions. The `pr-writer` persona
  emits one fenced Markdown PR body in chat plus `## Next operator steps` outside
  the fence; the operator paste-applies the body into `gh pr create`. The parent
  SHALL NOT report a PR as opened unless the operator explicitly did so outside the
  agent session.
- **Materialize documented directories on demand.** When agent-facing documentation
  names a durable repository directory and that directory is absent, agents SHALL
  create it before reading, writing, listing, or failing on that path and SHALL
  add `.gitkeep` when Git tracks the path. This does not apply to generated,
  local-only, or run-scoped paths such as `lib/inbox/`, `.pan/work/<day>/<task-id>/`,
  archive entries, or `.pan/sandboxes/` workspace trees.
- **Inbox is local-only** under `lib/inbox/`; never read or modify `lib/inbox/notes/`.
  Durable archival copies belong under `.pan/archive/inbox/`.
- **Human in-loop** at phase boundaries (`LocalUserAuthorizer`).
- **Dual-anchor citations** per `lib/memory/handbook/glossary.md` §4. JS-literal
  `{kind: lines, ...}` form is forbidden.
- **Layer 1 lint** per `lib/memory/handbook/contract-style.md`.
- **Documentation impact** per `lib/memory/handbook/documentation-impact-contract.md`.
- **Next operator steps** per `lib/memory/handbook/operator-output-contract.md`.
- **`pan` CLI prefix:** `pnpm -w exec pan …` from repository root.
- **Librarian pre-close validation** per `OPERATION.md` § Pre-close validation checklist.
- **Operator verification at close** per operator-verification template.
- **Compliance runs** after changes to personas, skills, pipelines, or operator
  interfaces per `lib/memory/handbook/compliance-runs.md`.
- **Stage exit criteria** are non-negotiable.

## 6 — What to do next

1. Read `lib/memory/active/current.md` unless `simple task mode` applies.
2. Read `OPERATION.md` when human procedure context is required.
3. Check `lib/inbox/in/` for directives; `lib/inbox/out/` for delivery reports.
4. When a directive maps to pipeline stages, follow §4.
5. Author inbox entries with `pnpm -w exec pan intake new <slug>`, keeping bucket
   naming aligned with `lib/memory/handbook/inbox-lifecycle.md` and
   `lib/memory/features/timestamp-naming-conventions/spec.md`.
6. Close runs: `pnpm -w exec pan close-artifacts <task-id>` after human validation.
7. Interpret `pan` deferral envelopes (`"status":"deferred"`, exit **125**) per
   `lib/internal/packages/@pancreator/cli/src/run.ts`.
8. Set `lib/memory/active/current.md` Active Feature bullets explicitly when work
   becomes active; run `pnpm -w exec pan refresh-active-memory [--dry-run]` when
   derived slices drift. `close-artifacts` refreshes shipped rows and clears Active
   Feature to `(none)` when it matched the archived inbox source.
   `lib/memory/features/*/index.json` remain the indexed source of truth.

### 6.1 — Pancreator self-development

1. Read `.docs/PRD.summary.md` and `.docs/PRD.index.md` for product orientation.
2. Read `lib/memory/backlog/index.yaml` for ranked work.
3. Read full `.docs/PRD.md` or `.docs/BOOTSTRAP.md` only when line-anchored authority
   is required per `lib/memory/handbook/context-economy.md`.

### 6.2 — Compliance-run trigger guidance

Agents SHALL follow `lib/memory/handbook/compliance-runs.md`: run descriptors under
`tests/compliance/` against `tests/compliance/schemas/latest.yaml` after qualifying
structure changes or on `operator-on-demand`; do not assume scheduled cadence until
scheduler wiring lands.

## 7 — Workspace map

```
/AGENTS.md                       this file (internal)
/README.md                       external landing (high-level)
/OPERATION.md                    external operator procedures (human)
/.docs/                           internal product documents (local-only; gitignored)
/lib/personas/rules/             tool-agnostic persona rule specs (emitted to .cursor/rules/)
/.cursor/agents/                 local Cursor agent projections (gitignored; cursor-sync)
/.cursor/rules/                  local Cursor rule shims (gitignored; cursor-sync)
/lib/personas/                   persona specs
/lib/personas/skills/            skill packs (Agent Skills open spec)
/lib/pipelines/                  pipeline DAGs (YAML)
/lib/ensembles/                  ensemble configurations (M4+)
/lib/memory/handbook/            authoring canon
/lib/memory/active/              active-memory pointers
/lib/memory/features/<id>/       per-feature artifacts
/lib/memory/adr/                 architecture decision records
/lib/memory/backlog/             ranked product backlog
/lib/memory/rfc/{draft,accepted,rejected}/
/lib/memory/checkpoints/<task-id>/  pipeline-state snapshots
/lib/memory/adoption/            adopter scan reports
/lib/memory/research/            founding research lineage
/lib/inbox/{in,out,threads}/     transient comms (gitignored)
/lib/inbox/notes/                human-only (agents MUST NOT read)
/.pan/archive/inbox/in/               durable archived inbound directives
/.pan/work/<day>/<task-id>/           active pipeline workspace
/.pan/archive/work/                   completed runs (explicit-read)
/.pan/sandboxes/                      operator/agent scratch QA + port registry (gitignored)
/lib/internal/packages/          TypeScript packages
/lib/internal/tools/             validation scripts
/client/                         Command Center (Next.js; de-indexed)
/tests/                          repository tests
/.pan/scheduler/                 scheduler/intervention control-plane state
/pancreator.yaml                 live policy and project_root
/pancreator-defaults.yaml        risk-tier defaults (not live config)
```

## 8 — Runtime defaults

`pancreator.yaml` holds live runtime policy: `project_root`, `runner`,
`risk_tier`, and related knobs. It does not track closed bootstrap phase status;
do not use bootstrap completion as a primary routing or behavior gate.

Current work routes through inbox directives, `lib/memory/active/current.md`,
and `lib/memory/features/*/index.json`. Closed bootstrap history lives in
`.docs/BOOTSTRAP.md` and ratification artifacts under
`lib/memory/features/bootstrap-phase-*` for explicit replay only.

When `runner.cursor.invocation: sdk` is set, `pnpm -w exec pan run` and
`pnpm -w exec pan advance` invoke CursorRunner for the entering stage. Manual
delegation remains available when SDK mode is omitted. `pnpm -w exec pan run
feature-delivery <inbox-entry>` creates handoff, next-prompt, and run log.
When a run reaches `complete`, the librarian runs
`pnpm -w exec pan close-artifacts <task-id>` after human validation.
`pnpm -w exec pan refresh-prompt <task-id>` regenerates prompt files without
changing state.

## 9 — Stability

Changes to this file require an inbox item and human ratification per
`lib/memory/handbook/agents-md-authoring.md`. Promotion to `stability: stable`
follows Phase 5 dogfood validation.
