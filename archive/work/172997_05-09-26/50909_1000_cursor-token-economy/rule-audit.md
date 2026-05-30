# Cursor rule glob audit — cursor-token-economy

This artifact lists every `.cursor/rules/*.mdc` shim at audit time, the prior
`globs` activation surface, the new `globs` surface when changed, and the
rationale. Operators MUST ratify edits to persona-mirrored rules before merge.

| Rule file | Changed | Prior globs (summary) | New globs (summary) | Rationale |
|-----------|---------|------------------------|---------------------|-----------|
| 00-agents-md.mdc | yes | `["**/*"]` | `AGENTS.md`, `BOOTSTRAP.md`, `README.md`, `PRD.summary.md`, `PRD.index.md` | Reduce default attachment of AGENTS briefing to every indexed path while `alwaysApply` remains true. |
| pancreator-engineer.mdc | yes | Broad list including `lib/memory/**/*`, `work/**/*`, `.cursor/agents/**/*` | Scoped packages, tools, tests, configs, `lib/memory/handbook`, `personas`, `lib/personas/skills/SKILL.md`, `.cursor/rules/*.mdc`, `lib/inbox/in` | Remove default `work/**/*` and bulk memory activation per Engineering Spec. |
| intake-analyst.mdc | no | `lib/memory/features/**/spec.md`, inbox threads and in | unchanged | Already narrow for intake work. |
| tech-writer.mdc | no | Feature delivery reports, work delivery-report, lib/inbox/out | unchanged | Scoped to reporting artifacts. |
| supervisor.mdc | no | pipelines, run logs, checkpoints, postmortems | unchanged | Supervisor needs run-control paths; not broadened. |
| tech-lead.mdc | no | plan trio, lib/memory/adr | unchanged | Scoped to planning surfaces. |
| coder.mdc | no | packages lib/test, tests, work touch-set | unchanged | Scoped to code and touch-set. |
| reviewer.mdc | no | `work/**/review.md` | unchanged | Scoped to review artifact. |
| librarian.mdc | no | feature index, backlog, curation sweeps | unchanged | Scoped to curation. |
| compliance-auditor.mdc | no | compliance audit paths under work | unchanged | Scoped to compliance remediation. |
| contract-writer.mdc | no | feature contracts, pancreator configs, templates | unchanged | Scoped to contract authoring. |
| adopter.mdc | no | adoption scan, inbox adopter items, pancreator.yaml | unchanged | Scoped to adoption. |
| persona-designer.mdc | no | `lib/personas/**/*.md`, `.cursor/rules/**/*.mdc` | unchanged | Touches mirror parity; defer narrowing until human ratifies persona-designer scope. |

## Human ratification queue

1. AGENTS.md and handbook edits in this slice: operator review before merge.
2. `.cursor/agents/**` indexing exclusion in `.cursorindexingignore`: operator MUST confirm Cursor custom agent discovery after reindex.
3. Any future narrowing of `persona-designer.mdc` globs: requires explicit approval (mirror parity risk).
