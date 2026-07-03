# Embedded Pancreator installation

Pancreator's supported deployment model is **harness inside target**. A
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
# Then run /pan-build-docs to replace the bootstrap target primer and
# /pan-build-briefs to generate target-specific brief semantics and design tokens.
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
    bin/ governance/ library/ src/ tests/
    docs/
      target-repo-primer.md  # target-specific durable repository primer
      operator-briefs/        # generated target ontology and design tokens
      ...                     # Pancreator operator and authoring documentation
    dist/ node_modules/      # built runtime and development tooling
    runtime/
      repository-checks.json # target-authoritative verification profiles
      logs/ inbox/ ...       # target-specific durable workflow state
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
and validators are retained. The source checkout's self-development primer is
replaced by a target-specific bootstrap at `.pancreator/docs/target-repo-primer.md`.
Other source-checkout self-development context is not installed: `.git`, `.env`,
source `runtime/`, nested validation repositories, editor-local settings, and the
self-development operating card are excluded.

## Target repository checks

The embedded harness is language- and technology-agnostic. It does not infer
that the target uses npm, Python, a root package, or any other ecosystem merely
because Pancreator itself is implemented in TypeScript.

`/pan-build-docs` creates or regenerates
`.pancreator/docs/target-repo-primer.md` and writes
`.pancreator/runtime/repository-checks.json`. The librarian inventories target
repository documentation and incorporates useful verified details into the primer,
reconciling stale claims against current scripts, manifests, and code. The check
configuration's `configuration`, `static`,
`fast`, optional `secondary`, and `full` profiles may contain only commands
verified from target-owned documentation, manifests, executable scripts, or
operator instructions. `fast` is the shortest documented default or primary
suite; it must not silently reuse `full` when the repository defines a distinct
fast path. `secondary` represents a separately documented slow, integration,
model-backed, or end-to-end subset. `full` is complete verification and may use
one command or an ordered command list covering every suite. Commands should use
explicit interpreter, virtual-environment, compiler, SDK, or package manager
entrypoints where PATH ambiguity could make stage results incomparable. Optional
probes should print executable identity and version before verification, and
`timeout_ms` should capture a documented runtime bound when one exists.

The dev workflow invokes profiles through:

```sh
./.pancreator/bin/pan repository-check static
./.pancreator/bin/pan repository-check fast
./.pancreator/bin/pan repository-check secondary
./.pancreator/bin/pan repository-check full
```

An empty profile is reported as `not_configured`. Pancreator does not replace it
with a guessed command or treat it as successful evidence. Direct profile runs
stream subprocess output to stderr while reserving stdout for the final result,
so `--json` remains machine-readable without appearing frozen. Refreshes preserve
valid target-specific commands, add newly introduced standard profiles, and
safely disable a legacy `fast` profile that exactly duplicates `full`; the
pre-migration file is backed up under `.pancreator/backups/repository-checks/`.

## Operator brief system

Every install includes Pancreator-owned schemas, generic semantics, and base CSS under `.pancreator/library/`. A fresh target does not inherit Pancreator self-development card types or colors. Run `/pan-build-briefs` after installation to generate `.pancreator/docs/operator-briefs/project.json` and `.pancreator/docs/operator-briefs/project.css` from recurring target use cases. The underlying CLI commands are:

```sh
./.pancreator/bin/pan briefs build
./.pancreator/bin/pan briefs validate
./.pancreator/bin/pan briefs render --input <brief.json> --output <brief.html>
```

Refreshes preserve the target-specific project files. Legacy installations can generate them with the same command; existing Markdown artifacts remain unchanged.

## Workspace mutation model

Pancreator no longer creates persistent workspace locks, active-workflow leases,
or per-edit ledger entries. Source-allowed workers edit within declared scope
directly; the harness relies on accepted workspace indexes, fingerprints,
read-only-stage mutation guards, and stage evidence. Legacy
`pan changes begin|commit|cancel` commands remain compatibility no-ops.
Operators MUST NOT run concurrent mutating workflows against one target
workspace and should pause a run before making other concurrent tracked-file
changes so stage attribution remains clear.

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

- filesystem references use `.pancreator/docs/...`,
  `.pancreator/runtime/...`, `.pancreator/library/...`, and
  `.pancreator/governance/...`
- CLI request/output arguments remain harness-relative, such as
  `runtime/inbox/request.md`, because `./.pancreator/bin/pan` resolves them from
  the installation root

## Refresh, repair, and clean install

A complete installation can be refreshed idempotently:

```sh
./bin/install --target /path/to/target-repository --yes
```

Refresh replaces owned harness payload and reprojects Cursor files while preserving `.pancreator/docs/target-repo-primer.md`, `.pancreator/docs/operator-briefs/` when generated, `.pancreator/runtime/repository-checks.json`, workflow state, Cursor backups, and unrelated target files. The refreshed payload includes current workflow stages, personas, policies, handbooks, validators, and runtime enforcement, so operator-supremacy semantics, flexible waiver directives, internal-change attribution, implementation baselines, same-reason pauses, retry remediation, reviewer remediation, and technology-scoped Python guidance apply to both new and updated installations. Upgrading an older installation migrates `.pancreator/runtime/target-repo-primer.md` into the durable docs location and removes the legacy path; a conflicting legacy copy is backed up under `.pancreator/backups/target-repo-primer/`. Refresh also removes the obsolete `.pancreator/runtime/locks/` directory from pre-removal installations so stale cooperative locks cannot block upgraded runs.

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

`VERSION` is the operator-facing harness version and MUST use complete Semantic Versioning. `VERSION`, `package.json`, and the root package in `package-lock.json` currently agree on `2.11.0`. `CHANGELOG.md` records curated release history in Common Changelog format.

`release/index.json` is the internal mapping from harness version to immutable
Git commit. Because a commit cannot contain its own hash, release publication is
a two-commit protocol:

1. Complete and validate the Pancreator self-development workflow. The
   self-development-only release steward inspects every change since the last
   committed release bump, selects `major`, `minor`, or `patch`, authors the
   release notes, and synchronizes `VERSION`, npm metadata, and current-version
   README/docs references. The same bounded update can be run manually through
   `/pan-release`.
2. The operator reviews those prepared files and creates the **release commit**
   containing the exact installable payload. The release steward does not
   commit, publish, or invent the future commit hash.
3. After that hash exists, the operator adds `version -> release commit` to
   `release/index.json` in a separate **index metadata commit**.

Major means an incompatible installed contract requiring target migration.
Minor means a backward-compatible material capability. Patch means any
backward-compatible release, including defect corrections, documentation,
tests, maintenance, and internal refactors.

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

Updates are initiated from a Pancreator source checkout:

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

The target primer, runtime state, and unrelated target Cursor files are preserved. Updates refuse
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
idempotent refresh with repository-check preservation and legacy-lock cleanup, partial repair/clean/abort choices, omission of
self-development context, the dirty/unindexed/indexed source-state boundaries,
rejection of unversioned indexed harness drift, and an indexed fast-forward
update that preserves target runtime and custom Cursor state.
