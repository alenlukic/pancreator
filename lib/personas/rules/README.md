# Persona Rule Specs

This directory is the tracked source of truth for Cursor rule projections.
Each `lib/personas/rules/<name>.yaml` file defines the tool-agnostic rule spec
for one persona, and `pnpm -w exec pan cursor-sync` emits the local
gitignored `.cursor/rules/<name>.mdc` shim from it.

Use these files when a persona needs rule-layer activation by path glob.
Keep the YAML focused on:

- `persona` — the canonical persona name; MUST match `lib/personas/<name>.md`
  and the rule filename.
- `description` — the activation description copied into the `.mdc` projection.
- `globs` — the non-empty list of repo paths that should activate the rule.
- `alwaysApply` — reserved for priority rules; normal persona rules use `false`.

Do not edit `.cursor/rules/*.mdc` directly. Regenerate projections with
`pnpm -w exec pan cursor-sync` after changing any file in this directory, then
verify drift with `node lib/internal/tools/check-cursor-projection-drift.mjs`.
