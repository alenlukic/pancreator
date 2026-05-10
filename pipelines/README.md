# Pipelines

The `pipelines/` directory carries the PRD §11 MVP pipeline definitions. Each
file is a YAML document loaded by `@tesseract/pipeline`'s `loadPipelineYaml`
(see `internal/packages/@tesseract/pipeline/src/load-yaml.ts`). Each pipeline declares
an `id`, an optional `version`, an ordered list of `stages` with optional
`persona` routing, and an open `metadata` map for forwards-compatible fields.

## MVP roster

| File | Pipeline `id` | Owner persona(s) |
|---|---|---|
| `feature-delivery.yaml` | `feature-delivery` | `intake-analyst` → `tech-lead` → `coder` → `reviewer` → `tech-writer` → `supervisor` → `librarian` |
| `chat-with-persona.yaml` | `chat-with-persona` | dispatched persona (M4+ ensemble runtime) |
| `knowledge-curation.yaml` | `knowledge-curation` | `librarian` → `librarian` → `tech-writer` |
| `init-greenfield.yaml` | `init-greenfield` | scaffold → `intake-analyst` → `tech-lead` |
| `adopt.yaml` | `adopt` | `adopter` → human ratification |

## Bootstrap status

The pipelines are registered through `loadPipelineYaml` for now; LangGraph
`StateGraph` compilation is stubbed in `internal/packages/@tesseract/pipeline/src/compile.ts`
and lands during the Phase 5 self-hosted milestone. Until then, stages execute
in order through `executePipeline` with delegation to named persona subagents
per `AGENTS.md` §4.

## Authoring rules

- Use RFC 2119 keywords (`MUST`, `SHALL`, `MAY`) and EARS shapes in any prose.
- Every cross-reference in `metadata.references[]` MUST be a dual-anchor
  citation (`{kind: 'symbol' | 'lines', path, contentHash}`).
- `metadata.tesseract-bootstrap-only: true` flags pipelines that exist only
  to satisfy the bootstrap and SHALL be retired or formalized once the
  runtime substrate lands.
