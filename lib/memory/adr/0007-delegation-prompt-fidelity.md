---
title: Ratify Delegation Prompt Fidelity And No Unsolicited Parent Action
seq: "0007"
status: proposed
date: 2026-05-31T00:00:00Z
deciders: [supervisor, tech-lead, LocalUserAuthorizer]
supersedes: null
superseded-by: null
feature_id: delegation-prompt-fidelity
references:
  - kind: lines
    path: AGENTS.md
    range: [119, 141]
    contentHash: TBD-on-commit
    note: AGENTS §5 delegation policy clause amended by this decision.
  - kind: lines
    path: lib/memory/handbook/context-economy.md
    range: [188, 197]
    contentHash: TBD-on-commit
    note: Planning/execution handoff discipline carries the mirrored prompt-fidelity norm.
  - kind: lines
    path: lib/memory/handbook/agents-md-authoring.md
    range: [103, 117]
    contentHash: TBD-on-commit
    note: AGENTS change-control workflow requires inbox authorization and ADR for policy-significant edits.
  - kind: lines
    path: lib/inbox/in/172975_05-31-26/30025_1539_delegation-prompt-fidelity-no-editorializing.md
    range: [11, 31]
    contentHash: TBD-on-commit
    note: Authorizing inbox directive framing the contract gap and required outcomes.
---

## Context

The `AGENTS.md` §5 delegation policy governs delegation invocation mechanics: when
the parent invokes a named subagent, how long it waits, the 2-minute heartbeat,
the three-attempt retry, and the result report. The prior wording said the parent
invokes "with the remainder of the prompt as the delegated task" but did not
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
`{kind: lines, path: AGENTS.md, range: [121, 123], contentHash: TBD-on-commit}`.

When a parent agent constructs a delegated prompt, the parent agent SHALL NOT
inject interpretation, inferred intent, assumptions, background context,
prior-chat history, file contents, or directory listings unless the operator
prompt or a generated `work/<day>/<task-id>/next-prompt.md` names that exact
artifact. When the parent agent adds an operationally required reference, the
parent agent SHALL label it parent-supplied and SHALL keep it to the minimal
pointer the subagent needs to start. Citation:
`{kind: lines, path: AGENTS.md, range: [123, 129], contentHash: TBD-on-commit}`.

When a delegation prompt carries no instructions specifically intended for the
parent agent, the parent agent SHALL perform no repository reads, edits, or other
actions beyond invoking the subagent, SHALL wait for completion, and SHALL report
the delegated result without editorializing the subagent output. Citation:
`{kind: lines, path: AGENTS.md, range: [129, 134], contentHash: TBD-on-commit}`.

When a delegation prompt also carries instructions specifically intended for the
parent agent, the parent agent SHALL execute only those instructions, SHALL
sequence them relative to delegation as the instructions require, and SHALL NOT
expand them into adjacent unrequested work. Citation:
`{kind: lines, path: AGENTS.md, range: [137, 141], contentHash: TBD-on-commit}`.

When a parent agent invokes an executor on the planning/execution path, the
parent agent SHALL apply the same verbatim-fidelity and no-injection norm and
SHALL treat `AGENTS.md` §5 as the governing source. Citation:
`{kind: lines, path: lib/memory/handbook/context-economy.md, range: [188, 197], contentHash: TBD-on-commit}`.

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
`{kind: lines, path: lib/memory/handbook/agents-md-authoring.md, range: [103, 117], contentHash: TBD-on-commit}`.
On ratification the author SHALL set `status: accepted`.
