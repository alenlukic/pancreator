# Tesseract Config

`tesseract.yaml` is the live operator-facing configuration file for this repository.
`tesseract-defaults.yaml` contains default policy values and historical bootstrap defaults; it is not the live bootstrap phase tracker.

## `project_root`

`tesseract.yaml` MUST include a top-level `project_root` property.

The value is either:

- an absolute path to the repository or project where the Tesseract harness is embedded, or
- a relative path from the Tesseract harness root to that embedded project root.

When Tesseract is being used to develop itself, `project_root` MUST be the special value `.`:

```yaml
project_root: "."
```

The `.` value means the harness root and target project root are the same directory.

## Adoption responsibility

The adopter persona owns proposing `project_root` during existing-repository adoption.

During adoption, the adopter SHOULD:

1. identify the target repository root,
2. propose the appropriate `project_root` value,
3. use `.` for self-hosting/self-development setups,
4. avoid writing `tesseract.yaml` directly unless the operator has ratified config-write mode.

## Bootstrap tracking

Live bootstrap state belongs in `tesseract.yaml` under the `bootstrap` block.

For this repository, the current live state is Phase 4 in progress with phases `-1`, `0`, `1`, `2`, and `3` completed.

`docs/BOOTSTRAP.md` remains the phase-contract and milestone reference. `docs/M1.index.md` is the compact route for M1/bootstrap context before loading the full bootstrap or PRD documents.

## Editing guidance

When changing `tesseract.yaml`:

- preserve the top-level `project_root` property,
- update bootstrap phase tracking only after checking `docs/BOOTSTRAP.md`,
- keep defaults in `tesseract-defaults.yaml` separate from live tracking,
- route adoption-related changes through `src/personas/adopter.md` and `src/skills/adopt-existing-repo/SKILL.md`.
