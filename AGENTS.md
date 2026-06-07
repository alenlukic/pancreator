# AGENTS.md — Agent operating card

> Internal surface (explicit-read). Cross-tool entry contract (Linux Foundation
> Agentic AI Foundation). Human operators use [`OPERATION.md`](OPERATION.md);
> embedded installs mirror this card at `.pancreator/AGENTS.md`.

## 1 — Repo identity

Pancreator is a simulated product-org agentic Delivery Pipeline (personas,
skills, pipelines, contracts). Runtime policy lives in `pancreator.yaml`
(`project_root`, `runner`, `risk_tier`). Current work routes through inbox,
`lib/memory/active/current.md`, and feature indexes.

Product requirements for Pancreator self-development live in `docs/PRD.md`.
Route through `docs/PRD.summary.md`, `docs/PRD.index.md`, and `docs/M1.index.md`
before full `docs/PRD.md` or `docs/BOOTSTRAP.md` when the task needs product
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
| Memory-tier taxonomy | `lib/memory/handbook/memory-tiers.md` |
| `simple task mode` | `lib/memory/handbook/context-economy.md` |
| Human operator procedures | `OPERATION.md` |
| `pan` CLI invocation | `lib/memory/handbook/pancreator-config.md` §“CLI invocation in this workspace” |
| Feature-delivery SDK progress relay | `AGENTS.md` §5 | `OPERATION.md` § SDK mode |
| Active-memory orientation | `lib/memory/active/current.md` |
| Inbox lifecycle | `lib/memory/handbook/inbox-lifecycle.md` |
| Operator completion output | `lib/memory/handbook/operator-output-contract.md` |
| Operator verification at close | `lib/memory/handbook/contract-templates/operator-verification.template.md` |
| Layer 1 contract style | `lib/memory/handbook/contract-style.md` |
| Documentation impact | `lib/memory/handbook/documentation-impact-contract.md` |
| Compact PRD orientation (self-dev) | `docs/PRD.summary.md` |
| PRD section triggers (self-dev) | `docs/PRD.index.md` |
| Full product spec (self-dev) | `docs/PRD.md`, `docs/BOOTSTRAP.md` |

## 3 — Where agents live

- `lib/personas/<name>.md` — Anthropic 16-field persona specs.
- `.cursor/agents/<name>.md` — canonical Cursor projection (one file per persona).
- `.cursor/rules/<name>.mdc` — Rule-layer projection where Cursor still requires it.
- `lib/personas/skills/<name>/SKILL.md` — Agent Skills open-spec packs.
- `lib/pipelines/<name>.yaml` — pipeline DAGs (YAML).

Bootstrap seeds: `lib/personas/persona-designer.md`, `lib/personas/contract-writer.md`.
`qa-tester` is experimental (`pancreator-stability: experimental`).

Meta-personas (`persona-designer`, `contract-writer`) are self-protected: no agent
SHALL modify role semantics, authority boundaries, tool grants, or safety constraints
unless explicit human ratification is recorded.

## 4 — Pipeline-step delegation rule

When work maps to a persona's `metadata.pancreator-pipeline-stages`, you SHALL
delegate to that persona rather than perform it directly unless `simple task
mode` forbids delegation.

1. **Planning/execution boundary.** Handoff at `work/<day>/<task-id>/handoff.md`;
   delegated prompt at `work/<day>/<task-id>/next-prompt.md`; pointers only in
   `lib/memory/active/handoffs.md`. Paste only `next-prompt.md` into subagents.
2. **Native subagent invocation.** One canonical `.cursor/agents/<name>.md` per persona.
   Model escalation: `lib/memory/handbook/context-economy.md`.
3. **General-purpose fallback.** Start `.cursor/agents/general-purpose.md` when routing
   is unclear.
4. **Persona-as-prompt fallback.** Prepend persona file to general-purpose when projection
   is missing; name the target persona in the first message.
5. **Loop discipline.** Do not run multi-round plan + implement + review in one context.
6. **Cost discipline.** Avoid fan-out that reloads the same handbook or archival context.
   Use `nextPromptFile` from `pan run` / `pan advance` as delegated scope.

## 5 — Working agreement

- **Delegation policy.** When a user prompt begins with `/persona`, forward the
  remainder verbatim; do not paraphrase or inject context unless the bounded
  prompt names an artifact. Parent performs only subagent invocation unless the
  prompt also targets the parent.
- **Feature-delivery SDK progress in chat.** Prefix with `PAN_FD_PROGRESS=ndjson`;
  monitor stderr for `feature_delivery_progress`; post concise chat updates per
  stage/heartbeat. See `OPERATION.md` § SDK mode.
- **Build-mode inbox scaffolding.** After plan completion, before first implementation
  edit: `pnpm -w exec pan intake from-build-plan <slug>`.
- **Stage diffs locally; never push.** No `git push` or `git commit --no-verify`.
- **Materialize documented directories on demand** with `.gitkeep` when Git tracks the path.
- **Inbox is local-only** under `lib/inbox/`; never read or modify `lib/inbox/notes/`.
- **Human in-loop** at phase boundaries (`LocalUserAuthorizer`).
- **Dual-anchor citations** per `lib/memory/handbook/glossary.md` §4.
- **Layer 1 lint** per `lib/memory/handbook/contract-style.md`.
- **Documentation impact** per `lib/memory/handbook/documentation-impact-contract.md`.
- **Next operator steps** per `lib/memory/handbook/operator-output-contract.md`.
- **`pan` CLI prefix:** `pnpm -w exec pan …` from repository root.
- **Librarian pre-close validation** per `OPERATION.md` § Pre-close validation checklist.
- **Operator verification at close** per operator-verification template.
- **Compliance runs** after changes to personas, skills, pipelines, or operator interfaces.
- **Stage exit criteria** are non-negotiable.

## 6 — What to do next

1. Read `lib/memory/active/current.md` unless `simple task mode` applies.
2. Read `OPERATION.md` when human procedure context is required.
3. Check `lib/inbox/in/` for directives; `lib/inbox/out/` for delivery reports.
4. When a directive maps to pipeline stages, follow §4.
5. Author inbox entries: `pnpm -w exec pan intake new <slug>`.
6. Close runs: `pnpm -w exec pan close-artifacts <task-id>` after human validation.

### 6.1 — Pancreator self-development

1. Read `docs/PRD.summary.md` and `docs/PRD.index.md` for product orientation.
2. Read `lib/memory/backlog/index.yaml` for ranked work.
3. Interpret `pan` deferral envelopes (`"status":"deferred"`, exit **125**) per
   `lib/internal/packages/@pancreator/cli/src/run.ts`.

## 7 — Workspace map

```
/AGENTS.md                       this file (internal)
/README.md                       external landing (high-level)
/OPERATION.md                    external operator procedures (human)
/docs/                           internal product documents
/.cursor/agents/                 Cursor persona projections
/lib/personas/                   persona specs
/lib/pipelines/                  pipeline DAGs
/lib/memory/handbook/            authoring canon
/lib/memory/active/              active-memory pointers
/lib/memory/features/<id>/       per-feature artifacts
/lib/memory/adr/                 architecture decision records
/lib/memory/backlog/             ranked product backlog
/lib/inbox/{in,out,threads}/     transient comms (gitignored)
/lib/inbox/notes/                human-only (agents MUST NOT read)
/work/<day>/<task-id>/           active pipeline workspace
/archive/work/                   completed runs (explicit-read)
/lib/internal/packages/          TypeScript packages
/lib/internal/tools/             validation scripts
/tests/                          repository tests
/pancreator.yaml                 live policy and project_root
```

## 8 — Runtime defaults

When `runner.cursor.invocation: sdk` is set, `pnpm -w exec pan run` and
`pnpm -w exec pan advance` invoke CursorRunner. `pnpm -w exec pan run
feature-delivery <inbox-entry>` creates handoff, next-prompt, and run log.
Librarian runs `pnpm -w exec pan close-artifacts <task-id>` after validation.

## 9 — Stability

Changes to this file require an inbox item and human ratification per
`lib/memory/handbook/agents-md-authoring.md`.
