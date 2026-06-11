# Feature memory

`lib/memory/features/` is durable feature memory. It is intentionally compact:
feature folders are grouped by broad category and each feature retains only a
small `index.json` plus any machine-checkable contract sidecars that still gate
repo behavior.

Full feature-delivery artifacts do not live here after curation. Specs, plans,
delivery reports, UX specs, generated evidence, and historical run logs belong in
active work while a run is open and in `.pan/archive/**` or git history after
closure. Agents should read this tree for planning context, not for forensic
replay.

## Layout

```text
lib/memory/features/
  index.md                 # human/agent retrieval map
  index.json               # compact machine index
  <category>/
    index.md               # category-specific retrieval map
    <feature-id>/
      index.json           # compressed feature memory
      contracts.index.json # retained only when contracts are still useful
      contracts/**         # retained machine-checkable gates only
```

## Retrieval contract

1. Start with `lib/memory/features/index.md` when a task may depend on shipped
   feature context.
2. Open one category `index.md` whose "when to read" line matches the task.
3. Open at most 3 feature `index.json` files before planning, unless the operator
   asks for historical reconstruction.
4. Prefer `summary`, `planning_context`, `implementation_surfaces`, `validation`,
   and `open_followups` from `index.json`; do not resurrect removed specs or
   delivery reports into durable memory.
5. Use git history or `.pan/archive/**` for forensic replay of omitted artifacts.

## Categories

- `bootstrap-repo-ops/` — Bootstrap and repository operations. Use for bootstrap closure, repository layout, embedded install, and one-time migration history.
- `command-center/` — Command Center UX and operator surfaces. Use when planning or reviewing Command Center UI, operator mission control, automation views, or design-craft work.
- `delivery-pipeline/` — Feature-delivery pipeline and run operations. Use when changing feature-delivery stages, SDK progress, inbox kickoff, QA/review gates, or run lifecycle semantics.
- `memory-context/` — Memory, context economy, and retrieval. Use when changing active memory, feature indexes, Cursor retrieval, context budget, token economy, or memory MCP behavior.
- `platform-substrate/` — Pancreator package substrate. Use when changing @pancreator package boundaries, package contracts, CLI/MCP substrate, policy, runner, or storage packages.
- `quality-governance/` — Quality, compliance, and governance. Use when changing compliance tests, JSON/timestamp policy, operator verification, CI expectations, contract style, or QA gates.
