---
title: Cursor rule audit — active-memory-context-economy-pass-2 slice 5
feature_id: active-memory-context-economy-pass-2
task_id: 173009_05-09-26/3900_2255_plan-active-memory-context-economy-pass-2
audited_at: 2026-05-09
references:
  - kind: lines
    path: src/memory/features/active-memory-context-economy-pass-2/spec.md
    range: [253, 265]
    contentHash: e6c4fcd2ef59f5cc9dfb5d528876b7e1e25dae7ccc9da22805d6343737ed0d9d
    note: Path-classification tiers tag internal operating content, durable memory, archival memory, and generated machine artifacts.
  - kind: lines
    path: src/memory/features/active-memory-context-economy-pass-2/spec.md
    range: [354, 396]
    contentHash: e6c4fcd2ef59f5cc9dfb5d528876b7e1e25dae7ccc9da22805d6343737ed0d9d
    note: Slim always-loaded context and narrow Cursor rule triggers, including handbook-route and src/work/** constraints.
  - kind: lines
    path: src/memory/features/active-memory-context-economy-pass-2/spec.md
    range: [398, 416]
    contentHash: e6c4fcd2ef59f5cc9dfb5d528876b7e1e25dae7ccc9da22805d6343737ed0d9d
    note: Product-context paths and internal operating content footprint groups.
  - kind: lines
    path: AGENTS.md
    range: [99, 100]
    contentHash: a29b04a32dc62da25ff1af024cca7ff74cc5fe3c76a2be301a7e391c4b56a0e1
    note: Canonical incoming queue path for `src/inbox/in/`.
  - kind: lines
    path: src/internal/work_archive/172997_05-09-26/3900_2255_plan-active-memory-context-economy-pass-2/plan.md
    range: [49, 49]
    contentHash: 58bbab6b966ad3014a4369cf75c6a43235f18832f625902ff70ff1151f086f70
    note: Plan records backlog key `active-memory-rule-glob-ratification` for mirror-parity deferrals.
  - kind: lines
    path: src/internal/work_archive/172997_05-09-26/3900_2255_plan-active-memory-context-economy-pass-2/plan.md
    range: [57, 57]
    contentHash: 58bbab6b966ad3014a4369cf75c6a43235f18832f625902ff70ff1151f086f70
    note: Plan task 5 mandates this audit artifact and mirrored rule ratification.
  - kind: lines
    path: src/internal/work_archive/172997_05-09-26/3900_2255_plan-active-memory-context-economy-pass-2/adr-draft.md
    range: [45, 59]
    contentHash: a001200da3a6253f9e329337cab3fbf1a262bc681a13006f0878dd03d2ec4bfa
    note: ADR draft states internal operating content loads by route and defines durable versus archival classes.
---

# Cursor rule audit

When this audit records a rule change, the change SHALL adjust only the YAML `description` anchor, the `globs` list, and the `alwaysApply` flag expected by Cursor.

When this audit cites memory tiers, the terms SHALL match the five-tier classification at `{kind: lines, path: src/memory/features/active-memory-context-economy-pass-2/spec.md, range: [253, 265], contentHash: e6c4fcd2ef59f5cc9dfb5d528876b7e1e25dae7ccc9da22805d6343737ed0d9d}`.

When this audit cites trigger-narrowing obligations, the obligations SHALL match `{kind: lines, path: src/memory/features/active-memory-context-economy-pass-2/spec.md, range: [375, 396], contentHash: e6c4fcd2ef59f5cc9dfb5d528876b7e1e25dae7ccc9da22805d6343737ed0d9d}` and the plan Cursor-rule task at `{kind: lines, path: src/internal/work_archive/172997_05-09-26/3900_2255_plan-active-memory-context-economy-pass-2/plan.md, range: [57, 57], contentHash: 58bbab6b966ad3014a4369cf75c6a43235f18832f625902ff70ff1151f086f70}`.

## 1. `00-agents-md.mdc`

| Field | Value |
| --- | --- |
| Prior globs | `AGENTS.md`, `BOOTSTRAP.md`, `README.md`, `PRD.summary.md`, `PRD.index.md`; `alwaysApply: true`; body referenced `@AGENTS.md` plus a cross-rule pointer to `pancreator-engineer.mdc` / `src/personas/pancreator-engineer.md`. |
| New globs | `AGENTS.md` only; `alwaysApply: true`; body is `@AGENTS.md` only. |
| Status | narrowed |
| Rationale | `PRD.summary.md`, `PRD.index.md`, `BOOTSTRAP.md`, and `README.md` are **product context** per `{kind: lines, path: src/memory/features/active-memory-context-economy-pass-2/spec.md, range: [413, 415], contentHash: e6c4fcd2ef59f5cc9dfb5d528876b7e1e25dae7ccc9da22805d6343737ed0d9d}`; the always-on rule SHALL not re-attach them on every turn. The body SHALL stay minimal per `{kind: lines, path: src/memory/features/active-memory-context-economy-pass-2/spec.md, range: [372, 373], contentHash: e6c4fcd2ef59f5cc9dfb5d528876b7e1e25dae7ccc9da22805d6343737ed0d9d}` and SHALL NOT chain-load another **internal operating content** rule. |

## 2. `pancreator-engineer.mdc`

| Field | Value |
| --- | --- |
| Prior globs | `src/inbox/in/**/*.md`, `src/internal/packages/@pancreator/**`, `src/internal/packages/pancreator/**`, `tools/**/*.mjs`, `tests/**/*.ts`, `tests/**/*.mjs`, `pancreator.yaml`, `pancreator-defaults.yaml`, `src/memory/handbook/**/*.md`, `src/personas/**/*.md`, `src/skills/**/SKILL.md`, `.cursor/rules/*.mdc`. |
| New globs | Same package, tool, test, config, inbox, skill, and `.cursor/rules/*.mdc` roots; `src/memory/handbook/**/*.md` replaced with explicit `src/memory/handbook/*.md` contract-route files plus `src/memory/handbook/contract-templates/**/*.md`; `src/personas/**/*.md` removed. |
| Status | narrowed |
| Rationale | `src/personas/**` is **internal operating content** per `{kind: lines, path: src/memory/features/active-memory-context-economy-pass-2/spec.md, range: [261, 262], contentHash: e6c4fcd2ef59f5cc9dfb5d528876b7e1e25dae7ccc9da22805d6343737ed0d9d}` and SHALL not activate this rule unless the task authors Personas. A wholesale `src/memory/handbook/**` sweep SHALL yield to route-scoped handbook files and templates per `{kind: lines, path: src/memory/features/active-memory-context-economy-pass-2/spec.md, range: [386, 387], contentHash: e6c4fcd2ef59f5cc9dfb5d528876b7e1e25dae7ccc9da22805d6343737ed0d9d}` and the route discipline at `{kind: lines, path: src/memory/features/active-memory-context-economy-pass-2/spec.md, range: [302, 303], contentHash: e6c4fcd2ef59f5cc9dfb5d528876b7e1e25dae7ccc9da22805d6343737ed0d9d}`. `src/work/**` stays absent per `{kind: lines, path: src/memory/features/active-memory-context-economy-pass-2/spec.md, range: [388, 390], contentHash: e6c4fcd2ef59f5cc9dfb5d528876b7e1e25dae7ccc9da22805d6343737ed0d9d}`. |

## 3. `persona-designer.mdc`

| Field | Value |
| --- | --- |
| Prior globs | `src/personas/**/*.md`, `.cursor/rules/**/*.mdc`. |
| New globs | `src/personas/**/*.md`, `.cursor/agents/**/*.md`, explicit `.cursor/rules/*.mdc` entries for each current persona-backed shim (12 files); omits `00-agents-md.mdc`. |
| Status | narrowed |
| Rationale | Persona authoring SHALL activate on `src/personas/**` and Cursor mirrors per **internal operating content** at `{kind: lines, path: src/memory/features/active-memory-context-economy-pass-2/spec.md, range: [261, 262], contentHash: e6c4fcd2ef59f5cc9dfb5d528876b7e1e25dae7ccc9da22805d6343737ed0d9d}`. The prior `.cursor/rules/**` glob SHALL attach this rule while editing the always-on AGENTS bridge; the explicit list SHALL stop that cross-coupling. When the repository adds one new persona rule file, the operator SHALL extend this list or SHALL route backlog item `active-memory-rule-glob-ratification` per `{kind: lines, path: src/internal/work_archive/172997_05-09-26/3900_2255_plan-active-memory-context-economy-pass-2/plan.md, range: [49, 49], contentHash: 58bbab6b966ad3014a4369cf75c6a43235f18832f625902ff70ff1151f086f70}`. |

## 4. `intake-analyst.mdc`

| Field | Value |
| --- | --- |
| Prior globs | `src/memory/features/**/spec.md`, `src/inbox/threads/**/*`, `src/inbox/in/**/*`. |
| New globs | `src/memory/features/**/spec.md`, `src/inbox/threads/**/*.md`, `src/inbox/in/**/*.md`. |
| Status | narrowed |
| Rationale | `src/memory/features/**/spec.md` is **durable memory** at `{kind: lines, path: src/memory/features/active-memory-context-economy-pass-2/spec.md, range: [258, 259], contentHash: e6c4fcd2ef59f5cc9dfb5d528876b7e1e25dae7ccc9da22805d6343737ed0d9d}`. `src/inbox/threads/**` is **archival memory** at `{kind: lines, path: src/memory/features/active-memory-context-economy-pass-2/spec.md, range: [256, 256], contentHash: e6c4fcd2ef59f5cc9dfb5d528876b7e1e25dae7ccc9da22805d6343737ed0d9d}`. The `src/inbox/in/**` queue is canonical per `{kind: lines, path: AGENTS.md, range: [99, 100], contentHash: a29b04a32dc62da25ff1af024cca7ff74cc5fe3c76a2be301a7e391c4b56a0e1}`. Markdown-only patterns SHALL match this repository slice inventory and SHALL avoid non-text attachment churn. |

## 5. `supervisor.mdc`

| Field | Value |
| --- | --- |
| Prior globs | `src/pipelines/**/*.yaml`, `src/work/**/run.log.jsonl`, `src/work/**/run-summary.md`, `src/memory/checkpoints/**/*.json`, `src/memory/postmortems/**/*.md`. |
| New globs | Unchanged. |
| Status | kept-as-is |
| Rationale | The rule body targets pipeline orchestration and **archival memory** run logs under `src/work/**/run.log.jsonl` and `src/work/**/run-summary.md`, which satisfies the explicit `src/work/**` exception at `{kind: lines, path: src/memory/features/active-memory-context-economy-pass-2/spec.md, range: [388, 390], contentHash: e6c4fcd2ef59f5cc9dfb5d528876b7e1e25dae7ccc9da22805d6343737ed0d9d}`. `src/memory/checkpoints/**/*.json` matches **generated machine artifacts** per `{kind: lines, path: src/memory/features/active-memory-context-economy-pass-2/spec.md, range: [263, 265], contentHash: e6c4fcd2ef59f5cc9dfb5d528876b7e1e25dae7ccc9da22805d6343737ed0d9d}`; narrowing below pipeline checkpoint files SHALL risk false-negative activation, so the prior glob set remains. |

## 6. `tech-lead.mdc`

| Field | Value |
| --- | --- |
| Prior globs | `src/work/**/plan.md`, `src/work/**/adr-draft.md`, `src/work/**/touch-set.json`, `src/memory/adr/**/*.md`. |
| New globs | Same `src/work/**` plan artifacts; `src/memory/adr/**/*.md` replaced with `src/memory/adr/*.md`. |
| Status | narrowed |
| Rationale | `src/work/**` plan outputs stay within the run-artifact exception at `{kind: lines, path: src/memory/features/active-memory-context-economy-pass-2/spec.md, range: [388, 390], contentHash: e6c4fcd2ef59f5cc9dfb5d528876b7e1e25dae7ccc9da22805d6343737ed0d9d}`. `src/memory/adr/*.md` still covers **durable memory** ADR seeds at `{kind: lines, path: src/memory/features/active-memory-context-economy-pass-2/spec.md, range: [258, 259], contentHash: e6c4fcd2ef59f5cc9dfb5d528876b7e1e25dae7ccc9da22805d6343737ed0d9d}` without recursive depth that this repository does not use. |

## 7. `tech-writer.mdc`

| Field | Value |
| --- | --- |
| Prior globs | `src/memory/features/**/delivery-report.md`, `src/work/**/delivery-report.md`, `src/inbox/out/**/*`. |
| New globs | `src/memory/features/**/delivery-report.md`, `src/work/**/delivery-report.md`, `src/inbox/out/**/*.md`. |
| Status | narrowed |
| Rationale | Delivery reports under `src/memory/features/**` and `src/work/**` remain **durable memory** and **archival memory** artifacts per `{kind: lines, path: src/memory/features/active-memory-context-economy-pass-2/spec.md, range: [256, 259], contentHash: e6c4fcd2ef59f5cc9dfb5d528876b7e1e25dae7ccc9da22805d6343737ed0d9d}`. `src/inbox/out/**` is archival operator mail; limiting activation to Markdown SHALL match every staged report today and SHALL avoid attaching on non-text outputs. |

## Mirror-parity escape hatch

When the audit evaluates backlog item `active-memory-rule-glob-ratification` at `{kind: lines, path: src/internal/work_archive/172997_05-09-26/3900_2255_plan-active-memory-context-economy-pass-2/plan.md, range: [49, 49], contentHash: 58bbab6b966ad3014a4369cf75c6a43235f18832f625902ff70ff1151f086f70}`, the audit SHALL record whether any rule used deferred status.

**Result:** The escape hatch **was not** used; every rule is **narrowed** or **kept-as-is**, and no rule is **deferred** solely for mirror parity.

Human ratification remains mandatory for mirrored `.cursor/rules/*.mdc` diffs per `{kind: lines, path: src/memory/features/active-memory-context-economy-pass-2/spec.md, range: [500, 504], contentHash: e6c4fcd2ef59f5cc9dfb5d528876b7e1e25dae7ccc9da22805d6343737ed0d9d}`.
