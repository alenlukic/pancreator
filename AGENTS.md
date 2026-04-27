# AGENTS.md — Tesseract repo briefing

> Read this file first. It is the primary cross-tool contract per the Linux
> Foundation Agentic AI Foundation standard. `CLAUDE.md` and
> `.github/copilot-instructions.md` are symlinks to this file. Cursor reads
> this file via `.cursor/rules/00-agents-md.mdc` (`alwaysApply: true`).

## 1 — What this repo is

Tesseract is a simulated product-org agentic development ecosystem. The
deliverables are personas, skills, pipelines, and contracts that compose into
a self-hosting Delivery Pipeline. The repo is currently in the **bootstrap
phase**: see `BOOTSTRAP.md` for the phase-by-phase plan and the current
status. The product spec is `PRD.md`.

## 2 — Where the canon lives

The handbook seeds under `/memory/handbook/` are the canonical references for
authoring work. Every persona and contract MUST cite them.

| File | Purpose |
|---|---|
| `/memory/handbook/glossary.md` | The ubiquitous-language source of truth. Every domain noun resolves here. |
| `/memory/handbook/index.md` | Intent-to-document routing map used to retrieve the right handbook pages with minimal context load. |
| `/memory/handbook/persona-spec.md` | Anthropic Claude Agent SDK 16-field YAML reference + Cursor projection contract (`.cursor/agents` mirror + `.mdc` rule shim where required). |
| `/memory/handbook/agents-md-authoring.md` | Authoring and change-control guide for `/AGENTS.md`, including required shape, triggers, and symlink policy. |
| `/memory/handbook/run-log-schema.md` | Canonical run-log schema contract for `/work/<id>/run.log.jsonl`, including OpenInference + OTel GenAI alignment and checkpoint correlation fields. |
| `/memory/handbook/contract-format.md` | Wrapper schema, kind registry, runner adapter, failure shape, quorum policy. |
| `/memory/handbook/contract-style.md` | The 5-layer style discipline (RFC 2119, EARS, atomic, no weasel words, glossary, dual-anchor). |
| `/memory/handbook/documentation-impact-contract.md` | Global post-task decision contract for documentation/reference impact, required updates, and deferral tracking. |
| `/memory/handbook/policy-compliance-contract.md` | Machine-checkable per-task policy alignment artifact contract used by commit-time enforcement hooks. |
| `/memory/handbook/inbox-lifecycle.md` | Canonical lifecycle and semantic immutability rules for `inbox/{in,out,threads}` artifacts and archival usage. |
| `/memory/handbook/contract-templates/` | The 6 MVP slot-driven scaffolds for common clause shapes. |
| `BOOTSTRAP.md` | The phase-by-phase bootstrap plan; the human is the in-loop reviewer at every phase boundary. |
| `PRD.md` | The product spec. The line-anchored citation target until handbook seeds are promoted to canonical. |

## 3 — Where the agents live

- `personas/<name>.md` — persona specs in the Anthropic 16-field format.
- `.cursor/agents/<name>.md` — Cursor-native persona mirror emitted from the
  canonical persona spec.
- `.cursor/rules/<name>.mdc` — rule-layer projection retained only where
  Cursor rule loading still requires it; canonical source remains the persona
  file.
- `skills/<name>/SKILL.md` — reusable procedures conforming to the Agent
  Skills open spec.
- `/ensembles/<name>.yaml` — persona ensemble configurations (M4+; not
  populated with executable definitions yet).
- `/pipelines/<name>.yaml` — pipeline definitions (M1+; not populated until
  the runtime wiring lands in this repo).

The bootstrap-canonical seed roster is two meta-personas:

- `personas/persona-designer.md` — authors persona specs.
- `personas/contract-writer.md` — authors contract clauses.

The repo now also carries the full Phase-1 MVP persona roster, corresponding
Cursor mirrors/rule projections, and MVP skills.

Both meta-personas are self-protected for semantic changes: no agent and no
persona MUST NOT modify role semantics, authority boundaries, tool grants, or
safety constraints unless explicit human ratification is recorded. Deterministic
maintenance-only updates (for example `references[].contentHash` refreshes,
citation range realignment, and canonical/mirror parity sync) MAY proceed
when policy-compliance and documentation-impact obligations are satisfied.

## 4 — Pipeline-step delegation rule

When the work assigned to you maps to a named persona's
`metadata.tesseract-pipeline-stages`, you SHALL delegate the work to that
persona rather than perform it directly. Two delegation modes:

1. **Native subagent invocation.** When the runtime surfaces the persona as
   a subagent type, invoke it via the runtime's task tool with the persona
   name. Cursor: `.cursor/agents/<name>.md` (with `.mdc` rule projection where
   rule loading is still required). Claude Code:
   `Task(subagent_type="<name>")`. Other harnesses: their equivalent.
2. **Persona-as-prompt fallback.** When no native invocation surface exists,
   spin up a generalPurpose subagent and prepend the persona file's contents
   to its system prompt, naming the persona explicitly in the first message.

When no persona owns the work (e.g., bootstrap-only handbook authoring,
configuration scaffolding), perform it directly and cite this section in
your response.

## 5 — Working agreement

- **Stage diffs locally; never push.** No agent SHALL run `git push` or
  `git commit --no-verify`. Every persona's `disallowedTools` enforces this;
  AGENTS.md restates it for any out-of-band tooling.
- **Human is the in-loop reviewer at every phase boundary.** The bootstrap
  authorizer is `LocalUserAuthorizer` (PRD §10). The human ratifies each
  phase exit before the next phase starts.
- **Dual-anchor citations everywhere.** Every cross-reference is
  `{kind: 'symbol' | 'lines', path, contentHash}`. URLs without an anchored
  citation fail Layer 1 lint at `severity: block`.
- **Layer 1 lint is non-negotiable.** Body prose uses RFC 2119 keywords,
  EARS templates, atomic clauses, active voice, present tense, quantified
  numerics, glossary-resolved nouns, and no weasel words. See
  `/memory/handbook/contract-style.md`.
- **Documentation impact check is mandatory per task.** Every agent SHALL
  evaluate documentation/reference impact after each task and SHALL either
  apply required updates or record deferral rationale with backlog linkage per
  `/memory/handbook/documentation-impact-contract.md`.
- **Policy-compliance artifact gate is mandatory for governed commits.** Tasks
  that stage non-`work/` structural changes SHALL stage
  `/work/<task-id>/policy-compliance.json` per
  `/memory/handbook/policy-compliance-contract.md`; commit-time hooks enforce
  fail-closed behavior when the artifact is missing or invalid.
- **Stage exit criteria are non-negotiable.** Mirrors the PRD's R-class
  circuit-breaker pattern. The bootstrap correctness ratchet is its own
  contract.
- **Bootstrap-only affordances are tagged.** Anything pulled forward (manual
  phase boundaries before the runner exists, hand-checked lints) carries
  `metadata.tesseract-bootstrap-only: true | false` so it can be retired or
  formalized later.
- **Commit trailer.** Every bootstrap commit MUST carry
  `Bootstrap-Phase: <N>` so the bootstrap is replayable end-to-end.

## 6 — How to discover what to do next

1. Read `BOOTSTRAP.md` for the phase-by-phase plan and the current exit
   criteria.
2. Check `/inbox/in/` for human directives. Files there are the canonical
   work queue at every phase boundary.
3. Check `/inbox/out/` for staged delivery reports awaiting human review.
4. When a directive maps to a persona's
   `metadata.tesseract-pipeline-stages`, follow §4 above to delegate.

## 6.1 — Compliance-run trigger guidance

- During automation-deferred phases, agents SHALL support manual invocation via
  `operator-on-demand` and SHALL run descriptors under `tests/compliance/`
  against `tests/compliance/schemas/latest.yaml`.
- Agents SHALL trigger a compliance run after create, modify, or delete changes
  that affect personas, skills, pipeline definitions, documented operational
  primitives, testing infrastructure, operator interfaces, or milestone
  ratification artifacts.
- Scheduled cadence remains backlog-tracked automation work until runtime
  scheduler wiring lands; agents SHALL NOT assume automatic cadence execution in
  the first slice.

## 7 — Workspace map

```
/AGENTS.md                       this file
/CLAUDE.md                       symlink → AGENTS.md
/.github/copilot-instructions.md symlink → ../AGENTS.md
/.cursor/agents/                 Cursor-native persona mirrors
/.cursor/rules/                  Cursor rule shims (00-agents-md.mdc + per-persona where required)
/personas/                       persona specs (Anthropic 16-field)
/skills/                         skill packs (Agent Skills open spec)
/pipelines/                      pipeline DAGs (YAML; M1+)
/ensembles/                      ensemble configurations (M4+)
/memory/handbook/                canonical reference: glossary, persona-spec, contract-format, contract-style, templates
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
/work/<task-id>/                 ephemeral pipeline workspace
/.tess/{worktrees,sandboxes,scheduler}/  control-plane state
/PRD.md                          product spec
/BOOTSTRAP.md                    phase-by-phase bootstrap plan
/tesseract.yaml                  org-level threshold policy (M2+)
/tesseract-defaults.yaml         risk-tier defaults (M2+)
```

## 8 — Bootstrap status (live)

**Current state.** Handbook seeds under `/memory/handbook/` are present.
Meta-personas and meta-skills are present. The full Phase-1 MVP persona roster
is present, with corresponding Cursor shims and MVP skills. Backlog tracking
foundation is present through ADR-0001, backlog format, and backlog index.
`tess` CLI/runtime execution is not wired in this repo yet. `/pipelines/` and
`/ensembles/` are not populated with executable definitions yet.

**Next phase focus.** Per `BOOTSTRAP.md`, the next meaningful implementation
phase is the contract corpus and substrate/runtime execution wiring.

## 9 — Stability

This file is bootstrap-canonical. Changes require an inbox item and human
ratification. Promotion to `stability: stable` follows Phase 5 dogfood
validation.
