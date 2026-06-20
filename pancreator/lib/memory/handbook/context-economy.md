---
slug: context-economy
stability: experimental
bootstrap-only: false
phase: bootstrap
owners: [tech-lead, supervisor]
purpose: |
  Default discipline for AI context, Cursor indexing, and explicit document
  retrieval so routine tasks avoid loading the full durable-memory and work
  artifact surface.
references:
  - '{"kind":"lines","path":"AGENTS.md","range":[1,36],"contentHash":"b953d77","note":"AGENTS defines the primary entry contract and canon table including PRD routing."}'
  - '{"kind":"lines","path":"lib/memory/handbook/index.md","range":[53,72],"contentHash":"a4563dc","note":"Handbook index defines retrieval policy and routing table maintenance rules."}'
  - '{"kind":"lines","path":"lib/memory/features/memory-context/active-memory-context-economy-pass-2/index.json","range":[288,352],"contentHash":"9b2ddcc","note":"Context-economy acceptance criteria include tier routing and retrieval-discipline rules."}'
  - '{"kind":"lines","path":"lib/memory/handbook/glossary.md","range":[205,226],"contentHash":"762edb4","note":"Glossary defines active-memory and related tier nouns used here."}'
related:
  - lib/memory/handbook/index.md
  - lib/memory/handbook/memory-tiers.md
  - lib/memory/handbook/glossary.md
  - lib/memory/handbook/simple-task-mode.md
  - lib/memory/active/current.md
  - lib/memory/handbook/context-cost-audit.md
...

# Operator section
- 👀 **In this file:** Context economy and Cursor retrieval
- ⚖️ **Why it matters:** Quick orientation for Context economy and Cursor retrieval before agents load the full contract.
- 🧭 **See also:**
  - lib/memory/handbook/index.md
  - lib/memory/handbook/memory-tiers.md
  - lib/memory/handbook/glossary.md

# Context economy and Cursor retrieval

## Default retrieval discipline

Agents and operators MUST load the smallest surface that resolves the task:

1. Read the **agent operating card** first: `AGENTS.md` (self-host) or
   `.pancreator/AGENTS.md` (embedded).
2. Read `lib/memory/active/current.md` when the task needs current Feature pointers
   inside **active-memory** and
   `lib/memory/handbook/simple-task-mode.md` does not block that read.
3. Read `OPERATION.md` when the task needs human operator procedure context.
4. Read `lib/memory/handbook/index.md` and follow at most one primary route plus
   stated secondaries.

**Internal product docs** (`.docs/**`): read only for Pancreator self-development
or meta-persona tasks. Route through `.docs/PRD.summary.md` and `.docs/PRD.index.md`
before full `.docs/PRD.md` or `.docs/BOOTSTRAP.md`. Feature-delivery stage personas
MUST NOT load `.docs/**` unless the bounded prompt names an internal task.

Agents MUST NOT read, traverse, ingest, cite, or modify files under
`lib/inbox/notes/` per inbox lifecycle.

## RTK-first shell retrieval

When a task uses shell commands for repository inspection, the agent MUST prefer
RTK-compressed wrappers before raw shell commands.

### Mandatory substitution catalog

Only high-frequency `rtk` commands that agents use in routine coding workflows
are listed below. Agents SHALL prefer these mappings over raw commands.

| `rtk` command | Substitutes |
| --- | --- |
| `rtk ls` | `ls` |
| `rtk tree` | `tree` |
| `rtk read` | `cat`, `head`, `tail`, `sed -n` file inspection flows |
| `rtk find` | `find` |
| `rtk grep` | `grep`, `rg` broad text search flows |
| `rtk git` | `git` |
| `rtk pnpm` | `pnpm` |
| `rtk npm` | `npm` |
| `rtk npx` | `npx` |
| `rtk err` | Manual stderr filtering pipelines |
| `rtk test` | Raw test command + manual failure extraction |
| `rtk jest` | `jest` |
| `rtk vitest` | `vitest` |
| `rtk pytest` | `pytest` |
| `rtk ruff` | `ruff` |
| `rtk mypy` | `mypy` |
| `rtk tsc` | `tsc` |
| `rtk lint` | `eslint` and compatible lint entrypoints |

### Required first-pass commands by task

Agents SHALL use these exact first-pass commands before any raw equivalent:

1. **Broad file inspection**: `rtk read <path> -l aggressive`
2. **Broad symbol/content search**:
   `rtk grep "<pattern>" <path> --ultra-compact`
3. **Directory shape inspection**: `rtk ls <path>` (or `rtk tree <path>`)
4. **Git working-set inspection**:
   `rtk git status`, `rtk git diff`, `rtk git log`
5. **Test failure triage**: framework-specific wrapper (for example
   `rtk test <cmd>`, `rtk jest`, `rtk vitest`, `rtk pytest`)
6. **Lint/typecheck diagnostics**: wrapper commands (for example
   `rtk lint`, `rtk tsc`, `rtk ruff`, `rtk mypy`)

### Task-specific usage rules (judgment minimization)

Agents SHALL follow the case logic below.

1. **Searching for a function name to refactor**
   - Run `rtk grep "<function_name>" <scope> --ultra-compact`.
   - Use grouped output to collect candidate files.
   - For each candidate file, run `rtk read <file> -l aggressive` first.
   - Only after this pass, rerun `rtk read <file>` for exact body-level edits.
2. **Finding every file that mentions "token economy" before further processing**
   - Run `rtk grep "token economy" <scope> --ultra-compact`.
   - Use grouped file buckets as the canonical candidate set.
   - Inspect each candidate with `rtk read <file> -l aggressive` before deeper
     parsing or edits.
3. **Pre-edit impact scan for a symbol/config key**
   - Start with `rtk grep "<symbol_or_key>" <scope> --ultra-compact`.
   - Inspect only matched files with `rtk read`; do not broad-scan directories
     after matches are known.
4. **Repository state checks before or after edits**
   - Use `rtk git status`, `rtk git diff`, and `rtk git log`.
   - Do not switch to raw `git` output unless required detail is missing.
5. **Test-output triage**
   - Use the nearest wrapper (`rtk jest`, `rtk vitest`, `rtk pytest`,
     `rtk cargo test`, `rtk go test`, or `rtk test <cmd>`).
   - Use `rtk err <cmd>` when the command is not test-native but failure-only
     diagnostics are required.
6. **Lint/typecheck triage**
   - Use `rtk lint`, `rtk tsc`, `rtk ruff`, or `rtk mypy` before raw
     invocations.
7. **Dependency/package inspection**
   - Prefer `rtk pnpm`, `rtk npm`, and `rtk npx` over raw package-manager
     listings.

### Exception and escalation path

- Built-in `Read`/`Grep` or raw shell commands MAY be used only when the active
  task needs exact-path, full-fidelity output that compressed RTK output omits.
- Before escalating, agents SHALL rerun a **narrower RTK command** first:
  tighter path, tighter pattern, or direct per-file reads.
- If the RTK output is still insufficient, agents SHALL state the missing detail
  and then perform the minimal raw command needed to recover that detail.
- Hook rewrite scope is shell-only: built-in `Read`/`Grep`/`Glob` tool calls do
  not auto-rewrite through RTK, so shell-based inspection MUST use explicit RTK
  commands when RTK filtering is required.

## Memory-tier routing

This section states canonical routing cited at
`{kind: lines, path: lib/memory/features/memory-context/active-memory-context-economy-pass-2/index.json, range: [288, 312], contentHash: 9b2ddcc}`.

When an agent asks what the memory tiers mean, the agent SHALL open
`lib/memory/handbook/memory-tiers.md` before loading broader `lib/memory/` trees.

When an agent asks what is actively coordinated now, the agent SHALL open
`lib/memory/active/current.md` unless
`lib/memory/handbook/simple-task-mode.md` blocks that read.

When an agent selects default memory orientation, the agent SHALL treat
`lib/memory/active/**` as the only **active-memory** tier intended for routine
default orientation among Memory paths.

When an agent selects **active-work**, the agent SHALL treat `.pan/work/**` as
active run workspace and explicit-read only by default.

When an agent selects **archival-memory**, the agent SHALL treat
`.pan/archive/work/**`, `lib/inbox/out/**`, `.pan/archive/inbox/**`, and
`lib/inbox/threads/**` as archival memory and explicit-read only.

When an agent loads **internal-operating-content**, the agent SHALL load named
routes only and SHALL NOT sweep entire handbook, persona, skill, or Cursor rule
trees without justification.

When an agent expands context into **durable-memory** Feature specs, the agent
SHALL record task-specific justification in the operator thread or run log.

When an agent reads full `.docs/PRD.md`, `.docs/BOOTSTRAP.md`, or archival run artifacts,
the agent SHALL record task-specific justification in the operator thread or
run log.

## Indexed versus explicit-read surfaces

The repository root `.cursorindexingignore` file declares paths agents SHOULD
treat as low default indexing value.

Exclusion from default indexing MUST NOT mean deletion or secrecy: humans and
agents SHALL still open excluded files with explicit paths or editor
attachments when the task requires them.

Typical explicit-read surfaces include:

- Internal `AGENTS.md` and entire `.docs/**` tree, including `.docs/README.md`
  (Pancreator product development; explicit-read only).
- `lib/memory/adr/`, `lib/memory/backlog/`, `lib/memory/research/`, `tests/**`.
- Full `.docs/PRD.md` and `.docs/BOOTSTRAP.md` after compact internal routes.
- Selected `.pan/work/**` artifacts for active-run handling.
- Selected `.pan/archive/work/**`, `lib/inbox/out/**`, `.pan/archive/inbox/**`,
  and `lib/inbox/threads/**` artifacts for historical reconstruction.
- `lib/memory/features/**` for Feature specs, contracts, and delivery reports when
  the named Feature is in scope.
