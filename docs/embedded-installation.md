# Embedded Pancreator installation

Install Pancreator into another repository so the harness can fingerprint, gate, and run workflows against that project as the deliverable workspace.

## Requirements

- macOS or another UNIX environment with Bash
- A Pancreator checkout (this repository)
- A target project directory

## Quick install

From the Pancreator checkout:

```sh
./bin/install --target /path/to/your-project
```

The installer writes Pancreator-owned configuration under `.pancreator/` in the target project and creates `project.json` at the project root. It does not modify other application source.

## Generated files

| Path                                  | Purpose                                                               |
| ------------------------------------- | --------------------------------------------------------------------- |
| `project.json`                        | Workspace identity, state root, and tracking include/exclude patterns |
| `.pancreator/install.json`            | Records the Pancreator checkout used for installation                 |
| `.pancreator/runtime/inbox/`          | Drop zone for operator requests                                       |
| `.pancreator/runtime/logs/workflows/` | Per-run workflow records for the embedded workspace                   |
| `.pancreator/runtime/backlog/`        | Optional backlog storage                                              |

`project.json` excludes common generated paths (`dist/`, `node_modules/`, `coverage/`, and related build artifacts) so automated test commands do not block workflow progression solely because of expected generated output.

## Verification

After installation, confirm the configuration exists:

```sh
test -f /path/to/your-project/project.json
test -d /path/to/your-project/.pancreator/runtime/inbox
```

### Scripted smoke verification

Run the installer smoke harness from the Pancreator checkout:

```sh
./bin/install --smoke
```

The smoke run creates temporary skeleton projects, exercises fresh install, idempotent `--yes` rerun, and partial-install `[r]`/`[c]`/`[a]` branches via the deterministic `--choice` harness, then reports `smoke: all steps passed` on success.

Integration tests in `tests/integration/embedded-installation.test.ts` cover the same installer behaviors at the Node test boundary; run them with:

```sh
npm run test:integration
```

Start a workflow from the Pancreator checkout, targeting the embedded project:

```sh
./bin/pan init --workflow dev \
  --request runtime/inbox/request.md \
  --workspace /path/to/your-project
```

The invocation card should show the embedded path as the workspace root.

## Idempotent reruns

When installation is already complete, rerunning the installer without flags repeats the configuration write and reports success. In non-interactive contexts (CI or piped stdin), pass `--yes`:

```sh
./bin/install --target /path/to/your-project --yes
```

## Partial installations

If `.pancreator/` exists but required files are missing, the installer detects a partial installation.

**Interactive mode** prompts:

- `[r]` repair — recreate missing configuration and runtime layout
- `[c]` clean install — remove `.pancreator/` and reinstall from scratch
- `[a]` abort — exit without changes

**Non-interactive mode** requires an explicit choice:

```sh
./bin/install --target /path/to/your-project --repair
./bin/install --target /path/to/your-project --clean
```

**Smoke and test harness** can supply the interactive choice deterministically:

```sh
./bin/install --target /path/to/your-project --choice r
./bin/install --target /path/to/your-project --choice c
./bin/install --target /path/to/your-project --choice a
```

`--choice` routes through the same repair, clean, and abort branches as the interactive prompt.

## Cleanup and rollback

To remove Pancreator from a target project:

```sh
rm -rf /path/to/your-project/.pancreator
```

This removes only Pancreator-owned paths. It does not revert changes made during workflow runs to tracked project source; use your normal source-control tools for that.

A clean reinstall removes `.pancreator/` first, then writes fresh configuration:

```sh
./bin/install --target /path/to/your-project --clean
```

## Options reference

```sh
./bin/install --target <dir> [--pancreator-root <dir>] [--repair | --clean | --yes | --choice <r|c|a>]
./bin/install --smoke
```

- `--target` — required unless `--smoke`; the project directory to embed Pancreator into
- `--pancreator-root` — Pancreator checkout path (defaults to the parent of this script)
- `--repair` — fix a partial installation without prompting
- `--clean` — remove `.pancreator/` and reinstall
- `--yes` — non-interactive idempotent rerun when installation is already complete
- `--choice` — deterministic partial-install choice (`r`, `c`, or `a`) for smoke tests and automation
- `--smoke` — run scripted smoke verification against temporary dummy projects
