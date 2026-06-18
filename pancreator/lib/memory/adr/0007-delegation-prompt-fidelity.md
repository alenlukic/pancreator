---
title: Ratify Delegation Prompt Fidelity And No Unsolicited Parent Action
seq: 7
status: proposed
date: "2026-05-31T00:00:00Z"
deciders:
  - supervisor
  - tech-lead
  - LocalUserAuthorizer
supersedes: null
superseded-by: null
feature_id: delegation-prompt-fidelity
references:
  - '{"kind":"file","path":"AGENTS.md","note":"AGENTS §2 now carries the repo-wide delegation authority and prompt-fidelity rules ratified by this ADR."}'
  - '{"kind":"file","path":"lib/memory/handbook/context-economy.md","note":"Planning/execution handoff discipline carries the mirrored prompt-fidelity norm."}'
  - '{"kind":"file","path":"lib/memory/handbook/agents-md-authoring.md","note":"AGENTS change-control workflow requires inbox authorization and ADR for policy-significant edits."}'
  - '{"kind":"lines","path":"lib/inbox/in/172975_05-31-26/30025_1539_delegation-prompt-fidelity-no-editorializing.md","range":[11,31],"contentHash":"a82d909","note":"Authorizing inbox directive framing the contract gap and required outcomes."}'
...

## Context

The `AGENTS.md` §2 delegation authority rules govern delegation invocation
mechanics: how parent agents hand off bounded scope to named personas and which
repo-wide rules survive that handoff. The prior wording said the parent invokes
"with the remainder of the prompt as the delegated task" but did not
require that remainder to pass through unchanged, and its closing sentence granted
open-ended discretion over parent-agent instructions.

Two gaps followed. First, no clause required verbatim pass-through, so parents
paraphrased, summarized, or injected interpretation and assumptions into the
delegated prompt (editorializing). Second, no clause prohibited unsolicited
proactive action, so parents performed repository work the operator never
requested even when the prompt was a pure delegation passthrough. Operators
reported both behaviors as recurring and unacceptable.

The planning/execution handoff discipline in `lib/memory/handbook/context-economy.md`
held a related but weaker `SHOULD NOT` clause that covered only the
planner-to-executor `next-prompt.md` path, leaving prompt fidelity
under-specified at the contract layer.

## Decision

When a parent agent invokes a named subagent, the parent agent SHALL forward the
delegated remainder verbatim and SHALL NOT paraphrase, summarize, translate,
reorder, or rewrite it. Citation:
`{kind: file, path: AGENTS.md, note: "AGENTS §2 delegation authority requires verbatim prompt pass-through."}`.

When a parent agent constructs a delegated prompt, the parent agent SHALL NOT
inject interpretation, inferred intent, assumptions, background context,
prior-chat history, file contents, or directory listings unless the operator
prompt or a generated `.pan/work/<day>/<task-id>/next-prompt.md` names that exact
artifact. When the parent agent adds an operationally required reference, the
parent agent SHALL label it parent-supplied and SHALL keep it to the minimal
pointer the subagent needs to start. Citation:
`{kind: file, path: AGENTS.md, note: "AGENTS §2 forbids injected interpretation, broad context, and unsolicited adjacent work unless explicitly named."}`.

When a delegation prompt carries no instructions specifically intended for the
parent agent, the parent agent SHALL perform no repository reads, edits, or other
actions beyond invoking the subagent, SHALL wait for completion, and SHALL report
the delegated result without editorializing the subagent output. Citation:
`{kind: file, path: AGENTS.md, note: "AGENTS §2 limits pure-passthrough delegations to invoke-and-report behavior."}`.

When a delegation prompt also carries instructions specifically intended for the
parent agent, the parent agent SHALL execute only those instructions, SHALL
sequence them relative to delegation as the instructions require, and SHALL NOT
expand them into adjacent unrequested work. Citation:
`{kind: file, path: AGENTS.md, note: "AGENTS §2 limits parent-side work to the instructions explicitly addressed to the parent."}`.

When a parent agent invokes an executor on the planning/execution path, the
parent agent SHALL apply the same verbatim-fidelity and no-injection norm and
SHALL treat `AGENTS.md` §2 as the governing source, with
`lib/memory/handbook/context-economy.md` mirroring that rule for the
planning/execution handoff path.

## Consequences

- Positive: Subagents receive operator intent unaltered, which removes a class of
  misleading-context defects and makes delegated runs reproducible.
- Positive: Pure-passthrough delegations no longer trigger unrequested parent
  edits, reducing scope creep and token cost.
- Positive: The two prompt-construction surfaces now state one consistent norm.
- Negative: Parents lose latitude to pre-clarify ambiguous prompts; genuinely
  ambiguous tasks must surface the ambiguity to the operator instead of guessing.
- Neutral: This ADR records policy only; runtime enforcement of prompt fidelity
  stays unimplemented and is out of scope.

## Status

This ADR is `proposed` on 2026-05-31 (UTC) pending `LocalUserAuthorizer`
ratification, per the AGENTS change-control workflow at
`{kind: file, path: lib/memory/handbook/agents-md-authoring.md, note: "AGENTS change-control workflow."}`.
On ratification the author SHALL set `status: accepted`.
