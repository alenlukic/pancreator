# Task List - @tesseract/persona

- [x] T1: Confirm package scaffold and exported surface satisfy `tesseract.persona.package_shape`.
- [x] T2: Confirm README Quickstart satisfies `tesseract.persona.readme_ergonomics` (manual review; LLM-judge contract deferred to CI).
- [x] T3: Implement `parsePersonaMarkdown`, structural validation (`assertPersonaSpec` / `isPersonaSpec`), `emitPersonaMarkdown` / `emitCursorAgentsMirror`, and `emitMdcShim` per `memory/handbook/persona-spec.md`.
- [x] T4: Add `yaml` dependency, vitest round-trip on `personas/tech-writer.md`, and validation unit tests.
- [x] T5: Wire `build`, `test`, `typecheck`, `attw`, and `publint` scripts; green on Phase 3 step 5 slice.

## Deferred

- Byte-identical round-trip (YAML reorders keys; semantic equality is asserted).
- Optional known-metadata key lint and Layer 1 body lint inside the package.
- Automated CLI or filesystem write of `.cursor/agents` on disk (caller-owned I/O).
