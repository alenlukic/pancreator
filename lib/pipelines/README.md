# Pipelines

The `lib/pipelines/` directory carries the PRD §11 MVP pipeline definitions. Each
file is a YAML document loaded by `@pancreator/pipeline`'s `loadPipelineYaml`
(see `lib/internal/packages/@pancreator/pipeline/lib/load-yaml.ts`). Each pipeline declares
an `id`, an optional `version`, an ordered list of `stages` with optional
`persona` routing, and an open `metadata` map for forwards-compatible fields.

## MVP roster

| File | Pipeline `id` | Owner persona(s) |
|---|---|---|
| `feature-delivery.yaml` | `feature-delivery` | `intake-analyst` → `tech-lead` → `coder` → `reviewer` → `qa-tester` → `tech-writer` → `supervisor` → `librarian` |
| `chat-with-persona.yaml` | `chat-with-persona` | backlog-deferred (M2+; skeleton registered at bootstrap) |
| `knowledge-curation.yaml` | `knowledge-curation` | `librarian` → `librarian` → `tech-writer` |
| `init-greenfield.yaml` | `init-greenfield` | scaffold → `intake-analyst` → `tech-lead` |
| `adopt.yaml` | `adopt` | `adopter` → human ratification |

## Bootstrap status

The pipelines are registered through `loadPipelineYaml`. `pan run feature-delivery <inbox-entry>` (path relative to `lib/inbox/in/`, for example `<day-bucket>/<file>.md`) now creates a Phase-4 active-work state machine, handoff card, generated `next-prompt.md`, and run log for the first stage. `pan advance <task-id> --artifact <path>` records accepted stage artifacts, mutates `state.json`, appends the run log, and regenerates the next handoff/prompt. When feature-delivery reaches `complete`, the generated `next-prompt.md` becomes the final librarian handoff: after human validation/indexing, the librarian runs `pan close-artifacts <task-id>` to archive the active `work/<day>/<task-id>/` directory to `archive/work/<day>/<task-id>/`, remove the now-empty active day directory, and move the source `lib/inbox/in/` directive to `archive/inbox/in/<day>/<task-id>/`. `pan refresh-prompt <task-id>` regenerates `handoff.md` and `next-prompt.md` from the current ledger without changing state, which is useful after prompt template changes or for already-complete runs. LangGraph `StateGraph` compilation remains stubbed in `lib/internal/packages/@pancreator/pipeline/lib/compile.ts` and lands during the Phase 5 self-hosted milestone. Until then, operators still invoke the named Cursor persona subagents manually, but they should delegate only the generated `next-prompt.md` rather than broad prior chat context.

## Authoring rules

- Use RFC 2119 keywords (`MUST`, `SHALL`, `MAY`) and EARS shapes in any prose.
- Every cross-reference in `metadata.references[]` MUST be a dual-anchor
  citation (`{kind: 'symbol' | 'lines', path, contentHash}`).
- `metadata.pancreator-bootstrap-only: true` flags pipelines that exist only
  to satisfy the bootstrap and SHALL be retired or formalized once the
  runtime substrate lands.
