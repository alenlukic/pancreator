# Pipelines

The `lib/pipelines/` directory carries the PRD §11 MVP pipeline definitions. Each
file is a YAML document loaded by `@pancreator/pipeline`'s `loadPipelineYaml`
(see `lib/internal/packages/@pancreator/pipeline/lib/load-yaml.ts`). Each pipeline declares
an `id`, an optional `version`, an ordered list of `stages` with optional
`persona` routing, and an open `metadata` map for forwards-compatible fields.

## MVP roster

| File | Pipeline `id` | Owner persona(s) |
|---|---|---|
| `feature-delivery.yaml` | `feature-delivery` | `product-engineer` ∥ `design-engineer` → `tech-lead` → `coder` → `reviewer` → `qa-tester` ∥ `design-reviewer` → `tech-writer` → `compliance-auditor` → `supervisor` → `librarian` |
| `chat-with-persona.yaml` | `chat-with-persona` | backlog-deferred (M2+; skeleton registered at bootstrap) |
| `knowledge-curation.yaml` | `knowledge-curation` | `librarian` → `librarian` → `tech-writer` |
| `init-greenfield.yaml` | `init-greenfield` | scaffold → `intake-analyst` → `tech-lead` |
| `adopt.yaml` | `adopt` | `adopter` → human ratification |
| `experience-planning.yaml` | `experience-planning` | `intake-analyst` → `sme-product` ∥ `sme-design` → human review gate → `product-design-lead` → optional `supervisor` deliver |

## Bootstrap status

The pipelines are registered through `loadPipelineYaml`. `pan run feature-delivery <inbox-entry>` (path relative to `lib/inbox/in/`, for example `<day-bucket>/<file>.md`) now creates a Phase-4 active-work state machine beginning at the plan stage, handoff card, generated `next-prompt.md`, companion product/design prompts, and run log for the first stage. `pan advance <task-id> --artifact <path>` records accepted stage artifacts, mutates `state.json`, appends the run log, and regenerates the next handoff/prompt. When feature-delivery reaches `complete`, the generated `next-prompt.md` becomes the final librarian handoff: after human validation/indexing, the librarian runs `pan close-artifacts <task-id>` to archive the active `.pan/work/<day>/<task-id>/` directory to `.pan/archive/work/<day>/<task-id>/`, remove the now-empty active day directory, and move the source `lib/inbox/in/` directive to `.pan/archive/inbox/in/<day>/<task-id>/`. `pan refresh-prompt <task-id>` regenerates `handoff.md` and `next-prompt.md` from the current ledger without changing state, which is useful after prompt template changes or for already-complete runs. LangGraph `StateGraph` compilation remains stubbed in `lib/internal/packages/@pancreator/pipeline/lib/compile.ts` and lands during the Phase 5 self-hosted milestone. Until then, operators still invoke the named Cursor persona subagents manually, but they should delegate only the generated `next-prompt.md` rather than broad prior chat context.

## Authoring rules

- Use RFC 2119 keywords (`MUST`, `SHALL`, `MAY`) and EARS shapes in any prose.
- Every cross-reference in `metadata.references[]` MUST be a dual-anchor
  citation (`{kind: 'symbol' | 'lines', path, contentHash}`).
- `metadata.pancreator-bootstrap-only: true` flags pipelines that exist only
  to satisfy the bootstrap and SHALL be retired or formalized once the
  runtime substrate lands.

## knowledge-curation cron seed (M1)

The `knowledge-curation` pipeline carries an operator-invoked cron seed in
`metadata.cron_seed` (see `knowledge-curation.yaml`). Until M4 scheduler wiring
lands, operators SHALL run the seed manually:

1. **Cadence:** daily during active bootstrap work; weekly minimum during quiet periods.
2. **Trigger:** run the commands listed under `metadata.cron_seed.operator_commands`,
   then delegate the librarian persona through the `scan`, `curate`, and `report`
   stages using a dedicated inbox directive when drift work is required.
3. **Destinations:** drift reports land in `lib/inbox/out/`; per-feature citation
   scans land under `lib/memory/curation/<feature-id>-citation-rot-scan.md`.
4. **Ownership:** the librarian persona owns the anti-rot loop; scheduler automation
   deferral is recorded under `metadata.cron_seed.anti_rot_loop.scheduler_deferral`.
