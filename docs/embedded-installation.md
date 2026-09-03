# Pancreator installation

Pancreator installs a self-contained harness that governs a target repository.
The target repository always remains the workspace opened in Cursor and the
owner of application code, Git state, and repository-specific instructions.

Two layouts are supported:

| Mode                 | Harness location                 | `workspace_root`            | Use when                                                                            |
| -------------------- | -------------------------------- | --------------------------- | ----------------------------------------------------------------------------------- |
| `embedded` (default) | `<target>/.pancreator`           | `".."`                      | Normal case; harness travels with the checkout                                      |
| `detached`           | Any directory outside the target | Absolute path to the target | The target must not gain a top-level directory, or the harness is managed centrally |

Both project the same pan-namespaced `.cursor/` surface into the target, so the
operator opens the target in Cursor either way. Neither modifies a file the
target repository tracks.

## Requirements

- Node.js 22 or newer
- npm
- Git
- Cursor with project commands and subagents enabled
- Chrome for Testing and a `chrome-devtools` MCP server — required only for targets
  with a web UI, because `BROWSER-001` blocks browser verdicts without them. The
  installer reports whether they are configured; it never installs a browser or
  writes target MCP config. See `./bin/pan doctor`.
- The Claude Code CLI (`claude`), installed and authenticated per machine —
  required only when the active persona mapping routes a persona to the
  `claude-code` executor. A missing or unauthenticated CLI is an
  operator-visible preflight pause, not an error to work around; the harness
  never silently substitutes Cursor. See `./bin/pan doctor`.

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

## Detached installation

Pass `--harness-dir` to place the harness outside the target tree. The directory
MUST NOT be inside the target; the installer rejects a nested path.

```sh
./bin/install --target /path/to/target-repository \
  --harness-dir /opt/pancreator/target-repository
```

The target then receives only the `.cursor/` projection — there is no
`<target>/.pancreator` at all, and runtime state, logs, `dist/`, and
`node_modules/` all live with the harness.

Because no relative path from the target can reach a detached harness, the
installed configuration records the target's **absolute** path:

```json
{
  "workspace_root": "/path/to/target-repository",
  "state_root": "runtime",
  "installation_mode": "detached"
}
```

Projected Cursor artifacts likewise address the harness absolutely, so
`/pan-*` commands work unchanged when the operator opens the target.

The CLI locates its own installation from `bin/pan`, so invoking it by absolute
path always works. To run `pan` from inside the target repository, export the
harness root:

```sh
/opt/pancreator/target-repository/bin/pan doctor
# or, to run from anywhere:
export PANCREATOR_ROOT=/opt/pancreator/target-repository
```

Without `PANCREATOR_ROOT`, root discovery walks up from the working directory
and cannot reach a detached harness. Update a detached installation by passing
the same directory:

```sh
./bin/update --target /path/to/target-repository \
  --harness-dir /opt/pancreator/target-repository
```

## Detached target authority

A detached installation does not copy target governance into the harness.
Target-owned `AGENTS.md`, Cursor rules, and agents remain in the live target
workspace and are authoritative for target application files, behavior, and
conventions. When they conflict with Pancreator defaults, the target policy
wins. Pancreator retains authority for harness runtime/state, stage contracts,
and operator-owned source-control actions.

The installed harness operating card at `<harness>/AGENTS.md` states this
boundary explicitly. Refresh regenerates Pancreator-owned detached guidance
without mutating target-owned files or creating a copied target-policy snapshot.

## Installed layout

```text
<target>/
  .cursor/
    agents/pan-*.md         # Pancreator personas projected for Cursor
    commands/pan-*.md       # /pan-* commands projected for Cursor
    rules/pancreator.mdc    # embedded operating rule
    rules/pan-browser-isolation.mdc    # always-apply rule generated from BROWSER-001
  .pancreator/
    AGENTS.md               # installed-harness operating card
    VERSION
    install.json            # source version/commit and ownership manifest
    config.json             # embedded workspace and model configuration
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

## Target repository ownership

Installation MUST NOT change any file the target repository tracks. The
installer never reads, writes, or deletes the target's `.gitignore`, source,
documentation, or existing agentic-harness configuration.

Pancreator-owned paths are kept out of the target's Git status through a managed
block in `.git/info/exclude`, which is local to the clone and never committed:

```text
# >>> pancreator >>>
/.pancreator/
/.cursor/agents/pan-*.md
/.cursor/commands/pan-*.md
/.cursor/rules/pan-*.mdc
/.cursor/rules/pancreator.mdc
# <<< pancreator <<<
```

The block is rewritten on every refresh, so it never accumulates duplicates. A
detached installation omits the `/.pancreator/` line, because nothing is
installed there. The patterns are deliberately narrow: excluding `.cursor/`
wholesale would hide the target's own agent configuration from its operators.
Installing into a clean Git target therefore leaves `git status` empty.

Historical installations may still contain a tracked `.pancreator/` line in the
target `.gitignore`. The installer never rewrites that tracked file; it reports
the legacy line for optional operator cleanup and uses `.git/info/exclude` going
forward.

## Coexisting with an existing agentic harness

A target repository MAY already run other agentic tooling. Pancreator installs
alongside it and treats applicable target instruction surfaces as live target
authority for target application work. On first install the installer reports
what it found — `AGENTS.md`, `CLAUDE.md`, `.claude/`, `.cursorrules`,
`.github/copilot-instructions.md`, target-authored `.cursor/` files, and other
recognized surfaces — and states that hard conflicts between target policy and
Pancreator defaults fall back to the target.

Collisions are prevented by construction. Every file Pancreator projects into a
target's `.cursor/` is namespaced: `pan-<persona>.md` for agents, `pan-*.md` for
commands, and `pan-*.mdc` or `pancreator.mdc` for rules. Both
`src/lib/projection.ts` and `bin/install-support` enforce this, so a target
keeping its own `.cursor/agents/coder.md` is unaffected. A target file that
occupies a Pancreator-owned name is reported as a takeover and backed up under
`.pancreator/backups/cursor/` before it is replaced.

The target root does **not** receive a Pancreator `config.json`. The installed
configuration lives at `.pancreator/config.json` with:

- `installation_mode: "embedded"`
- `workspace_root: ".."` so the target repository is authoritative
- `state_root: "runtime"` so state resolves to `.pancreator/runtime`

Pancreator infrastructure, tooling, workflows, personas, governance, schemas,
and validators are retained. The source checkout's self-development primer is
replaced by a target-specific bootstrap at `.pancreator/docs/target-repo-primer.md`.
Other source-checkout self-development context is not installed: `.git`, `.env`,
source `runtime/`, nested validation repositories, editor-local settings, and the
self-development operating card are excluded.

## Browser isolation projection

`BROWSER-001` (`.pancreator/governance/policies/BROWSER-001.json`) is the single
source of the browser-inspection contract. Workflow agents receive its rules inline
on their invocation card, with the procedure delivered as an audited guidance
reference; for work that runs outside a card, embedded installs generate
it into `.cursor/rules/pan-browser-isolation.mdc` as an always-apply rule. That file
is generated output — change the policy, not the rule.

Pancreator never overwrites target-owned `.cursor/mcp.json`. The policy requires a
Chrome for Testing bundle, which operators configure locally:

```json
{
  "mcpServers": {
    "chrome-devtools": {
      "command": "npx",
      "args": [
        "chrome-devtools-mcp@latest",
        "--executablePath=/path/to/chrome-for-testing",
        "--isolated"
      ]
    }
  }
}
```

Run `./.pancreator/bin/pan doctor` to see whether the bundle and server are
detected. Without them, stages that owe a browser verdict report
environment-blocked rather than guessing.

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

The delivery workflow invokes profiles through:

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

Refreshes preserve the target-specific project files. Legacy installations can generate them with the same command; existing historical Markdown artifacts remain unchanged. Run `/pan-build-briefs` before starting the first workflow after a fresh install or a legacy update that lacks those files. New worker-stage invocations then require brief JSON plus rendered HTML, and the harness rerenders the HTML during submission.

## Target policy extensions

Targets can add lookup rows under
`.pancreator/governance/registries/policy_lookup.d/*.json`. Each file uses
`schema_version: 1` with a `rows` array. Refresh preserves these target-owned
files. Invalid JSON, duplicate rows, and missing policy identifiers stop policy
resolution before card preparation.

## Target command, skill, and persona authoring

Run `/pan-author` in an embedded or detached installation to create one
target-owned command, skill, or persona. The command writes a complete draft
under `runtime/inbox/target-authoring/`, then passes that draft to:

```sh
./.pancreator/bin/pan author apply --input runtime/inbox/target-authoring/<id>.json
./.pancreator/bin/pan author validate --extension <id>
```

The canonical manifest and Markdown content live under
`.pancreator/target-extensions/<id>/`. One binding-only lookup file lives at
`.pancreator/governance/registries/policy_lookup.d/<id>.json`. A command is
projected to `.cursor/commands/<id>.md`, and a persona is projected to
`.cursor/agents/<id>.md` from its generated
`.pancreator/target-extensions/<id>/agent.md`. A skill remains canonical inside
the harness.
Authored Cursor basenames cannot start with `pan-` or `pancreator.` and never
enter Pancreator's projection manifest or persona configuration.

The manifest records the artifact context, model where applicable, policy ids,
canonical digest, and projected digest. A coding artifact resolves the current
coder policy set at authoring time. A TypeScript target includes `TS-001`
through the normal technology-scoped lookup. Each executable artifact opens
`governance card --mode target --extension <id>` before it reads its canonical
content, so sessions receive resolved policy text and guidance references
without reading policy JSON directly.

Applying identical input is a no-op. A changed draft must carry the current
`expected_manifest_sha256`, which prevents an old draft from replacing a newer
extension. Validation restores a missing or stale lookup file, Cursor
projection, and clone-local exclusion from canonical manifest data. Repeated
apply and validation operations keep one manifest, content file, lookup row,
and projection.

Refresh, repair, and indexed update preserve unmanifested target-extension
files through payload reconciliation. They also preserve binding-only lookup
files and never replace foreign Cursor projections. A clean reinstall removes
the canonical extensions and policy bindings with the harness. It retains
foreign Cursor files, reports their exact paths as inert copies, and directs
the operator to remove or re-author them.

Authoring never changes the target `.gitignore` or another target-tracked file.
For Git targets, exact foreign Cursor projection paths enter a separate managed
block in `.git/info/exclude`. Repeated authoring replaces that block without
changing unrelated clone-local exclusions.

## Target context-bloat dispositions

A policy carrying `target_extension: <name>` is target-authored, and so is every
handbook it reaches through `guidance_sources`. The context audit tracks that
ownership. A duplicate directive spanning a target-owned surface and a
harness-owned one is the documented purpose of a target extension, so the audit
reports it without requiring a disposition. Restating a harness norm in target
vocabulary costs the target nothing.

A duplicate among the target's own surfaces still needs a disposition. Record it
under
`.pancreator/governance/registries/context_bloat_dispositions.d/<extension-id>.json`,
using `schema_version: 1`, an `extension_id` matching the filename, and an
`entries` array shaped like the harness registry. Refresh preserves these
target-owned files, whereas an edit to the harness registry itself is superseded
by the incoming release.

## Workspace mutation model

Pancreator fingerprints relevant Git-visible source state and does not recursively index target files. Compiled artifacts, caches, virtual environments, and third-party dependency/package directories are excluded and permanently outside agent remit. Source-allowed workers edit declared source directly; governance and artifact diagnostics are deferred to release-steward review instead of looping implementation. Operators should pause before concurrent tracked-file changes so attribution remains clear.

Every refresh or version update removes obsolete workspace-tracking state from older installations.

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

Refresh replaces owned harness payload and reprojects Cursor files while preserving `.pancreator/docs/target-repo-primer.md`, `.pancreator/docs/operator-briefs/` when generated, `.pancreator/runtime/repository-checks.json`, workflow state, Cursor backups, and unrelated target files. The refreshed payload includes current workflow stages, personas, policies, handbooks, validators, and runtime enforcement, so operator-supremacy semantics, flexible waiver directives, internal-change attribution, implementation baselines, same-reason pauses, retry remediation, reviewer remediation, and technology-scoped Python guidance apply to both new and updated installations. Before replacing the payload, `--yes` refresh runs the same runtime maintenance as `pan archive`: recognized workflow names are migrated to the UTC minute-bearing convention, persisted references are updated, and directories older than seven days are moved into the corresponding `archive/` child. Upgrading an older installation also migrates `.pancreator/runtime/target-repo-primer.md` into the durable docs location and removes the legacy path; a conflicting legacy copy is backed up under `.pancreator/backups/target-repo-primer/`. Refresh removes the obsolete `.pancreator/runtime/locks/` directory from pre-removal installations so stale cooperative locks cannot block upgraded runs.

### Payload reconciliation

`install.json` records a `payload_files` manifest hashing every release-owned
payload file as shipped (build artifacts excluded). Refreshes and updates
reconcile the installed payload against that manifest before the payload swap:

- A harness-owned file that was modified locally is **superseded**: the
  Pancreator source is authoritative, the local version is backed up under
  `.pancreator/backups/payload/<timestamp>/`, and the file is named in CLI
  output so the operator can re-apply or upstream the fix.
- A file the release never shipped is a **target-specific extension** and is
  carried through the swap unchanged, on this and every later update. It is
  never recorded as release-owned content.
- A harness-owned file that was deleted locally is restored and reported.
- A local change whose bytes already match the incoming release needs no flag:
  the fix was upstreamed.

Installations whose marker predates the manifest are replaced wholesale once,
with a notice, and tracked from then on.

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

`VERSION` is the operator-facing harness version and MUST use complete Semantic Versioning. `VERSION`, `package.json`, and the root package in `package-lock.json` currently agree on `5.12.0`. `CHANGELOG.md` records curated release history in Common Changelog format.

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
