# AGENTS.md — Tesseract operating card

> Cross-tool entry contract (Linux Foundation Agentic AI Foundation). `CLAUDE.md`
> and `.github/copilot-instructions.md` symlink here. Cursor loads this file via
> `.cursor/rules/00-agents-md.mdc` (`alwaysApply: true`).

## 1 — Repo identity

Tesseract is a simulated product-org agentic Delivery Pipeline (personas,
skills, pipelines, contracts). The repo is in **bootstrap**; see `BOOTSTRAP.md`.
Product requirements live in `PRD.md`, but routine work SHOULD route through
`PRD.summary.md`, `PRD.index.md`, and `M1.index.md` first. Agents SHOULD read
full `PRD.md` or `BOOTSTRAP.md` only when the task needs authoritative wording,
phase-exit detail, citation repair, or line-anchored requirements per
`memory/handbook/context-economy.md`.

## 2 — Routing map (canon and contracts)

Authoring canon sits under `memory/handbook/`; every persona and contract MUST
cite handbook seeds. Quick routes: intent → `memory/handbook/index.md`;
language → `memory/handbook/glossary.md`; persona YAML and Cursor projection →
`memory/handbook/persona-spec.md`; AGENTS change control →
`memory/handbook/agents-md-authoring.md`.

| Topic | Path |
|---|---|
| Default AI context, indexing boundaries, explicit-read rules | `memory/handbook/context-economy.md` |
| Memory-tier taxonomy and tier rules | `memory/handbook/memory-tiers.md` |
| `simple task mode` | `memory/handbook/context-economy.md` |
| M1/bootstrap routing before full PRD/BOOTSTRAP reads | `M1.index.md` |
| Subagent standard/complex model tiers | `memory/handbook/subagent-model-tiers.md` |
| Current context cost audit | `memory/handbook/context-cost-audit.md` |
| Model and context escalation | `memory/handbook/context-economy.md` |
| Active-memory orientation | `memory/active/current.md` |
| Active-memory layout | `memory/active/README.md` |
| Post-task documentation impact | `memory/handbook/documentation-impact-contract.md` |
| Governed-commit policy compliance artifact | `memory/handbook/policy-compliance-contract.md` |
| Inbox lifecycle and operator sandbox | `memory/handbook/inbox-lifecycle.md` |
| Layer 1 normative style | `memory/handbook/contract-style.md` |
| Clause wrapper schema | `memory/handbook/contract-format.md` |
| Run log schema | `memory/handbook/run-log-schema.md` |
| Contract templates | `memory/handbook/contract-templates/` |
| Compact PRD orientation | `PRD.summary.md` |
| PRD section triggers | `PRD.index.md` |
| Full-source phase/spec authority | `BOOTSTRAP.md`, `PRD.md` |

## 3 — Where agents live

- `personas/<name>.md` — Anthropic 16-field persona specs.
- `.cursor/agents/<name>.md` — backward-compatible standard Cursor projection.
- `.cursor/agents/<name>-standard.md` and `<name>-complex.md` — economical and escalated Cursor variants.
- `.cursor/rules/<name>.mdc` — Rule-layer projection where Cursor still
  requires it; persona files remain canonical.
- `skills/<name>/SKILL.md` — Agent Skills open-spec packs.
- `/ensembles/<name>.yaml` — M4+ ensembles (no executable definitions yet).
- `/pipelines/<name>.yaml` — M1+ pipeline DAGs (no executable definitions until
  runtime wiring lands).

Bootstrap seeds: `personas/persona-designer.md`, `personas/contract-writer.md`.
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

1. **Native subagent invocation.** Cursor exposes standard and complex variants:
   `.cursor/agents/<name>-standard.md` uses `model: auto`;
   `.cursor/agents/<name>-complex.md` preserves the prior fixed model for that
   persona; `.cursor/agents/<name>.md` is a backward-compatible standard alias.
   Use standard by default. Use complex only for the escalation triggers in
   `memory/handbook/subagent-model-tiers.md`. Claude Code and other harnesses
   SHALL use their equivalent tiering when available.
2. **Persona-as-prompt fallback.** When no native invocation exists, start a
   generalPurpose subagent, prepend the persona file contents to its system
   prompt, and name the persona plus intended tier in the first message.
3. **Cost discipline.** Subagents isolate parent context; they do not guarantee
   lower total tokens. Avoid fan-out when multiple subagents would reload the
   same PRD, handbook, or archival context.

When no persona owns the work (for example bootstrap-only handbook authoring or
configuration scaffolding), perform it directly and cite this section in your
response.

## 5 — Working agreement

- **Stage diffs locally; never push.** No agent SHALL run `git push` or
  `git commit --no-verify`. Persona `disallowedTools` enforces this; AGENTS.md
  restates it for out-of-band tooling.
- **Operator sandbox is off-limits.** `/inbox/notes/` is human-operator-only.
  No agent SHALL read, traverse, ingest, cite, or modify any file under
  `/inbox/notes/`. Only `/inbox/in/` is the canonical incoming queue; operators
  SHALL promote a notes draft into `/inbox/in/` before any agent acts on it.
  See `memory/handbook/inbox-lifecycle.md` section 1a.
- **Human is the in-loop reviewer at every phase boundary.** The bootstrap
  authorizer is `LocalUserAuthorizer` (PRD section 10). The human ratifies each
  phase exit before the next phase starts.
- **Dual-anchor citations everywhere.** Every cross-reference is
  `{kind: 'symbol' | 'lines', path, contentHash}`. URLs without an anchored
  citation fail Layer 1 lint at `severity: block`.
- **Layer 1 lint is non-negotiable.** Body prose uses RFC 2119 keywords, EARS
  templates, atomic clauses, active voice, present tense, quantified numerics,
  glossary-resolved nouns, and no weasel words. See
  `memory/handbook/contract-style.md`.
- **Documentation impact check is mandatory per task.** Every agent SHALL
  evaluate documentation or reference impact after each task and SHALL either
  apply required updates or record deferral rationale with backlog linkage per
  `memory/handbook/documentation-impact-contract.md`.
- **Policy-compliance artifact gate is mandatory for governed commits.** Tasks
  that stage non-`work/` structural changes SHALL stage
  `/work/<task-id>/policy-compliance.json` per
  `memory/handbook/policy-compliance-contract.md`; commit-time hooks enforce
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

1. Read `memory/active/current.md` for current pointers unless `simple task
   mode` applies. For M1/bootstrap routing, read `M1.index.md` before full
   `BOOTSTRAP.md`. Agents SHOULD skim `PRD.summary.md` and `PRD.index.md`
   before loading full `PRD.md`.
2. Check `/inbox/in/` for directives (canonical queue every phase boundary).
3. Check `/inbox/out/` for staged delivery reports.
4. Do NOT read `/inbox/notes/`; it remains human-only per
   `memory/handbook/inbox-lifecycle.md` section 1a.
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

## 7 — Workspace map

```
/AGENTS.md                       this file
/CLAUDE.md                       symlink → AGENTS.md
/.github/copilot-instructions.md symlink → ../AGENTS.md
/.cursor/agents/                 Cursor-native compact projections and standard/complex variants
/.cursor/rules/                  Cursor rule shims (00-agents-md.mdc + per-persona where required)
/personas/                       persona specs (Anthropic 16-field)
/skills/                         skill packs (Agent Skills open spec)
/pipelines/                      pipeline DAGs (YAML; M1+)
/ensembles/                      ensemble configurations (M4+)
/memory/handbook/                canonical reference: glossary, persona-spec, context economy, subagent tiers
/memory/active/                  active-memory tier (orientation and layout)
/memory/adr/                     architecture decision records (Nygard format)
/memory/rfc/{draft,accepted,rejected}/
/memory/features/<id>/           per-feature artifacts (Spec-Kit aligned)
/memory/smes/<name>/             per-SME private memory (M4+)
/memory/backlog/                 ranked product backlog (M2+)
/memory/debt/                    technical-debt inventory (M3+, US-7)
/memory/checkpoints/<task-id>/   pipeline-state snapshots (LangGraph BaseCheckpointSaver v1)
/memory/adoption/                adopter scan reports (M1, US-9)
/memory/runbooks/                per-alert runbooks (M4+)
/memory/postmortems/             blameless RCAs
/memory/research/                founding research lineage
/inbox/{in,out,threads}/         human ↔ org message queue
/inbox/notes/                    human-only operator sandbox (agents MUST NOT read or write)
/work/<task-id>/                 ephemeral pipeline workspace
/.tess/{worktrees,sandboxes,scheduler}/  control-plane state
/PRD.md                          product spec
/M1.index.md                      compact M1/bootstrap route map
/BOOTSTRAP.md                    phase-by-phase bootstrap plan
/tesseract.yaml                  org-level threshold policy (M2+)
/tesseract-defaults.yaml         risk-tier defaults (M2+)
```

## 8 — Bootstrap status (live)

Handbook seeds, meta-personas, meta-skills, Phase-1 MVP roster, Cursor shims,
and backlog foundation (ADR-0001, format, index) are present. `tess`
CLI or runtime execution is not wired; `/pipelines/` and `/ensembles/` hold no
executable definitions yet. Next meaningful implementation phase per
`BOOTSTRAP.md`: contract corpus plus substrate or runtime execution wiring.

## 9 — Stability

This file is bootstrap-canonical. Changes require an inbox item and human
ratification. Promotion to `stability: stable` follows Phase 5 dogfood
validation.
