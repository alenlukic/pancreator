# AGENTS.md — Pancreator agent operating card

> Internal agent entry surface. Human operator procedures live in `OPERATION.md`.
> This file is intentionally thin. It names the binding contract system and the
> small set of repo-wide operating rules every agent must honor.

## 1 — Start here

Every agent invocation MUST read this card before acting. Source-backed
subagents MAY read their own `lib/personas/<name>.md` persona spec first to
resolve persona-local role semantics, but `AGENTS.md` remains the repo-wide
authority on conflict and MUST be read before they act.

Agents MUST NOT treat path enumeration as compliance. Binding work rules come
from static repo artifacts with stable global keys:

- `DOC.REGISTRY` → `lib/memory/handbook/agent-document-registry.md`
- `DOC.PERSONA_SPEC` → `lib/memory/handbook/persona-spec.md`
- `DOC.PERSONA_CONTRACTS` → `lib/memory/handbook/persona-contracts.md`
- `DOC.OUTPUT_MANIFEST` → `lib/memory/handbook/output-manifest-contract.md`
- `DOC.PIPELINE_STATE` → `lib/memory/handbook/pipeline-state-contract.md`
- `PIPE.FEATURE_DELIVERY` → `lib/pipelines/feature-delivery.yaml`

When a persona spec, pipeline stage, or prompt names a `DOC.*`, `PIPE.*`, or
`PERSONA.*` key, agents MUST resolve that key through `DOC.REGISTRY`, load the
resolved artifact, and follow its obligations. Agents MUST NOT invent an
ad-hoc execution contract for the current run; the contract is static in the
persona spec and pipeline definition.

## 2 — Persona and pipeline authority

Canonical persona specs live at `lib/personas/<name>.md`. Each persona spec MUST
own its static execution contract: responsibilities, required docs, required
inputs, output artifacts, output manifest shape, definition of done, and gate
validator. Cursor projections under `.cursor/agents/` are generated local files;
regenerate them with `pnpm -w exec pan cursor-sync` instead of editing them.

When this card conflicts with a persona spec or generated projection, this card
wins. Persona specs and generated projections provide narrower local contracts
inside that repo-wide boundary.

Pipeline definitions live under `lib/pipelines/*.yaml`. A pipeline stage MUST name
its owner persona, required docs, required inputs, required outputs, transition
gates, and remediation route. The runtime and supervising personas enforce stage
transitions from those declarations.

Delegated scope (`.pan/work/<day>/<task-id>/next-prompt.md`, `handoff.md`, or an
operator `/persona` remainder) bounds what to work on. It does not redefine a
persona's role, tools, forbidden actions, output contract, or definition of done.
When delegated scope conflicts with the target persona spec, the target persona
spec wins.

When a parent agent delegates to a named persona, the parent MUST pass the
operator remainder or generated bounded prompt verbatim. The parent MUST NOT
paraphrase, summarize, or inject inferred intent, broad context, or unsolicited
adjacent work unless the operator request or bounded prompt explicitly names
that addition. When the delegation prompt carries no instructions for the
parent, the parent MUST limit itself to invoking the target persona and
reporting the result.

## 3 — Output manifests and gate validation

Every bounded persona invocation MUST emit an output manifest per
`DOC.OUTPUT_MANIFEST`. When an invocation writes a durable artifact, the manifest
MUST be written inside that artifact. The final chat/stdout response MUST also
include the same manifest summary or point to the artifact section containing it.

Review, QA, compliance, supervisor, and other gate personas MUST validate the
previous stage's declared outputs and output manifest before advancing. Missing
manifest fields, missing required artifacts, unmet acceptance criteria, or an
invalid definition-of-done claim MUST block the transition and route remediation
to the stage owner declared by the pipeline.

## 4 — Context discipline

Load the narrowest binding artifact that can answer the contract question. Start
with `DOC.REGISTRY` and the persona/pipeline keys before opening broad handbook,
PRD, archive, inbox history, or prior run context. Use
`lib/memory/handbook/context-economy.md` only when a task requires context-budget,
model escalation, memory-tier, or archival retrieval decisions not already named
by the static contract.

Active feature-delivery work is under `.pan/work/<day>/<task-id>/`. Do not scan
unrelated `.pan/work/**`, `.pan/archive/**`, `lib/inbox/out/**`, or
`lib/inbox/threads/**` unless the static contract, bounded prompt, or operator
request explicitly names archival reconstruction as the task.

## 5 — Repo operating rules

- Use `pnpm -w exec pan …` from the repository root for `pan` CLI commands.
- Before `pnpm -w exec pan run`, `pan advance`, `pan repair-state`, or
  `pan close-artifacts`, load `.env` with `set -a && source .env && set +a`
  when present.
- Build-mode inbox scaffolding routes through `pnpm -w exec pan intake from-build-plan`.
  Agents MUST use `pan intake from-build-plan` when promoting Build-mode plan text
  into the inbox instead of bypassing the inbox queue.
- When running feature-delivery commands in chat, set `PAN_FD_PROGRESS=ndjson`,
  monitor stderr for `feature_delivery_progress`, and summarize progress without
  pasting raw NDJSON.
- Stage diffs locally only. Agents MUST NOT run `git push`, `git commit`,
  `git commit --no-verify`, `gh pr create`, or `gh pr merge` unless an explicit
  persona spec grants that action and the operator has ratified it.
- JSON written by repo tooling MUST be pretty formatted with two-space indent
  unless a file contract explicitly declares compact JSON.
- If agent documentation references a non-transient repository directory that is
  absent, create the directory with an appropriate tracked placeholder or update
  the docs in the same change.
- Run compliance descriptors under `tests/compliance/` when
  `lib/memory/handbook/compliance-runs.md` says the touched surface requires it.
- After editing any persona under `lib/personas/`, regenerate the gitignored
  Cursor projections with `pnpm -w exec pan cursor-sync` and verify them with
  `node lib/internal/tools/check-cursor-projection-drift.mjs`; stale projections
  are not caught by tracked-file CI.
- When the persona/registry/pipeline/escalation surface changes, run the
  framework gates: `pnpm governance:test` (registry integrity + escalation
  completeness) and `pnpm governance:projection-drift`. Use `pnpm
  governance:audit` to re-measure governance usage and friction.

## 6 — Human/operator output

Operator-facing completion output MUST follow
`lib/memory/handbook/operator-output-contract.md`. For repo-change tasks, report
what changed, validation actually run, validation not run, and any patch/script
artifacts produced. Do not claim a file was modified, moved, deleted, or tested
unless the current repo state proves it.
