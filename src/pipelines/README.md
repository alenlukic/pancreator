# Pipelines

The `src/pipelines/` directory carries the PRD §11 MVP pipeline definitions. Each
file is a YAML document loaded by `@tesseract/pipeline`'s `loadPipelineYaml`
(see `src/internal/packages/@tesseract/pipeline/src/load-yaml.ts`). Each pipeline declares
an `id`, an optional `version`, an ordered list of `stages` with optional
`persona` routing, and an open `metadata` map for forwards-compatible fields.

## MVP roster

| File | Pipeline `id` | Owner persona(s) |
|---|---|---|
| `feature-delivery.yaml` | `feature-delivery` | `intake-analyst` → `tech-lead` → `coder` → `reviewer` → `tech-writer` → `supervisor` → `librarian` |
| `chat-with-persona.yaml` | `chat-with-persona` | backlog-deferred (M2+; skeleton registered at bootstrap) |
| `knowledge-curation.yaml` | `knowledge-curation` | `librarian` → `librarian` → `tech-writer` |
| `init-greenfield.yaml` | `init-greenfield` | scaffold → `intake-analyst` → `tech-lead` |
| `adopt.yaml` | `adopt` | `adopter` → human ratification |

## Bootstrap status

The pipelines are registered through `loadPipelineYaml`. `tess run feature-delivery <inbox-entry>` (path relative to `src/inbox/in/`, for example `<day-bucket>/<file>.md`) now creates a Phase-4 active-work state machine, handoff card, generated `next-prompt.md`, and run log for the first stage. `tess advance <task-id> --artifact <path>` records accepted stage artifacts, mutates `state.json`, appends the run log, and regenerates the next handoff/prompt. When feature-delivery reaches `complete`, the generated `next-prompt.md` becomes the final librarian handoff: after human validation/indexing, the librarian runs `tess close-artifacts <task-id>` to archive the active `src/work/<day>/<task-id>/` directory to `src/internal/work_archive/<day>/<task-id>/`, remove the now-empty active day directory, and move the source `src/inbox/in/` directive to `src/inbox/archive/in/<day>/<task-id>/`. `tess refresh-prompt <task-id>` regenerates `handoff.md` and `next-prompt.md` from the current ledger without changing state, which is useful after prompt template changes or for already-complete runs. LangGraph `StateGraph` compilation remains stubbed in `src/internal/packages/@tesseract/pipeline/src/compile.ts` and lands during the Phase 5 self-hosted milestone. Until then, operators still invoke the named Cursor persona subagents manually, but they should delegate only the generated `next-prompt.md` rather than broad prior chat context.

## Authoring rules

- Use RFC 2119 keywords (`MUST`, `SHALL`, `MAY`) and EARS shapes in any prose.
- Every cross-reference in `metadata.references[]` MUST be a dual-anchor
  citation (`{kind: 'symbol' | 'lines', path, contentHash}`).
- `metadata.tesseract-bootstrap-only: true` flags pipelines that exist only
  to satisfy the bootstrap and SHALL be retired or formalized once the
  runtime substrate lands.
