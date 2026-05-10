# @tesseract/persona

Parse and emit Anthropic 16-field persona YAML from `src/personas/<name>.md` with `.cursor/agents` mirror and `.mdc` shim text.

## Quickstart

```sh
pnpm install
pnpm --filter @tesseract/persona run build
pnpm --filter @tesseract/persona test
pnpm --filter @tesseract/persona run typecheck
```

Use `parsePersonaMarkdown` to load a file, `emitPersonaMarkdown` or `emitCursorAgentsMirror` to write the mirror body, and `emitMdcShim` for the five-line rule header plus `@src/personas/<name>.md` per the handbook.

## Scope

- This package depends only on `@tesseract/core`, `yaml`, and Node built-ins.
- Persona content lint (Layer 1) and filesystem writes are out of scope for this module API.
