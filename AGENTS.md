# AGENTS.md — Pancreator internal operating card

> Internal surface: plan and build Pancreator itself.
> For feature-delivery operating contract, read `README.md` §Delivery operating card
> (self-host) or `.pancreator/AGENTS.md` (embedded).

## 1 — Repo identity

This repository is the Pancreator product harness: personas, pipelines, CLI,
handbook, and implementation under `lib/internal/`. Runtime policy lives in
`pancreator.yaml` (`project_root`, `runner`, `risk_tier`).

Product requirements live in `docs/PRD.md`. Routine Pancreator self-development
SHOULD route through `docs/PRD.summary.md`, `docs/PRD.index.md`, and
`docs/M1.index.md` first. Read full `docs/PRD.md` or `docs/BOOTSTRAP.md` only
when the task needs authoritative wording, closed-phase replay, citation repair,
or line-anchored requirements per `lib/memory/handbook/context-economy.md`.

Feature delivery on a target project uses the **external surface** (`README.md`,
`OPERATION.md`, personas, active memory) — not this file.

## 2 — Routing map (internal canon)

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
| Context cost audit | `lib/memory/handbook/context-cost-audit.md` |
| Compact PRD orientation | `docs/PRD.summary.md` |
| PRD section triggers | `docs/PRD.index.md` |
| M1 route map | `docs/M1.index.md` |
| Full product spec | `docs/PRD.md` |
| Bootstrap phase record | `docs/BOOTSTRAP.md` |
| Architecture baseline | `lib/memory/adr/0002-system-architecture-map.md` |
| Backlog format | `lib/memory/handbook/backlog-format.md` |
| Layer 1 contract style | `lib/memory/handbook/contract-style.md` |
| Documentation impact | `lib/memory/handbook/documentation-impact-contract.md` |
| Delivery operating card (external) | `README.md` §Delivery operating card |
| Operator procedures (external) | `OPERATION.md` |

## 3 — Meta-personas and protection

Bootstrap seeds: `lib/personas/persona-designer.md`, `lib/personas/contract-writer.md`.
`pancreator-engineer`, `persona-designer`, and `contract-writer` are meta-personas.

Both meta-personas are self-protected: no agent and no persona SHALL modify role
semantics, authority boundaries, tool grants, or safety constraints unless
explicit human ratification is recorded. Deterministic maintenance-only updates
(for example `references[].contentHash` refreshes, citation range realignment,
canonical or mirror parity sync) MAY proceed when documentation-impact
obligations are satisfied.

## 4 — Pancreator self-development working agreement

- **Dual-anchor citations** per `lib/memory/handbook/glossary.md` §4.
- **Layer 1 lint** per `lib/memory/handbook/contract-style.md`.
- **Documentation impact check** mandatory per task per
  `lib/memory/handbook/documentation-impact-contract.md`.
- **Stage diffs locally; never push.** No `git push` or `git commit --no-verify`.
- **Compliance runs** after changes to personas, skills, pipelines, operator
  interfaces, or milestone ratification artifacts (`tests/compliance/`).
- **`pan` CLI prefix:** `pnpm -w exec pan …` from repository root.
- **Next operator steps** per `lib/memory/handbook/operator-output-contract.md`
  when completing bounded internal tasks.

## 5 — What to do next (internal work)

1. Read `docs/PRD.summary.md` and `docs/PRD.index.md` for product orientation.
2. Read `lib/memory/active/current.md` for active Feature pointers.
3. Read `lib/memory/backlog/index.yaml` for ranked work.
4. Check `lib/inbox/in/` for directives when work is inbox-driven.
5. For delivery work on a target feature, use external surfaces instead of this file.

### 5.1 — Deferred CLI protocol

Operators SHALL interpret `pan` JSON envelopes with `"status":"deferred"` as the
canonical deferral protocol (exit **125**; see
`lib/internal/packages/@pancreator/cli/src/run.ts`).

## 6 — Workspace map (internal emphasis)

```
/AGENTS.md                       this file (internal)
/README.md                       external landing + delivery operating card
/OPERATION.md                    external operator procedures
/docs/                           internal product documents (PRD, bootstrap)
/lib/memory/adr/                 architecture decision records
/lib/memory/backlog/             ranked product backlog
/lib/memory/features/            per-feature specs (bootstrap-phase-* internal)
/lib/memory/handbook/            authoring canon
/lib/internal/packages/          TypeScript workspace packages
/lib/internal/tools/             validation and maintenance scripts
/tests/                          repository tests and compliance fixtures
/client/                         operator dashboard (monorepo only)
/pancreator.yaml                 live policy and project_root
```

## 7 — Runtime defaults

`pancreator.yaml` holds live runtime policy. Closed bootstrap history lives in
`docs/BOOTSTRAP.md` and `lib/memory/features/bootstrap-phase-*`.

## 8 — Stability

Changes to this file require an inbox item and human ratification per
`lib/memory/handbook/agents-md-authoring.md`.
