# Embedded Pancreator installation

Pancreator's supported v0 deployment model is **harness inside target**. A
Pancreator source checkout installs a self-contained harness at
`<target>/.pancreator`; the target repository remains the workspace opened in
Cursor and the owner of application code, Git state, and repository-specific
instructions.

## Requirements

- Node.js 22 or newer
- npm
- Git
- Cursor with project commands and subagents enabled

## Install

From a Pancreator source checkout:

```sh
./bin/install --target /path/to/target-repository
```

A production-capable install runs `npm ci` and builds the embedded CLI. Run the
post-install checks from the target repository:

```sh
cd /path/to/target-repository
./.pancreator/bin/pan doctor
./.pancreator/bin/pan validate
# Then run /pan-build-docs in Cursor to replace the bootstrap target primer.
```

## Installed layout

```text
<target>/
  .cursor/
    agents/                 # Pancreator personas projected for Cursor
    commands/               # /pan-* commands projected for Cursor
    rules/pancreator.mdc    # embedded operating rule
  .pancreator/
    AGENTS.md               # installed-harness operating card
    VERSION
    install.json            # source version/commit and ownership manifest
    project.json            # embedded workspace and model configuration
    bin/ docs/ governance/ library/ src/ tests/
    dist/ node_modules/     # built v0 runtime and development tooling
    runtime/                # target-specific durable workflow state
    backups/cursor/         # replaced operator Cursor files, when needed
```

When the target already has a `.gitignore`, installation and refresh add a
single `.pancreator/` entry while preserving all existing content. The installer
does not create a target `.gitignore` when none exists. This keeps the embedded
harness and its target-specific runtime state local to the checkout.

The target root does **not** receive a Pancreator `project.json`. The installed
configuration lives at `.pancreator/project.json` with:

- `installation_mode: "embedded"`
- `workspace_root: ".."` so the target repository is authoritative
- `state_root: "runtime"` so state resolves to `.pancreator/runtime`

Pancreator infrastructure, tooling, workflows, personas, governance, schemas,
and validators are retained. Source-checkout self-development context is not
installed: `.git`, `.env`, source `runtime/`, nested `workdesk/`, editor-local
settings, and the self-development operating card are excluded.

## Cursor merge behavior

The source checkout's `.cursor/` directory is local, fully gitignored, and never
used as installation input. Canonical Cursor agents, commands, and rules live
under `library/cursor/` and are declared by
`governance/registries/projection_manifest.json`.

The installer renders those canonical artifacts into the target's `.cursor/`
directory. It preserves unrelated files such as custom settings and
non-conflicting commands.

When `.cursor/` already exists on first install, the installer emits a prominent
warning banner. Pancreator assumes a pristine agentic/harness environment;
retained custom Cursor configuration can conflict semantically even when file
paths do not collide.

A conflicting Pancreator-owned path is backed up before replacement under:

```text
.pancreator/backups/cursor/<timestamp>/.cursor/...
```

`install.json` records the checksum of every projected Cursor file. On refresh,
operator edits to a Pancreator-owned file are backed up before reprojection.
Files formerly owned by Pancreator are removed only when their checksum still
matches the previous installation; modified operator copies are retained.

Cursor operates from the target root. Therefore projected instructions use two
path spaces:

- filesystem references use `.pancreator/runtime/...`,
  `.pancreator/library/...`, and `.pancreator/governance/...`
- CLI request/output arguments remain harness-relative, such as
  `runtime/inbox/request.md`, because `./.pancreator/bin/pan` resolves them from
  the installation root

## Refresh, repair, and clean install

A complete installation can be refreshed idempotently:

```sh
./bin/install --target /path/to/target-repository --yes
```

Refresh replaces owned harness payload and reprojects Cursor files while
preserving `.pancreator/runtime`, Cursor backups, and unrelated target files.

If `.pancreator/` exists but is incomplete, an interactive install offers:

- `r` — repair in place
- `c` — remove `.pancreator/` and reinstall
- `a` — abort

Non-interactive equivalents:

```sh
./bin/install --target /path/to/target-repository --repair
./bin/install --target /path/to/target-repository --clean
```

A clean reinstall removes the entire `.pancreator/` directory, including its
runtime state. Cursor files outside `.pancreator/` are merged again rather than
blanket-deleted.

## Harness versioning

`VERSION` is the operator-facing harness version. Pancreator currently starts at
`0.1`; `package.json` uses the equivalent npm version `0.1.0`.

`release/index.json` is the internal mapping from harness version to immutable
Git commit. Because a commit cannot contain its own hash, release publication is
a two-commit protocol:

1. Complete and validate the Pancreator self-development workflow. The
   self-development-only release steward recommends `major`, `minor`, or
   `neither`; it does not edit version metadata or commit.
2. The operator updates `VERSION` when required and creates the **release
   commit** containing the exact installable payload.
3. After that hash exists, the operator adds `version -> release commit` to
   `release/index.json` in a separate **index metadata commit**.

Major means an incompatible installed contract requiring target migration.
Minor means a backward-compatible material capability. `Neither` covers bounded
fixes, documentation, tests, and internal refactors without a material installed
contract change.

Install metadata distinguishes three source states:

- **Indexed release:** a clean checkout whose installable inputs match the
  indexed commit for `VERSION`. The marker records `source_dirty: false` and
  `source_indexed: true`; automatic fast-forward updates are enabled.
- **Unindexed release candidate:** a clean release commit created before the
  later index metadata commit. The marker records `source_dirty: false` and
  `source_indexed: false`; installation and validation are allowed, but automatic
  updates remain disabled until the version is published and reinstalled.
- **Development snapshot:** a dirty Pancreator checkout used for local
  validation. The marker records `source_dirty: true` and
  `source_indexed: false`; automatic updates remain disabled.

Once `VERSION` is indexed, a clean checkout installs only when its installable
inputs match that indexed commit. The only permitted later difference is
non-installable release-index metadata. This prevents an unchanged version from
silently shipping harness drift.

## Fast-forward update

For v0, updates are initiated from a Pancreator source checkout:

```sh
./bin/update --target /path/to/target-repository
```

The updater:

1. reads the target's `.pancreator/install.json`
2. resolves the installed and current versions through `release/index.json`
3. verifies the installed commit matches its indexed version
4. requires the target release commit to be a Git descendant of the installed
   release commit
5. archives that exact release commit and refreshes the embedded harness

Runtime state and unrelated target Cursor files are preserved. Updates refuse
development snapshots, unindexed release candidates, legacy markers, missing
index entries, unavailable commits, marker/index mismatches, and non-fast-forward
histories.

## Validation

Run the deterministic installer smoke harness:

```sh
./bin/install --smoke
```

Run the integration coverage:

```sh
npm run test:integration
```

The tests cover fresh install, existing `.cursor` warning and backups,
idempotent refresh, partial repair/clean/abort choices, omission of
self-development context, the dirty/unindexed/indexed source-state boundaries,
rejection of unversioned indexed harness drift, and an indexed fast-forward
update that preserves target runtime and custom Cursor state.
