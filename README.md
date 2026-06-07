# Pancreator

*A simulated product organization for agentic software delivery.*

Pancreator gives operators and agents a shared, file-native delivery pipeline:
personas, pipeline stages, durable memory, inbox workflow, and the `pan` CLI.
This repository is the operating surface for running and hardening that loop in
real projects, not a frontend or design-skill showcase.

[Operator guide](OPERATION.md) · [Delivery operating card](#delivery-operating-card)

## System overview

| Area | Path | Role |
|---|---|---|
| Operator how-to | `OPERATION.md` | Inbox, feature-delivery loop, CLI, validation |
| Delivery contract | This file §Delivery operating card | Cross-tool rules and routing for feature delivery |
| Personas | `lib/personas/` | Agent roles and constraints |
| Skills | `lib/personas/skills/` | Reusable procedures |
| Handbook | `lib/memory/handbook/` | Canon: glossary, contracts, context economy |
| Inbox | `lib/inbox/in`, `out`, `threads` | Local transient comms (gitignored; `notes/` is human-only) |
| Memory | `lib/memory/active/`, `lib/memory/features/` | Active pointers and per-feature artifacts |
| Implementation | `lib/internal/` | Packages, tools, work archive |

Pancreator self-development (product spec, internal operating card) lives under
`docs/` (explicit-read; not semantically indexed) and internal `AGENTS.md`.

## Key paths

- `pancreator.yaml` — live policy and `project_root` (`lib/memory/handbook/pancreator-config.md`)
- `lib/memory/active/current.md` — active-memory orientation
- `lib/memory/active/handoffs.md` — pointer-only handoff map
- `work/` — active runs (archived to `archive/work/`)
- `lib/internal/packages/` — TypeScript workspace packages
- `lib/internal/tools/` — validation and maintenance scripts

---

## Delivery operating card

> Cross-tool delivery contract (Linux Foundation Agentic AI Foundation).
> Embedded installs: same content lives at `.pancreator/AGENTS.md`.

### Where agents live

- `lib/personas/<name>.md` — Anthropic 16-field persona specs.
- `.cursor/agents/<name>.md` — canonical Cursor projection (one file per persona).
- `.cursor/rules/<name>.mdc` — Rule-layer projection where Cursor still requires it.
- `lib/personas/skills/<name>/SKILL.md` — Agent Skills open-spec packs.
- `lib/pipelines/<name>.yaml` — pipeline DAGs (YAML).

Invoke stage personas directly (for example `/coder`). Meta-personas for Pancreator
engineering (`pancreator-engineer`, `persona-designer`, `contract-writer`) read
internal `AGENTS.md` instead of this card.

### Pipeline-step delegation rule

When work maps to a persona's `metadata.pancreator-pipeline-stages`, you SHALL
delegate to that persona rather than perform it directly unless `simple task
mode` forbids delegation.

1. **Planning/execution boundary.** Handoff card at `work/<day>/<task-id>/handoff.md`;
   delegated prompt at `work/<day>/<task-id>/next-prompt.md`; pointers only in
   `lib/memory/active/handoffs.md`. Paste only `next-prompt.md` into subagents.
2. **Native subagent invocation.** One canonical `.cursor/agents/<name>.md` per persona.
   Model escalation: `lib/memory/handbook/context-economy.md`.
3. **General-purpose fallback.** Start `.cursor/agents/general-purpose.md` when routing
   is unclear or infrastructure gaps block normal routing.
4. **Persona-as-prompt fallback.** Prepend persona file to general-purpose when projection
   is missing; name the target persona in the first message.
5. **Loop discipline.** Do not run multi-round plan + implement + review in one context.
6. **Cost discipline.** Avoid fan-out that reloads the same handbook or archival context.
   Use `nextPromptFile` from `pan run` / `pan advance` as delegated scope.

### Working agreement

- **Delegation policy.** `/persona` invocations: forward remainder verbatim; no paraphrase;
  parent performs only subagent invocation unless prompt also targets parent.
- **Feature-delivery SDK progress.** Prefix with `PAN_FD_PROGRESS=ndjson`; monitor stderr
  for `feature_delivery_progress`; post concise chat updates per stage/heartbeat.
  See `OPERATION.md` § SDK mode.
- **Build-mode inbox scaffolding.** After plan completion, before first implementation edit:
  `pnpm -w exec pan intake from-build-plan <slug>` with title, operator prompt, plan text.
- **Stage diffs locally; never push.** No `git push` or `git commit --no-verify`.
- **Materialize documented directories on demand** with `.gitkeep` when Git tracks the path.
- **Inbox is local-only** under `lib/inbox/`; archive durable copies to `archive/inbox/`.
- **Operator sandbox.** Never read or modify `lib/inbox/notes/`.
- **Human in-loop** at phase boundaries (`LocalUserAuthorizer`).
- **Dual-anchor citations** per `lib/memory/handbook/glossary.md` §4.
- **Layer 1 lint** per `lib/memory/handbook/contract-style.md`.
- **Documentation impact** per `lib/memory/handbook/documentation-impact-contract.md`.
- **Next operator steps** per `lib/memory/handbook/operator-output-contract.md`.
- **`pan` CLI prefix:** `pnpm -w exec pan …` from repo root.
- **Version control is operator-owned.** Optional `/pr-writer` for PR bodies.
- **Librarian pre-close validation** — run build, lint, typecheck, test, compliance, and
  context-budget checks listed in `OPERATION.md` § Pre-close validation checklist.
- **Operator verification at close** per operator-verification template.
- **Stage exit criteria** are non-negotiable.

### What to do next

1. Read `lib/memory/active/current.md` unless `simple task mode` applies.
2. Read `OPERATION.md` for inbox, feature-delivery, CLI, and pre-close procedure.
3. Check `lib/inbox/in/` for directives; `lib/inbox/out/` for delivery reports.
4. Do not read `lib/inbox/notes/`.
5. When a directive maps to pipeline stages, follow delegation above.
6. Author inbox entries: `pnpm -w exec pan intake new <slug>`.
7. Set active feature explicitly in `lib/memory/active/current.md`.
8. Close runs: `pnpm -w exec pan close-artifacts <task-id>` after human validation.

### Delivery workspace map

```
/.cursor/agents/                 Cursor persona projections
/lib/personas/                   persona specs
/lib/personas/skills/            skill packs
/lib/pipelines/                  pipeline DAGs
/lib/memory/handbook/            delivery canon (route via index)
/lib/memory/active/              active-memory pointers
/lib/memory/features/<id>/       per-feature artifacts
/lib/memory/adoption/            adoption scan reports
/lib/inbox/{in,out,threads}/     transient comms (gitignored)
/lib/inbox/notes/                human-only (agents MUST NOT read)
/work/<day>/<task-id>/           active pipeline workspace
/archive/work/                   completed runs (explicit-read)
/lib/internal/packages/          TypeScript packages
/lib/internal/tools/             validation scripts
/pancreator.yaml                 live policy and project_root
```

### Runtime defaults

`pancreator.yaml` holds `project_root`, `runner`, and `risk_tier`. Current work
routes through inbox, `lib/memory/active/current.md`, and feature indexes.

When `runner.cursor.invocation: sdk` is set, `pnpm -w exec pan run` and
`pnpm -w exec pan advance` invoke CursorRunner. `pnpm -w exec pan run
feature-delivery <inbox-entry>` creates handoff, next-prompt, and run log.
Librarian runs `pnpm -w exec pan close-artifacts <task-id>` after validation.
