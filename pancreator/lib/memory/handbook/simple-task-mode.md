---
slug: simple-task-mode
stability: experimental
bootstrap-only: false
phase: bootstrap
owners: [tech-lead, supervisor]
purpose: |
  Canonical bounded-work posture for low-risk mechanical tasks that do not
  justify broader memory, pipeline, or product-context expansion.
references:
  - '{"kind":"lines","path":"lib/memory/features/memory-context/active-memory-context-economy-pass-2/index.json","range":[288,352],"contentHash":"9b2ddcc","note":"Feature acceptance criteria define the low-risk bounded-work posture and escalation triggers."}'
  - '{"kind":"lines","path":".pan/archive/work/172997_05-09-26/3900_2255_plan-active-memory-context-economy-pass-2/plan.md","range":[36,42],"contentHash":"d0e8d06","note":"Plan decision D1 names simple task mode as a distinct operating posture."}'
related:
  - /AGENTS.md
  - /lib/memory/handbook/context-economy.md
  - /lib/memory/handbook/index.md
...

# Operator section
- 👀 **In this file:** Simple task mode contract
- ⚖️ **Why it matters:** Defines the bounded posture for low-risk mechanical work so agents do not over-read repo memory or widen scope unnecessarily.
- 🧭 **See also:**
  - /AGENTS.md
  - /lib/memory/handbook/context-economy.md
  - /lib/memory/handbook/index.md

# Simple task mode

This page is the canonical definition of `simple task mode`.

When a task executes under `simple task mode`, agents SHALL treat the posture as
the default for low-risk mechanical work.

When `simple task mode` applies, the mode SHALL cover small code edits, lint
invocations, typecheck invocations, build invocations, test invocations,
dependency inspection, file lookup, mechanical refactors, formatting fixes, and
repository maintenance that requires no product reasoning.

While `simple task mode` applies, an agent MUST NOT perform additional reads of
internal `AGENTS.md` beyond the startup read required by `AGENTS.md` §1.

While `simple task mode` applies, an agent MUST NOT read `.docs/PRD.md`.

While `simple task mode` applies, an agent MUST NOT read `.docs/BOOTSTRAP.md`.

While `simple task mode` applies, an agent MUST NOT traverse `lib/memory/**`.

While `simple task mode` applies, an agent MUST NOT traverse `.pan/work/**` or
`.pan/archive/work/**`.

While `simple task mode` applies, an agent MUST NOT load persona specs beyond
the persona the operator invoked.

While `simple task mode` applies, an agent MUST NOT invoke subagents unless the
operator request names a subagent explicitly. When a named subagent is required,
the agent MUST invoke the canonical `.cursor/agents/<name>.md` projection for
that persona.

While `simple task mode` applies, an agent MUST inspect only directly relevant
files.

While `simple task mode` applies, an agent MUST prefer exact paths over broad
codebase search.

When any trigger below becomes true, an agent SHALL exit `simple task mode`
before expanding context:

1. The task changes product behavior.
2. The task changes pipeline or persona semantics.
3. The task touches policy or compliance behavior.
4. The task requires active run artifact handling or historical artifact reconstruction.
5. Tests fail in a way that demands broader architectural diagnosis.
6. The operator explicitly requests broad repository analysis.

When an agent exits `simple task mode` and expands context surface, the agent
SHALL summarize the escalation rationale in `run.log.jsonl` or in the
operator-visible response body.
