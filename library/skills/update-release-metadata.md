# Update release metadata

Use during a Pancreator self-development ship stage and in standalone
`/pan-release` mode. Do not use in embedded target repositories.

## Outcome

Prepare one complete, reviewable release candidate without committing it:

- determine the actual change range since the last committed release bump
- select exactly one Semantic Versioning bump: `major`, `minor`, or `patch`
- author or regenerate the current Common Changelog release entry
- synchronize every current-version metadata and documentation reference
- leave `release/index.json` unchanged until the release commit exists

## Establish the baseline

1. Read `project.json` and stop without mutation unless `installation_mode` is
   `self_development`.
2. Read `VERSION`, `package.json`, `package-lock.json`, `CHANGELOG.md`,
   `release/index.json`, `README.md`, and `docs/embedded-installation.md`.
3. Resolve the committed version with `git show HEAD:VERSION` and identify the
   commit that introduced that value by inspecting `git log -p -- VERSION`.
   Record the full 40-character lowercase commit hash as `baseline_commit`.
4. Inspect the complete delta after that baseline: committed changes through
   `HEAD`, staged and unstaged changes, relevant untracked files, and existing
   `## [Unreleased]` content. Do not rely only on the current workflow artifact
   or only on the unstaged diff.
5. Treat a dirty metadata set whose latest versioned changelog entry already
   equals the working-tree `VERSION` as an in-progress release candidate.
   Regenerate that candidate in place. Never bump again merely because the
   ship stage or `/pan-release` is retried.
6. When standalone `/pan-release` finds no changes after the baseline and no
   in-progress candidate, stop without editing files.

## Choose the bump

Select the highest applicable impact across the complete release delta:

- `major`: a backward-incompatible installed layout, command contract,
  durable-state schema, governance contract, or update path requiring migration
- `minor`: a backward-compatible operator capability, workflow, persona,
  validation behavior, or material installation behavior
- `patch`: backward-compatible fixes, documentation, tests, maintenance, and
  internal refactors shipped as a release

Calculate the exact next stable version from the committed current version:

- major: `<major + 1>.0.0`
- minor: `<major>.<minor + 1>.0`
- patch: `<major>.<minor>.<patch + 1>`

## Author release notes

1. Replace `## [Unreleased]` with `## [<proposed-version>] - <UTC date>` when
   it represents the pending delta. Otherwise insert or regenerate the latest
   versioned entry without duplicating the same version.
2. Summarize the actual release delta rather than copying commit subjects.
3. Use only the groups that apply, in this order: `Changed`, `Added`, `Removed`,
   `Fixed`.
4. Use imperative, operator-facing impact statements.
5. Link each item to the best evidence already available: an existing commit,
   PR, issue, or repository document. Never invent a future release commit hash.
6. Preserve historical release entries unchanged.

## Synchronize version-bearing files

Update all of the following to the proposed version:

- `VERSION`
- `package.json.version`
- `package-lock.json.version`
- `package-lock.json.packages[""].version`
- the current-version heading and introduction in `README.md`
- the current-version statement in `docs/embedded-installation.md`
- any other durable `README*` or `docs/**/*.md` statement that explicitly
  identifies the current Pancreator version

Do not rewrite historical versions, examples, migration references, or
`CHANGELOG.md` history merely because they contain an older number.

## Validate

1. Search `README*` and `docs/**/*.md` for the committed current version and
   update only remaining statements that claim it is the current release.
2. Run `npm run format:check`, `npm run typecheck`, and `npm run validate`.
3. Inspect the final Git diff and confirm that release-preparation edits are
   limited to `CHANGELOG.md`, `VERSION`, `package.json`, `package-lock.json`,
   `README.md`, and version-bearing Markdown under `docs/`.
4. In workflow mode, populate `release.versioning` with:
   `current_version`, `recommendation`, `proposed_version`, `baseline_commit`,
   `rationale`, `compatibility`, `updated_files`, and `release_index_action`.

## Boundaries

Do not edit `release/index.json`. Do not commit, push, open or merge a PR,
publish, deploy, rewrite history, or invent commit hashes. The operator owns the
release commit; its immutable hash can be indexed only afterward.
