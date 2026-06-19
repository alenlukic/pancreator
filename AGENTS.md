# Operator section
- 👀 **In this file:** Repo-wide agent operating card: where agents start, how they resolve contracts, and how they report work.
- ⚖️ **Why it matters:** Every Pancreator agent reads this first so it knows which contracts bind the run and how to report results.
- 🧭 **See also:**
  - pancreator/lib/memory/handbook/agent-document-registry.md
  - pancreator/lib/memory/handbook/operator-agent-artifact-format.md
  - pancreator/lib/memory/handbook/operator-output-contract.md
# AGENTS.md — Pancreator agent operating card

> Internal agent entry surface. Human operator procedures live in `OPERATION.md`.
> This file is intentionally thin. It names the binding contract system and the
> small set of repo-wide operating rules every agent must honor.

## 1 — Start here

Every agent invocation MUST read this card before acting. Source-backed
subagents MAY read their own `pancreator/lib/personas/<name>.md` persona spec first to
resolve persona-local role semantics, but `AGENTS.md` remains the repo-wide
authority on conflict and MUST be read before they act.

Agents MUST NOT treat path enumeration as compliance. Binding work rules come
from static repo artifacts with stable global keys:

- `DOC.REGISTRY` → `pancreator/lib/memory/handbook/agent-document-registry.md`
- `DOC.OPERATOR_AGENT_FORMAT` → `pancreator/lib/memory/handbook/operator-agent-artifact-format.md`
- `DOC.PERSONA_SPEC` → `pancreator/lib/memory/handbook/persona-spec.md`
- `DOC.PERSONA_CONTRACTS` → `pancreator/lib/memory/handbook/persona-contracts.md`
- `DOC.OUTPUT_MANIFEST` → `pancreator/lib/memory/handbook/output-manifest-contract.md`
- `DOC.OPERATOR_OUTPUT` → `pancreator/lib/memory/handbook/operator-output-contract.md`
- `DOC.PIPELINE_STATE` → `pancreator/lib/memory/handbook/pipeline-state-contract.md`
- `PIPE.FEATURE_DELIVERY` → `pancreator/lib/pipelines/feature-delivery.yaml`

When a persona spec, pipeline stage, or prompt names a `DOC.*`, `PIPE.*`, or
`PERSONA.*` key, agents MUST resolve that key through `DOC.REGISTRY`, load the
resolved artifact, and follow its obligations. Agents MUST NOT invent an
ad-hoc execution contract for the current run; the contract is static in the
persona spec and pipeline definition.

When a file begins with `# Operator section` or a `⚙️ no human content` banner,
agents MUST skip that operator-only prefix and treat everything after it as the
agent-readable payload. Agents MUST NOT use operator-section prose as evidence
for validation, scope, requirements, or gate decisions unless the human
explicitly asks about operator-facing readability.

## 2 — Persona and pipeline authority

Canonical persona specs live at `pancreator/lib/personas/<name>.md`. Each persona spec MUST
own its static execution contract: responsibilities, required docs, required
inputs, output artifacts, output manifest shape, definition of done, and gate
validator. Cursor projections under `.cursor/agents/` are generated local files;
regenerate them with `pnpm -w exec pan cursor-sync` instead of editing them.

When this card conflicts with a persona spec or generated projection, this card
wins. Persona specs and generated projections provide narrower local contracts
inside that repo-wide boundary.

Tool documentation defines platform capabilities and parameter semantics. It
does not grant permission to use optional or default tool behaviors when this
card or a referenced repo contract imposes a stricter policy. When a Cursor
tool or subagent interface allows omitted parameters, inherited defaults,
optional verification, or broader usage, agents MUST treat the repo-local rule
as a hard precondition to invocation. If the agent cannot satisfy that
repo-local precondition exactly, it MUST NOT use that tool path and MUST choose
another compliant path.

Pipeline definitions live under `pancreator/lib/pipelines/*.yaml`. A pipeline stage MUST name
its owner persona, required docs, required inputs, required outputs, transition
gates, and remediation route. The runtime and supervising personas enforce stage
transitions from those declarations.

Delegated scope (`pancreator/.pan/work/<day>/<task-id>/next-prompt.md`, `handoff.md`, or an
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

When a parent agent invokes a named persona, the parent MUST use the canonical
`.cursor/agents/<name>.md` projection for that persona unless the operator
explicitly overrides the invocation. Named persona model policy comes from that
canonical projection; the parent MUST NOT substitute a different ad-hoc model.

When a parent agent invokes an ad-hoc subagent rather than a named persona, the
parent MUST pass the parent's own exact model string explicitly in the
invocation and MUST NOT leave the model parameter blank. After launch, the
parent MUST verify that the running subagent is using that same model string. If
the subagent is using any other model, or if the parent cannot verify the model
string, the parent MUST immediately terminate that subagent and reinvoke it with
the correct explicit model. If the parent cannot name the exact parent model
string explicitly before launch, it MUST NOT invoke the ad-hoc subagent. If the
platform does not expose a way to verify the running subagent's model string,
the parent MUST NOT use that ad-hoc subagent path and MUST choose a compliant
alternative instead.

## 3 — Output manifests and gate validation

Every bounded persona invocation MUST emit an output manifest per
`DOC.OUTPUT_MANIFEST`. When an invocation writes a durable artifact, the manifest
MUST be written inside the artifact's agent section. The final chat/stdout
response MUST also include the same manifest summary or point to the artifact
section containing it.

Review, QA, compliance, supervisor, and other gate personas MUST validate the
previous stage's declared outputs and output manifest before advancing. Missing
manifest fields, missing required artifacts, unmet acceptance criteria, or an
invalid definition-of-done claim MUST block the transition and route remediation
to the stage owner declared by the pipeline.

## 4 — Context discipline

Load the narrowest binding artifact that can answer the contract question. Start
with `DOC.REGISTRY` and the persona/pipeline keys before opening broad handbook,
PRD, archive, inbox history, or prior run context. Use
`pancreator/lib/memory/handbook/context-economy.md` only when a task requires context-budget,
retrieval-depth, RTK-first shell, memory-tier, or archival retrieval decisions
not already named by the static contract. Use
`pancreator/lib/memory/handbook/simple-task-mode.md` only when the task needs the
bounded low-risk work posture or its context-expansion triggers.

Active feature-delivery work is under `pancreator/.pan/work/<day>/<task-id>/`. Do not scan
unrelated `pancreator/.pan/work/**`, `pancreator/.pan/archive/**`, `pancreator/lib/inbox/out/**`, or
`pancreator/lib/inbox/threads/**` unless the static contract, bounded prompt, or operator
request explicitly names archival reconstruction as the task.

## 5 — Repo operating rules

### Pan CLI and execution environment

- Use `pnpm -w exec pan …` from the repository root for `pan` CLI commands.
- Before `pnpm -w exec pan run`, `pan advance`, `pan repair-state`, or
  `pan close-artifacts`, load `.env` with `set -a && source .env && set +a`
  when present.

### Feature-delivery workflow routing

- Build-mode inbox scaffolding routes through
  `pnpm -w exec pan intake from-build-plan`. Agents MUST use
  `pan intake from-build-plan` when promoting Build-mode plan text into the
  inbox instead of bypassing the inbox queue.
- When running feature-delivery commands in chat, set `PAN_FD_PROGRESS=ndjson`,
  monitor stderr for `feature_delivery_progress`, and summarize progress without
  pasting raw NDJSON.

### Source-control and shell-output policy

- Stage diffs locally only. Agents MUST NOT run `git push`, `git commit`,
  `git commit --no-verify`, `gh pr create`, or `gh pr merge` unless an explicit
  persona spec grants that action and the operator has ratified it.
- Shell inspection MUST default to RTK-compressed commands; agents MUST use raw
  shell output or built-in file/search tools only when RTK output cannot
  provide required fidelity for the active task.

### Formatting and repository hygiene

- JSON written by repo tooling MUST be pretty formatted with two-space indent
  unless a file contract explicitly declares compact JSON.
- If agent documentation references a non-transient repository directory that is
  absent, create the directory with an appropriate tracked placeholder or update
  the docs in the same change.

### Compliance and governance gates

- Run compliance descriptors under `pancreator/tests/compliance/` when
  `pancreator/lib/memory/handbook/compliance-runs.md` says the touched surface
  requires it.
- After editing any persona under `pancreator/lib/personas/`, regenerate the
  gitignored Cursor projections with `pnpm -w exec pan cursor-sync` and verify
  them with
  `node pancreator/lib/internal/tools/checks/check-cursor-projection-drift.mjs`;
  stale projections are not caught by tracked-file CI.
- When the persona/registry/pipeline/escalation surface changes, run the
  framework gates: `pnpm governance:test` (registry integrity + escalation
  completeness) and `pnpm governance:projection-drift`. Use
  `pnpm governance:audit` to re-measure governance usage and friction.

## 6 — Sectioned document and artifact format

Permanent documents and transient artifacts SHOULD use the operator/agent split
defined by `DOC.OPERATOR_AGENT_FORMAT` unless a file-specific parser cannot yet
tolerate the prefix. `.cursor` projections MUST NOT receive the section prefix;
they remain generated, compact runtime surfaces.

For Markdown and YAML, document frontmatter (when present) MUST be at line 1.
The operator section follows and is the first content humans see in preview.
Agents MUST skip the operator prefix (`# Operator section` and its three bullets,
or the `⚙️ no human content` banner) and read the remainder of the file as the
agent section. Any existing file frontmatter belongs to the agent section and
therefore leads the file before the operator summary. For JSON, the first
top-level key MAY be `$operator` when a human summary is useful; agents MUST
strip it before schema validation.

The operator section MUST come before the agent section. Agents MUST NOT consult,
quote, summarize, validate, or reason from the operator section unless the human
explicitly asks about operator-facing readability. If the file has no useful
human content, the operator section MUST be a single-line `⚙️ no human content`
banner.

Human-readable sections MUST include these bullets with emoji prefixes:

- 👀 **In this file:** what the file contains.
- ⚖️ **Why it matters:** why a human operator should care, in plain language (not
  contract prose copied from the agent section).
- 🧭 **See also:** newline-separated related files, or `N/A`.

## 7 — Human/operator output

Operator-facing completion output MUST follow
`pancreator/lib/memory/handbook/operator-output-contract.md`. For every chat
completion, report action status, brief summary, added/changed files with
clickable links, deleted files, and next operator actions. Use `N/A` for any
empty field. For repo-change tasks, report what changed, validation actually
run, validation not run, and any patch/script artifacts produced. Do not claim a
file was modified, moved, deleted, or tested unless the current repo state proves it.
