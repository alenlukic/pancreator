# Changelog

## [7.25.2] - 2026-09-24

This release restores concrete persona model defaults in `config.json`.

### Changed

- Fill empty `defaults` persona model mappings with concrete aliases and add `investigator` and `repo-technician` ([dcc73dae](https://github.com/alenlukic/pancreator/commit/dcc73daead23f8a6909272716df443134bdb2fcf)).

## [7.25.1] - 2026-09-23

This release updates the tracked Anthropic advanced model and adds an empty default pipeline config.

### Changed

- Set `anthropic.advanced` to `claude-opus-5-5` with 1m context ([01372a9a](https://github.com/alenlukic/pancreator/commit/01372a9adafabc29a8bc8cd4b6684c3a50e84da3)).

### Added

- Add an empty `configs.default` so a local `active_config` of `default` can resolve ([01372a9a](https://github.com/alenlukic/pancreator/commit/01372a9adafabc29a8bc8cd4b6684c3a50e84da3)).

## [7.25.0] - 2026-09-23

This release makes `pan watch` the exclusive agent timer. Agents record cadence authority, gaps, and completion evidence on every wait.

### Changed

- Require `--cadence-directed-by-operator` for every cadence other than 60 seconds ([1377f3a8](https://github.com/alenlukic/pancreator/commit/1377f3a88b77af0f1512f59f7397cbff53036408)).
- Loop each focused and process watch to a terminal verdict with a four-hour default bound ([1377f3a8](https://github.com/alenlukic/pancreator/commit/1377f3a88b77af0f1512f59f7397cbff53036408)).
- Measure first-background lateness from platform return rather than launch ([1377f3a8](https://github.com/alenlukic/pancreator/commit/1377f3a88b77af0f1512f59f7397cbff53036408)).
- Raise `fast_wall.ceiling_ms` to 240000 for the longer fast suite ([1377f3a8](https://github.com/alenlukic/pancreator/commit/1377f3a88b77af0f1512f59f7397cbff53036408)).
- Strip volatile scratch paths from repository-check diagnostic identities ([1377f3a8](https://github.com/alenlukic/pancreator/commit/1377f3a88b77af0f1512f59f7397cbff53036408)).

### Added

- Add `pan watch --process` and `pan watch --timer` for waits outside a run ([1377f3a8](https://github.com/alenlukic/pancreator/commit/1377f3a88b77af0f1512f59f7397cbff53036408)).
- Add `--until-terminal` for multiplexed waits that return only on an actionable target ([1377f3a8](https://github.com/alenlukic/pancreator/commit/1377f3a88b77af0f1512f59f7397cbff53036408)).
- Add `pan watch audit` for a read-only historical observation report ([1377f3a8](https://github.com/alenlukic/pancreator/commit/1377f3a88b77af0f1512f59f7397cbff53036408)).
- Record signal closure, orphan gaps, coverage advisories, and completion bases on schema-1 ledgers ([1377f3a8](https://github.com/alenlukic/pancreator/commit/1377f3a88b77af0f1512f59f7397cbff53036408)).

### Fixed

- Refuse a timeout below the cadence and `--stall-wakes 1` before observation ([1377f3a8](https://github.com/alenlukic/pancreator/commit/1377f3a88b77af0f1512f59f7397cbff53036408)).
- Refuse a held or interrupted wake as final observation at submit ([1377f3a8](https://github.com/alenlukic/pancreator/commit/1377f3a88b77af0f1512f59f7397cbff53036408)).

## [7.24.0] - 2026-09-23

This release adds a Cursor project hook that injects a compact, role-specific governance reminder on each operator turn.

### Changed

- Point repository-check commands at workspace registries when the workspace is a Pancreator checkout ([2e19adaa](https://github.com/alenlukic/pancreator/commit/2e19adaab41f4a24d2f718714fa189fbe7f2880e)).
- Replace the probe body of `pan governance prompt-context` with the reminder resolver ([552cfa30](https://github.com/alenlukic/pancreator/commit/552cfa30de0d244258f65aeee8adce464a8f43a1)).

### Added

- Project and merge one `beforeSubmitPrompt` hook that fails open ([f95e8957](https://github.com/alenlukic/pancreator/commit/f95e8957d5eaa92b9b92dc6876ced1c52d768b9c)).
- Add `bin/pan-hook-governance-reminder` with direct compiled-CLI dispatch ([f95e8957](https://github.com/alenlukic/pancreator/commit/f95e8957d5eaa92b9b92dc6876ced1c52d768b9c)).
- Record the Cursor Desktop 3.21.16 probe verdict that honors flat `additional_context` ([f95e8957](https://github.com/alenlukic/pancreator/commit/f95e8957d5eaa92b9b92dc6876ced1c52d768b9c)).
- Generate role-specific reminders from canonical policy and card selectors ([552cfa30](https://github.com/alenlukic/pancreator/commit/552cfa30de0d244258f65aeee8adce464a8f43a1)).
- Add the turn-reminder registry, schema, and repository validation check ([552cfa30](https://github.com/alenlukic/pancreator/commit/552cfa30de0d244258f65aeee8adce464a8f43a1)).

### Fixed

- Keep a self-development profile command on workspace files when `PANCREATOR_EXEC_ROOT` points at that workspace ([2e19adaa](https://github.com/alenlukic/pancreator/commit/2e19adaab41f4a24d2f718714fa189fbe7f2880e)).

## [7.22.0] - 2026-09-22

This release adds a 30-day retention policy, a report-first cleanup command, and a quality-pass gate on self-development finalize.

### Changed

- Set the default retention window to 30 days in `config.json` and RUNTIME-001 ([1b857178](https://github.com/alenlukic/pancreator/commit/1b85717889c19de55f3d9e07ad42aaadf1c48456)).
- Resolve tracked conform surfaces against the selected self-development workspace ([1b857178](https://github.com/alenlukic/pancreator/commit/1b85717889c19de55f3d9e07ad42aaadf1c48456)).
- Refuse `pan release finalize` when the conform pass or the style pass is unclean ([1b857178](https://github.com/alenlukic/pancreator/commit/1b85717889c19de55f3d9e07ad42aaadf1c48456)).
- Repair instruction prose and TypeScript style on the release candidate ([ff88a3e0](https://github.com/alenlukic/pancreator/commit/ff88a3e0004366f1bfbc21850cc623bc8e4b8b08)).

### Added

- Add `pan cleanup` and `/pan-cleanup` with a report-first plan and an apply flag ([1b857178](https://github.com/alenlukic/pancreator/commit/1b85717889c19de55f3d9e07ad42aaadf1c48456)).
- Add configurable retention classes in `config.json` and `library/schemas/config.schema.json` ([1b857178](https://github.com/alenlukic/pancreator/commit/1b85717889c19de55f3d9e07ad42aaadf1c48456)).
- Report the Git branch of every worktree the cleanup removes ([1b857178](https://github.com/alenlukic/pancreator/commit/1b85717889c19de55f3d9e07ad42aaadf1c48456)).

### Fixed

- Read a missing `config.json` as the built-in 30-day window during install ([1b857178](https://github.com/alenlukic/pancreator/commit/1b85717889c19de55f3d9e07ad42aaadf1c48456)).

## [7.21.3] - 2026-09-20

This release rebuilds the target repository primer against the 7.21.2 source head.

### Changed

- Rebuild `docs/target-repo-primer.md` against source head `3a087b8c` after twelve minor versions of drift ([fe2d650f](https://github.com/alenlukic/pancreator/commit/fe2d650fae567ab64248f7b62f4ba425fafe541d)).

### Added

- Cover `pan debloat`, `pan horizon`, `pan schedule`, `pan worker`, and `pan attribute` in the primer ([fe2d650f](https://github.com/alenlukic/pancreator/commit/fe2d650fae567ab64248f7b62f4ba425fafe541d)).
- Cover the OpenAI executor, `bin/check-landing` with `.githooks/`, `bin/benchmark`, and the 7.19.0 removals ([fe2d650f](https://github.com/alenlukic/pancreator/commit/fe2d650fae567ab64248f7b62f4ba425fafe541d)).

## [7.21.2] - 2026-09-20

This release orders the governance card ahead of the orientation list. An unbound agent takes its card before the first substantive response.

### Changed

- Order the governance-card requirement ahead of the orientation list on `AGENTS.md` and both Cursor rule surfaces ([885155a3](https://github.com/alenlukic/pancreator/commit/885155a340d59ea04d22cb95552596dfcea547cd)).
- Bind `COMMS-001` on the first chat report, before any card is resolved ([885155a3](https://github.com/alenlukic/pancreator/commit/885155a340d59ea04d22cb95552596dfcea547cd)).
- Move the unbound trigger to the first substantive response ([885155a3](https://github.com/alenlukic/pancreator/commit/885155a340d59ea04d22cb95552596dfcea547cd)).

### Added

- Add four regression tests for card order, the denial clause, the `COMMS-001` chat rule, and live resolution through `STANDALONE_MODES.unbound` ([885155a3](https://github.com/alenlukic/pancreator/commit/885155a340d59ea04d22cb95552596dfcea547cd)).

## [7.21.1] - 2026-09-20

This release corrects two `pan debloat` scan defects. The orphan pass now sees live CLI entrypoints. The exclusive-reference cascade keeps facilities that the same scan already marked as used.

### Changed

- Mark the orphan category as medium confidence, because a path assembled at run time can hide a consumer ([01697814](https://github.com/alenlukic/pancreator/commit/016978146d581bd7a8ae7b14848ae9c584882e6d)).
- Keep a facility with execution or direction evidence, and record it under `retained_because` ([2493e1a4](https://github.com/alenlukic/pancreator/commit/2493e1a413d40fee3f6dbe18047decdb8ec4b439)).

### Added

- Record a `bin/` script and a `package.json` script that runs a built `dist/**/*.js` path as live consumers ([01697814](https://github.com/alenlukic/pancreator/commit/016978146d581bd7a8ae7b14848ae9c584882e6d)).
- Record a source string that names a spawned built file as a live consumer ([01697814](https://github.com/alenlukic/pancreator/commit/016978146d581bd7a8ae7b14848ae9c584882e6d)).
- Follow a barrel chain to a real consumer so a module behind a consumed barrel stays live ([01697814](https://github.com/alenlukic/pancreator/commit/016978146d581bd7a8ae7b14848ae9c584882e6d)).
- Recognize a subcommand invoked as `npm run <name>` or through a built `cli.js <name>` path ([2493e1a4](https://github.com/alenlukic/pancreator/commit/2493e1a413d40fee3f6dbe18047decdb8ec4b439)).

### Fixed

- Keep a live CLI entrypoint out of the unused-file report ([01697814](https://github.com/alenlukic/pancreator/commit/016978146d581bd7a8ae7b14848ae9c584882e6d)).
- Keep a used facility out of the exclusive-reference cascade ([2493e1a4](https://github.com/alenlukic/pancreator/commit/2493e1a413d40fee3f6dbe18047decdb8ec4b439)).

## [7.21.0] - 2026-09-20

This release counts only functional usage when `pan debloat` scans chat, inbox, and prose. An incidental mention no longer keeps a facility.

### Changed

- Count a chat, inbox, or prose mention as usage only when the line is a functional direction ([89049eaa](https://github.com/alenlukic/pancreator/commit/89049eaaf187f76e37c019acabe356331f55665d)).
- Classify each prose edge by line, and follow only functional edges for reachability ([89049eaa](https://github.com/alenlukic/pancreator/commit/89049eaaf187f76e37c019acabe356331f55665d)).
- Count an agent `Read` of a facility file as a direction unless the agent later edits it ([89049eaa](https://github.com/alenlukic/pancreator/commit/89049eaaf187f76e37c019acabe356331f55665d)).
- Mark an operator line that repeats an assistant line as incidental ([89049eaa](https://github.com/alenlukic/pancreator/commit/89049eaaf187f76e37c019acabe356331f55665d)).
- Exclude every transcript of a `/pan-debloat` session from the usage window ([89049eaa](https://github.com/alenlukic/pancreator/commit/89049eaaf187f76e37c019acabe356331f55665d)).
- Keep a non-functional facility edge as an edit that does not block a cascade ([89049eaa](https://github.com/alenlukic/pancreator/commit/89049eaaf187f76e37c019acabe356331f55665d)).
- Make a functional direction in `AGENTS.md` an anchor for reachability ([89049eaa](https://github.com/alenlukic/pancreator/commit/89049eaaf187f76e37c019acabe356331f55665d)).

### Added

- Train a logistic-regression intent classifier at scan time from `library/debloat/intent-corpus.jsonl` ([89049eaa](https://github.com/alenlukic/pancreator/commit/89049eaaf187f76e37c019acabe356331f55665d), [`library/debloat/intent-corpus.jsonl`](library/debloat/intent-corpus.jsonl)).
- Record execution evidence from `Task` launches, `pan` shell invocations, `--mode` and `--workflow` options, and operator slash lines ([89049eaa](https://github.com/alenlukic/pancreator/commit/89049eaaf187f76e37c019acabe356331f55665d)).
- Add source counts for excluded debloat sessions, agent invocations, agent lookups, and incidental mentions ([89049eaa](https://github.com/alenlukic/pancreator/commit/89049eaaf187f76e37c019acabe356331f55665d)).
- Add per-facility `direction_count` and `incidental_mention_count` ([89049eaa](https://github.com/alenlukic/pancreator/commit/89049eaaf187f76e37c019acabe356331f55665d)).
- Document the functional usage rule in DEBLOAT-001, `/pan-debloat`, and the operator guide ([89049eaa](https://github.com/alenlukic/pancreator/commit/89049eaaf187f76e37c019acabe356331f55665d), [`docs/operator-guide.md`](docs/operator-guide.md)).

### Removed

- Remove the `mention` usage tier so an incidental mention never retains a facility ([89049eaa](https://github.com/alenlukic/pancreator/commit/89049eaaf187f76e37c019acabe356331f55665d)).

## [7.20.0] - 2026-09-20

This release rebuilds `pan debloat` over a functional dependency graph. The scanner now reports stranded files, reads the usage window in full, and checks orphans on their own.

### Changed

- Decide eligibility from a dependency graph over functional artifacts rather than a narrow text scan ([7ecea924](https://github.com/alenlukic/pancreator/commit/7ecea924b097b69868b5389c37964951c9d20a67)).
- Classify each marked dispatch reference on its own, and keep a live import as a retaining edge ([7ecea924](https://github.com/alenlukic/pancreator/commit/7ecea924b097b69868b5389c37964951c9d20a67)).
- Accumulate `pan debloat select` ids across calls, and add an explicit replace reset ([7ecea924](https://github.com/alenlukic/pancreator/commit/7ecea924b097b69868b5389c37964951c9d20a67)).
- Delete a projected Cursor file whose canonical source is gone, and report that orphan as drift until it is pruned ([7ecea924](https://github.com/alenlukic/pancreator/commit/7ecea924b097b69868b5389c37964951c9d20a67)).
- Read inventory from the scanned tree so a worktree scan does not inherit the running build ([7ecea924](https://github.com/alenlukic/pancreator/commit/7ecea924b097b69868b5389c37964951c9d20a67)).

### Added

- Add a `freed` section that names each stranded path or symbol and the referrer that stranded it ([7ecea924](https://github.com/alenlukic/pancreator/commit/7ecea924b097b69868b5389c37964951c9d20a67)).
- Read every evidence file in the usage window, count each source, and leave no silent skip ([7ecea924](https://github.com/alenlukic/pancreator/commit/7ecea924b097b69868b5389c37964951c9d20a67)).
- Add an independent orphan check for unused exports, types, files, and import-chain-only symbols ([7ecea924](https://github.com/alenlukic/pancreator/commit/7ecea924b097b69868b5389c37964951c9d20a67)).
- Fail `pan debloat verify` while a freed entry still survives ([7ecea924](https://github.com/alenlukic/pancreator/commit/7ecea924b097b69868b5389c37964951c9d20a67)).

## [7.19.1] - 2026-09-20

This release applies the 2026-09-20 tune-harness verdicts to the self-development test suite.

### Changed

- Move selected integration and regression contracts into the unit lane when a cheaper direct form exists ([f5f8e678](https://github.com/alenlukic/pancreator/commit/f5f8e6784fe038b909b4dc9f478b559076460d3f), [e88b5b74](https://github.com/alenlukic/pancreator/commit/e88b5b74378992ecdfbd28f324950ed2d1f44be7)).
- Fold duplicate assertions into their named survivors and delete the source tests ([f5f8e678](https://github.com/alenlukic/pancreator/commit/f5f8e6784fe038b909b4dc9f478b559076460d3f)).
- Correct the primer statement that names the impacted cohort for `docs/target-repo-primer.md` ([f5f8e678](https://github.com/alenlukic/pancreator/commit/f5f8e6784fe038b909b4dc9f478b559076460d3f)).

### Added

- Add unit files for away-mode parse, installation-schema agreement, invocation liveness, repository-check baseline and authority, requirement target kind, and the secret-path corpus ([f5f8e678](https://github.com/alenlukic/pancreator/commit/f5f8e6784fe038b909b4dc9f478b559076460d3f), [e88b5b74](https://github.com/alenlukic/pancreator/commit/e88b5b74378992ecdfbd28f324950ed2d1f44be7)).

### Removed

- Remove the four DELETE verdicts and the merged source tests from the integration and regression lanes ([f5f8e678](https://github.com/alenlukic/pancreator/commit/f5f8e6784fe038b909b4dc9f478b559076460d3f)).

## [7.19.0] - 2026-09-20

This release removes 15 unused harness facilities. The operator no longer sees `/pan-debug`, the investigation mode, or the preflight workflow.

### Changed

- Repair references in config, policy indexes, governance cards, command grammar, WORK-001, SPOT-001, and operator docs after the removal ([12f2f996](https://github.com/alenlukic/pancreator/commit/12f2f996c5bd4163dc59a68c62a2544556abe152)).
- Keep `src/lib/hypervisor.ts`, the `pan hypervisor` CLI, and the `hypervisor` persona key so away mode can read health state ([12f2f996](https://github.com/alenlukic/pancreator/commit/12f2f996c5bd4163dc59a68c62a2544556abe152)).

### Removed

- Remove `/pan-debug` and the `investigation` standalone mode ([12f2f996](https://github.com/alenlukic/pancreator/commit/12f2f996c5bd4163dc59a68c62a2544556abe152)).
- Remove the `hypervisor`, `investigator`, and `repo-technician` personas ([12f2f996](https://github.com/alenlukic/pancreator/commit/12f2f996c5bd4163dc59a68c62a2544556abe152)).
- Remove policy DIAG-001 and policy HYPERVISOR-001 ([12f2f996](https://github.com/alenlukic/pancreator/commit/12f2f996c5bd4163dc59a68c62a2544556abe152)).
- Remove skills `hypervisor`, `manual-qa-cases`, `map-acceptance-criteria`, `modern-code-review`, and `scope-control` ([12f2f996](https://github.com/alenlukic/pancreator/commit/12f2f996c5bd4163dc59a68c62a2544556abe152)).
- Remove the `preflight` workflow and the example templates `stage-artifact.example.md` and `supervisor-assessment.example.json` ([12f2f996](https://github.com/alenlukic/pancreator/commit/12f2f996c5bd4163dc59a68c62a2544556abe152)).

## [7.18.0] - 2026-09-20

This release corrects the `/pan-debloat` reference graph. The scanner now treats a registration as a registry, not a use.

### Changed

- Classify the handler dispatch table in `src/lib/requirements/handlers.ts` as a registry ([c60b913e](https://github.com/alenlukic/pancreator/commit/c60b913e7e8a78ed5c343416d5d5d7b2eaf44179)).
- Recover validator liveness from the resolve chain of policy requirement, registry entry, handler id, and module binding ([c60b913e](https://github.com/alenlukic/pancreator/commit/c60b913e7e8a78ed5c343416d5d5d7b2eaf44179)).
- Strip comments from TypeScript before the literal scan ([c60b913e](https://github.com/alenlukic/pancreator/commit/c60b913e7e8a78ed5c343416d5d5d7b2eaf44179)).
- Narrow the `code` referrer class to `src/` and `bin/` ([c60b913e](https://github.com/alenlukic/pancreator/commit/c60b913e7e8a78ed5c343416d5d5d7b2eaf44179)).

### Added

- Record `test_only_references` when every structural reference to a facility is its own tests ([c60b913e](https://github.com/alenlukic/pancreator/commit/c60b913e7e8a78ed5c343416d5d5d7b2eaf44179)).
- Show that state as a candidate column and as a report section for facilities held off the list ([c60b913e](https://github.com/alenlukic/pancreator/commit/c60b913e7e8a78ed5c343416d5d5d7b2eaf44179)).

### Fixed

- Allow unused validators to become removal candidates. A registration in the dispatch table is no longer a use ([c60b913e](https://github.com/alenlukic/pancreator/commit/c60b913e7e8a78ed5c343416d5d5d7b2eaf44179)).
- Do not treat a comment that names a facility as a live edge ([c60b913e](https://github.com/alenlukic/pancreator/commit/c60b913e7e8a78ed5c343416d5d5d7b2eaf44179)).

## [7.17.0] - 2026-09-20

This release extends policy COMMS-001. Chat reports now obey a 250-word prose cap and a terminal-state report contract. Embedded installs also receive the always-apply rule `pan-chat-output.mdc`.

### Changed

- Extend policy COMMS-001 with a 250-word prose cap, a terminal-state report contract, direct-statement rules, and a banned-phrase list ([a0c6f49a](https://github.com/alenlukic/pancreator/commit/a0c6f49af4380f3cf5b4d53890aeda399eeedad3)).
- Treat an inline code span as quoted text in the STE validator ([a0c6f49a](https://github.com/alenlukic/pancreator/commit/a0c6f49af4380f3cf5b4d53890aeda399eeedad3)).
- Shape the orchestrator decision packet under policy COMMS-001 ([a0c6f49a](https://github.com/alenlukic/pancreator/commit/a0c6f49af4380f3cf5b4d53890aeda399eeedad3)).

### Added

- Project `.cursor/rules/pan-chat-output.mdc` from policy COMMS-001 as an always-apply rule in every embedded install ([a0c6f49a](https://github.com/alenlukic/pancreator/commit/a0c6f49af4380f3cf5b4d53890aeda399eeedad3), [docs/embedded-installation.md](docs/embedded-installation.md)).

## [7.16.0] - 2026-09-20

This release adds `/pan-debloat`. An operator can scan unused harness facilities and remove a selected set as a release.

### Added

- Add `/pan-debloat` so an operator can scan unused facilities, select a subset, and land the exclusive closure as a minor release ([e3ec36db](https://github.com/alenlukic/pancreator/commit/e3ec36dba6070922f77424f3d43aafde31fd6403)).
- Add `pan debloat scan|select|impact|verify` so the command can inventory facilities, record the operator choice, compute the exclusive-reference closure, and prove the workspace ([e3ec36db](https://github.com/alenlukic/pancreator/commit/e3ec36dba6070922f77424f3d43aafde31fd6403)).
- Add policy DEBLOAT-001, the `debloat` standalone mode, the `debloater` persona, and skill `debloat-closure` so removal stays inside the recorded selection ([e3ec36db](https://github.com/alenlukic/pancreator/commit/e3ec36dba6070922f77424f3d43aafde31fd6403)).

## [7.15.0] - 2026-09-20

This release consolidates the five harness-repair releases 7.10.0 through 7.14.0 into one installable tree and adds the supervisor's harness-path delegation.

### Changed

- `pan delegate --headless` dispatches a cursor-executor stage through the harness cursor-agent path with the persona's mapped model, and `--evidence-only [--role]` runs one evidence worker, so a supervisor whose platform exposes no projected agent still launches every stage at the mapped model ([4f0f7a2b](https://github.com/alenlukic/pancreator/commit/4f0f7a2b1a7d150a2319f77d5df97c106e0aa1b4)).
- The long-horizon retry rung follows a stage's declared failure transition (verify to remediate) instead of re-running the failed stage against an unchanged workspace ([cbac1a60](https://github.com/alenlukic/pancreator/commit/cbac1a60ba63dba4c07e6080748a6bba909453c2)).
- A spawned worker no longer inherits `PANCREATOR_EXEC_ROOT` or the `PANCREATOR_ROOT` that `bin/pan` pins beside it, and `bin/pan` unsets the request before it execs the selected build ([b54a61d0](https://github.com/alenlukic/pancreator/commit/b54a61d001ab3cbe86035df052920abe5ffe8146)).

### Fixed

- The regression guard for the versioned-landing rule accepts the scoped commit prohibition in `AGENTS.md` ([f335bb90](https://github.com/alenlukic/pancreator/commit/f335bb90dd7fe3f9f2bcc1e56fc97700efc7b052)).
- The multiplexed watch measures its stall window as a duration, as the focused watch does, so the 7.10.0 liveness rule and the 7.13.0 multiplexed watch agree ([fb517a2b](https://github.com/alenlukic/pancreator/commit/fb517a2bbd6aebbb9f45864036574521314cdcf6)).

## [7.14.0] - 2026-09-20

This release closes six compliance findings. A validator now blocks only on a field the worker contract declares. An evidence worker cannot satisfy the ship full-profile gate.

### Changed

- Refuse `pan repository-check full` from a verify-stage evidence worker. Name VERIFY-001 and the ship gate that owns the profile ([9c406af3](https://github.com/alenlukic/pancreator/commit/9c406af37a0fd510aad89c807d974de8eff3759b)).
- Reject a cached full-profile pass when the recorder was not permitted to run that profile. The ship gate then executes ([9c406af3](https://github.com/alenlukic/pancreator/commit/9c406af37a0fd510aad89c807d974de8eff3759b)).
- Return a submission advisory when an output claims a profile pass that the ledger does not hold at the current fingerprint ([9c406af3](https://github.com/alenlukic/pancreator/commit/9c406af37a0fd510aad89c807d974de8eff3759b)).
- Record `OUTPUT_SCAFFOLD_MISSING_BEFORE_WORKSPACE_CHANGE` when a wake sees a changed workspace with no output file. Do not count that wake as unchanged ([9c406af3](https://github.com/alenlukic/pancreator/commit/9c406af37a0fd510aad89c807d974de8eff3759b)).
- State the output-last rule in CONTRACT-001 and in `library/skills/write-stage-output.md` ([9c406af3](https://github.com/alenlukic/pancreator/commit/9c406af37a0fd510aad89c807d974de8eff3759b)).
- State that worker model evidence is best-effort in DELEGATE-001. Keep a probed-versus-snapshot mismatch as a hard failure ([9c406af3](https://github.com/alenlukic/pancreator/commit/9c406af37a0fd510aad89c807d974de8eff3759b)).
- Direct a supervisor to resume a worker that wrote a refused output. Do not edit the worker output ([9c406af3](https://github.com/alenlukic/pancreator/commit/9c406af37a0fd510aad89c807d974de8eff3759b)).
- Name `./bin/pan repository-check <profile> --run <run-id>` in the remediate prompt ([9c406af3](https://github.com/alenlukic/pancreator/commit/9c406af37a0fd510aad89c807d974de8eff3759b)).
- Accept a plan `maps_to` id in the `C-*` or `OOS-*` family when the same output defines it ([9c406af3](https://github.com/alenlukic/pancreator/commit/9c406af37a0fd510aad89c807d974de8eff3759b)).
- Fail `pan validate` when a stage validator blocks on a field that `enforced_fields` does not declare ([9c406af3](https://github.com/alenlukic/pancreator/commit/9c406af37a0fd510aad89c807d974de8eff3759b)).

### Added

- Add `src/lib/validators/refusals.ts` as the canonical refusal declaration for every live stage-output validator, and the prototype intake handler ([9c406af3](https://github.com/alenlukic/pancreator/commit/9c406af37a0fd510aad89c807d974de8eff3759b)).
- Declare verify finding `id` and `evidence[]` in the shared field contract. Emit a scaffold exemplar that shows that shape ([9c406af3](https://github.com/alenlukic/pancreator/commit/9c406af37a0fd510aad89c807d974de8eff3759b)).

### Fixed

- Close the prototype intake exemption so AC-010 covers that handler ([9c406af3](https://github.com/alenlukic/pancreator/commit/9c406af37a0fd510aad89c807d974de8eff3759b)).

## [7.13.0] - 2026-09-19

This release makes the suite-cost gate advisory. It also adds a multiplexed cohort wait, a bounded runtime rewrite, and progress output on long commands.

### Changed

- Make `ship.fast_wall_ceiling` advisory. A breach records a run advisory and a performance intake, and it does not route the run ([3bcc43b8](https://github.com/alenlukic/pancreator/commit/3bcc43b8efbda2b75247fb44c5775e0d4692f258)).
- Restore `fast_wall.ceiling_ms` to 120000. Keep that value until a tuning pass revisits it ([3bcc43b8](https://github.com/alenlukic/pancreator/commit/3bcc43b8efbda2b75247fb44c5775e0d4692f258)).
- Exclude a fast-wall sample above the host-load threshold or from a non-gate caller, and count it in `unqualified_runs` ([3bcc43b8](https://github.com/alenlukic/pancreator/commit/3bcc43b8efbda2b75247fb44c5775e0d4692f258)).
- Report `insufficient_samples` when the qualified window holds fewer than five samples ([3bcc43b8](https://github.com/alenlukic/pancreator/commit/3bcc43b8efbda2b75247fb44c5775e0d4692f258)).
- Read only the runtime directories that can hold a durable name reference. Exclude `runtime/tmp/` and unknown siblings ([3bcc43b8](https://github.com/alenlukic/pancreator/commit/3bcc43b8efbda2b75247fb44c5775e0d4692f258)).
- Print each `pan archive` maintenance pass on stderr. Print the entry-gate id and timeout before a gated `pan prepare` ([3bcc43b8](https://github.com/alenlukic/pancreator/commit/3bcc43b8efbda2b75247fb44c5775e0d4692f258)).

### Added

- Add `pan watch --cohort` and a multi-target wait that returns on the first change ([3bcc43b8](https://github.com/alenlukic/pancreator/commit/3bcc43b8efbda2b75247fb44c5775e0d4692f258)).
- Add `fast_wall.max_load_average_per_cpu` and `fast_wall.minimum_qualified_samples` beside the existing ceiling ([3bcc43b8](https://github.com/alenlukic/pancreator/commit/3bcc43b8efbda2b75247fb44c5775e0d4692f258)).
- Record host load and caller class on each new fast-wall series entry ([3bcc43b8](https://github.com/alenlukic/pancreator/commit/3bcc43b8efbda2b75247fb44c5775e0d4692f258)).

### Fixed

- Wake a cohort supervisor on the first finished sibling, not on a single blocked wait ([3bcc43b8](https://github.com/alenlukic/pancreator/commit/3bcc43b8efbda2b75247fb44c5775e0d4692f258)).
- Stop a default scan of scratch space during a runtime-name rewrite ([3bcc43b8](https://github.com/alenlukic/pancreator/commit/3bcc43b8efbda2b75247fb44c5775e0d4692f258)).

## [7.12.0] - 2026-09-19

This release repairs nine mechanical-friction defects. Worktree-bound stages keep file tools. Prepare, watch, waiver, and plan-approval recovery name the next command.

### Changed

- Default `pan prepare` to the projected agent of the stage persona so a bare prepare writes the labeled delegation artifact ([ff190097](https://github.com/alenlukic/pancreator/commit/ff190097c24b5cc8a95e73b8e4da520a17ce8657)).
- End a background watch that exhausts its wake budget with a distinct exit and the re-arm command ([ff190097](https://github.com/alenlukic/pancreator/commit/ff190097c24b5cc8a95e73b8e4da520a17ce8657)).
- Name the verification root in an evidence brief for a managed self-development worktree ([ff190097](https://github.com/alenlukic/pancreator/commit/ff190097c24b5cc8a95e73b8e4da520a17ce8657)).
- Name the status found and the command that applies on a refusal ([ff190097](https://github.com/alenlukic/pancreator/commit/ff190097c24b5cc8a95e73b8e4da520a17ce8657)).
- State `/pan-start` dispositions for prose, an existing queue file, and an augment note ([ff190097](https://github.com/alenlukic/pancreator/commit/ff190097c24b5cc8a95e73b8e4da520a17ce8657)).
- Narrow `.cursorignore` to instruction files so worktree source stays readable ([ff190097](https://github.com/alenlukic/pancreator/commit/ff190097c24b5cc8a95e73b8e4da520a17ce8657)).
- Return a criterion waiver to the blocked point and keep finished stage output ([ff190097](https://github.com/alenlukic/pancreator/commit/ff190097c24b5cc8a95e73b8e4da520a17ce8657)).
- Refresh the disposable Cursor projection on worktree create and branch restore ([ff190097](https://github.com/alenlukic/pancreator/commit/ff190097c24b5cc8a95e73b8e4da520a17ce8657)).
- Inherit the planning worktree on a single-chunk route, and refuse to branch away from uncommitted work ([ff190097](https://github.com/alenlukic/pancreator/commit/ff190097c24b5cc8a95e73b8e4da520a17ce8657)).

## [7.11.0] - 2026-09-19

This release repairs eight internal-consistency defects. A late worker-record call no longer rewrites a launched contract. Primer freshness, verify return visits, ship scope, and release allocation now match the stated rules.

### Changed

- Derive the primer version from `VERSION` at the stamped `source-head`. `pan doctor` and `pan validate` report primer drift ([183437cc](https://github.com/alenlukic/pancreator/commit/183437cc25403c0a5a7d0968cb3f7d1e388003cd)).
- Permit the read-only `configuration` profile on a verify return visit. Refresh stale interior evidence at prepare, and remove the `fast` offer from the return-visit brief ([183437cc](https://github.com/alenlukic/pancreator/commit/183437cc25403c0a5a7d0968cb3f7d1e388003cd)).
- Compare ship scope by content when the recorded base is not an ancestor of HEAD. Compare the harness root against its current HEAD rather than the prepare-time commit ([183437cc](https://github.com/alenlukic/pancreator/commit/183437cc25403c0a5a7d0968cb3f7d1e388003cd)).
- Name the release version sequence, `pan-dev`, and `release/index.json` as shared resources on the operating card ([183437cc](https://github.com/alenlukic/pancreator/commit/183437cc25403c0a5a7d0968cb3f7d1e388003cd)).
- Refuse a proposed version that already exists on `pan-dev` or the local default branch. Refuse release finalization without a recorded allocation ([183437cc](https://github.com/alenlukic/pancreator/commit/183437cc25403c0a5a7d0968cb3f7d1e388003cd)).
- State the launch record as the watch clock. Keep that clock on a `--mark-background` re-arm ([183437cc](https://github.com/alenlukic/pancreator/commit/183437cc25403c0a5a7d0968cb3f7d1e388003cd)).
- Cite the configured `fast_wall` ceiling and `ship.fast_wall_ceiling` in review guidance ([183437cc](https://github.com/alenlukic/pancreator/commit/183437cc25403c0a5a7d0968cb3f7d1e388003cd)).
- Render a harness prefetch from the ledger `invoked_by` field, and name the recording role for an agent pass ([183437cc](https://github.com/alenlukic/pancreator/commit/183437cc25403c0a5a7d0968cb3f7d1e388003cd)).

### Added

- `pan prepare --agent` for an evidence role, so the attempt is allocated before launch ([183437cc](https://github.com/alenlukic/pancreator/commit/183437cc25403c0a5a7d0968cb3f7d1e388003cd)).
- A `configuration` gate on the `delivery-chunk` remediate stage ([183437cc](https://github.com/alenlukic/pancreator/commit/183437cc25403c0a5a7d0968cb3f7d1e388003cd)).

### Fixed

- A late `pan worker record` no longer allocates a phantom attempt or rewrites the contract a launched worker holds ([183437cc](https://github.com/alenlukic/pancreator/commit/183437cc25403c0a5a7d0968cb3f7d1e388003cd)).

## [7.10.0] - 2026-09-19

This release bounds executor write grants, records prompt-task tool policy, and measures worker liveness as a duration.

### Changed

- Measure the watch stall window as five minutes so a cadence change does not alter the liveness rule ([d2334640](https://github.com/alenlukic/pancreator/commit/d2334640a86ae15efe2ff838c9ef289a3c9b03ef)).
- Stop the away evaluator when a stage output carries an unanswered operator question ([d2334640](https://github.com/alenlukic/pancreator/commit/d2334640a86ae15efe2ff838c9ef289a3c9b03ef)).
- Withhold the shell tool from a stage whose write roots exclude the workspace, on OpenAI and Claude Code ([d2334640](https://github.com/alenlukic/pancreator/commit/d2334640a86ae15efe2ff838c9ef289a3c9b03ef)).
- Grant a prompt task the workspace plus the run runtime directory, and record `granted_roots` and `tool_policy` ([d2334640](https://github.com/alenlukic/pancreator/commit/d2334640a86ae15efe2ff838c9ef289a3c9b03ef)).
- Deny prompt-task writes outside those roots with `sandbox-exec` on macOS. Observe the whole root when the host cannot enforce that bound ([d2334640](https://github.com/alenlukic/pancreator/commit/d2334640a86ae15efe2ff838c9ef289a3c9b03ef)).
- Record a platform-initiated detach as its own redline category. Measure watch lateness from the launch record ([d2334640](https://github.com/alenlukic/pancreator/commit/d2334640a86ae15efe2ff838c9ef289a3c9b03ef)).

### Added

- Add a structured `operator_question` field on the stage output contract ([d2334640](https://github.com/alenlukic/pancreator/commit/d2334640a86ae15efe2ff838c9ef289a3c9b03ef)).
- Add write-sandbox profile generation for prompt-task launches ([d2334640](https://github.com/alenlukic/pancreator/commit/d2334640a86ae15efe2ff838c9ef289a3c9b03ef)).

### Fixed

- Mark a rollback plan incomplete when a generated pan command is not in the CLI grammar ([d2334640](https://github.com/alenlukic/pancreator/commit/d2334640a86ae15efe2ff838c9ef289a3c9b03ef)).

## [7.9.0] - 2026-09-19

This release makes the operator's chat session the supervisor of a long-horizon session end to end, adds a session arbiter so no harness verdict can end a task, closes the four hard blocks that may stop long-horizon work, and refuses any landing on `pan-dev` that carries no release.

### Changed

- Supervise a long-horizon session from the chat: `horizon start` arms the session and returns, `horizon status --json` lists every live run with its bootstrap commands, and `horizon reconcile` applies the mechanical part of each wake. A task finishes when its route finishes, so the delivery run or cohort a plan approval starts is supervised rather than orphaned ([6a9425d7](https://github.com/alenlukic/pancreator/commit/6a9425d7eb11d303cd4aaaf9328b97170e3ac0ad)).
- Route every long-horizon stop through the session arbiter before any deferral: a rejected ranking, a spent budget, an apply error, an unparseable evaluator reply, or an exhausted ladder is evidence the arbiter reasons about, and a task defers only when it names one of the four hard blocks ([3ce507b0](https://github.com/alenlukic/pancreator/commit/3ce507b02b9970ca5800e7ac1dd93deda1553acd)).
- Close the long-horizon hard-block list to four (LH-H1 to LH-H4): a cost- or wall-time-backed criterion, a self-caused condition, a transient failure, and any ordinary judgment call are decided and recorded, never deferred. The profile allows `waive-gate` and sizes the decision budget at 12 per run; a failed away apply falls through to the next ranked option ([41c2c5b8](https://github.com/alenlukic/pancreator/commit/41c2c5b8a6a5e9c41758e05f2a8767b6d923b16f)).
- State the 60-second observation rule as one statement with no exceptions, refuse to end a turn while an observed process is unfinished, and project `DELEGATE-001` as an always-on Cursor rule ([41c2c5b8](https://github.com/alenlukic/pancreator/commit/41c2c5b8a6a5e9c41758e05f2a8767b6d923b16f)).
- Require a named authority on `horizon defer`: `--hard-block <LH-H1..LH-H4>` or `--operator-directive` ([6a9425d7](https://github.com/alenlukic/pancreator/commit/6a9425d7eb11d303cd4aaaf9328b97170e3ac0ad)).

### Added

- `horizon reconcile`, `horizon reinstate`, and `horizon start --headless` for the scheduled-job substrate ([6a9425d7](https://github.com/alenlukic/pancreator/commit/6a9425d7eb11d303cd4aaaf9328b97170e3ac0ad), [3ce507b0](https://github.com/alenlukic/pancreator/commit/3ce507b02b9970ca5800e7ac1dd93deda1553acd)).
- `bin/check-landing` with `pre-commit` and `pre-merge-commit` hooks under `.githooks/`, wired by `npm run prepare`: a direct installable commit on `pan-dev` or `main`, and a merge whose source carries no new indexed release, are refused ([de81dcab](https://github.com/alenlukic/pancreator/commit/de81dcab4007e4fcb180e792de39f11a109e7bab), [b2c536e5](https://github.com/alenlukic/pancreator/commit/b2c536e58ede5ec78f2f627f79a5780db87d3fc2)).

## [7.8.0] - 2026-09-19

This release repairs eleven live command defects on the ship, inbox, and validator paths. It also allocates concurrent release versions from one shared ledger.

### Changed

- Resolve a requirement stage from the invocation, so `pan output validate` runs claims checks on remediate outputs ([7845b9c4](https://github.com/alenlukic/pancreator/commit/7845b9c4cb3e8ffe675e2763ab575378a5cfcf7b)).
- Bind `pan requirements run --invocation` to the attempt workspace. Name the comparison base when only `--run` is given ([7845b9c4](https://github.com/alenlukic/pancreator/commit/7845b9c4cb3e8ffe675e2763ab575378a5cfcf7b)).
- Skip release sync when the fetched ref is already an ancestor. Otherwise rebase in merge-preserving mode ([7845b9c4](https://github.com/alenlukic/pancreator/commit/7845b9c4cb3e8ffe675e2763ab575378a5cfcf7b)).
- Return `not_needed` from `pan release continue` when no rebase is active ([7845b9c4](https://github.com/alenlukic/pancreator/commit/7845b9c4cb3e8ffe675e2763ab575378a5cfcf7b)).
- Reuse a complete release pair on retry. Refuse a dirty tree before the first release commit ([7845b9c4](https://github.com/alenlukic/pancreator/commit/7845b9c4cb3e8ffe675e2763ab575378a5cfcf7b)).
- List every regular inbox file. Report an unlistable file with its reason ([7845b9c4](https://github.com/alenlukic/pancreator/commit/7845b9c4cb3e8ffe675e2763ab575378a5cfcf7b)).
- Accept every model-evidence role the invocation declares ([7845b9c4](https://github.com/alenlukic/pancreator/commit/7845b9c4cb3e8ffe675e2763ab575378a5cfcf7b)).
- Keep a current-run suite-profile index entry. Write `recorded_at` from the profile artifact ([7845b9c4](https://github.com/alenlukic/pancreator/commit/7845b9c4cb3e8ffe675e2763ab575378a5cfcf7b)).
- Read embedded review-scope closure from the installation when `.pancreator/` is untracked ([7845b9c4](https://github.com/alenlukic/pancreator/commit/7845b9c4cb3e8ffe675e2763ab575378a5cfcf7b)).
- Retry one malformed away-evaluator reply before a ledger write. Keep parse text out of the decision record ([7845b9c4](https://github.com/alenlukic/pancreator/commit/7845b9c4cb3e8ffe675e2763ab575378a5cfcf7b)).
- Accept a blocked implement result with empty acceptance results when blocked data is present ([7845b9c4](https://github.com/alenlukic/pancreator/commit/7845b9c4cb3e8ffe675e2763ab575378a5cfcf7b)).
- Allocate release versions from one shared ledger so concurrent worktrees do not collide ([d3e12776](https://github.com/alenlukic/pancreator/commit/d3e127769417d2fe59d424c56b449270ab4e7d64)).
- Reuse a held allocation only for the same bump ([732f74ab](https://github.com/alenlukic/pancreator/commit/732f74ab68183ecfb10ad6bd510bf8016516a4e5)).
- Pass `--force` and a path-resolution preamble so a headless stage worker can read its contract ([89fd41fd](https://github.com/alenlukic/pancreator/commit/89fd41fd368925d95b1c6d7802cb558b8413938b)).
- Raise the headless worker bound and record executor failures ([6ca005cf](https://github.com/alenlukic/pancreator/commit/6ca005cf5141738509ed99630749172070191c29)).
- Skip the RFC 2119 keyword definition in the directive-ownership audit. `pan validate` now reports zero warnings ([c575264f](https://github.com/alenlukic/pancreator/commit/c575264fb92554e5daa0c6d96a15fc49956c44b4)).
- Fail a repair intake that names a sibling file this checkout does not hold ([b93d62b2](https://github.com/alenlukic/pancreator/commit/b93d62b29c7bce8e274bb01d0068995fb46cb12a)).
- Report `harness_version` and a stale flag from `pan installs list` ([b93d62b2](https://github.com/alenlukic/pancreator/commit/b93d62b29c7bce8e274bb01d0068995fb46cb12a)).
- Raise the TEST-001 fast-wall ceiling from 120000 ms to 160000 ms ([e4ec3882](https://github.com/alenlukic/pancreator/commit/e4ec38828994f8153cf7bfc25a96abfb8533999b)).

### Added

- Add `pan release allocate` as the version authority for a managed ship ([d3e12776](https://github.com/alenlukic/pancreator/commit/d3e127769417d2fe59d424c56b449270ab4e7d64)).
- Add `--invocation` on `pan requirements run` ([7845b9c4](https://github.com/alenlukic/pancreator/commit/7845b9c4cb3e8ffe675e2763ab575378a5cfcf7b)).
- Add a blocked-data contract on every delivery implement stage ([7845b9c4](https://github.com/alenlukic/pancreator/commit/7845b9c4cb3e8ffe675e2763ab575378a5cfcf7b)).

### Fixed

- Fail release sync when a rebase drops a merge the branch carried ([7845b9c4](https://github.com/alenlukic/pancreator/commit/7845b9c4cb3e8ffe675e2763ab575378a5cfcf7b)).
- Stop a second release pair for the same version after a blocked ship ([7845b9c4](https://github.com/alenlukic/pancreator/commit/7845b9c4cb3e8ffe675e2763ab575378a5cfcf7b)).
- Keep a newer suite-profile index entry instead of an older scan ([7845b9c4](https://github.com/alenlukic/pancreator/commit/7845b9c4cb3e8ffe675e2763ab575378a5cfcf7b)).
- Show captured `.txt` requests in `pan inbox` ([7845b9c4](https://github.com/alenlukic/pancreator/commit/7845b9c4cb3e8ffe675e2763ab575378a5cfcf7b)).
- Submit a blocked implement output that carries blocked data ([7845b9c4](https://github.com/alenlukic/pancreator/commit/7845b9c4cb3e8ffe675e2763ab575378a5cfcf7b)).

## [7.7.0] - 2026-09-19

This release classifies load-sensitive gate failures, allocates concurrent release versions, and repairs headless workers. Plan validation now rejects a pan option that the CLI does not accept.

### Changed

- Classify a new gate failure outside the change import graph as `environment_or_flake` when one isolated rerun passes ([ebe6baee](https://github.com/alenlukic/pancreator/commit/ebe6baee655927471ce69b073b5e1742ddfccc3c)).
- Raise the TEST-001 rolling fast-wall ceiling from 120s to 160s ([e4ec3882](https://github.com/alenlukic/pancreator/commit/e4ec38828994f8153cf7bfc25a96abfb8533999b)).

### Added

- Add `pan release allocate` so concurrent worktrees take distinct versions from one ledger ([d3e12776](https://github.com/alenlukic/pancreator/commit/d3e12776)).
- Add a shared pan option grammar for plan cases, rollback steps, and command files ([ebe6baee](https://github.com/alenlukic/pancreator/commit/ebe6baee655927471ce69b073b5e1742ddfccc3c)).
- Add a benchmark session record that pairs a baseline sample with a candidate sample ([ebe6baee](https://github.com/alenlukic/pancreator/commit/ebe6baee655927471ce69b073b5e1742ddfccc3c)).
- Flag a stale installation on `pan installs list` ([b93d62b2](https://github.com/alenlukic/pancreator/commit/b93d62b2)).
- Refuse a repair intake that names a sibling intake file this checkout does not hold ([b93d62b2](https://github.com/alenlukic/pancreator/commit/b93d62b2)).

### Fixed

- Let headless stage workers read their contract, honor `--force`, and use an hours-long bound ([6ca005cf](https://github.com/alenlukic/pancreator/commit/6ca005cf5141738509ed99630749172070191c29)).
- Reuse a held release allocation only for the same bump ([732f74ab](https://github.com/alenlukic/pancreator/commit/732f74ab)).
- Stop `pan validate` from reporting RFC 2119 keyword-definition warnings ([c575264f](https://github.com/alenlukic/pancreator/commit/c575264f)).
- Repair three regression guards so they fail against the pre-change state ([ebe6baee](https://github.com/alenlukic/pancreator/commit/ebe6baee655927471ce69b073b5e1742ddfccc3c)).
- Render the suite-profile advisory in both shapes and drop the doubled blank line ([ebe6baee](https://github.com/alenlukic/pancreator/commit/ebe6baee655927471ce69b073b5e1742ddfccc3c)).

## [7.6.0] - 2026-09-19

This release adds `/pan-trace`. The command runs a cheap end-to-end smoke of a newly merged harness feature.

### Added

- Add the `/pan-trace` command and the `trace` card mode ([1530e2e5](https://github.com/alenlukic/pancreator/commit/1530e2e561ba9bc030a55caa034a88a01097303e)).
- Register `pan-trace` as a card command and as a target-mutating command ([1530e2e5](https://github.com/alenlukic/pancreator/commit/1530e2e561ba9bc030a55caa034a88a01097303e)).
- Add the `trace` policy lookup row for persona `harness-workflow-qa` ([1530e2e5](https://github.com/alenlukic/pancreator/commit/1530e2e561ba9bc030a55caa034a88a01097303e)).
- Document the choice among `/pan-trace`, `/pan-qa-workflow`, and `pan eval` ([1530e2e5](https://github.com/alenlukic/pancreator/commit/1530e2e561ba9bc030a55caa034a88a01097303e)).
- Add integration tests for command registration and the trace card ([1530e2e5](https://github.com/alenlukic/pancreator/commit/1530e2e561ba9bc030a55caa034a88a01097303e)).

## [7.5.1] - 2026-09-19

This release adds four `openai:` bracket options for the Astra Responses API. A persona can set `mode`, `context`, `summary`, and `verbosity`. The `context` option has no replay effect yet.

### Added

- Add `mode`, `context`, `summary`, and `verbosity` as `openai:` bracket options for `reasoning` and `text.verbosity` ([e22825ee](https://github.com/alenlukic/pancreator/commit/e22825ee7d7b3849521d4010b32713c2dbb4114c)).

## [7.5.0] - 2026-09-18

This release extends the style scanner and the `/pan-style` command. The scanner reports the handbook rules it can decide. The command reads every file that changed after the last checkpoint.

### Changed

- Extend `CODE-STYLE-VALIDATE-001` so the scanner reports the TypeScript handbook rules it can decide ([3b22f015](https://github.com/alenlukic/pancreator/commit/3b22f01569f6315fefad4fc787b3f2f7e615d8f4)).
- Route every eligible file that changed after the last checkpoint through the complete style handbook ([3b22f015](https://github.com/alenlukic/pancreator/commit/3b22f01569f6315fefad4fc787b3f2f7e615d8f4)).
- Run the fast test profile before the `/pan-style` checkpoint ([3b22f015](https://github.com/alenlukic/pancreator/commit/3b22f01569f6315fefad4fc787b3f2f7e615d8f4)).
- Document the wider scanner and command scope in the operator guide and `pan style` help ([3b22f015](https://github.com/alenlukic/pancreator/commit/3b22f01569f6315fefad4fc787b3f2f7e615d8f4)).
- Apply the handbook pass to 118 source and test files ([7372472a](https://github.com/alenlukic/pancreator/commit/7372472ad9e6ae3e9a9ef0371af60e9c13b84b76)).
- Replace a non-null assertion and a cast in the horizon test with a type guard ([a23e7c19](https://github.com/alenlukic/pancreator/commit/a23e7c193bed5b06c224666346fae705ad1db496)).

### Added

- Add scanner codes for unbraced bodies, block spacing, large declaration groups, and a `switch` without `default` ([3b22f015](https://github.com/alenlukic/pancreator/commit/3b22f01569f6315fefad4fc787b3f2f7e615d8f4)).
- Add scanner codes for default exports, mutable exports, function expressions, private fields, and `debugger` ([3b22f015](https://github.com/alenlukic/pancreator/commit/3b22f01569f6315fefad4fc787b3f2f7e615d8f4)).
- Add scanner codes for restricted features, wrapper constructors, the arguments object, and TypeScript suppressions ([3b22f015](https://github.com/alenlukic/pancreator/commit/3b22f01569f6315fefad4fc787b3f2f7e615d8f4)).
- Add a documented exception as `// style: allow <code> <reason>`, or `# style: allow` in Python ([3b22f015](https://github.com/alenlukic/pancreator/commit/3b22f01569f6315fefad4fc787b3f2f7e615d8f4)).
- Add exhaustive `default` branches in `versioning.ts`, `engine.ts`, `cohorts.ts`, and `render.ts` ([7372472a](https://github.com/alenlukic/pancreator/commit/7372472ad9e6ae3e9a9ef0371af60e9c13b84b76)).

### Fixed

- Follow a `${}` substitution in the template masker so a nested template does not end the outer template early ([3b22f015](https://github.com/alenlukic/pancreator/commit/3b22f01569f6315fefad4fc787b3f2f7e615d8f4)).

## [7.4.0] - 2026-09-18

This release extends `/pan-conform` to the harness instruction surfaces that STE-001 names. The scanner and the validator now cover those files. The first operator conform pass repairs the copy debt.

### Changed

- Extend the `/pan-conform` editable set to `AGENTS.md`, policy files, criteria, personas, skills, commands, and rules ([76d1e1f5](https://github.com/alenlukic/pancreator/commit/76d1e1f5376c52cbdc537e3b2bde2b6b0b0e4dd6)).
- Reword STE-001 instruction 2 so the governance exclusion covers only non-instruction files ([76d1e1f5](https://github.com/alenlukic/pancreator/commit/76d1e1f5376c52cbdc537e3b2bde2b6b0b0e4dd6)).
- Repair instruction-surface copy against STE-001 after the scanner change ([a14cc27f](https://github.com/alenlukic/pancreator/commit/a14cc27fcae3997bc325d156b55ddaa63e1b80c2)).

### Added

- Add a `policy-json` target type so `SIMPLIFIED-ENGLISH-VALIDATE-001` counts policy instruction text ([76d1e1f5](https://github.com/alenlukic/pancreator/commit/76d1e1f5376c52cbdc537e3b2bde2b6b0b0e4dd6)).

### Fixed

- Accept a policy file and an `.mdc` rule as validator targets ([76d1e1f5](https://github.com/alenlukic/pancreator/commit/76d1e1f5376c52cbdc537e3b2bde2b6b0b0e4dd6)).

## [7.3.0] - 2026-09-18

This release indexes the merged tree. Versions 7.1.0 and 7.2.0 were cut in parallel on separate branches, so neither indexed commit describes a tree holding both features. This release restores the release identity the installer checks.

### Changed

- Index a release commit whose harness payload matches the merge of the design composition of 7.1.0 and the embedded installation registry of 7.2.0 ([ff415dc4](https://github.com/alenlukic/pancreator/commit/ff415dc4)).
- Drop the stale version from the `AGENTS.md` header ([38bd2d5f](https://github.com/alenlukic/pancreator/commit/38bd2d5f)).

## [7.2.0] - 2026-09-18

This release adds a machine-local registry of embedded installations. Operators can list those installs and archive cited inbox items from the source checkout. The version is 7.2.0 because pan-dev already holds 7.1.0.

### Changed

- Point `/pan-repair installs` at every registered install and write one intake set in this repository ([3363f781](https://github.com/alenlukic/pancreator/commit/3363f7819b91ddd67bae285c56acec1b85b6eb33)).
- Document the registry, the two installs commands, and the sweep ([f657a7f8](https://github.com/alenlukic/pancreator/commit/f657a7f8ff5bd63c588a032f11eb2b96e7e85447)).

### Added

- Add an optional `installations` array with `id` and absolute `path` ([3363f781](https://github.com/alenlukic/pancreator/commit/3363f7819b91ddd67bae285c56acec1b85b6eb33)).
- Add `pan installs list` and `pan installs archive` ([3363f781](https://github.com/alenlukic/pancreator/commit/3363f7819b91ddd67bae285c56acec1b85b6eb33)).
- Add `archiveInboxRequest` for a terminal inbox item ([3363f781](https://github.com/alenlukic/pancreator/commit/3363f7819b91ddd67bae285c56acec1b85b6eb33)).

### Fixed

- Match a cited inbox file name as a whole path segment ([3363f781](https://github.com/alenlukic/pancreator/commit/3363f7819b91ddd67bae285c56acec1b85b6eb33)).

## [7.1.0] - 2026-09-18

This release adds an optional design composition for planning and delivery runs. The operator selects the option at run creation. A run without the option keeps the current graph.

### Changed

- Carry the design selection from `pan init` through the plan route into delivery, chunk, and release runs ([bf25658d](https://github.com/alenlukic/pancreator/commit/bf25658d9e22ae151b9510f8fa86c756d705ee71)).
- Record verify findings from design-review and design-qa when those workers run ([bf25658d](https://github.com/alenlukic/pancreator/commit/bf25658d9e22ae151b9510f8fa86c756d705ee71)).
- Name `runtime/inbox/queue/` as the destination of a new inbox item ([62d19132](https://github.com/alenlukic/pancreator/commit/62d191323c7ac253812f0f6941f5e706fd3cd7d6)).

### Added

- Add `./bin/pan init --with-design` for planning, delivery, and delivery-chunk ([bf25658d](https://github.com/alenlukic/pancreator/commit/bf25658d9e22ae151b9510f8fa86c756d705ee71)).
- Add a planning design stage before plan when the option is on ([bf25658d](https://github.com/alenlukic/pancreator/commit/bf25658d9e22ae151b9510f8fa86c756d705ee71)).
- Add design-review and design-qa workers on verify when the option is on ([bf25658d](https://github.com/alenlukic/pancreator/commit/bf25658d9e22ae151b9510f8fa86c756d705ee71)).

### Fixed

- Create every inbox lifecycle directory during install layout preparation ([62d19132](https://github.com/alenlukic/pancreator/commit/62d191323c7ac253812f0f6941f5e706fd3cd7d6)).

## [7.0.0] - 2026-09-18

This release adds long-horizon mode, a headless driver, a session ladder, and scheduled jobs. The operator selects the mode at preflight. The harness then advances a queue of workflows and one-off tasks without a mid-run stop.

### Changed

- Split the two mode-specific rules into SINGLERUN-001 and HORIZON-001. Policy resolution reads the snapshotted `long_horizon` contract ([1664bba1](https://github.com/alenlukic/pancreator/commit/1664bba1970ea9d74f6b30a847330e4beb79a5c8)).
- Extract the eval drive loop into one shared headless driver. Eval outcomes stay the same ([3fdbfd37](https://github.com/alenlukic/pancreator/commit/3fdbfd370db02de993fe525e812729bd8def4e80)).
- Move the submit watch check to harness delegation rather than executor kind ([3fdbfd37](https://github.com/alenlukic/pancreator/commit/3fdbfd370db02de993fe525e812729bd8def4e80)).
- Permit a coarser Cursor tool policy when the CLI has no per-path write control. The scope gate stays the gate of record ([3fdbfd37](https://github.com/alenlukic/pancreator/commit/3fdbfd370db02de993fe525e812729bd8def4e80)).
- Attach the chrome-devtools MCP server to one shared Chrome for Testing instance with `--browserUrl`. Do not launch an isolated browser from the server ([de1635ed](https://github.com/alenlukic/pancreator/commit/de1635edd6ac02f7d2badd4f2077b900c7d92e81)).

### Added

- Add a `long-horizon` involvement profile, a `long_horizon` run contract, and a lookup-table mode dimension ([1664bba1](https://github.com/alenlukic/pancreator/commit/1664bba1970ea9d74f6b30a847330e4beb79a5c8)).
- Add HORIZON-001, SINGLERUN-001, and the horizon handbook with the marked enumeration and the ladder ([1664bba1](https://github.com/alenlukic/pancreator/commit/1664bba1970ea9d74f6b30a847330e4beb79a5c8)).
- Add a Cursor executor adapter that drives `cursor-agent` with the persona model spec and the rendered delivery prompt ([3fdbfd37](https://github.com/alenlukic/pancreator/commit/3fdbfd370db02de993fe525e812729bd8def4e80)).
- Add `pan horizon` for a durable session that holds tasks, dependencies, deferral, and a handoff at each task boundary ([0e5f3492](https://github.com/alenlukic/pancreator/commit/0e5f34922a41870d9bd4f6e48af673f5e5e81981)).
- Add a four-rung per-task ladder: retry, strategy switch, scoped re-plan, then defer ([0e5f3492](https://github.com/alenlukic/pancreator/commit/0e5f34922a41870d9bd4f6e48af673f5e5e81981)).
- Add `pan schedule` with a tick that owns every decision, a dead-man alert file, and an optional macOS launchd agent ([c189aabd](https://github.com/alenlukic/pancreator/commit/c189aabdbd74a9ded447fdb9ef0c83079b275c7a)).

### Fixed

- Skip a policy-mandated inbox name during `pan archive` standardization. Archival still reads age from the UTC timestamp in that name ([9a2799a8](https://github.com/alenlukic/pancreator/commit/9a2799a84323493485420aaf5c622f84dab959a2)).

## [6.10.0] - 2026-09-16

This release adds `/pan-research` as a standalone research mode. The operator names a subject and a document type. The session writes one sourced Markdown document under `runtime/research/`. Research documents join the STE-001 governed set and the `/pan-conform` editable set. Cursor now ignores nested worktree checkouts.

### Changed

- Register `research` in the standalone mode table, the policy lookup table, and command governance, and list it in the primer, the operator guide, and the skills index ([governance-card](src/lib/governance-card.ts), [lookup](governance/registries/policy_lookup_table.json), [command-governance](governance/registries/command_governance.json), [2b680424](https://github.com/alenlukic/pancreator/commit/2b680424b2afd23f9bcb6dd6b9d42c9590b40917)).
- Add research documents to the STE-001 governed-artifact list and the STE handbook ([STE-001](governance/policies/STE-001.json), [handbook](governance/handbooks/writing/simplified-technical-english.md), [2b680424](https://github.com/alenlukic/pancreator/commit/2b680424b2afd23f9bcb6dd6b9d42c9590b40917)).
- Add `runtime/research/*.md` to the `/pan-conform` editable set across the scanner, mode boundary, command, operator guide, and primer ([conform](src/lib/conform.ts), [pan-conform](library/cursor/commands/pan-conform.md), [operator-guide](docs/operator-guide.md), [2b680424](https://github.com/alenlukic/pancreator/commit/2b680424b2afd23f9bcb6dd6b9d42c9590b40917)).
- Ignore worktree checkouts in Cursor so nested `AGENTS.md` files do not enter the root workspace. Add `.cursorignore` for `worktrees/`, `runtime/worktrees/`, and `.claude/worktrees/` ([.cursorignore](.cursorignore), [f780bc9f](https://github.com/alenlukic/pancreator/commit/f780bc9f3893686e0ab80a5c8993aed375c76b5b)).

### Added

- Add `/pan-research` as a standalone research mode that writes one sourced Markdown document under `runtime/research/` ([pan-research](library/cursor/commands/pan-research.md), [researcher](library/personas/researcher.md), [research](library/skills/research.md), [governance-card](src/lib/governance-card.ts), [2b680424](https://github.com/alenlukic/pancreator/commit/2b680424b2afd23f9bcb6dd6b9d42c9590b40917)).
- Add the `researcher` persona and the `research` skill with five document types: `solution assessment`, `comparison`, `technical brief`, `feasibility study`, and `research memo` ([researcher](library/personas/researcher.md), [research](library/skills/research.md), [2b680424](https://github.com/alenlukic/pancreator/commit/2b680424b2afd23f9bcb6dd6b9d42c9590b40917)).
- Add coverage for the research command, the research card, the STE-001 lookup, and the conform editable set ([command-coverage](tests/integration/command-coverage.test.ts), [governance-card](tests/integration/governance-card.test.ts), [policies](tests/integration/policies.test.ts), [conform](tests/integration/conform.test.ts), [2b680424](https://github.com/alenlukic/pancreator/commit/2b680424b2afd23f9bcb6dd6b9d42c9590b40917)).

## [6.9.0] - 2026-09-15

This release names the integration branch `pan-dev`. Agents commit and merge on `pan-dev` or on a branch that lands on `pan-dev`, and the operator promotes `pan-dev` to `main`. The former name `dev` collided with branches that target repositories already use for other work. The installer now creates `pan-dev` from the target's HEAD when it is missing, so a target carries the branch before its first run.

### Changed

- Rename the integration branch from `dev` to `pan-dev` on every surface that states the landing rule: `AGENTS.md`, the embedded and detached `AGENTS.md` templates, ACTION-001, both Cursor rules, and the operator guide ([AGENTS](AGENTS.md), [ACTION-001](governance/policies/ACTION-001.json), [7bf92ae6](https://github.com/alenlukic/pancreator/commit/7bf92ae64e75ac4004a081d57c38c8235b9a4fcf)).
- Assert the `pan-dev` landing rule in the cohort-autonomy surface regression test, so a surface that still names `dev` fails the suite ([cohort-autonomy-surfaces](tests/regression/cohort-autonomy-surfaces.test.ts), [7bf92ae6](https://github.com/alenlukic/pancreator/commit/7bf92ae64e75ac4004a081d57c38c8235b9a4fcf)).

### Added

- Create the local `pan-dev` branch from the target's current HEAD on a fresh install and on every refresh when the target workspace is a Git repository and the branch does not exist. The installer never checks the branch out or pushes it, keeps an existing `pan-dev` at its own commit, skips a repository with no commits with a one-line notice, and creates the branch in the target workspace for a detached install ([install](bin/install), [embedded-installation](docs/embedded-installation.md), [0a28ddd0](https://github.com/alenlukic/pancreator/commit/0a28ddd0ed0bb94b32d074c23ba9de347201073a)).
- Add smoke steps for the integration branch: a git target with no commits gets no branch, a committed target gets `pan-dev` at HEAD and stays on its own branch, a refresh keeps one `pan-dev` at the same commit, a pre-existing `pan-dev` is left alone, a non-git target gets no repository, and a detached install creates the branch in the target ([install](bin/install), [0a28ddd0](https://github.com/alenlukic/pancreator/commit/0a28ddd0ed0bb94b32d074c23ba9de347201073a)).
- Assert the created and retained branch in the embedded and detached installer suites, on the git-target paths they already covered ([embedded-installation](tests/secondary/embedded-installation.test.ts), [detached-installation](tests/secondary/detached-installation.test.ts), [0a28ddd0](https://github.com/alenlukic/pancreator/commit/0a28ddd0ed0bb94b32d074c23ba9de347201073a)).
- Report the integration branch in `pan doctor` under `git.integration_branch`. A missing branch is advisory and names the repair: run the `./bin/install` refresh or `git branch pan-dev` ([git](src/lib/git.ts), [cli](src/cli.ts), [integration-branch-readiness](tests/unit/integration-branch-readiness.test.ts), [0a28ddd0](https://github.com/alenlukic/pancreator/commit/0a28ddd0ed0bb94b32d074c23ba9de347201073a)).

## [6.8.0] - 2026-09-15

This release removes commit and merge from every MUST NOT list. Agents commit and merge on their own judgment, on `dev` or on a branch that lands on `dev`. The operator promotes `dev` to `main` and pushes. Push, publication, deployment, history rewrite, branch deletion, and destructive reset stay operator-authorized.

### Changed

- Remove commit and merge from the MUST NOT list on every invariant surface: `AGENTS.md`, the embedded and detached `AGENTS.md` templates, ACTION-001, the Cursor rules, the mode cards, and the governance card generator ([AGENTS](AGENTS.md), [ACTION-001](governance/policies/ACTION-001.json), [governance-card](src/lib/governance-card.ts), [17da734a](https://github.com/alenlukic/pancreator/commit/17da734a666cc7c97a0db9d59d43fdd5fa376a9d)).
- State one landing rule on those surfaces. Agents commit and merge on `dev` or on a branch that lands on `dev`. Agents MUST NOT merge into `main`. The operator promotes `dev` to `main` and pushes ([ACTION-001](governance/policies/ACTION-001.json), [17da734a](https://github.com/alenlukic/pancreator/commit/17da734a666cc7c97a0db9d59d43fdd5fa376a9d)).
- Delete the cohort-integration exception clauses from `AGENTS.md`, ACTION-001, AWAY-001, the templates, and the rules, because a permitted action needs no carve-out ([AWAY-001](governance/policies/AWAY-001.json), [17da734a](https://github.com/alenlukic/pancreator/commit/17da734a666cc7c97a0db9d59d43fdd5fa376a9d)).
- Remove `git commit` from the `disallowedTools` list of every projected Cursor agent. Push and destructive reset stay denied ([coder](library/cursor/agents/coder.md), [17da734a](https://github.com/alenlukic/pancreator/commit/17da734a666cc7c97a0db9d59d43fdd5fa376a9d)).
- Narrow the prohibition in every persona and command card to push, publish, deploy, history rewrite, and branch deletion ([orchestrator](library/personas/orchestrator.md), [pan-pair](library/cursor/commands/pan-pair.md), [17da734a](https://github.com/alenlukic/pancreator/commit/17da734a666cc7c97a0db9d59d43fdd5fa376a9d)).
- Adjust COHORT-001 so the harness still owns the unit commit and the group merge, because only that path writes the merge proof. The supervisor SHOULD run the named integrate command rather than merge by hand ([COHORT-001](governance/policies/COHORT-001.json), [17da734a](https://github.com/alenlukic/pancreator/commit/17da734a666cc7c97a0db9d59d43fdd5fa376a9d)).
- Narrow BESTOFN-001, PAIR-001, and SPOT-001 so each forbids only push, publication, deployment, branch deletion, and history rewrite ([BESTOFN-001](governance/policies/BESTOFN-001.json), [PAIR-001](governance/policies/PAIR-001.json), [SPOT-001](governance/policies/SPOT-001.json), [17da734a](https://github.com/alenlukic/pancreator/commit/17da734a666cc7c97a0db9d59d43fdd5fa376a9d)).
- Rewrite the cohort-autonomy surface regression test. It now asserts that no invariant surface forbids commit or merge, that each states the `dev` landing rule, and that no exception clause remains ([cohort-autonomy-surfaces](tests/regression/cohort-autonomy-surfaces.test.ts), [17da734a](https://github.com/alenlukic/pancreator/commit/17da734a666cc7c97a0db9d59d43fdd5fa376a9d)).
- Store the eval fixture instruction file as `evals/fixtures/toy-node/AGENTS.fixture.md`. Cursor merges every nested `AGENTS.md` into agent context and offers no exclusion. The eval runner restores the `AGENTS.md` name when it copies the fixture into the run workspace ([run](src/lib/evals/run.ts), [evals](docs/evals.md), [b2fa0570](https://github.com/alenlukic/pancreator/commit/b2fa057096971484d9407e005ff2f2c3007c23c2)).

## [6.7.0] - 2026-09-15

This release lands two finished features that stayed on unmerged branches. The harness now advances a cohort group by itself, and clean-tree gates read the workspace attribution records.

### Changed

- Commit each verified unit worktree, merge the finished group, and start the next group or the release run without an operator command ([cohorts](src/lib/cohorts.ts), [64bda3c5](https://github.com/alenlukic/pancreator/commit/64bda3c5e26eb8976fb8cad1074954f52ad51a85)).
- Give ACTION-001 and `AGENTS.md` a narrow carve-out for a commit or merge the harness performs during its own integration ([ACTION-001](governance/policies/ACTION-001.json), [AGENTS](AGENTS.md), [64bda3c5](https://github.com/alenlukic/pancreator/commit/64bda3c5e26eb8976fb8cad1074954f52ad51a85)).
- Narrow AWAY-001 so away mode must not run push, publication, deployment, or branch-deletion actions ([AWAY-001](governance/policies/AWAY-001.json), [64bda3c5](https://github.com/alenlukic/pancreator/commit/64bda3c5e26eb8976fb8cad1074954f52ad51a85)).
- Reconcile every operator-facing surface so each names the harness as the owner of cohort integration ([pan-cohort](library/cursor/commands/pan-cohort.md), [64bda3c5](https://github.com/alenlukic/pancreator/commit/64bda3c5e26eb8976fb8cad1074954f52ad51a85)).
- Make every clean-tree gate treat an untracked read-only input as clean state ([operator-guide](docs/operator-guide.md), [6ea864bf](https://github.com/alenlukic/pancreator/commit/6ea864bfd15c70440298185acd2c766a0e01ff4b)).
- Withhold a recorded read-only input from every harness commit: the cohort unit commit, the release checkpoint, and the release scope check ([cohorts](src/lib/cohorts.ts), [6ea864bf](https://github.com/alenlukic/pancreator/commit/6ea864bfd15c70440298185acd2c766a0e01ff4b)).
- Refuse a cohort unit commit when a tracked read-only input is modified, so the edit never drops out of the merge in silence ([cohorts](src/lib/cohorts.ts), [6ea864bf](https://github.com/alenlukic/pancreator/commit/6ea864bfd15c70440298185acd2c766a0e01ff4b)).
- Copy recorded read-only inputs into a new worktree at creation ([worktrees](src/lib/worktrees.ts), [6ea864bf](https://github.com/alenlukic/pancreator/commit/6ea864bfd15c70440298185acd2c766a0e01ff4b)).
- Define uncommitted work and the three dispositions in COHORT-001 and OPERATOR-001 ([COHORT-001](governance/policies/COHORT-001.json), [6ea864bf](https://github.com/alenlukic/pancreator/commit/6ea864bfd15c70440298185acd2c766a0e01ff4b)).
- Move the workspace-attribution suite to the integration lane to satisfy the 6.6.0 lane audit ([bf306326](https://github.com/alenlukic/pancreator/commit/bf306326231153d8965f3a741bee7f8cabb26c34)).

### Added

- Add `maybeAdvanceCohort` after submit, assess, decide, and away apply ([cli](src/cli.ts), [64bda3c5](https://github.com/alenlukic/pancreator/commit/64bda3c5e26eb8976fb8cad1074954f52ad51a85)).
- Add `waive-gate` to the away-mode vocabulary with a required note and away authorship ([away-mode](src/lib/away-mode.ts), [WAIVER-001](governance/policies/WAIVER-001.json), [64bda3c5](https://github.com/alenlukic/pancreator/commit/64bda3c5e26eb8976fb8cad1074954f52ad51a85)).
- Add `--disposition read-only-input|commit-with-unit|operator-owned` to `pan attribute`. The default is `operator-owned` ([6ea864bf](https://github.com/alenlukic/pancreator/commit/6ea864bfd15c70440298185acd2c766a0e01ff4b)).
- Add a repository-scoped attribution store at `runtime/logs/workspace-attributions.json` ([workspace-attribution](src/lib/workspace-attribution.ts), [6ea864bf](https://github.com/alenlukic/pancreator/commit/6ea864bfd15c70440298185acd2c766a0e01ff4b)).
- Add automatic-advance, away-waiver, attributed clean-tree, and surface-regression tests ([cohort-auto-advance](tests/integration/cohort-auto-advance.test.ts), [attributed-input-clean-tree](tests/regression/attributed-input-clean-tree.test.ts), [64bda3c5](https://github.com/alenlukic/pancreator/commit/64bda3c5e26eb8976fb8cad1074954f52ad51a85), [6ea864bf](https://github.com/alenlukic/pancreator/commit/6ea864bfd15c70440298185acd2c766a0e01ff4b)).

### Fixed

- Name each blocking path and its attribution status in a clean-tree refusal ([worktrees](src/lib/worktrees.ts), [6ea864bf](https://github.com/alenlukic/pancreator/commit/6ea864bfd15c70440298185acd2c766a0e01ff4b)).

## [6.6.0] - 2026-09-15

This release bounds the fast test lane. The runner starts the longest files first. A tracked 120 s ceiling reports the daily average.

### Changed

- Order compiled test files longest first from the last-run duration record ([d947205c](https://github.com/alenlukic/pancreator/commit/d947205c)).
- Rename the test scratch root to `runtime/tmp/tests.noindex` and move sweep work off the critical path ([d947205c](https://github.com/alenlukic/pancreator/commit/d947205c)).
- Amend TEST-001 so a fast-lane duration ceiling and structural test-placement checks are permitted ([a3fa9a80](https://github.com/alenlukic/pancreator/commit/a3fa9a80)).
- Convert hand-built run construction to checkpoint clones and enforce the rule in repository validation ([93c0ab2c](https://github.com/alenlukic/pancreator/commit/93c0ab2c)).
- Keep the unit lane free of fixtures and subprocesses. Move those tests to the integration lane ([93c0ab2c](https://github.com/alenlukic/pancreator/commit/93c0ab2c)).
- Set the explicit fast-lane worker default to 13 after the cost work ([1a3da16a](https://github.com/alenlukic/pancreator/commit/1a3da16a)).

### Added

- Record fixture template size and file count, and fail a template over 30 MB ([d947205c](https://github.com/alenlukic/pancreator/commit/d947205c)).
- Seed fixture clones with a local repository-check file that uses Node, not npm ([93c0ab2c](https://github.com/alenlukic/pancreator/commit/93c0ab2c)).
- Add a durable fast-wall series, `pan tests wall`, and a ship criterion that names the average and the ceiling ([1a3da16a](https://github.com/alenlukic/pancreator/commit/1a3da16a)).
- Show implement-stage wall and test-count deltas on the verify card ([1a3da16a](https://github.com/alenlukic/pancreator/commit/1a3da16a)).

### Fixed

- Write the run-tests session record with an atomic rename in the wrapper test ([0ccc28bb](https://github.com/alenlukic/pancreator/commit/0ccc28bb)).

## [6.5.0] - 2026-09-14

This release adds two standalone command-backed modes. `/pan-harden` prepares ad-hoc session changes for integration. `/pan-polish` brings UI and design changes into handbook and design-system conformance.

### Changed

- Register `harden` and `polish` in the standalone mode table, the policy lookup table, and command governance, and list both in the primer, the operator guide, and the skills index ([64860cc6](https://github.com/alenlukic/pancreator/commit/64860cc6a214cb5237cbf04366556b5ffc6feab4)).

### Added

- Add `/pan-harden` as a standalone coder mode that assesses scope, runs checks, delegates one reviewer, inspects a rendered surface when one changed, closes gaps, and names the operator integration command without running it ([64860cc6](https://github.com/alenlukic/pancreator/commit/64860cc6a214cb5237cbf04366556b5ffc6feab4)).
- Add `/pan-polish` as a standalone designer mode that resolves the design system for each touched surface and conforms the work, and that creates a new design-system file only after recorded operator approval ([64860cc6](https://github.com/alenlukic/pancreator/commit/64860cc6a214cb5237cbf04366556b5ffc6feab4)).

## [6.4.0] - 2026-09-14

This release registers `openai` as a persona executor. An operator can map a worker persona to GPT 6 Astra and run a real stage.

### Changed

- Widen former `claude-code`-only dispatch, projection, eval, and validation paths so they accept `openai` ([35b867d1](https://github.com/alenlukic/pancreator/commit/35b867d19fd9faa0e2479531781e7d6e8e450350)).

### Added

- Register `openai` as a third persona executor with a bounded Responses API tool loop, local continuation, and documented mapping options ([35b867d1](https://github.com/alenlukic/pancreator/commit/35b867d19fd9faa0e2479531781e7d6e8e450350)).
- Add a single-shot OpenAI Responses connector for operator use ([7f24c782](https://github.com/alenlukic/pancreator/commit/7f24c7829b7e9fa56d3a5770920e87817b87e6f6)).

### Fixed

- Harden OpenAI response handling against a malformed or incomplete Responses API payload ([2659e745](https://github.com/alenlukic/pancreator/commit/2659e745aea13b5fb3b6feb530e960e32bac9ffb)).

## [6.3.2] - 2026-09-14

This release removes TypeScript non-null assertions from CLI, engine, and tests.

### Changed

- Replace non-null assertions with explicit guards in the CLI tune prepare path, the waiver spotfix-case path, and matching tests ([ce36fa64](https://github.com/alenlukic/pancreator/commit/ce36fa64cde970310014019d522456ae3a17d8ac)).

## [6.3.1] - 2026-09-14

This release adds a developer benchmark script for repository-check profiles.

### Added

- Add `bin/benchmark` and `npm run benchmark` with `--fast` and `--full`. The default is `--fast`. Each selected profile runs three times in sequence. Both flags run fast first, then full. An unknown flag exits with a non-zero status and prints usage ([01b629f7](https://github.com/alenlukic/pancreator/commit/01b629f7bf87d51f053ba4e0e5d4f02f8dc22079)).

## [6.3.0] - 2026-09-14

This release repairs Phase 4 mechanical defects in four chunks.

### Changed

- Give a self-development release an execution-root override, a recorded build identity, and a post-submit landing ([64b1325b](https://github.com/alenlukic/pancreator/commit/64b1325b75b13ed3946ccd80b31e764475bfc72b)).
- Replace the delegation-artifact clock with one launch record, and accept `--launched-at` and `--handle` on `pan watch` ([d44c9edd](https://github.com/alenlukic/pancreator/commit/d44c9edd88d717484fd07b2961c647f8702d77cb)).
- Record the capture worktree on a shared baseline, keep invocation aliases, and add `--role` to the reuse key ([8f659244](https://github.com/alenlukic/pancreator/commit/8f659244dedb5bdec120a475dd8647a2fd4ae6e2)).
- Replace three prose pins with structural checks, and treat an unmeasured secondary lane as null ([0c44aefc](https://github.com/alenlukic/pancreator/commit/0c44aefca761bd35cc88b0acfdb3c71f1da926db)).
- Correct the launch-clock docs, fail-soft a contended snapshot event, and render `--handle` and `--launched-at` on every watch form ([d44c9edd](https://github.com/alenlukic/pancreator/commit/d44c9edd88d717484fd07b2961c647f8702d77cb)).
- Leave a pre-path baseline pointer empty, and refuse a `--resolve` citation that leaves the run ([8f659244](https://github.com/alenlukic/pancreator/commit/8f659244dedb5bdec120a475dd8647a2fd4ae6e2)).
- Fold the VERIFY-001 reproduction rule into the policy, and carry instruction #10 durability into the AGENTS templates ([3371aefb](https://github.com/alenlukic/pancreator/commit/3371aefb2d93a0fea7f8ea6d88104fdfe7518b8a)).

### Added

- Add `PANCREATOR_EXEC_ROOT` so a release can run the workspace build while state stays on the installation ([64b1325b](https://github.com/alenlukic/pancreator/commit/64b1325b75b13ed3946ccd80b31e764475bfc72b)).
- Add `pan status --resolve` so a live citation still names a file after the run closes ([8f659244](https://github.com/alenlukic/pancreator/commit/8f659244dedb5bdec120a475dd8647a2fd4ae6e2)).
- Add a launch record when `pan watch` first arms, with `--launched-at` and `--handle` ([d44c9edd](https://github.com/alenlukic/pancreator/commit/d44c9edd88d717484fd07b2961c647f8702d77cb)).

### Fixed

- Repair the inbox-routing case so a producer that writes the inbox root fails, and correct five stale tracked statements ([0c44aefc](https://github.com/alenlukic/pancreator/commit/0c44aefca761bd35cc88b0acfdb3c71f1da926db)).

## [6.2.2] - 2026-09-13

This release applies the five governance-text refinements the Phase 3 evaluation proposed.

### Changed

- Require a carried verify warning to name its finding id, its graded severity, the evidence file path rather than an in-flight invocation prefix, and the receiving chunk's verifier, and to stay out of the next release run when it leaves tracked operator-facing text false ([orchestrator](library/personas/orchestrator.md), [7d44e351](https://github.com/alenlukic/pancreator/commit/7d44e351bb85704dbdcf8c8e8502184d235c5ebb)).
- Tell the release lane that every `./bin/pan` command on a self-development release runs the harness root's build, and require the run to confirm a release-lane behavior against the root `VERSION` and to state which release-lane repairs are inactive ([ship](library/workflows/delivery/prompts/ship.md), [orchestrator](library/personas/orchestrator.md), [7d44e351](https://github.com/alenlukic/pancreator/commit/7d44e351bb85704dbdcf8c8e8502184d235c5ebb)).
- Ask the verifier to record the shape and trial count of the reproduction that settles a disagreement between evidence reports, and to grade on the evidence that exists when it can reproduce neither claim ([VERIFY-001](governance/policies/VERIFY-001.json), [7d44e351](https://github.com/alenlukic/pancreator/commit/7d44e351bb85704dbdcf8c8e8502184d235c5ebb)).
- Ask a non-blocking finding routed to the warning inbox to name the condition that makes it urgent separately from the chunk or owner that will close it ([VERIFY-001](governance/policies/VERIFY-001.json), [7d44e351](https://github.com/alenlukic/pancreator/commit/7d44e351bb85704dbdcf8c8e8502184d235c5ebb)).
- Require a named harness-contract conflict to land in a durable artifact the run retains, and in the succeeding attempt's `risks` or `unknowns` when a later attempt overwrites the agent's output ([PRINCIPLES-001](governance/policies/PRINCIPLES-001.json), [coder](library/personas/coder.md), [AGENTS](AGENTS.md), [7d44e351](https://github.com/alenlukic/pancreator/commit/7d44e351bb85704dbdcf8c8e8502184d235c5ebb)).

## [6.2.1] - 2026-09-13

This release reconciles authoring layers with the authority order and corrects two tests.

### Changed

- Reconcile authoring layers with the authority order in PRINCIPLES-001, the workflow-authoring guide, `FALLBACK_AUTHORITY_ORDER`, and the installed templates ([PRINCIPLES-001](governance/policies/PRINCIPLES-001.json), [workflow-authoring](docs/workflow-authoring.md), [watch](src/lib/watch.ts), [embedded-AGENTS](library/templates/embedded-AGENTS.md), [detached-AGENTS](library/templates/detached-AGENTS.md), [52d154fe](https://github.com/alenlukic/pancreator/commit/52d154fee50e288b1fef8766ea9d0b7c389fc13c)).

### Fixed

- Correct the AC-050 comment so it credits the record-count pins ([run-mutex-bookkeeping](tests/regression/run-mutex-bookkeeping.test.ts), [f976678b](https://github.com/alenlukic/pancreator/commit/f976678b34192187addc753b7fd537207fb3d13c)).
- Assert the `agent_reported_running` hold reason in the sibling watch case ([watch](tests/unit/watch.test.ts), [f976678b](https://github.com/alenlukic/pancreator/commit/f976678b34192187addc753b7fd537207fb3d13c)).

## [6.2.0] - 2026-09-13

This release repairs Phase 3 mechanical defects in four chunks.

### Changed

- Give installer smoke children explicit source metadata so the clean-checkout guard does not block a self-development release ([install](bin/install), [a7541881](https://github.com/alenlukic/pancreator/commit/a75418814a46641752971a58fceff08ac92bbdf0)).
- Honor a gate waiver on the named entry-gate criterion, or refuse the waiver by name ([engine](src/lib/engine.ts), [a7541881](https://github.com/alenlukic/pancreator/commit/a75418814a46641752971a58fceff08ac92bbdf0)).
- Refuse release sync when a rebase would rewrite a commit that is already on local main ([release-preparation](src/lib/release-preparation.ts), [a7541881](https://github.com/alenlukic/pancreator/commit/a75418814a46641752971a58fceff08ac92bbdf0)).
- Carry a same-run release-metadata fingerprint chain for the ship currency check ([validation](src/lib/validation.ts), [a7541881](https://github.com/alenlukic/pancreator/commit/a75418814a46641752971a58fceff08ac92bbdf0)).
- Hold the watch for one confirming wake when completion evidence is weak ([watch](src/lib/watch.ts), [af65209e](https://github.com/alenlukic/pancreator/commit/af65209e424a0dacfd02b3868aba7b73845ac805)).
- Record a handle for each delegated worker, and give each role a unique evidence path ([engine](src/lib/engine.ts), [af65209e](https://github.com/alenlukic/pancreator/commit/af65209e424a0dacfd02b3868aba7b73845ac805)).
- Return a recorded profile pass at the same fingerprint instead of a second run ([repository-checks](src/lib/repository-checks.ts), [83fc9524](https://github.com/alenlukic/pancreator/commit/83fc9524b0ab29a7d326e0b98028ca83bb35d249)).
- List every inbox lifecycle status, and drop the integrate command for an abandoned-only cohort ([inbox](src/lib/inbox.ts), [cohorts](src/lib/cohorts.ts), [83fc9524](https://github.com/alenlukic/pancreator/commit/83fc9524b0ab29a7d326e0b98028ca83bb35d249)).
- Measure the supervisor-card digest diff from the last attested card ([supervisor-card](src/lib/governance/supervisor-card.ts), [83fc9524](https://github.com/alenlukic/pancreator/commit/83fc9524b0ab29a7d326e0b98028ca83bb35d249)).

### Added

- Add `pan worker state` and `pan worker record` for a delegated worker handle ([cli](src/cli.ts), [af65209e](https://github.com/alenlukic/pancreator/commit/af65209e424a0dacfd02b3868aba7b73845ac805)).
- Add a per-case citation field for a carried QA result ([stage-validators](src/lib/validators/stage-validators.ts), [83fc9524](https://github.com/alenlukic/pancreator/commit/83fc9524b0ab29a7d326e0b98028ca83bb35d249)).

### Fixed

- Repair harness tests that could not fail, and restore TP-10 honesty in the suite ([6c323365](https://github.com/alenlukic/pancreator/commit/6c3233652cb1cfaf9e76d8a3864ec6474729c779)).
- Pin the still-writing watch fixture to the launch artifact so the case does not depend on host load ([watch-helpers](tests/unit/watch-helpers.ts), [5df51c31](https://github.com/alenlukic/pancreator/commit/5df51c31fd2f7f842b1f08055dc77834accb907c)).

## [6.1.1] - 2026-09-13

This release adds two PRINCIPLES-001 instructions and aligns worker procedures with those rules.

### Changed

- Align AGENTS.md and the installed AGENTS templates with the contract-conflict rule ([AGENTS.md](AGENTS.md), [2676a32a](https://github.com/alenlukic/pancreator/commit/2676a32ab9412335e95f760e5e4ea6e0d6f4378e)).
- Read the agent-run ledger before you record a repository-check profile gap ([evaluate-evidence](library/skills/evaluate-evidence.md), [2676a32a](https://github.com/alenlukic/pancreator/commit/2676a32ab9412335e95f760e5e4ea6e0d6f4378e)).
- Write `result` last in a stage output so the watch does not end supervision early ([write-stage-output](library/skills/write-stage-output.md), [2676a32a](https://github.com/alenlukic/pancreator/commit/2676a32ab9412335e95f760e5e4ea6e0d6f4378e)).
- Skip BROWSER-001 without a supervisor prompt when no surface owes a browser verdict ([verifier](library/personas/verifier.md), [browser-inspection](library/skills/browser-inspection.md), [2676a32a](https://github.com/alenlukic/pancreator/commit/2676a32ab9412335e95f760e5e4ea6e0d6f4378e)).
- Record the two new judgment scenarios as named gaps ([judgment-backlog](evals/scenarios/judgment-backlog.md), [2676a32a](https://github.com/alenlukic/pancreator/commit/2676a32ab9412335e95f760e5e4ea6e0d6f4378e)).
- State that a cost-backed rule must name that cost in the workflow-authoring guide ([workflow-authoring](docs/workflow-authoring.md), [2676a32a](https://github.com/alenlukic/pancreator/commit/2676a32ab9412335e95f760e5e4ea6e0d6f4378e)).

### Added

- Add a PRINCIPLES-001 instruction that names a harness contract that blocks the objective ([PRINCIPLES-001](governance/policies/PRINCIPLES-001.json), [2676a32a](https://github.com/alenlukic/pancreator/commit/2676a32ab9412335e95f760e5e4ea6e0d6f4378e)).
- Add a PRINCIPLES-001 instruction that states the cost behind a cost-backed rule ([PRINCIPLES-001](governance/policies/PRINCIPLES-001.json), [2676a32a](https://github.com/alenlukic/pancreator/commit/2676a32ab9412335e95f760e5e4ea6e0d6f4378e)).

## [6.1.0] - 2026-09-13

This release integrates the two Phase 2 chunks of the harness-repair program. Chunk 2a repairs CLI and scaffold friction, error identity, and the inbox producer regression. Chunk 2b tightens the next-action contract, labeled model evidence, the secret-path detector, plan producibility, and supervisor-card digest diffs.

### Changed

- Report every missing `pan output validate` argument in one refusal, and treat a flag in the positional slot as a named-argument error ([cli](src/cli.ts), [0e95eee6](https://github.com/alenlukic/pancreator/commit/0e95eee69f5210df961a2091d04c5264554a9c6d)).
- Prefill skipped-guidance attestation fields as empty `reason` and `final_line`, and fail a skip whose reason was written into `final_line` ([scaffold](src/lib/requirements/scaffold.ts), [0e95eee6](https://github.com/alenlukic/pancreator/commit/0e95eee69f5210df961a2091d04c5264554a9c6d)).
- Order evidence workers before the verifier in prepare and the supervisor procedure ([engine](src/lib/engine.ts), [0e95eee6](https://github.com/alenlukic/pancreator/commit/0e95eee69f5210df961a2091d04c5264554a9c6d)).
- Name the recovery command that performs the intended action when `resume` or `decide` is refused, require a waiver destination when a silent forward route would skip a gate, and list every ratified criterion a verification-level change disables ([engine](src/lib/engine.ts), [0e95eee6](https://github.com/alenlukic/pancreator/commit/0e95eee69f5210df961a2091d04c5264554a9c6d)).
- Select pre-submit validators by determinism and side-effect freedom, so a claim defect fails before a repository-check gate ([validation](src/cli.ts), [0e95eee6](https://github.com/alenlukic/pancreator/commit/0e95eee69f5210df961a2091d04c5264554a9c6d)).
- Print the resolved gate timeout and the sourced gate-cache rule on worker cards that own a repository-check gate ([render](src/lib/render.ts), [0e95eee6](https://github.com/alenlukic/pancreator/commit/0e95eee69f5210df961a2091d04c5264554a9c6d)).
- Disclose absolute judging and credit only a declared known-failing case on an unbaselined entry gate ([known-failing](src/lib/known-failing.ts), [0e95eee6](https://github.com/alenlukic/pancreator/commit/0e95eee69f5210df961a2091d04c5264554a9c6d)).
- Honor `--worktree` on `decide` and `cohort route` so an approved single-chunk plan occupies a named checkout ([cohorts](src/lib/cohorts.ts), [0e95eee6](https://github.com/alenlukic/pancreator/commit/0e95eee69f5210df961a2091d04c5264554a9c6d)).
- Apply the harness-repair next-action forbidden-token contract to the operator lead as well as the recommended-next-action section ([validator](src/lib/validators/stage-validators.ts), [771a2974](https://github.com/alenlukic/pancreator/commit/771a297454c685687d0173dbf2faa66a6ac36e22)).
- Record labeled default model evidence for every declared worker, then replace it with the probed variant. Submission advises only a missing record and refuses a snapshot contradiction with `MODEL_EVIDENCE_MISMATCH` ([engine](src/lib/engine.ts), [771a2974](https://github.com/alenlukic/pancreator/commit/771a297454c685687d0173dbf2faa66a6ac36e22)).
- Widen the exported secret-path detector to dot-env directory members, PEM and keystore files, and extensionless private keys ([release-preparation](src/lib/release-preparation.ts), [771a2974](https://github.com/alenlukic/pancreator/commit/771a297454c685687d0173dbf2faa66a6ac36e22)).
- Refuse a plan criterion whose verification names no worker-producible evidence ([plan validation](src/lib/validators/stage-validators.ts), [771a2974](https://github.com/alenlukic/pancreator/commit/771a297454c685687d0173dbf2faa66a6ac36e22)).
- Report a digest-diff summary of a mid-run policy edit and still require supervisor re-attestation ([supervisor-card](src/lib/governance/supervisor-card.ts), [771a2974](https://github.com/alenlukic/pancreator/commit/771a297454c685687d0173dbf2faa66a6ac36e22)).

### Added

- Add `pan inbox restore` to return a canceled or active inbox item to the queue, and refuse a completed or already-queued item ([inbox](src/lib/inbox.ts), [0e95eee6](https://github.com/alenlukic/pancreator/commit/0e95eee69f5210df961a2091d04c5264554a9c6d)).
- Add `pan context card` to render an invocation read-only without writing run state ([context-card](src/lib/context-card.ts), [771a2974](https://github.com/alenlukic/pancreator/commit/771a297454c685687d0173dbf2faa66a6ac36e22)).

### Fixed

- Raise a coded harness error when a worktree override copy fails ([worktrees](src/lib/worktrees.ts), [0e95eee6](https://github.com/alenlukic/pancreator/commit/0e95eee69f5210df961a2091d04c5264554a9c6d)).
- Reach a run-owned inbox item under the queue directory during the finalization rewrite ([workflow-artifacts](src/lib/workflow-artifacts.ts), [0e95eee6](https://github.com/alenlukic/pancreator/commit/0e95eee69f5210df961a2091d04c5264554a9c6d)).

## [6.0.0] - 2026-09-13

This release adds the always-applied `PRINCIPLES-001` policy and aligns tradeoff rules under that hierarchy.

This release was first published as 5.24.0. The old numbers map as follows: 5.24.0 to 6.0.0, 5.25.0 to 6.1.0, 5.25.1 to 6.1.1, 5.26.0 to 6.2.0, and 5.26.1 to 6.2.1.

### Changed

- Rewrite the `AGENTS.md` authority order so invariants sit above operating principles and the card ([AGENTS.md](AGENTS.md), [128c6236](https://github.com/alenlukic/pancreator/commit/128c623667cfc2332fd6f947cc95e424f68dc2ee)).
- Render `PRINCIPLES-001` first on every governance card ([policy-guidance](src/lib/policy-guidance.ts), [128c6236](https://github.com/alenlukic/pancreator/commit/128c623667cfc2332fd6f947cc95e424f68dc2ee)).
- Downgrade 22 tradeoff preferences from MUST to SHOULD so `PRINCIPLES-001` can decide ordinary judgment calls ([68275aee](https://github.com/alenlukic/pancreator/commit/68275aee1eabf3a87d188de680f532b0d12e5b8b)).
- Make the reviewer persona read-only. The reviewer records findings and does not edit tracked files ([reviewer](library/personas/reviewer.md), [68275aee](https://github.com/alenlukic/pancreator/commit/68275aee1eabf3a87d188de680f532b0d12e5b8b)).

### Added

- Add policy `PRINCIPLES-001` as the always-applied operating principles and invariants hierarchy ([PRINCIPLES-001](governance/policies/PRINCIPLES-001.json), [128c6236](https://github.com/alenlukic/pancreator/commit/128c623667cfc2332fd6f947cc95e424f68dc2ee)).
- Add seven judgment eval scenarios and a grader backlog for `PRINCIPLES-001` ([evals](evals/scenarios/), [d7cdb077](https://github.com/alenlukic/pancreator/commit/d7cdb077955b6b5bfe4063cf29e5b9cf6b6ba908)).

## [5.23.0] - 2026-09-13

This release integrates the three chunks of cohort `63296_Sep-13-1313_phase-harnes`. Two acceptance criteria carry an operator disposition: AC-025, the harness-root-untouched live eval, was met by explicit operator waiver on the unit proof [eval-graders test](tests/unit/eval-graders.test.ts); AC-019 was met against an authorized plan amendment under a `fail_severe` remediation.

### Changed

- Route a failed ship release gate through remediate and verify before ship runs the gate again, instead of returning remediate directly to ship ([ship stage](library/workflows/delivery/stages/ship.json), [engine](src/lib/engine.ts), [30b088b8](https://github.com/alenlukic/pancreator/commit/30b088b83433fe3f250fb12711010fd996afac86)).
- Enforce the release-commit scope so the mandated release commit passes the ship scope criterion and a real external edit still fails it ([ship-gate](src/lib/validators/stage-validators.ts), [30b088b8](https://github.com/alenlukic/pancreator/commit/30b088b83433fe3f250fb12711010fd996afac86)).
- Return every advisory that `pan submit` records, and give a blocked ship result a satisfiable output shape ([engine](src/lib/engine.ts), [ship prompt](library/workflows/delivery/prompts/ship.md), [30b088b8](https://github.com/alenlukic/pancreator/commit/30b088b83433fe3f250fb12711010fd996afac86)).
- Hold the run mutex of a worker model probe only across the state read and the state write, never across the live model call ([engine](src/lib/engine.ts), [93a209b1](https://github.com/alenlukic/pancreator/commit/93a209b1cd68904c2173db02c0cd2f9e362f6d39)).
- Accept the shared `--worktree` option on `pan tests impacted` ([cli](src/cli.ts), [93a209b1](https://github.com/alenlukic/pancreator/commit/93a209b1cd68904c2173db02c0cd2f9e362f6d39)).
- Record a `captured_at` freshness timestamp on the Cursor model catalog and keep `pan models` and `pan doctor` working on a stale catalog ([cursor-catalog](src/lib/executors/cursor-catalog.ts), [93a209b1](https://github.com/alenlukic/pancreator/commit/93a209b1cd68904c2173db02c0cd2f9e362f6d39)).
- Move test fixture sidecars out of run evidence directories ([fixture-template](tests/fixture-template.ts), [93a209b1](https://github.com/alenlukic/pancreator/commit/93a209b1cd68904c2173db02c0cd2f9e362f6d39)).
- Keep the worktree record when `pan worktree remove` did not remove the directory, and refuse before any index change ([worktrees](src/lib/worktrees.ts), [93a209b1](https://github.com/alenlukic/pancreator/commit/93a209b1cd68904c2173db02c0cd2f9e362f6d39)).
- Parse the null-separated `git status --porcelain -z` format through one exported reader ([git](src/lib/git.ts), [93a209b1](https://github.com/alenlukic/pancreator/commit/93a209b1cd68904c2173db02c0cd2f9e362f6d39)).
- Build every gate-cache entry through one shared constructor, and carry the recorded suite profile on an accepted `full` pass ([gate-cache](src/lib/gate-cache.ts), [c15e74a4](https://github.com/alenlukic/pancreator/commit/c15e74a45ffcc99bf1f96f9f47060aeab131dc86)).
- Bound the suite-profile lookup by an index instead of reading every run state ([suite-profile](src/lib/suite-profile.ts), [c15e74a4](https://github.com/alenlukic/pancreator/commit/c15e74a45ffcc99bf1f96f9f47060aeab131dc86)).
- Give `pan output validate` a per-caller scratch path ([cli](src/cli.ts), [c15e74a4](https://github.com/alenlukic/pancreator/commit/c15e74a45ffcc99bf1f96f9f47060aeab131dc86)).
- State the ratified gate-cache acceptance rule in the operator guide ([operator guide](docs/operator-guide.md), [c15e74a4](https://github.com/alenlukic/pancreator/commit/c15e74a45ffcc99bf1f96f9f47060aeab131dc86)).

### Added

- Add `pan attribute <run-id>` to record an operator directive executed against the workspace outside a stage ([cli](src/cli.ts), [30b088b8](https://github.com/alenlukic/pancreator/commit/30b088b83433fe3f250fb12711010fd996afac86)).
- Assert the run-workspace write scope at the gate, so a write outside the run workspace fails ([workspace-write-scope test](tests/unit/workspace-write-scope.test.ts), [30b088b8](https://github.com/alenlukic/pancreator/commit/30b088b83433fe3f250fb12711010fd996afac86)).
- Refuse any CLI argument at or above 900 bytes with `ARGV_ELEMENT_TOO_LARGE`, and accept `--note-file <path>` on `decide`, `pause`, `resume`, `set-stage`, and `waive-gate` ([argv-limits](src/lib/argv-limits.ts), [93a209b1](https://github.com/alenlukic/pancreator/commit/93a209b1cd68904c2173db02c0cd2f9e362f6d39)).
- Add `--adopt-plan-from <run-id>` to `pan waive-gate`, so waiver-based plan reuse moves the worktree claim to the adopting run ([engine](src/lib/engine.ts), [93a209b1](https://github.com/alenlukic/pancreator/commit/93a209b1cd68904c2173db02c0cd2f9e362f6d39)).
- Declare worktree readiness through `config.json` `worktrees.readiness_paths`, assert it before a run's first stage, and adopt a hand-made worktree through `pan worktree resolve` ([worktrees](src/lib/worktrees.ts), [config.json](config.json), [93a209b1](https://github.com/alenlukic/pancreator/commit/93a209b1cd68904c2173db02c0cd2f9e362f6d39)).
- Add `--delete-branch` to `pan worktree remove`, which deletes the branch only when it is an ancestor of the default branch ([worktrees](src/lib/worktrees.ts), [93a209b1](https://github.com/alenlukic/pancreator/commit/93a209b1cd68904c2173db02c0cd2f9e362f6d39)).
- Print one bootstrap command set per live chunk run from `pan cohort status` ([cohorts](src/lib/cohorts.ts), [c15e74a4](https://github.com/alenlukic/pancreator/commit/c15e74a45ffcc99bf1f96f9f47060aeab131dc86)).
- Add `pan prepare --agent <name>`, which writes the labeled delegation card and starts the detached worker model probe ([engine](src/lib/engine.ts), [c15e74a4](https://github.com/alenlukic/pancreator/commit/c15e74a45ffcc99bf1f96f9f47060aeab131dc86)).

### Fixed

- Use the strict technology clause in the lookup coverage predicate and resolve every gap it surfaces ([command-coverage](src/lib/governance/command-coverage.ts), [30b088b8](https://github.com/alenlukic/pancreator/commit/30b088b83433fe3f250fb12711010fd996afac86)).
- Name the language's own policy in style evidence, state the delivered scope of the field-contract guard, and keep stage-output issue codes stable across a reword ([code-style validator](src/lib/validators/code-style.ts), [stage-validators](src/lib/validators/stage-validators.ts), [30b088b8](https://github.com/alenlukic/pancreator/commit/30b088b83433fe3f250fb12711010fd996afac86)).
- Close eight declaration-to-enforcement gaps across SHIP-001, REMED-001, and OPERATOR-001, and record the supervisor-executed operator directive ([SHIP-001](governance/policies/SHIP-001.json), [REMED-001](governance/policies/REMED-001.json), [OPERATOR-001](governance/policies/OPERATOR-001.json), [30b088b8](https://github.com/alenlukic/pancreator/commit/30b088b83433fe3f250fb12711010fd996afac86)).
- Repair three healthy-run assumptions in run state and workflow-artifact handling ([state](src/lib/state.ts), [workflow-artifacts](src/lib/workflow-artifacts.ts), [93a209b1](https://github.com/alenlukic/pancreator/commit/93a209b1cd68904c2173db02c0cd2f9e362f6d39)).

## [5.22.2] - 2026-09-13

### Changed

- Watch every background worker at one universal 60-second cadence. `pan watch` no longer defaults to 120 seconds or expects `--cadence-seconds 300` for long work ([watch](src/lib/watch.ts), [bfc64e14](https://github.com/alenlukic/pancreator/commit/bfc64e14d7a40c521b92d179c1603b37e1d07258)).
- State the fixed 60-second cadence in DELEGATE-001 and remove the separate long-work cadence rule ([DELEGATE-001](governance/policies/DELEGATE-001.json), [bfc64e14](https://github.com/alenlukic/pancreator/commit/bfc64e14d7a40c521b92d179c1603b37e1d07258)).
- Document the universal cadence and the operator-directed `--cadence-seconds` override in the operator guide ([operator guide](docs/operator-guide.md), [bfc64e14](https://github.com/alenlukic/pancreator/commit/bfc64e14d7a40c521b92d179c1603b37e1d07258)).

## [5.22.1] - 2026-09-13

### Changed

- Rebuild the target repository primer after the 5.22.0 release ([primer](docs/target-repo-primer.md), [7ad2f7a1](https://github.com/alenlukic/pancreator/commit/7ad2f7a1fd9d0e3cbd65456712539cf65c4c1dad)).
- Split seven SHIP-001 instruction sentences so each uses 20 words or fewer ([SHIP-001](governance/policies/SHIP-001.json), [0b4803e8](https://github.com/alenlukic/pancreator/commit/0b4803e87c138726a44e349e01db5c79ff6efba2)).

### Fixed

- Replace `load-bearing claims` with `critical claims` in VERIFY-001 ([VERIFY-001](governance/policies/VERIFY-001.json), [0b4803e8](https://github.com/alenlukic/pancreator/commit/0b4803e87c138726a44e349e01db5c79ff6efba2)).
- Correct the TS-001 index line to TypeScript conformance for detected TypeScript workspaces ([policy index](governance/policies/index.md), [0b4803e8](https://github.com/alenlukic/pancreator/commit/0b4803e87c138726a44e349e01db5c79ff6efba2)).
- Point four `--request` examples at `runtime/inbox/queue/` ([operator guide](docs/operator-guide.md), [0b4803e8](https://github.com/alenlukic/pancreator/commit/0b4803e87c138726a44e349e01db5c79ff6efba2)).
- State that no shipped template enables the `concurrent` profile flag ([operator guide](docs/operator-guide.md), [0b4803e8](https://github.com/alenlukic/pancreator/commit/0b4803e87c138726a44e349e01db5c79ff6efba2)).
- Record that no worker in the run owns code style and that `/pan-style` repairs it ([verify stages](library/workflows/delivery/stages/verify.json), [0b4803e8](https://github.com/alenlukic/pancreator/commit/0b4803e87c138726a44e349e01db5c79ff6efba2)).
- Remove the retired `finalize:workflow-artifacts` script from the runtime protocol ([runtime protocol](docs/runtime-protocol.md), [0b4803e8](https://github.com/alenlukic/pancreator/commit/0b4803e87c138726a44e349e01db5c79ff6efba2)).

## [5.22.0] - 2026-09-12

### Changed

- Adopt a recorded passed baseline at the same workspace fingerprint and verification-configuration digest ([engine](src/lib/engine.ts), [b167a42f](https://github.com/alenlukic/pancreator/commit/b167a42f5df16e5b9f0f9e4c0391170802ed9583)).
- Store a clean agent profile pass where the submit gate already looks for it ([repository-checks](src/lib/repository-checks.ts), [b167a42f](https://github.com/alenlukic/pancreator/commit/b167a42f5df16e5b9f0f9e4c0391170802ed9583)).
- Start a detached prefetch of the full profile when a source stage moves to verify ([engine](src/lib/engine.ts), [b167a42f](https://github.com/alenlukic/pancreator/commit/b167a42f5df16e5b9f0f9e4c0391170802ed9583)).
- Honor an optional `concurrent` profile flag in the asynchronous runner only ([repository-checks](src/lib/repository-checks.ts), [b167a42f](https://github.com/alenlukic/pancreator/commit/b167a42f5df16e5b9f0f9e4c0391170802ed9583)).
- Point Prettier at explicit top-level paths and turn on its content cache ([package.json](package.json), [b167a42f](https://github.com/alenlukic/pancreator/commit/b167a42f5df16e5b9f0f9e4c0391170802ed9583)).
- Return from a run-scoped model probe before the model answers ([cursor-probe](src/lib/executors/cursor-probe.ts), [b167a42f](https://github.com/alenlukic/pancreator/commit/b167a42f5df16e5b9f0f9e4c0391170802ed9583)).
- Parse the policy catalog and each guidance selection once per process for one root ([policies](src/lib/policies.ts), [b167a42f](https://github.com/alenlukic/pancreator/commit/b167a42f5df16e5b9f0f9e4c0391170802ed9583)).
- Move prepare and submit agent-registry writes outside the run mutex ([engine](src/lib/engine.ts), [b167a42f](https://github.com/alenlukic/pancreator/commit/b167a42f5df16e5b9f0f9e4c0391170802ed9583)).
- Apply the ratified tune verdicts to the decomposed test suite ([0a243077](https://github.com/alenlukic/pancreator/commit/0a2430770126979ba4b3d0a5aebfe67ea1988095)).
- Discard the test scratch tree in the background after each suite run ([bin/run-tests](bin/run-tests), [0a243077](https://github.com/alenlukic/pancreator/commit/0a2430770126979ba4b3d0a5aebfe67ea1988095)).

### Added

- Add an optional `concurrent` boolean on a repository-check profile. The gate runner still runs commands one after another, and no shipped profile enables the flag ([repository-checks](src/lib/repository-checks.ts), [b167a42f](https://github.com/alenlukic/pancreator/commit/b167a42f5df16e5b9f0f9e4c0391170802ed9583)).
- Probe every distinct model spec together on a bare `pan models --probe` ([cursor-probe](src/lib/executors/cursor-probe.ts), [b167a42f](https://github.com/alenlukic/pancreator/commit/b167a42f5df16e5b9f0f9e4c0391170802ed9583)).
- Infer a tune-record target kind so `pan requirements run` reaches the registry validator ([requirements runner](src/lib/requirements/run.ts), [0a243077](https://github.com/alenlukic/pancreator/commit/0a2430770126979ba4b3d0a5aebfe67ea1988095)).

### Fixed

- Repair the two installer language-bundle cases that failed on an embedded refresh ([language-bundle tests](tests/secondary/embedded-installation-language-bundle.test.ts), [0a243077](https://github.com/alenlukic/pancreator/commit/0a2430770126979ba4b3d0a5aebfe67ea1988095)).
- Add an authority section to the watch fixture and a stale stamp to the build-stamp reuse case ([0a243077](https://github.com/alenlukic/pancreator/commit/0a2430770126979ba4b3d0a5aebfe67ea1988095)).
- Derive the target-language bundle fixture from the installed template so the installer suites accept the split shape ([embedded-installation-language-bundle](tests/secondary/embedded-installation-language-bundle.test.ts), [b167a42f](https://github.com/alenlukic/pancreator/commit/b167a42f5df16e5b9f0f9e4c0391170802ed9583)).

## [5.21.1] - 2026-09-11

### Fixed

- List the authoritative harness repair category registry in the governance registry index ([registry index](governance/registries/index.md), [20da5408](https://github.com/alenlukic/pancreator/commit/20da540868309ed327d37aea9b1fb362f6f4d967)).
- Partition unresolved harness workflow QA findings into one intake per repair category ([workflow QA persona](library/personas/harness-workflow-qa.md), [20da5408](https://github.com/alenlukic/pancreator/commit/20da540868309ed327d37aea9b1fb362f6f4d967)).
- Keep planner, supervisor, and harness-only cohort rules off delivery-chunk worker cards through instruction audiences ([COHORT-001](governance/policies/COHORT-001.json), [20da5408](https://github.com/alenlukic/pancreator/commit/20da540868309ed327d37aea9b1fb362f6f4d967)).

## [5.21.0] - 2026-09-11

### Changed

- Partition a harness technician audit by issue category. Write one intake for each confirmed category, not one intake for the whole audit ([REPAIR-001](governance/policies/REPAIR-001.json), [31137dbf](https://github.com/alenlukic/pancreator/commit/31137dbf7d41fce6e2abbac0bf52a7ac03c7a73e)).
- Keep an explicit operator directive for one intake, a named subset, or a fixed count above that default ([REPAIR-001](governance/policies/REPAIR-001.json), [31137dbf](https://github.com/alenlukic/pancreator/commit/31137dbf7d41fce6e2abbac0bf52a7ac03c7a73e)).
- Let one category intake carry several findings. Give the out-of-band category a next action that names operator-supervised execution and forbids `/pan-start` ([validator](src/lib/validators/stage-validators.ts), [31137dbf](https://github.com/alenlukic/pancreator/commit/31137dbf7d41fce6e2abbac0bf52a7ac03c7a73e)).

### Added

- Add the harness repair category registry and its loader ([registry](governance/registries/harness_repair_categories.json), [31137dbf](https://github.com/alenlukic/pancreator/commit/31137dbf7d41fce6e2abbac0bf52a7ac03c7a73e)).
- Validate the category field, filename slug, next-action contract, and multi-finding traceability on each intake ([validator](src/lib/validators/stage-validators.ts), [31137dbf](https://github.com/alenlukic/pancreator/commit/31137dbf7d41fce6e2abbac0bf52a7ac03c7a73e)).

## [5.20.0] - 2026-09-11

### Changed

- Capture one shared deterministic pre-edit baseline per unit of work. A cohort session shares one baseline per interior gate profile: the first run captures it, and later runs adopt it ([DEV-001](governance/policies/DEV-001.json), [ec77e424](https://github.com/alenlukic/pancreator/commit/ec77e42483701e7a0497bb817821c511cd647a30)).
- Iterate implement and remediate agents on the impacted profile plus their added tests. Each agent runs the fast profile once as final validation and never runs the full profile ([DEV-001](governance/policies/DEV-001.json), [REMED-001](governance/policies/REMED-001.json), [VERIFY-001](governance/policies/VERIFY-001.json), [ec77e424](https://github.com/alenlukic/pancreator/commit/ec77e42483701e7a0497bb817821c511cd647a30)).
- Run the full profile only as the release gate of the ship stage. A failure routes to remediate and returns to ship, at most twice, and a third failure pauses the run for the operator ([SHIP-001](governance/policies/SHIP-001.json), [config](config.json), [ec77e424](https://github.com/alenlukic/pancreator/commit/ec77e42483701e7a0497bb817821c511cd647a30)).
- Remove the full profile from the verify and remediate submission gates ([VERIFY-001](governance/policies/VERIFY-001.json), [ec77e424](https://github.com/alenlukic/pancreator/commit/ec77e42483701e7a0497bb817821c511cd647a30)).
- Bind VERIFY-001 to the reviewer and qa-tester personas on every verify stage ([lookup table](governance/registries/policy_lookup_table.json), [ec77e424](https://github.com/alenlukic/pancreator/commit/ec77e42483701e7a0497bb817821c511cd647a30)).

### Added

- Add the optional `entry_gate` stage field: a shell criterion the harness runs when a run enters the stage, before it delegates the worker. The ship stage declares the full profile here as its release gate ([stage schema](library/schemas/stage.schema.json), [ec77e424](https://github.com/alenlukic/pancreator/commit/ec77e42483701e7a0497bb817821c511cd647a30)).

## [5.19.0] - 2026-09-09

### Changed

- Give `COMMS-001` ownership of operator chat output. Move those rules out of `STE-001`, `BRIEF-001`, and `OUTPUT-001` ([COMMS-001](governance/policies/COMMS-001.json), [db2cf7a4](https://github.com/alenlukic/pancreator/commit/db2cf7a47a8bec9252239b2dcb5fc0efce7e1e6a)).
- Bind TypeScript and Python style handbooks to `TSTYLE-001` and `PYSTYLE-001` on the librarian style mode only ([TSTYLE-001](governance/policies/TSTYLE-001.json), [PYSTYLE-001](governance/policies/PYSTYLE-001.json), [65ed3a5a](https://github.com/alenlukic/pancreator/commit/65ed3a5af3066aae29a00f8944917a31ae013d95)).
- Remove the `## Chat reports` section from the Simplified Technical English handbook ([handbook](governance/handbooks/writing/simplified-technical-english.md), [db2cf7a4](https://github.com/alenlukic/pancreator/commit/db2cf7a47a8bec9252239b2dcb5fc0efce7e1e6a)).
- Direct `/pan-build-docs` to emit a split `LANGSTYLE-001` bundle. Preserve a conforming split bundle on install ([pan-build-docs](library/cursor/commands/pan-build-docs.md), [install-support](bin/install-support), [65ed3a5a](https://github.com/alenlukic/pancreator/commit/65ed3a5af3066aae29a00f8944917a31ae013d95), [7c21d05a](https://github.com/alenlukic/pancreator/commit/7c21d05a8f71215b5e3e1356669c577666646231)).

### Added

- Add `./bin/pan style scan|checkpoint` and `/pan-style` for judgment-level code style repair ([code-style](src/lib/code-style.ts), [pan-style](library/cursor/commands/pan-style.md), [65ed3a5a](https://github.com/alenlukic/pancreator/commit/65ed3a5af3066aae29a00f8944917a31ae013d95)).
- Add `CODE-STYLE-VALIDATE-001` for the style mode ([registry](governance/registries/validation_registry.json), [65ed3a5a](https://github.com/alenlukic/pancreator/commit/65ed3a5af3066aae29a00f8944917a31ae013d95)).

### Removed

- Stop delivery personas from resolving style-guide guidance ([lookup table](governance/registries/policy_lookup_table.json), [65ed3a5a](https://github.com/alenlukic/pancreator/commit/65ed3a5af3066aae29a00f8944917a31ae013d95)).

### Fixed

- Preserve a split language bundle across embedded install refresh ([install-support](bin/install-support), [7c21d05a](https://github.com/alenlukic/pancreator/commit/7c21d05a8f71215b5e3e1356669c577666646231)).
- Drop stale `guidance_sources` wording from `PY-001` ([PY-001](governance/policies/PY-001.json), [7c21d05a](https://github.com/alenlukic/pancreator/commit/7c21d05a8f71215b5e3e1356669c577666646231)).

## [5.18.0] - 2026-09-09

### Changed

- Rename the `extreme` named config to `ultra`. Remove the unused `simple` config ([config](config.json), [967268e7](https://github.com/alenlukic/pancreator/commit/967268e7)).

### Added

- Add `--force` to `pan models --sync`. A stale local catalog does not block projection ([cli](src/cli.ts), [dd378938](https://github.com/alenlukic/pancreator/commit/dd378938)).

## [5.17.0] - 2026-09-09

### Changed

- Tag mixed-policy instructions by audience so a delivery card omits operator, librarian, and standalone text ([policy-instructions](src/lib/policy-instructions.ts), [24734b5d](https://github.com/alenlukic/pancreator/commit/24734b5d), [10e043a2](https://github.com/alenlukic/pancreator/commit/10e043a2)).
- Split primer-only librarian rules onto `LIBRARIAN-001`. Restrict generated `LANG-001` rows to target installs ([8f3de05f](https://github.com/alenlukic/pancreator/commit/8f3de05f)).
- Keep unique supervisor rules in the orchestrator brief. Stop `/pan-start` and `/pan-resume` from a second read of `orchestrator.md` ([orchestrator](library/personas/orchestrator.md), [8f3de05f](https://github.com/alenlukic/pancreator/commit/8f3de05f)).
- Move AGENTS.md author text to `docs/workflow-authoring.md` ([workflow-authoring](docs/workflow-authoring.md), [8f3de05f](https://github.com/alenlukic/pancreator/commit/8f3de05f)).
- Record that the operator waived the second verify, review, and QA after the remediator. The remediator full suite also did not run ([8f3de05f](https://github.com/alenlukic/pancreator/commit/8f3de05f)).
- Keep `docs/issues/` inside the `STE-001` writing rules, in the policy and in the handbook ([STE-001](governance/policies/STE-001.json), [handbook](governance/handbooks/writing/simplified-technical-english.md), [3cc4ba41](https://github.com/alenlukic/pancreator/commit/3cc4ba41), [30526852](https://github.com/alenlukic/pancreator/commit/30526852)).
- Refresh the target repository primer at the post-merge head ([primer](docs/target-repo-primer.md), [f50b1538](https://github.com/alenlukic/pancreator/commit/f50b1538)).
- Record that five review rounds ran before this release. Twenty-three non-blocking findings stay open ([297019c7](https://github.com/alenlukic/pancreator/commit/297019c7)).

### Added

- Add `pan conform` scan and checkpoint with `/pan-conform`. The command runs at the installation root, and it reports `CHANGELOG.md` without an edit. No target-tracked path is editable ([conform](src/lib/conform.ts), [c024aa31](https://github.com/alenlukic/pancreator/commit/c024aa31), [3cc4ba41](https://github.com/alenlukic/pancreator/commit/3cc4ba41), [8816e8ad](https://github.com/alenlukic/pancreator/commit/8816e8ad)).
- Add three registry-integrity checks so `pan validate` fails when a policy reaches no card. A harness citation must name a declared test ([validation](src/lib/validation.ts), [0d98b291](https://github.com/alenlukic/pancreator/commit/0d98b291), [81bdbf2f](https://github.com/alenlukic/pancreator/commit/81bdbf2f)).
- Add a committed best-of-N configs example and name it in the best-of-N documentation ([template](library/templates/best-of-n-config.example.json), [best-of-n](docs/best-of-n.md), [d869b910](https://github.com/alenlukic/pancreator/commit/d869b910)).

### Fixed

- Restore unique orchestrator rules for cohort status, `models --probe`, `--no-autostart`, and the decision packet ([orchestrator](library/personas/orchestrator.md), [8f3de05f](https://github.com/alenlukic/pancreator/commit/8f3de05f)).
- Add `OUTPUT-001` to the orchestrator `EXECUTOR-001` row. Add an unscoped `TEST-001` row for spotfixer so a target install loads it with `LANG-001` ([8f3de05f](https://github.com/alenlukic/pancreator/commit/8f3de05f)).
- Point the 4.0.0 configs link at the committed template, because the earlier link named an untracked file ([42bae507](https://github.com/alenlukic/pancreator/commit/42bae507)).

## [5.16.0] - 2026-09-08

### Changed

- Place named-configuration persona keys beside `summary`. Keep the nested `personas` object as compatibility input only ([config](config.json), [1fac9772](https://github.com/alenlukic/pancreator/commit/1fac9772)).
- Store expanded model specifications in snapshots, projections, and installer output ([pipeline-config](src/lib/pipeline-config.ts), [1fac9772](https://github.com/alenlukic/pancreator/commit/1fac9772)).
- Preserve operator mappings across override migration and embedded install refresh ([migration](src/lib/pipeline-config-migration.ts), [install-support](bin/install-support), [1fac9772](https://github.com/alenlukic/pancreator/commit/1fac9772)).
- Document reserved `cursor` tier names, undefined-tier errors, and legacy nested precedence ([operator guide](docs/operator-guide.md), [1fac9772](https://github.com/alenlukic/pancreator/commit/1fac9772)).
- Refresh the target-repository primer and the generated JavaScript and TypeScript language handbooks ([97936ad0](https://github.com/alenlukic/pancreator/commit/97936ad0)).

### Added

- Add four model alias maps and resolve `<family>:<tier>` persona mappings to exact configured specifications ([config](config.json), [schema](library/schemas/config.schema.json), [1fac9772](https://github.com/alenlukic/pancreator/commit/1fac9772)).

### Fixed

- Remove the undeclared `TEST-001` reference from the generated TypeScript target handbook ([c30d2a15](https://github.com/alenlukic/pancreator/commit/c30d2a15)).

## [5.15.0] - 2026-09-07

### Changed

- Raise the `delivery` fast and full gate bounds to 1200 s to match `delivery-chunk` ([implement](library/workflows/delivery/stages/implement.json), [verify](library/workflows/delivery/stages/verify.json), [remediate](library/workflows/delivery/stages/remediate.json)).
- List commit, push, merge, publication, deployment, branch deletion, and gate waivers as the actions away mode never runs. Permit the `COHORT-001` plan route to create branches and worktrees under an away-mode approval ([AWAY-001](governance/policies/AWAY-001.json), [COHORT-001](governance/policies/COHORT-001.json)).
- Split every over-length `COHORT-001` sentence, including the routing and release rules, into one-obligation sentences ([COHORT-001](governance/policies/COHORT-001.json)).
- Name `planning` as the default systematic workflow in the embedded and detached operating cards. Drop `--workflow delivery` from the installer's post-install next step ([embedded card](library/templates/embedded-AGENTS.md), [detached card](library/templates/detached-AGENTS.md), [install](bin/install)).
- Render the `cohort integrate` autostart kinds as a list in the orchestrator brief and remove every semicolon from the supervisor procedures ([pan-cohort](library/cursor/commands/pan-cohort.md), [pan-start](library/cursor/commands/pan-start.md), [orchestrator](library/personas/orchestrator.md)).
- Replace the duplicated autostart bullets of `pan-cohort` with a reference to **Cohort supervision** step 8 of the orchestrator brief ([pan-cohort](library/cursor/commands/pan-cohort.md)).
- State that `pan cohort status <cohort-id>` reports `release_command` after a failed release continuation. The command is the merge-free `pan cohort release <cohort-id>`, and running it restarts the continuation ([pan-cohort](library/cursor/commands/pan-cohort.md), [orchestrator](library/personas/orchestrator.md), [operator guide](docs/operator-guide.md)).
- Raise the `delivery-candidate` fast and full gate bounds to 1200 s to match the other concurrent worktree workflows. Name it in the primer's gate-budget note ([implement](library/workflows/delivery-candidate/stages/implement.json), [verify](library/workflows/delivery-candidate/stages/verify.json), [remediate](library/workflows/delivery-candidate/stages/remediate.json), [primer](docs/target-repo-primer.md)).
- Split the over-length review-squad instructions and rewrap the selection paragraph ([pan-review](library/cursor/commands/pan-review.md), [shepherd-reviewer](library/personas/shepherd-reviewer.md), [shepherd-reviewer agent](library/cursor/agents/shepherd-reviewer.md), [review-squad](library/skills/review-squad.md)).
- Share one live-run definition between agent-run check evidence and release preparation, and add `pan repository-check --run <run-id>` to record evidence against one named run ([state](src/lib/state.ts), [repository-checks](src/lib/repository-checks.ts), [release-preparation](src/lib/release-preparation.ts)).
- Read repository-check capture files bounded from the open descriptors, and remove the capture directory before a timeout kill ([repository-checks](src/lib/repository-checks.ts)).
- Drop the `timeout_ms` that 5.14.0 added to the self-development `fast` profile template. Stage gate bounds are the only timeout authority once `runtime/repository-checks.json` is regenerated ([template](library/templates/repository-checks.self-development.json)).
- Report the delivery autostart the eval run performed, with its kind, status, and commands. Stop describing every autostart as a cohort autostart ([evals](src/lib/evals/run.ts), [schema](library/schemas/eval-scenario.schema.json)).
- Report conditional review dimensions on the default-lineup review card as resolved by the coordinator instead of as not run. Under a `--dimensions` selection, list every unselected conditional dimension as not run and drop the coordinator-resolved line, so a selection is never widened ([review-dimensions](src/lib/review-dimensions.ts), [governance-card](src/lib/governance-card.ts)).
- Refuse an empty list on `--dimensions`, `--criteria`, and `--defer` instead of reading it as none ([cli](src/cli.ts)).
- Pass the installation root to every `cursor-agent` spawn as `installationRoot`, separate from the child working directory ([cursor-agent](src/lib/executors/cursor-agent.ts)).
- Convert the four long `/pan-review` steps and the `/pan-start` init-options step into lead sentences with nested bullets ([pan-review](library/cursor/commands/pan-review.md), [pan-start](library/cursor/commands/pan-start.md)).
- Split the selection-recording sentence of the harness review lineup that still exceeded the instruction length ([review-squad-pancreator](library/skills/review-squad-pancreator.md)).
- Name `evaluator_failure` records among the ledger kinds `AWAY-001` requires ([AWAY-001](governance/policies/AWAY-001.json)).
- Record the routing rule's surfaces as a retained duplication in the context-bloat dispositions: the policy, the orchestrator brief, the `/pan-start` command, the primer, and the two operating cards. Credit `COHORT-001` only with the rules it states and attribute the `--workflow delivery` escape hatch to the agent-facing surfaces that carry it ([dispositions](governance/registries/context_bloat_dispositions.json)).
- Convert the `/pan-review` governance-card step into a lead sentence with nested bullets ([pan-review](library/cursor/commands/pan-review.md)).
- Split the shepherd-reviewer **Inputs** paragraph and the shepherd-reviewer agent body into paragraphs of at most six sentences ([shepherd-reviewer](library/personas/shepherd-reviewer.md), [shepherd-reviewer agent](library/cursor/agents/shepherd-reviewer.md)).
- Rewrap the selection paragraph of the harness review lineup, and scope the slug sentence of the squad procedure to its two lineup tables ([review-squad-pancreator](library/skills/review-squad-pancreator.md), [review-squad](library/skills/review-squad.md)).
- Tell the supervisor to run the listed `pan cohort route --plan-run <id>` once after a failed plan route, and to stop and report it when it fails again ([orchestrator](library/personas/orchestrator.md), [pan-resume](library/cursor/commands/pan-resume.md)).
- Write the derived target into the `/pan-review` request file whenever `$ARGUMENTS` names no target, not only when it is empty ([pan-review](library/cursor/commands/pan-review.md)).
- State that `pan cohort release` creates the `release-<digest>` worktree and branch when no worktree holds the integration branch, and merges nothing ([operator guide](docs/operator-guide.md)).
- Split the `/pan-build-docs` setup sentence into short sentences and state which runs skip setup ([pan-build-docs](library/cursor/commands/pan-build-docs.md), [evals](docs/evals.md)).

### Fixed

- Replace the retired `gpt-5.4` in the test fixtures with `gpt-5.6-terra`, and align every fixture model spec with the variants the current Cursor catalog declares, so the suite passes against a refreshed account-local catalog ([best-of-n helpers](tests/integration/best-of-n-helpers.ts), [pipeline-config tests](tests/unit/pipeline-config.test.ts), [projection tests](tests/unit/projection.test.ts), [run-friction tests](tests/regression/run-friction.test.ts)).
- Add `pan cohort release <cohort-id>`, the merge-free release continuation. It refuses with `COHORT_NOT_SATISFIED` while a cohort lacks its merge proof, and it starts or adopts the release run otherwise ([cohorts](src/lib/cohorts.ts), [cli](src/cli.ts)).
- Accept `evaluator_failure` records in the away decision ledger validator, so one failed evaluator spawn no longer fails every later ledger check ([autonomy-state](src/lib/validators/autonomy-state.ts)).
- Run the repository-check `setup` commands once per run in a worktree workspace, for any start stage, before baseline capture, when a stage of the workflow needs a provisioned tree. Record the outcome on the run as `workspace_setup` with status `passed`, `failed`, or `not_configured`, so a release run starting at `verify` is provisioned and a `planning` run runs no setup ([engine](src/lib/engine.ts), [types](src/lib/types.ts)).
- Treat a worktree run that captured repository-check baselines before `workspace_setup` existed as provisioned, so an upgrade does not reinstall its dependencies ([engine](src/lib/engine.ts)).
- Set the `repository_check_fast_repeated` allowance from the stage's declared evidence worker count instead of one, so two compliant verify workers no longer trip it ([repository-checks](src/lib/repository-checks.ts)).
- Adopt an indexed chunk worktree and its live run inside `pan cohort start`, so a retry after a crash between worktree and run creation no longer fails with `WORKTREE_EXISTS` ([cohorts](src/lib/cohorts.ts)).
- Name the evaluator evidence files and the `pan decide` recovery command in the `AWAY_EVALUATOR_FAILURE_LIMIT` refusal. Build that command from the installation's resolved `pan` command, so it runs in embedded and detached installations ([away-mode](src/lib/away-mode.ts)).
- Write the planner's digest command bare as `pan context digest`, run from the harness root, so an embedded planner can run it. Name the card's **Harness root** line when present and the **Workspace** otherwise, so a default-workspace planner finds the root ([plan prompt](library/workflows/planning/prompts/plan.md)).
- Refuse a missing or flag-shaped positional on the `cohort` subcommands and `context digest` with `INVALID_ARGUMENT`, so `pan cohort release --json` reports the missing cohort id instead of `INVALID_COHORT_ID` ([cli](src/cli.ts)).
- Prove through the CLI that a bare `pan repository-check` records no run evidence and `--run` records one line ([worktree-cli tests](tests/integration/worktree-cli.test.ts)). Scope the `--worktree` recording help line to the no-`--run` case ([cli](src/cli.ts)).
- Name `pan cohort release <cohort-id>` as the merge-free retry of a failed release continuation and as the value of `release_command`. Describe `pan cohort integrate` only as the operator-owned merge ([orchestrator](library/personas/orchestrator.md), [pan-cohort](library/cursor/commands/pan-cohort.md), [operator guide](docs/operator-guide.md), [primer](docs/target-repo-primer.md)).
- Describe the release run in the workflow-authoring routing table as the other surfaces do. It runs in a managed worktree on a `release-<digest>` branch, or in the recorded `--into-branch` worktree ([workflow authoring](docs/workflow-authoring.md)).
- State in the orchestrator **Start** rule that a `/pan-qa-workflow` session passes the workflow its command names. Render the workflow choices as nested bullets ([orchestrator](library/personas/orchestrator.md)).
- Document that the `AWAY_EVALUATOR_FAILURE_LIMIT` refusal names the evaluator exchange records and the `pan decide` recovery, so the next action is a hand decision ([runtime protocol](docs/runtime-protocol.md)).
- Qualify the `delivery-chunk` rule of `COHORT-001` to plans of two or more units, and state that a single-unit `delivery` run carries its own `ship` stage ([COHORT-001](governance/policies/COHORT-001.json)).
- Document `run_evidence_paths` on the `pan repository-check` JSON response, and describe the `repository_check_fast_repeated` allowance as the stage's `evidence_workers` count ([runtime protocol](docs/runtime-protocol.md)).
- State that workspace setup runs once per run at the start stage and is recorded on the run as `workspace_setup` ([evals](docs/evals.md)).

- Complete a half-recorded release continuation on a repeated `pan cohort integrate`, and adopt an existing release run instead of failing with `COHORT_COMPLETE` ([cohorts](src/lib/cohorts.ts)).
- Adopt the delivery run a single-chunk autostart already created when the handoff record was lost, so a retry creates no second run ([cohorts](src/lib/cohorts.ts)).
- Record no `failed` away decision beside an `applied` one when the routing hook fails after `pan away apply` ([cli](src/cli.ts)).
- Keep `--dimensions` on the conduct-conflict card rebuild in `/pan-review`, and state that the selection list carries no spaces ([pan-review](library/cursor/commands/pan-review.md)).
- Record the `5.14.0` release-index mapping and the 1200 s `full` gate bound in the primer ([primer](docs/target-repo-primer.md)).
- Correct the 5.14.0 entry: its 1200 s bound covered `delivery-chunk` only. The same release raised the `delivery` fast gate bound from 300 s to 600 s ([changelog](CHANGELOG.md)).
- Describe the release run so it always runs in a managed worktree. That worktree is the recorded `--into-branch` worktree or a new `release-<digest>` worktree created from the integration head. Name `--worktree` on its release commands ([operator guide](docs/operator-guide.md), [COHORT-001](governance/policies/COHORT-001.json)).
- Print one idempotent `pan cohort release <cohort-id>` as the manual command of a failed release continuation. Replace the `init` and `set-stage` pair the harness could never adopt ([cohorts](src/lib/cohorts.ts)).
- Compute the manual commands of a failed cohort route from the session that exists at failure time. Refuse a second cohort session for one plan run with `COHORT_SESSION_EXISTS` ([cohorts](src/lib/cohorts.ts)).
- Bind the release run to the cohort session with `role: release` and its integration record, list the integration record and the chunk runs' verify outputs as its required references, and stop reporting the `implement` output as missing on it ([cohorts](src/lib/cohorts.ts), [context](src/lib/context.ts), [render](src/lib/render.ts), [verify prompt](library/workflows/delivery/prompts/verify.md)).
- Create a managed worktree for the release run when no recorded worktree holds the integration branch. Its `pan release` commands then have a `--worktree` to name ([cohorts](src/lib/cohorts.ts)).
- Report `release_command` from `pan cohort status` when every cohort is satisfied and no release run is recorded. It names the merge-free `pan cohort release <cohort-id>` ([cohorts](src/lib/cohorts.ts), [render](src/lib/render.ts)).
- Persist a failed plan route on the plan run as a `failed` delivery handoff and render it in `pan status` with its manual commands ([cohorts](src/lib/cohorts.ts), [types](src/lib/types.ts), [render](src/lib/render.ts)).
- Record an agent-run `pan repository-check <profile>` as run evidence only when the command names `--run <run-id>` or `--worktree <name>`. A bare invocation records nothing, so a standalone review can run checks without writing run state ([repository-checks](src/lib/repository-checks.ts), [cli](src/cli.ts)).
- Add `invocation_id` to each agent check evidence record. Report the `repository_check_fast_repeated` advisory from `pan output validate` when one invocation ran `fast` more than once ([repository-checks](src/lib/repository-checks.ts), [cli](src/cli.ts)).
- Print the exact `pan repository-check fast --run <run-id>` command on the evidence worker brief only when no gate passed `fast` at the current fingerprint. Otherwise tell the worker to cite the gate evidence. Name the harness root the command runs from ([render](src/lib/render.ts)).
- Add `pan cohort route --plan-run <run-id>` as the one idempotent retry of a failed plan route. It adopts the run or session the failed attempt created, and every failed route prints it as the only manual command ([cohorts](src/lib/cohorts.ts), [cli](src/cli.ts)).
- Record the cohort handoff on the plan run from `cohort init`, so a hand-run init replaces a `failed` route record ([cohorts](src/lib/cohorts.ts)).
- Return a `failed` route with the `pan cohort route` command for a `planning` run that predates routing and recorded no opt-in or opt-out, instead of starting nothing silently ([cohorts](src/lib/cohorts.ts)).
- List each chunk's child specification as a required reference of the release run, so its verify stage grades the acceptance criteria and validation cases the card names ([context](src/lib/context.ts), [verify prompt](library/workflows/delivery/prompts/verify.md)).
- Adopt an existing release run by its recorded `role: release` binding instead of by parsing the first event line ([cohorts](src/lib/cohorts.ts), [state](src/lib/state.ts)).
- Slice the whole `governance card` and `governance review-scope` help stanzas into the review-scope entry-point check, and prove the check against the real `src/cli.ts` ([review-scope](src/lib/review-scope.ts), [review-scope tests](tests/unit/review-scope.test.ts)).
- Refuse a `pan context digest` positional that starts with `--`, and report a directory as `CONTEXT_REFERENCE_NOT_FOUND` with its repository-relative path ([cli](src/cli.ts)).
- Add `pan context digest <path> [--json]` and have the planner take the child-specification digest from it instead of computing it by hand ([cli](src/cli.ts), [plan prompt](library/workflows/planning/prompts/plan.md)).
- Pre-filter live-run scans on the materialized `state.json` before reading event logs ([state](src/lib/state.ts), [cohorts](src/lib/cohorts.ts)).
- Cover the `commaSeparatedOption` helper and the `governance card` help lines in the review-scope entry-point check ([review-scope](src/lib/review-scope.ts)).
- Refuse a `--dimensions` value with an empty segment, such as `security,`, with `INVALID_ARGUMENT` ([cli](src/cli.ts)).
- State that `pan status <plan-run-id>` shows `Delivery route failed` with the manual commands after a failed plan route ([operator guide](docs/operator-guide.md)).
- Qualify the named core charter of the harness review lineup to the no-selection case. A `--dimensions` selection is then the only rule for the lineup ([review-squad-pancreator](library/skills/review-squad-pancreator.md)).
- Report the conditional dimensions the target did not activate in the `/pan-review` report. Also report any charter the coordinator applied itself ([pan-review](library/cursor/commands/pan-review.md)).
- Split the over-length selection-recording instruction of the harness review lineup into one-obligation sentences ([review-squad-pancreator](library/skills/review-squad-pancreator.md)).
- Name the release run's branch as the code creates it. It is a `release-<digest>` branch from the integration head, or the integration branch when `--into-branch` recorded a worktree for it. Tell the operator to merge that branch into the integration branch after ship ([COHORT-001](governance/policies/COHORT-001.json), [orchestrator](library/personas/orchestrator.md), [operator guide](docs/operator-guide.md), [primer](docs/target-repo-primer.md)).
- Split the failed continuation of **Cohort supervision** step 8 by kind. A failed cohort continuation reports `start_command`, and a failed release continuation reports `release_command` ([orchestrator](library/personas/orchestrator.md)).
- Replace the passive sentence on top-level supervision of started runs with active one-obligation sentences ([orchestrator](library/personas/orchestrator.md)).
- Name `--workflow delivery` in the `/pan-start` workflow step as the escape hatch the brief already allows ([pan-start](library/cursor/commands/pan-start.md)).
- Qualify the `timeout_ms` entry: stage gate bounds become the only timeout authority once `runtime/repository-checks.json` is regenerated ([changelog](CHANGELOG.md)).
- Document `pan cohort route --plan-run <plan-run-id>` as the one idempotent retry of a failed plan route, for a single chunk and a cohort alike. Replace the `pan init --workflow delivery` and `pan cohort init` recovery text with it ([operator guide](docs/operator-guide.md)).
- Document the failed route a pre-routing `planning` run returns on approval and the `pan cohort route` command that routes it ([operator guide](docs/operator-guide.md)).
- State that repository-check evidence is recorded only with `--run` or `--worktree` and carries the `invocation_id`. Name the `pan output validate` advisory diagnostic for an invocation that ran `fast` twice ([runtime protocol](docs/runtime-protocol.md), [operator guide](docs/operator-guide.md)).
- Describe the evidence-worker brief: it names the harness root and asks for `fast` only when no gate already passed it ([runtime protocol](docs/runtime-protocol.md), [operator guide](docs/operator-guide.md)).

## [5.14.0] - 2026-09-05

### Changed

- Bind each cohort chunk run to its worktree so later lifecycle commands accept `--worktree` on that run ([cohorts](src/lib/cohorts.ts), [4566eff9](https://github.com/alenlukic/pancreator/commit/4566eff9)).
- Seed cohort ids from the plan-run suffix instead of the parent-specification basename ([4566eff9](https://github.com/alenlukic/pancreator/commit/4566eff9)).
- Send the `cursor-agent` prompt over stdin so a large argv element is not killed at exec ([cursor-agent](src/lib/executors/cursor-agent.ts), [44ca8f1e](https://github.com/alenlukic/pancreator/commit/44ca8f1e)).
- Show the literal away-mode option shape in the evaluator prompt, persist every evaluator exchange as run evidence, and rank options by fitness for the gate ([away-mode](src/lib/away-mode.ts), [44ca8f1e](https://github.com/alenlukic/pancreator/commit/44ca8f1e)).
- Consume an away-mode decision only after a successful apply, and start the cohort with `--autostart` when away mode approves a planning gate ([COHORT-001](governance/policies/COHORT-001.json), [operator guide](docs/operator-guide.md), [44ca8f1e](https://github.com/alenlukic/pancreator/commit/44ca8f1e)).
- Capture repository-check output to files, lead a process group, and kill the group on timeout. Raise the fast and full gate bounds of `delivery-chunk` to 1200 s, and the `delivery` fast gate bound from 300 s to 600 s ([repository-checks](src/lib/repository-checks.ts), [44ca8f1e](https://github.com/alenlukic/pancreator/commit/44ca8f1e)).
- Name the workspace and worktree in evidence-worker briefs ([render](src/lib/render.ts), [44ca8f1e](https://github.com/alenlukic/pancreator/commit/44ca8f1e)).
- Validate a child-specification parent digest on the trimmed file and name the expected digest ([cohort-plan](src/lib/validators/cohort-plan.ts), [c64b0d60](https://github.com/alenlukic/pancreator/commit/c64b0d60)).
- Authenticate away-mode `cursor-agent` spawns through the same `probeEnvironment` path as the model probe ([cursor-auth](src/lib/executors/cursor-auth.ts), [4566eff9](https://github.com/alenlukic/pancreator/commit/4566eff9)).

### Added

- Add `cohort integrate --into-branch` so integration can target a dedicated branch when a dirty checkout holds the base ([cohorts](src/lib/cohorts.ts), [44ca8f1e](https://github.com/alenlukic/pancreator/commit/44ca8f1e)).
- Credit a changed source that a changed test imports in `pan tests impacted` ([test-impact](src/lib/test-impact.ts), [44ca8f1e](https://github.com/alenlukic/pancreator/commit/44ca8f1e)).
- Write `integration-<n>.json` for every cohort integration path, including the multi-chunk reconcile merge ([COHORT-001](governance/policies/COHORT-001.json), [c64b0d60](https://github.com/alenlukic/pancreator/commit/c64b0d60)).
- Record `pan repository-check --worktree` runs in the bound run's `agent/evidence/repository-check-runs.jsonl` ([repository-checks](src/lib/repository-checks.ts), [c64b0d60](https://github.com/alenlukic/pancreator/commit/c64b0d60)).
- Record evaluator failures as `evaluator_failure` with their own ceiling instead of consuming `max_decisions_per_run` ([away-mode](src/lib/away-mode.ts), [4566eff9](https://github.com/alenlukic/pancreator/commit/4566eff9)).

### Fixed

- Deduplicate colliding inbox terminal names with a numeric suffix ([inbox](src/lib/inbox.ts), [44ca8f1e](https://github.com/alenlukic/pancreator/commit/44ca8f1e)).
- Keep fixtures whose path contains `worktrees` sandboxed from the installation root ([repository-checks](src/lib/repository-checks.ts), [4566eff9](https://github.com/alenlukic/pancreator/commit/4566eff9)).
- Document the autostart response as `{status, chunks, …}` and name `pan init --request` in the supervisor procedure ([operator guide](docs/operator-guide.md), [pan-start](library/cursor/commands/pan-start.md), [c64b0d60](https://github.com/alenlukic/pancreator/commit/c64b0d60)).

## [5.13.1] - 2026-09-04

### Changed

- Give every test run one scratch directory under `runtime/tmp/tests/` that `bin/run-tests` removes when the run ends, and sweep directories left by runs that died. Fixtures never touch the shared OS temp directory, which had accumulated 166,000 leaked entries and slowed every create and unlink there for every program on the host ([run-tests](bin/run-tests), [temp](tests/temp.ts), [d7ae30f4](https://github.com/alenlukic/pancreator/commit/d7ae30f4)).
- Fence git discovery and Node module-type resolution at the scratch directory, so a fixture without its own repository or `package.json` behaves as it did in the shared temp directory rather than inheriting this checkout's ([run-tests](bin/run-tests)).
- Move the build lock to `runtime/build/` and the `run-quiet` capture files to `runtime/tmp/`, so no `pan` invocation touches the shared temp directory. Pair the lock owner's pid with its start time and bound the wait, so an orphaned lock can never wedge a root ([run-built](bin/run-built), [run-quiet](bin/run-quiet), [a82d3eaf](https://github.com/alenlukic/pancreator/commit/a82d3eaf)).

### Added

- Reject `tmpdir()` under `tests/` in `pan validate`, so the leak cannot recur ([test-scratch-audit](src/lib/test-scratch-audit.ts), [TP-09](governance/handbooks/eng/testing.md)).

### Fixed

- `pan --help` fell from 7.97s to 0.21s and `pan models --sync` from 3.21s to 0.23s once the wrappers stopped mutating the shared temp directory ([a82d3eaf](https://github.com/alenlukic/pancreator/commit/a82d3eaf)).

## [5.13.0] - 2026-09-03

### Changed

- Build into a staging directory and swap it into `dist` atomically. Serialize only the compile step behind a file lock, and report a holder that keeps the lock past five seconds. Wrapped commands no longer register as `dist` readers, so a long `pan watch` can no longer block every later build ([build](bin/build), [run-built](bin/run-built)).
- Observe the whole run tree and the workspace Git activity on every `pan watch` wake, so a worker that edits source or nested evidence is no longer called stalled. Keep wakes on an absolute schedule ([watch](src/lib/watch.ts), [git](src/lib/git.ts)).
- Bind every worktree record and every cohort session to the Git repository it belongs to, so a plan run against another workspace fans out into that repository ([worktrees](src/lib/worktrees.ts), [cohorts](src/lib/cohorts.ts)).
- Run each cohort chunk through the `delivery-chunk` workflow, which ends at a verified implementation and carries no ship stage ([delivery-chunk](library/workflows/delivery-chunk/workflow.json)).
- Permit one supervisor session to launch and observe the workers of several cohort runs in one message, foreground and within the parallelism limit ([COHORT-001](governance/policies/COHORT-001.json), [DELEGATE-001](governance/policies/DELEGATE-001.json), [ORCH-001](governance/policies/ORCH-001.json), [orchestrator](library/personas/orchestrator.md)).
- Move the specification hierarchy and cohort rules out of `PLAN-002` into `COHORT-001`, so a best-of-N candidate planner no longer receives chunking rules that do not apply to it ([PLAN-002](governance/policies/PLAN-002.json), [COHORT-001](governance/policies/COHORT-001.json)).
- Locate the plan from the card in the shared delivery prompts, so a candidate stage resolves the plan it was given instead of assuming the request is the plan ([implement](library/workflows/delivery/prompts/implement.md), [verify](library/workflows/delivery/prompts/verify.md)).
- Scope spotfixer test selection: iterate on the impacted profile plus added tests, run `fast` exactly once as final validation, and never run `full` ([SPOT-001](governance/policies/SPOT-001.json), [spotfix skill](library/skills/spotfix.md), [spotfixer](library/personas/spotfixer.md)).
- Require a named judgment cohort whenever a changed path reaches no impacted test ([DEV-001](governance/policies/DEV-001.json), [REMED-001](governance/policies/REMED-001.json), [VERIFY-001](governance/policies/VERIFY-001.json)).
- State that the gate cache is harness-owned and that agents do not set or clear `PAN_GATE_CACHE`, which an agent-run `repository-check` never consults ([REPO-001](governance/policies/REPO-001.json)).

### Added

- Add `--max-parallel` to `pan cohort init` and to `pan init --autostart`, and start a wide cohort in batches that fill only the free slots ([cohorts](src/lib/cohorts.ts), [cli](src/cli.ts)).
- Add the `/pan-cohort` supervisor command for every live chunk run of a session ([pan-cohort](library/cursor/commands/pan-cohort.md)).
- Add `--run` and `--worktree` to `pan requirements run` so a check binds to that workspace ([cli](src/cli.ts)).
- Add the `planning-cohort-fanout` eval scenario, the `cohort-fanout` grader, and the `cohort` scenario field that autostarts the fan-out on approval ([scenario](evals/scenarios/planning-cohort-fanout.json), [graders](src/lib/evals/graders.ts), [evals](docs/evals.md)).
- Select impacted tests for changes under `governance/`, `library/`, `docs/`, and configuration, which the import-graph selector could not reach before, and report an entirely unmapped change set as an explicit advisory ([test-impact](src/lib/test-impact.ts)).

### Fixed

- Name the valid kinds in the `UNKNOWN_INVOCATION_KIND` error ([cli](src/cli.ts)).
- Run the cohort fan-out through the resolved `pan` command instead of a hard-coded `./bin/pan`, so a fan-out works in an embedded or detached installation ([cohorts](src/lib/cohorts.ts)).
- Append the new cohort instructions to `ORCH-001` and `DELEGATE-001` instead of inserting them mid-array, so existing citations by instruction number keep pointing at the text they cite ([ORCH-001](governance/policies/ORCH-001.json), [DELEGATE-001](governance/policies/DELEGATE-001.json)).
- Correct the operator and authoring guides to name the `delivery-chunk` run per chunk, and to supervise a cohort with `/pan-cohort` rather than `/pan-resume` ([operator guide](docs/operator-guide.md), [workflow authoring](docs/workflow-authoring.md)).
- Make the watch unit tests independent of suite load through an injected clock, and round the watch cadence and timeout to whole milliseconds ([watch](src/lib/watch.ts), [watch tests](tests/unit/watch.test.ts)).

## [5.12.0] - 2026-09-03

### Changed

- Move planning out of delivery into a separate planning workflow with one operator-gated plan stage ([482cd150](https://github.com/alenlukic/pancreator/commit/482cd150460e221ac505333426d157a157807a34), [planning workflow](library/workflows/planning/workflow.json)).
- Start new delivery runs at implement. In-flight runs keep their snapshotted graph ([delivery workflow](library/workflows/delivery/workflow.json)).
- Deliver each chunk request as a child specification. Deliver the parent as an audited context reference ([context](src/lib/context.ts)).

### Added

- Add `pan cohort` commands for init, start, status, integrate, abandon, and clean ([cohorts](src/lib/cohorts.ts)).
- Add `--autostart` on a planning run so approval starts cohort 1 ([cli](src/cli.ts)).
- Add policy COHORT-001 and the cohort-plan and child-specification validators ([COHORT-001](governance/policies/COHORT-001.json)).
- Add a shared-item disposition so a cross-cutting requirement can belong to more than one chunk ([cohort-plan](src/lib/validators/cohort-plan.ts)).

### Removed

- Remove the delivery plan stage from the current delivery graph ([delivery stages](library/workflows/delivery/)).

### Fixed

- Accept a declared shared item in the child-specification validator. Refuse an undeclared double trace ([cohort-plan](src/lib/validators/cohort-plan.ts)).
- Isolate two fixture tests from a local untracked `config_overrides.json` ([best-of-n](tests/integration/best-of-n.test.ts), [pipeline-config](tests/unit/pipeline-config.test.ts)).

## [5.11.1] - 2026-09-03

### Changed

- Allow the harness technician to write several repair intakes when the operator requests more than one, keeping one intake as the default ([REPAIR-001](governance/policies/REPAIR-001.json), [harness technician](library/personas/harness-technician.md)).
- Require one intake for each distinct root cause, and forbid splitting one root cause across two intakes ([harness technician](library/personas/harness-technician.md)).
- Validate every repair intake individually, and report each intake result separately ([pan-repair](library/cursor/commands/pan-repair.md)).
- Bound the repair card to the declared intakes instead of a single intake artifact ([governance card](src/lib/governance-card.ts)).

## [5.11.0] - 2026-09-02

### Changed

- Validate full documents and RFC 7386 revisions through one effective document before preflight and submit ([8c45d60a](https://github.com/alenlukic/pancreator/commit/8c45d60ad19d0f92d85ff61461ec6204b92eadc5)).
- Gate hard criterion states on stable issue codes instead of diagnostic message text ([8c45d60a](https://github.com/alenlukic/pancreator/commit/8c45d60ad19d0f92d85ff61461ec6204b92eadc5)).
- Enforce required plan-file children from the shared field declaration ([8c45d60a](https://github.com/alenlukic/pancreator/commit/8c45d60ad19d0f92d85ff61461ec6204b92eadc5)).

### Added

- Rewrite exact-run inbox references during terminal finalization ([8c45d60a](https://github.com/alenlukic/pancreator/commit/8c45d60ad19d0f92d85ff61461ec6204b92eadc5)).
- Repair historical run-linked inbox aliases through runtime maintenance and report ambiguities ([8c45d60a](https://github.com/alenlukic/pancreator/commit/8c45d60ad19d0f92d85ff61461ec6204b92eadc5)).

### Fixed

- Restore a distinct release-owned active model during installer refresh ([8c45d60a](https://github.com/alenlukic/pancreator/commit/8c45d60ad19d0f92d85ff61461ec6204b92eadc5)).

## [5.10.1] - 2026-09-02

### Fixed

- Skip quiet capture for fresh build stamps, while preserving quiet capture for stale builds ([a2f96cb1](https://github.com/alenlukic/pancreator/commit/a2f96cb17937ef9549e1470fb78a32d5ffc0b57e)).

## [5.10.0] - 2026-09-01

### Changed

- Move inbox items through `queue`, `active`, `complete`, and `canceled` status directories ([inbox](src/lib/inbox.ts), [engine](src/lib/engine.ts)).
- Write new unactioned items to `runtime/inbox/queue` ([52404951](src/lib/inbox.ts)).
- Keep `pan inbox` on queue items and preserve its table and JSON fields ([inbox](src/lib/inbox.ts)).
- Archive expired complete items from the complete directory by default ([workflow-artifacts](src/lib/workflow-artifacts.ts)).

### Added

- Add `--complete` and `--canceled` so `pan archive` can select terminal inbox statuses ([cli](src/cli.ts)).
- Classify legacy direct inbox files into status directories during runtime maintenance ([inbox](src/lib/inbox.ts)).

### Fixed

- Recover a missing active item from stored run evidence before a terminal move ([inbox](src/lib/inbox.ts)).
- Restore a failed claim to the exact original path, including a legacy path ([engine](src/lib/engine.ts)).

## [5.9.0] - 2026-09-01

### Changed

- Accept documented test lanes as DEMOTE destinations in `/pan-tune-harness`, TUNE-001, and the testing handbook ([test-tuning](src/lib/test-tuning.ts), [TUNE-001](governance/policies/TUNE-001.json)).
- Apply the first tune-harness audit: remove 16 redundant tests and fold 38 tests that overlap into survivors ([e1371b07](https://github.com/alenlukic/pancreator/commit/e1371b077e7a8cfc6eecd34774c074479cfb36c5)).
- Point ordinary installer tests at one memoized indexed release fixture. Keep an explicit `--pancreator-root` override ([install-helpers](tests/secondary/install-helpers.ts)).
- Guard the CLI entrypoint so an import of `HELP_BODY` does not run `main` ([cli](src/cli.ts)).

### Added

- Add secondary-lane coverage for installer and compiled projection renderer parity ([projection test](tests/secondary/projection.test.ts)).

### Fixed

- Restore unique contracts that the first audit pass dropped. Cover DEMOTE validator branches and suite-profile attachment ([e1371b07](https://github.com/alenlukic/pancreator/commit/e1371b077e7a8cfc6eecd34774c074479cfb36c5)).
- Change installer fixture versions through parsed JSON instead of blanket text replacement ([install-helpers](tests/secondary/install-helpers.ts)).

## [5.8.0] - 2026-09-01

### Changed

- Isolate target mutations in a named managed worktree and restore a clean recorded branch before the first write ([worktrees](src/lib/worktrees.ts)).
- Bind each delivery run to one managed worktree and reject a later selection that differs ([engine](src/lib/engine.ts)).
- Keep existing worktree records and their registered branches. Use the worktree name as the branch only for new worktrees ([worktrees](src/lib/worktrees.ts)).
- Limit Pancreator fallback PR copy to Summary and Changelist. Keep target templates authoritative ([PR-001](governance/policies/PR-001.json), [pr-description](src/lib/pr-description.ts)).
- Move self-development release preparation through local sync, continue, and finalize before any remote action ([VERSION-001](governance/policies/VERSION-001.json), [SHIP-001](governance/policies/SHIP-001.json)).
- Document `/pan-release` as the local release sequence that ends with PR copy ([README](README.md), [pan-release](library/cursor/commands/pan-release.md)).

### Added

- Add `pan release sync`, `pan release continue`, and `pan release finalize` for local release preparation ([release-preparation](src/lib/release-preparation.ts)).
- Add worktree checks for classified target-mutating commands ([command_governance](governance/registries/command_governance.json)).

### Fixed

- Fix release continuation so an active rebase does not restore the recorded branch too early ([release-preparation](src/lib/release-preparation.ts)).
- Fix named PR validator resolution when invocation precomputation is absent ([requirements](src/lib/requirements/run.ts)).

## [5.7.0] - 2026-09-01

### Changed

- Copy the recognized local override into a new self-development worktree before setup ([worktrees](src/lib/worktrees.ts)).
- Read mutable release Git history, VERSION, metadata, and source diffs from the selected workspace ([stage-validators](src/lib/validators/stage-validators.ts)).

### Added

- Add the `/pan-augment` command and prompt-augmentation skill files ([2f27af7c](library/cursor/commands/pan-augment.md), [prompt-augmentation](library/skills/prompt-augmentation.md)).

## [5.6.0] - 2026-08-31

### Changed

- Extend policy STE-001 so chat reports use simple language, banned jargon, and required issue and outcome shapes ([STE-001](governance/policies/STE-001.json), [handbook](governance/handbooks/writing/simplified-technical-english.md)).
- Point the orchestrator persona to policy STE-001 for the chat-report shape ([orchestrator](library/personas/orchestrator.md)).
- Replace `load-bearing` with `critical` in the verifier persona and both verify prompts ([verifier](library/personas/verifier.md), [delivery verify](library/workflows/delivery/prompts/verify.md), [metacritic verify](library/workflows/metacritic/prompts/verify.md)).
- Register `/pan-augment` as a read-only command ([67f8bf4c](governance/registries/command_governance.json)).

### Added

- Add `/pan-augment` and the prompt-augmentation skill so an operator can expand one prompt in one shot ([67f8bf4c](library/cursor/commands/pan-augment.md), [prompt-augmentation](library/skills/prompt-augmentation.md)).

## [5.5.0] - 2026-08-31

### Changed

- Preserve target-owned extensions through refresh, repair, and indexed update ([target-authoring](src/lib/target-authoring.ts), [install](bin/install)).
- Permit binding-only policy lookup rows for target-authored artifacts ([policies](src/lib/policies.ts)).
- Scope `TS-001` to TypeScript coding contexts in target installations ([policy_lookup_table.json](governance/registries/policy_lookup_table.json)).

### Added

- Add `/pan-author` so operators can author target commands, skills, and personas ([pan-author](library/cursor/commands/pan-author.md), [target-authoring](src/lib/target-authoring.ts)).
- Add `author` and `target` governance card modes for authored artifacts ([governance-card](src/lib/governance-card.ts)).
- Add `TARGET-AUTHORING-VALIDATE-001` for installed target extensions ([validation_registry.json](governance/registries/validation_registry.json)).
- Add an empty `target-extensions/` root to the install payload ([target-extensions/.gitkeep](target-extensions/.gitkeep)).

### Removed

- Remove `docs/test-audit-2026-08-29.md` after the 5.4.0 release (commit `65617f5195f7b427974b7a83fedba42e747bb1b3`).

## [5.4.0] - 2026-08-31

### Changed

- Extend read-only command governance so one entry can name a required card mode ([command_governance.json](governance/registries/command_governance.json), [command-coverage](src/lib/governance/command-coverage.ts)).
- Scope repository validation so self-development audits stay out of an embedded install ([77b7279b](src/lib/validation.ts)).
- Treat an explicit `pan repository-check --timeout-ms` as the bound for the whole profile ([0b358a58](src/lib/repository-checks.ts)).

### Added

- Add `governance/handbooks/eng/testing.md`, `TEST-001`, and self-development persona bindings for the test standard ([testing handbook](governance/handbooks/eng/testing.md), [TEST-001](governance/policies/TEST-001.json)).
- Add `/pan-tune-harness`, the `tune-harness` standalone mode, `TUNE-001`, `pan tune` CLI commands, and archive-independent records under `runtime/tune-harness/` ([test-tuning](src/lib/test-tuning.ts), [TUNE-001](governance/policies/TUNE-001.json), [pan-tune-harness](library/cursor/commands/pan-tune-harness.md)).
- Add inventory and fixture sidecar reporters, complete suite-profile timings, and `TUNE-RECORD-VALIDATE-001` ([inventory reporter](tests/reporters/inventory.ts), [failures-only](tests/reporters/failures-only.ts), [tune-record validator](src/lib/validators/tune-record.ts)).
- Add the worked audit for the `c1cc09c2..96c5b639` test set ([docs/test-audit-2026-08-29.md](docs/test-audit-2026-08-29.md)).

### Removed

- Remove the resolved `docs/issues/` records and keep `.gitkeep` ([9cdee2f8](docs/issues/.gitkeep)).

### Fixed

- Fix historical baseline inventory so `pan tune validate-audit` reports 513 identities from a detached worktree ([test-tuning](src/lib/test-tuning.ts)).
- Consume each fixture sidecar once so a repeated profiled run does not double-count cost ([failures-only](tests/reporters/failures-only.ts)).
- Compare graph-build cost with process CPU time so coverage contention does not fail the gate ([test-impact](tests/unit/test-impact.test.ts)).
- Tighten installer payload hygiene and the embedded-install leakage guard ([b69eabe4](bin/install), [77b7279b](tests/secondary/embedded-installation.test.ts)).

## [5.3.1] - 2026-08-30

### Changed

- Arm the watch in the launch turn on every supervisor-facing surface. The orchestrator brief, `/pan-start`, and `/pan-resume` now match the rendered procedure: pick `--mark-background`, `--foreground-returned`, or a blocking watch from the launch outcome, and re-run with `--agent-state` when the watch exits `unverified` ([572ff142](library/personas/orchestrator.md), [pan-start](library/cursor/commands/pan-start.md), [pan-resume](library/cursor/commands/pan-resume.md), [regression](tests/regression/supervisor-delegation-contract.test.ts)).

### Fixed

- State only the watch-flag refusals the CLI enforces. The rendered procedure no longer claims a wrong flag fails loudly for mismatches the harness does not reject ([572ff142](src/lib/render.ts)).
- Record the current release-index membership in the primer. The index already maps 4.0.0 through 5.3.0 ([2d27a496](release/index.json), [dc82b8c3](release/index.json), [primer](docs/target-repo-primer.md)).

## [5.3.0] - 2026-08-30

### Changed

- Prefill every scaffolded criterion as `unevaluated`. Submission rejects that value and names the criterion ([scaffold](src/lib/requirements/scaffold.ts), [validation](src/lib/validation.ts), [schema](library/schemas/stage-output.schema.json)).
- Permit `skipped` only on a blocked output or a failed shell criterion. Forbid it on success ([validation](src/lib/validation.ts)).
- Declare every plan and verify field shape in the shared registry. Check each `enforced_fields` reference ([field contract](library/schemas/stage-output-requirements.json), [stage-validators](src/lib/validators/stage-validators.ts)).
- Classify gate evidence as `clean_pass` or `baseline_relative_acceptance`. Show the raw exit code and the carried-failure state ([context](src/lib/context.ts), [render](src/lib/render.ts)).
- Validate a blocked verify output from `blocking_reason` and `missing_evidence_paths` only. Reject product-verdict fields ([stage-validators](src/lib/validators/stage-validators.ts)).
- Promote unevaluated and skipped-on-success errors so submission fails before shell gates run ([engine](src/lib/engine.ts)).
- State the narrow watch completion rule and the residual risk in `DELEGATE-001` ([DELEGATE-001](governance/policies/DELEGATE-001.json)).
- Place `DELEGATE-001` on the delegation procedure. Arm the watch in the launch turn without a condition ([engine](src/lib/engine.ts), [render](src/lib/render.ts), [de517582](src/lib/engine.ts)).
- Refuse an early output as `unverified` unless agent state is completed. Record `terminal_basis` on every completed wake ([watch](src/lib/watch.ts), [bb87b426](src/lib/watch.ts)).
- Treat an untouched scaffold as nonterminal. A pending attestation also marks a scaffold ([scaffold](src/lib/requirements/scaffold.ts), [watch](src/lib/watch.ts), [de517582](src/lib/watch.ts)).
- Pass only optional Cursor flags that the installed CLI declares ([cursor-agent](src/lib/executors/cursor-agent.ts), [de517582](src/lib/executors/cursor-agent.ts)).
- Name evidence workers first in the operator next action when the invocation declares them ([render](src/lib/render.ts)).
- State the six primer labels in `PRIMER-001`. Build the validator patterns from those labels ([PRIMER-001](governance/policies/PRIMER-001.json), [primer validator](src/lib/validators/target-repo-primer.ts), [bb87b426](src/lib/validators/target-repo-primer.ts)).

### Added

- Add `docs/issues/` with the output-contract intake and the out-of-band adjustment record ([e74a8c60](docs/issues/harness-repair-20260830T164220Z-output-contracts-and-gate-evidence.md), [adjustment record](docs/issues/20260830T164220Z-out-of-band-harness-adjustments-against-main.md)).
- Add `--agent-state` to `pan watch` and the `unverified` exit ([watch](src/lib/watch.ts), [cli](src/cli.ts), [bb87b426](src/cli.ts)).
- Add a late-supervision advisory when the watch arm delay exceeds 60 seconds ([watch](src/lib/watch.ts), [de517582](src/lib/watch.ts)).
- Add `writeFixtureCursorCatalog` so model-evidence tests do not read the operator catalog ([helpers](tests/helpers.ts), [bb87b426](tests/helpers.ts)).

### Fixed

- Stop an unevaluated success output from advancing to ship ([engine](src/lib/engine.ts), [delivery-gates](tests/integration/delivery-gates.test.ts)).
- Stop a blocked verify output from raising false required-data errors for forbidden product fields ([validation](src/lib/validation.ts)).
- Remove the duplicate `qa_cases[].steps` field declaration ([field contract](library/schemas/stage-output-requirements.json)).
- Classify a passed baseline as a clean pass ([context](src/lib/context.ts)).

## [5.2.0] - 2026-08-29

### Changed

- Enforce the platform-guidance redline. Each `pan governance attest-supervisor` opens a supervisor session generation in `state.supervisor_card.session_generation`. Every attestation increments it, including a resume that re-attests an unchanged digest. Each redline declaration records the generation it was written under. `pan prepare` and `pan submit` refuse with `REDLINE_MISSING` until the record carries a declaration for the current generation. The attest command's output names the redline command as the next step ([supervisor-card](src/lib/governance/supervisor-card.ts), [watch](src/lib/watch.ts), [cli](src/cli.ts), [OPERATOR-001](governance/policies/OPERATOR-001.json), [ORCH-001](governance/policies/ORCH-001.json), [orchestrator](library/personas/orchestrator.md), [pan-start](library/cursor/commands/pan-start.md), [pan-resume](library/cursor/commands/pan-resume.md), [operator guide](docs/operator-guide.md)).
- Compute this attempt's changed paths once in `IMPLEMENTATION-CLAIMS-VALIDATE-001`. The test-delta check reuses them instead of re-running the Git snapshot ([stage-validators](src/lib/validators/stage-validators.ts)).
- Load the policy lookup table, catalog, and workspace technologies once per supervisor-card render. Every stage context resolves from those shared values. `resolvePolicies` accepts preloaded sources from `loadPolicySources` ([policies](src/lib/policies.ts), [supervisor-card](src/lib/governance/supervisor-card.ts)).
- Require at least one agent-side `fast` run in the implement stage of `delivery-basic-test-discipline`. A coder that ran no validation now fails the scenario ([scenario](evals/scenarios/delivery-basic-test-discipline.json)).
- Require each `tests_added` entry to name the contract the test proves. Entries are `{ path, contract }`. `IMPLEMENTATION-CLAIMS-VALIDATE-001` computes the attempt's test delta from the invocation `workspace_before` snapshot. The delta holds new `*.test.*` files and changed test files whose `test(` or `it(` call-site count rose against `HEAD`. Each delta without a contract fails with `implementation.tests_added_contract_missing`. A bare string still parses as `{ path }` and fails only when the delta requires a contract. A change with no new tests needs no entry. The reviewer evidence worker judges each contract for an existing assertion and for the cheapest form ([stage-validators](src/lib/validators/stage-validators.ts), [field contract](library/schemas/stage-output-requirements.json), [DEV-001](governance/policies/DEV-001.json), [implement](library/workflows/delivery/prompts/implement.md), [remediate](library/workflows/delivery/prompts/remediate.md), [verify stage](library/workflows/delivery/stages/verify.json), personas).

### Added

- Add the advisory suite profile. The failures-only reporter writes per-test and per-file durations to the JSON path in `PAN_TEST_PROFILE`. It writes nothing when the variable is unset. The harness sets the variable for exactly one execution: the `full`-profile gate that is the last suite run before ship. That gate is `verify.full_suite`, or `remediate.full_suite` when remediation ran. The variable is never set for a baseline, an interior gate, `impacted`, or an agent-side run. The artifact lands at `agent/evidence/<invocation-id>-suite-profile.json`, and the gate result records it as `suite_profile_path`. A cached full gate references the profile of the original execution. The ship card carries a `Suite profile` section with the test count, wall clock, and slowest files and tests. It also shows the delta against the previous succeeded run in the same workspace. `pan status` prints a one-line summary. No count and no duration gates anything ([reporter](tests/reporters/failures-only.ts), [suite-profile](src/lib/suite-profile.ts), [validation](src/lib/validation.ts), [render](src/lib/render.ts), [ship stage](library/workflows/delivery/stages/ship.json), [ship prompt](library/workflows/delivery/prompts/ship.md)).

### Fixed

- Refuse `pan watch --foreground-returned` with `FOREGROUND_RETURN_NOT_TERMINAL` when the worker output does not exist. `pan submit` counts an attestation only when its recorded observation saw the output present. The attestation can no longer stand in for a return the harness never saw. A malformed output still attests, and submit judges it ([watch](src/lib/watch.ts), [watch tests](tests/unit/watch.test.ts)).
- Grant the external-executor exemption from `DELEGATION_UNOBSERVED` only when the delegation-execution record exists and names the run and invocation. `pan delegate` writes that record. A hand-supplied output for an external-executor stage is unobserved ([watch](src/lib/watch.ts)).
- Make `pan output validate --file` validate the named file, even when a copy already sits at the declared path ([engine](src/lib/engine.ts), [parity tests](tests/unit/output-validate-parity.test.ts)).
- Accept `pipeline_config` as a scenario top-level key, so a scenario that pins a named pipeline configuration loads ([scenario](src/lib/evals/scenario.ts)).
- Stop the `platform-guidance-conflict-recorded` grader from treating the redline record as a conflict record. A mention without a `platform_guidance_conflicts[]` entry fails whether or not a redline exists. The redline does not count toward `min_recorded` ([graders](src/lib/evals/graders.ts), [evals guide](docs/evals.md)).
- Apply the `{ path, contract }` shape of `tests_added` to the metacritic consolidation prompt ([consolidate](library/workflows/metacritic/prompts/consolidate.md)).
- Render one gate-evidence instruction the evidence workers can follow. The verifier runs no profile. An evidence worker may run `fast` once and never `full`. No agent runs a profile after remediation. The reference no longer says "do not run the profile agent-side" beside a scope that permits one run ([context](src/lib/context.ts)).
- Propagate bin, fixture, and CLI references found in test helpers to the lane tests that import them. `pan tests impacted` now selects `tests/integration/worktree-cli.test.ts` for a `src/cli.ts` change. Those references are extracted in one pass per module instead of one scan per bin script and fixture ([test-impact](src/lib/test-impact.ts), [test-impact tests](tests/unit/test-impact.test.ts)).
- Run the review-mode scope check inside the worktree that `--worktree` binds, and accept `--closure-revision` on `pan governance card`. The review card no longer fails with `REVIEW_CLOSURE_REVISION_MISMATCH` when the main checkout sits at the base ([governance-card](src/lib/governance-card.ts), [cli](src/cli.ts)).
- Document `--occasion` on `pan status --redline` in `pan help` and drop the unreachable default coalesce ([cli](src/cli.ts)).
- Name the run's operator worktree on the supervisor card ([supervisor-card](src/lib/governance/supervisor-card.ts)).
- Remove the two semicolons from the generated supervisor procedure ([render](src/lib/render.ts)).

## [5.1.0] - 2026-08-29

### Changed

- Replace "run the static and fast checks until they pass" with an impacted-test discipline: the coder and remediator iterate with `./bin/pan tests impacted` (the `impacted` profile, selected by static import-graph analysis) plus the tests they added, the reviewer and QA worker iterate on blast-radius tests, each runs the `fast` profile once as validation, and none runs `full`; a retry that changed only claims or evidence runs no suite ([DEV-001](governance/policies/DEV-001.json), [VERIFY-001](governance/policies/VERIFY-001.json), [REMED-001](governance/policies/REMED-001.json), [implement](library/workflows/delivery/prompts/implement.md), [remediate](library/workflows/delivery/prompts/remediate.md), [verify](library/workflows/delivery/prompts/verify.md), personas).
- Make the consolidating verifier run no suite and let its passing verdict alone trigger the `full` profile as the verify submission gate; the default `light` level now maps `verify.full_suite` to `full` instead of `fast`, and `thorough` becomes a documented alias of `light` ([verification](src/lib/verification.ts), [operator guide](docs/operator-guide.md), [runtime protocol](docs/runtime-protocol.md)).
- Replace the remediate stage's `fast` gate with a `remediate.full_suite` gate on the `full` profile, exclude `full` from pre-implementation baselines even when a source-allowed stage gates on it, and rely on the gate cache so a remediate→verify return executes `full` exactly once ([remediate stage](library/workflows/delivery/stages/remediate.json), [delivery-candidate](library/workflows/delivery-candidate/stages/remediate.json), [engine](src/lib/engine.ts), [delivery-gates](tests/integration/delivery-gates.test.ts)).
- Allow each verify evidence worker one agent-side `fast` run recorded in its evidence report, replacing the blanket QA prohibition; a QA case still must not consist of a profile run ([VERIFY-001](governance/policies/VERIFY-001.json), [verify stage](library/workflows/delivery/stages/verify.json)).
- Require the supervisor to use `pan watch` as its timer and record inside a run, to treat a launch the platform backgrounds as a background subagent at once, and to write the platform-guidance redline at `/pan-start` and every `/pan-resume` ([DELEGATE-001](governance/policies/DELEGATE-001.json), [ORCH-001](governance/policies/ORCH-001.json), [OPERATOR-001](governance/policies/OPERATOR-001.json), [orchestrator](library/personas/orchestrator.md), [pan-start](library/cursor/commands/pan-start.md), [pan-resume](library/cursor/commands/pan-resume.md)).
- Run every claim, attestation, and artifact validator in `pan submit` before any repository-check shell gate, and record each gate as skipped with the deciding validator when one rejects the output, so a mechanical claims defect no longer costs the 81 seconds of static and fast checks first ([engine](src/lib/engine.ts), [validation](src/lib/validation.ts), [delivery-gates](tests/integration/delivery-gates.test.ts)).
- Require a delegation observation at `pan submit`: a Cursor worker invocation needs a completed `pan watch` record or a foreground-return attestation, and a submission with neither fails with the hard error `DELEGATION_UNOBSERVED`; external-executor stages that `pan delegate` runs are exempt, and the `DELEGATION_WATCH_MISSING` advisory is folded into the refusal ([engine](src/lib/engine.ts), [watch](src/lib/watch.ts), [DELEGATE-001](governance/policies/DELEGATE-001.json), [ORCH-001](governance/policies/ORCH-001.json), [orchestrator](library/personas/orchestrator.md), [pan-start](library/cursor/commands/pan-start.md), [pan-resume](library/cursor/commands/pan-resume.md), [meta-orchestrator](library/cursor/agents/meta-orchestrator.md)).
- Extend the supervisor's bounded mechanical-repair list to a `changed_files` claim that omits a path the recorded workspace delta shows the attempt changed ([ORCH-001](governance/policies/ORCH-001.json)).
- Make the `delegation-watch-record` grader accept a foreground-return attestation or external-executor evidence, drop its advisory scan, and demand a record for every delegation in the `delivery-background-delegation` scenario ([graders](src/lib/evals/graders.ts), [scenario](evals/scenarios/delivery-background-delegation.json), [evals guide](docs/evals.md)).

### Added

- Add the supervisor governance card: `pan init` and `pan prepare` render `agent/supervisor-card.md` with the full text of every policy the lookup table resolves for the orchestrator persona and the run workflow, record `state.supervisor_card`, and `pan governance card --mode supervisor --run <run-id>` refreshes it on demand ([supervisor-card](src/lib/governance/supervisor-card.ts), [engine](src/lib/engine.ts), [runtime protocol](docs/runtime-protocol.md)).
- Add `pan governance attest-supervisor <run-id> --sha256 <digest>`; `pan prepare` and `pan submit` now fail with `SUPERVISOR_CARD_UNATTESTED` until the current card digest is attested, and each `<invocation-id>.supervisor.md` prints the card path, digest, and attest command ([cli](src/cli.ts), [render](src/lib/render.ts), [supervisor-card tests](tests/unit/supervisor-card.test.ts)).
- Add the `release`, `write-pr`, `build-docs`, `build-briefs`, and `qa-workflow` governance card modes with their lookup rows, and rewrite the matching commands so step one runs `pan governance card --mode <mode>` and the delegated prompt inlines the card instead of hand-read policy files ([governance-card](src/lib/governance-card.ts), [lookup table](governance/registries/policy_lookup_table.json), [commands](library/cursor/commands/)).
- Add the command governance guard to `pan validate`: every canonical command runs a registered card mode or is allowlisted read-only in `governance/registries/command_governance.json`, no command reads a policy file by hand, and every standalone mode and standalone lookup row match ([command-coverage](src/lib/governance/command-coverage.ts), [workflow authoring](docs/workflow-authoring.md)).
- Add on-demand harness evals: `pan eval list|grade|run`, JSON scenarios under `evals/scenarios/` validated by `pan validate` against `library/schemas/eval-scenario.schema.json`, the `toy-node` fixture, five deterministic graders over run records (profile executions, delegation watch records, platform guidance conflict records, attempts spent on mechanics, stage order and terminal state), and STE-style JSON + Markdown reports under `runtime/logs/evals/<eval-id>/` ([evals](src/lib/evals/index.ts), [evals guide](docs/evals.md)).
- Add `pan watch <run-id>`, the harness-owned worker watch that sleeps on the `DELEGATE-001` cadence, inspects the invocation output and evidence paths, and appends every arming and wake to `agent/evidence/<invocation-id>-watch.jsonl`, exiting `completed`, `stalled`, or `timed_out` ([watch](src/lib/watch.ts), [cli](src/cli.ts)).
- Add `pan status <run-id> --redline`, which writes `agent/evidence/platform-guidance-redline.json` naming the platform-guidance categories pre-declared non-authoritative and the `AGENTS.md` authority order ([watch](src/lib/watch.ts)).
- Carry the delegation observation into the stage record as `delegation_observation`, naming whether a completed watch, a foreground-return attestation, or external-executor evidence proved the worker reached a terminal state ([engine](src/lib/engine.ts)).
- Add `pan watch <run-id> --foreground-returned [--invocation <id>] [--launched-at <iso-8601>]`, which records the launch and return wall-clock times of a foreground worker launch at `agent/evidence/<invocation-id>-foreground-return.json`, defaulting the launch time to the delegation artifact's modification time, and print the matching step in every `<invocation-id>.supervisor.md` procedure ([watch](src/lib/watch.ts), [cli](src/cli.ts), [render](src/lib/render.ts)).
- Add `submitAsSupervisor` to the test helpers so every test that drives a run through submit records the foreground attestation the way a supervisor does ([helpers](tests/helpers.ts)).
- Add `./bin/pan tests impacted`, which builds the runtime import graph of `src/` and `tests/` with the TypeScript parser, takes the change set from the dirty working tree (`--changed <ref>`, `--staged`, or `--file <path>` override it), and selects every mainline lane test whose import closure, bin-script reference, or fixture reference reaches a change; `--list` and `--json` report the selection, `--depth <n>` bounds the closure for iteration, an advisory names the `fast` profile when the selection passes 60% of the lane, each run appends to `runtime/cache/test-impact.jsonl`, and the new `impacted` repository-check profile and `npm run test:impacted` script expose it as an iteration aid that is never a gate ([test-impact](src/lib/test-impact.ts), [cli](src/cli.ts), [operator guide](docs/operator-guide.md)).

### Fixed

- Show `--invocation <path>` in the `pan output validate` help line and guard it with a CLI help regression test ([cli](src/cli.ts), [cli-help](tests/unit/cli-help.test.ts)).
- Make `pan output validate` run the same harness-authoritative validator set `pan submit` runs, including `IMPLEMENTATION-CLAIMS-VALIDATE-001`, from the shared `resolveSubmitValidators` resolution, so a claims omission surfaces before an attempt is spent ([engine](src/lib/engine.ts), [output-validate-parity](tests/unit/output-validate-parity.test.ts)).

## [5.0.1] - 2026-08-29

### Fixed

- Treat an empty model string in a named config's `personas` as "inherit the `defaults` entry" instead of rejecting the file, so `config_overrides.json` needs to name only the personas a config changes; an empty `defaults` entry is still rejected, and `pan models --migrate-from` reports a hole only when `defaults` leaves it empty too The installer applies the same rule when it ships the effective configuration and projects persona models ([pipeline-config](src/lib/pipeline-config.ts), [pipeline-config-migration](src/lib/pipeline-config-migration.ts), [install-support](bin/install-support), [operator guide](docs/operator-guide.md)).

## [5.0.0] - 2026-08-29

This release absorbs the unreleased 4.10.0 candidate. It is a major release: stage-output contracts, the verification profile contract, the check wrappers, and several governance policies change in ways that an existing installation and its in-flight agents must adopt.

### Changed

- Require a `TQ-nn` id on every prototype technical question; every later stage names a question by id only, and the intake validator rejects a bare-string question ([PROTO-001](governance/policies/PROTO-001.json), [prototype-output](src/lib/validators/prototype-output.ts)).
- Require the verify output to cite every current gate-evidence reference on its card in `data.verify.gate_evidence_citations`, and reject a QA case whose steps rerun a configured profile ([VERIFY-001](governance/policies/VERIFY-001.json), [stage-validators](src/lib/validators/stage-validators.ts), [field contract](library/schemas/stage-output-requirements.json)).
- Contract each `environment_blockers` entry as `id`, `description`, `evidence[]`, and non-empty `affected_questions[]` naming declared questions, so a blocker that names nothing can no longer bypass the readiness guard ([prototype-output](src/lib/validators/prototype-output.ts), [evaluate](library/workflows/prototype/prompts/evaluate.md)).
- Stop `bin/check` from running the test suite, so `npm run check` covers build, lint, and validate only and a full gate stops executing tests twice ([check](bin/check), [output-verbosity](docs/output-verbosity.md)).
- Make the tracked self-development `full` profile one execution of the suite under coverage plus the installer smoke, matching the generated runtime file ([repository-checks template](library/templates/repository-checks.self-development.json)).
- Accept a recorded clean pass of an identical gate command at an unchanged workspace fingerprint instead of re-executing it, marked `cached` with the original evidence; `PAN_GATE_CACHE=0` disables acceptance ([DEV-001](governance/policies/DEV-001.json), [gate-cache](src/lib/gate-cache.ts)).
- Skip the TypeScript rebuild and the lint typecheck when the source fingerprint is unchanged, and hold `rm -rf dist` while a wrapped command still reads it ([build](bin/build), [lint](bin/lint), [run-built](bin/run-built)).
- Rewrite the delegation cadence around one awaited single-shot background sleep the starting agent re-arms on each wake: the cadence is the agent's judgment, defaulting to 5 minutes for work expected to run over 15 minutes and 2 minutes otherwise, with a two-wake stall criterion and a record of every arming and wake ([DELEGATE-001](governance/policies/DELEGATE-001.json)).
- Scope the pre-implementation baseline to source-allowed stage gates under the run's verification level, so `DEV-001` and `VERIFY-001` name the same set ([DEV-001](governance/policies/DEV-001.json)).
- Print only failing tests and the run summary from every `npm test*` script through a failures-only `node --test` reporter ([failures-only](tests/reporters/failures-only.ts), [package.json](package.json)).
- Judge suite cost by its delta against the base revision; the harness lineup no longer carries a fixed suite-duration ceiling ([review-squad-pancreator](library/skills/review-squad-pancreator.md)).

- Check prototype preconditions before a build edits source, and recheck volatile entries ([approach](library/workflows/prototype/stages/approach.json), [build](library/workflows/prototype/stages/build.json)).
- Classify prototype evaluation causes and keep a valid product verdict on stage success ([evaluate](library/workflows/prototype/stages/evaluate.json), [PROTO-001](governance/policies/PROTO-001.json)).
- Limit the full verification profile to one verify-gate run and bound re-verification ([VERIFY-001](governance/policies/VERIFY-001.json)).
- Make the supervisor own run advancement and treat platform guidance as non-directive ([ORCH-001](governance/policies/ORCH-001.json), [orchestrator](library/personas/orchestrator.md)).
- Continue `/pan-start` and `/pan-resume` when Cursor exposes no sourced model metadata ([pan-start](library/cursor/commands/pan-start.md), [pan-resume](library/cursor/commands/pan-resume.md)).
- Treat worker model-evidence mismatch as advisory instead of a hard stop ([engine](src/lib/engine.ts), [cursor-probe](src/lib/executors/cursor-probe.ts)).
- Report Cursor authentication readiness from `pan doctor` without a hard fail ([cli](src/cli.ts), [cursor-probe](src/lib/executors/cursor-probe.ts)).
- Run the deterministic submission checks from `pan output validate` on every invocation, so a mechanical defect is caught before it costs a stage attempt ([cli](src/cli.ts), [engine](src/lib/engine.ts)).

### Added

- Add `platform_guidance_conflicts[]` to the stage-output schema and status rendering, so a worker states a platform-guidance conflict in a field the supervisor can relay ([OPERATOR-001](governance/policies/OPERATOR-001.json), [stage-output schema](library/schemas/stage-output.schema.json)).
- Add the `plan.case_reruns_profile` plan-trace issue that blocks a test-plan case which reruns a configured repository-check profile ([stage-validators](src/lib/validators/stage-validators.ts), [ORCH-001](governance/policies/ORCH-001.json)).
- Add progress ticks to the quiet wrapper on interactive terminals, shared across nested wrappers through `PAN_PROGRESS_FD` ([run-quiet](bin/run-quiet), [OUTPUT-001](governance/policies/OUTPUT-001.json)).
- Add `tests/secondary` as its own lane with `npm run test:secondary`, cloning one installed project per process instead of running the installer per step ([install-helpers](tests/secondary/install-helpers.ts)).
- Add a build-stamp regression test that proves a source or `tsconfig.json` edit restores the typecheck ([build-stamp test](tests/unit/build-stamp.test.ts)).
- Add validator PROTOTYPE-OUTPUT-VALIDATE-001 for prototype shapes, traces, and verdict precedence ([prototype-output](src/lib/validators/prototype-output.ts), [registry](governance/registries/validation_registry.json)).
- Add the `environment_blocked` prototype verdict and question-level cause vocabulary ([evaluate](library/workflows/prototype/stages/evaluate.json), [field contract](library/schemas/stage-output-requirements.json)).
- Add the Pancreator-only review-squad lineup and drop it from target installations ([review-squad-pancreator](library/skills/review-squad-pancreator.md), [install](bin/install), [validation](src/lib/validation.ts)).
- Add `/pan-review`, the `review` standalone mode, and `REVIEW-001`, with a review-scope check that classifies a target's conflicts of interest by tier, derives the conduct tier from the review card, renders base conduct with `--base`, and reports a per-policy standards delta ([review-scope](src/lib/review-scope.ts), [governance-card](src/lib/governance-card.ts), [REVIEW-001](governance/policies/REVIEW-001.json)).

### Removed

- Remove 324 tests that duplicated, pinned prose, restated config shape, or re-ran a validator the check gate already runs; the fast lane drops from 812 tests in about 148 s to about 600 in about 74 s, and the verdicts are recorded in `runtime/inbox/test-audit-20260829-verdicts.md` ([c1cc09c2](https://github.com/alenlukic/pancreator/commit/c1cc09c2), [helpers](tests/helpers.ts)).

### Fixed

- Bind the review-scope conflict closure to the target head instead of the working tree, classify `src/cli.ts`, `bin/lint`, `bin/install`, and the review-machinery tests by tier, require `--base` with `--target`, and carry the independent instrument-tier verdict into the review outcome ([review-scope](src/lib/review-scope.ts), [governance-card](src/lib/governance-card.ts), [REVIEW-001](governance/policies/REVIEW-001.json)).
- Supply the review workspace path from the shepherd caller, and require every dimension prompt to carry the calibration bar and the no-edit boundary ([shepherd-pr](library/skills/shepherd-pr.md), [pan-review](library/cursor/commands/pan-review.md)).
- Scope the reviewer persona's remediation duty out of a standalone review card ([reviewer](library/personas/reviewer.md)).
- Correct the `verification` operator note in `config.json`, the primer's `npm run check` and `npm run lint` descriptions, and the stale test citations in `docs/output-verbosity.md` ([config](config.json), [primer](docs/target-repo-primer.md)).
- Name the action that exists when verify-card gate evidence is superseded: the verify submission gate re-runs the profile on submit ([context](src/lib/context.ts)).
- Stop the quiet wrapper's orphaned ticker sleep from holding a captured stderr open for one full tick ([run-quiet](bin/run-quiet)).
- Clear the inherited tick sink in the quiet-command tests, so the suite passes from an interactive terminal ([quiet-command test](tests/unit/quiet-command.test.ts)).
- Split the added policy and persona sentences that exceeded the `STE-001` word bound or joined two directives with a semicolon ([STE-001](governance/policies/STE-001.json)).
- Reject unauthorized prototype question exclusions and close the build fail-open path ([prototype-output](src/lib/validators/prototype-output.ts)).
- Put RFC 2119 MUST directives on four governance instructions that failed the check gate ([ORCH-001](governance/policies/ORCH-001.json), [PROTO-001](governance/policies/PROTO-001.json)).
- Authorize prototype question exclusions against the run's operator-decision ledger instead of any file under the decisions directory ([prototype-output](src/lib/validators/prototype-output.ts)).
- Require the `volatile` precondition field, recheck only preconditions that still carry a live question, and keep a `blocked` prototype result as an operator pause ([prototype-output](src/lib/validators/prototype-output.ts)).
- Check prototype evaluation coverage against the brief's declared questions ([prototype-output](src/lib/validators/prototype-output.ts)).
- Align `VERIFY-001` with the shipped verification levels and put passed gate evidence on the verify card ([VERIFY-001](governance/policies/VERIFY-001.json), [context](src/lib/context.ts)).
- Persist model and pipeline advisories to run state so `pan status` and `pan submit` surface them ([engine](src/lib/engine.ts)).
- Load the Cursor model catalog once per pipeline-config load and render only the agent projection for the drift advisory ([cursor-catalog](src/lib/executors/cursor-catalog.ts), [projection](src/lib/projection.ts), [engine](src/lib/engine.ts)).
- Classify platform guidance under `OPERATOR-001` so every persona resolves it, and rewrite the `DELEGATE-001` cadence around a self-rescheduling single-shot timer ([OPERATOR-001](governance/policies/OPERATOR-001.json), [DELEGATE-001](governance/policies/DELEGATE-001.json)).

## [4.9.0] - 2026-08-27

### Changed

- Treat policies that declare `target_extension`, and the handbooks they reach, as target-owned during the context audit ([context-audit](src/lib/governance/context-audit.ts), [policies](src/lib/policies.ts)).
- Skip the disposition requirement when a duplicate directive spans harness-owned and target-owned sources ([context-audit](src/lib/governance/context-audit.ts)).
- Drop retired persona keys from embedded `defaults` and named configs on install refresh, and keep mappings for personas the incoming release still ships ([install-support](bin/install-support)).
- Point the post-install init hint at the `delivery` workflow ([install](bin/install)).

### Added

- Accept optional `target_extension` on a policy file ([types](src/lib/types.ts), [policies](src/lib/policies.ts)).
- Merge target-authored context-bloat dispositions from `context_bloat_dispositions.d/<extension-id>.json` so they survive a harness registry refresh ([context-audit](src/lib/governance/context-audit.ts), [embedded-installation](docs/embedded-installation.md)).

### Fixed

- Ignore a formatter-wrapped RFC 2119 preamble so two copies of that wrapping no longer form an undisposed duplicate ([context-audit](src/lib/governance/context-audit.ts)).

## [4.8.0] - 2026-08-27

### Changed

- Make `delivery` the default workflow for new runs ([engine](src/lib/engine.ts), [cli](src/cli.ts)).
- Run best-of-N candidates on the new `delivery-candidate` workflow ([best-of-n](src/lib/best-of-n.ts), [delivery-candidate](library/workflows/delivery-candidate/workflow.json)).
- Consolidate the metacritic review and test stages into one joint verify stage ([metacritic](library/workflows/metacritic/workflow.json)).
- Move the prototype approach stage to the planner persona ([approach](library/workflows/prototype/stages/approach.json)).
- Map `verify.full_suite` on every built-in verification level ([verification](src/lib/verification.ts)).
- Resolve target instructions for `verify` and `remediate` ([context](src/lib/context.ts)).
- Accept optional `persona_by_verdict` on a stage file ([stage schema](library/schemas/stage.schema.json), [workflow](src/lib/workflow.ts)).
- Drop the version from the README heading and its release-metadata check ([README](README.md), [versioning](src/lib/versioning.ts)).

### Added

- Add the `delivery` workflow with plan, implement, verify, remediate, and ship stages ([delivery](library/workflows/delivery/workflow.json)).
- Add planner, verifier, remediator, and remediator-severe personas ([planner](library/personas/planner.md)).
- Add policies PLAN-002, VERIFY-001, and REMED-001 ([PLAN-002](governance/policies/PLAN-002.json)).
- Add the read-only `pan inbox` command ([inbox](src/lib/inbox.ts), [cli](src/cli.ts)).
- Add verify-output validation for the delivery verify stage ([stage-validators](src/lib/validators/stage-validators.ts)).

### Removed

- Remove the superseded `dev` and `dev-candidate` workflows ([workflows](library/workflows)).
- Remove the intake-writer and tech-lead personas and their projected agents ([config](config.json)).
- Remove policies PLAN-001, REVIEW-001, REVIEW-002, and TEST-001 with their lookup rows and validators ([policy lookup](governance/registries/policy_lookup_table.json)).
- Remove the `review_mode` configuration and the squad review machinery ([project-config](src/lib/project-config.ts), [policies](src/lib/policies.ts)).

### Fixed

- Skip shell gates when a submission already decides a non-success ([engine](src/lib/engine.ts), [DEV-001](governance/policies/DEV-001.json)).

## [4.7.0] - 2026-08-26

### Changed

- Move new operator and best-of-N worktrees to the top-level `worktrees/` root ([project-config](src/lib/project-config.ts), [worktrees](src/lib/worktrees.ts), [best-of-n](src/lib/best-of-n.ts)).
- Keep legacy `runtime/worktrees/` records readable and leave them in place ([worktrees](src/lib/worktrees.ts), [operator-guide](docs/operator-guide.md)).
- Create the current `worktrees/` root during install and update, and do not move legacy data ([install](bin/install)).
- Exclude `worktrees/` from Git status and from workspace tracking ([.gitignore](.gitignore), [config.json](config.json)).
- Name the current worktree location on policy, schema, primer, and operator-guide surfaces ([BESTOFN-001](governance/policies/BESTOFN-001.json), [config schema](library/schemas/config.schema.json)).
- Fail with `WORKTREE_INDEX_CONFLICT` when both default operator indexes exist ([worktrees](src/lib/worktrees.ts)).
- Honor a declared `worktrees.root` and keep new worktrees at that path ([worktrees](src/lib/worktrees.ts), [operator-guide](docs/operator-guide.md)).

## [4.6.0] - 2026-08-25

### Changed

- Enforce required and authoritative harness validator failures on every stage they bind, routing `stage_failure`/`blocked` outcomes from the resolved requirement instead of demoting non-ship failures to governance warnings ([engine](src/lib/engine.ts), [dev-workflow test](tests/integration/dev-workflow.test.ts)).
- Accept operator-declared absolute and out-of-workspace paths wherever they resolve on the system: plan validation drops its path-shape rejection, and target-instruction resolution contributes no chain for out-of-workspace paths instead of failing with `TARGET_INSTRUCTION_PATH_INVALID` ([stage-validators](src/lib/validators/stage-validators.ts), [target-instructions](src/lib/target-instructions.ts), [run-friction tests](tests/regression/run-friction.test.ts)).
- Resolve native pytest `path::case` node ids and the spaced `path :: case` display form to the same test file in implementation claims, and name the accepted format in the failure message ([stage-validators](src/lib/validators/stage-validators.ts)).
- Run every repository-check profile command even after an earlier command fails, so independently meaningful partitions (backend/frontend) are always captured; probes remain fail-fast preconditions ([repository-checks](src/lib/repository-checks.ts)).
- Accept any successfully resolved Cursor variant for a bare (bracket-less) model spec in worker model evidence, aligning `probeRunInvocationModel` with the config-wide prober instead of comparing a spec id with a display name ([engine](src/lib/engine.ts), [model-evidence test](tests/integration/model-evidence.test.ts)).
- Permit the two-line `Agent:`/`Persona:` identity prefix ahead of delegation evidence and document the exact supported label grammar in the delivery procedure, `INVOCATION-001`, `BESTOFN-001`, and the orchestrator persona ([validation](src/lib/validation.ts), [render](src/lib/render.ts)).
- Rename the untracked operator-overrides file from `config.local.json` to `config_overrides.json`, with a legacy-name fallback for existing installations ([project-config](src/lib/project-config.ts), [install-support](bin/install-support)).
- Change the default worktree branch prefix from `pan-wt/` to `worktree/`; the prefix remains configurable via `worktrees.branch_prefix` in `config.json` ([project-config](src/lib/project-config.ts)).
- Merge the source checkout's `config_overrides.json` into every installer read of the source configuration, so installs ship the effective model specs while the tracked `config.json` may keep its model values blank ([install-support](bin/install-support)).

### Added

- Require per-reference read evidence: guidance attestation entries return (scaffold-prefilled identities, worker-supplied `final_line` quote of the selection's closing line) and target-instruction evidence gains `reads` entries quoting each file's last non-empty line, both validated against the actual bytes ([validation](src/lib/validation.ts), [scaffold](src/lib/requirements/scaffold.ts), [stage-validators](src/lib/validators/stage-validators.ts), [stage-output schema](library/schemas/stage-output.schema.json), [GLOBAL-002](governance/policies/GLOBAL-002.json)).
- Declare the `tests_added` entry format and the `remediation` object shape in the shared field contract so implement cards state them with an example ([stage-output-requirements](library/schemas/stage-output-requirements.json), [implement prompt](library/workflows/dev/prompts/implement.md)).
- Disclose dirty-worktree paths, the full dirty count, and a matching predecessor run id in pre-implementation baseline artifacts, and warn at capture when a run starts from uncommitted prior-run changes ([engine](src/lib/engine.ts), [repository-checks](src/lib/repository-checks.ts)).
- Expose `apply_ready_decision_ids` from `pan away status` and make `AWAY_DECISION_NOT_FOUND` name the ledger path, the id's actual state, and the apply-ready ids ([cli](src/cli.ts), [hypervisor-cli test](tests/integration/hypervisor-cli.test.ts)).
- Record `output_bytes` on every stage-history item as advisory output-volume telemetry ([engine](src/lib/engine.ts), [types](src/lib/types.ts)).

### Fixed

- Stop recording `outcome: success` and transitioning along the success edge while a required harness validator failure stands in a non-ship stage's `validation_errors` — the record and the transition now agree ([engine](src/lib/engine.ts)).

## [4.5.0] - 2026-08-24

### Changed

- Scope policy lookup rows by persona, stage, installation, and review mode ([policy_lookup_table.json](governance/registries/policy_lookup_table.json)).
- Replace file-specific projection rewrites with explicit path tokens for each installation mode ([cursor-content.ts](src/lib/cursor-content.ts)).
- Reduce `AGENTS.md` and projected wrappers to bootstrap, authority, and safety rules ([AGENTS.md](AGENTS.md)).
- Use one shared renderer for policy blocks in workflow cards and standalone cards ([policy-guidance.ts](src/lib/policy-guidance.ts)).
- Mirror projection tokens in the installer renderer and keep compiled output byte-identical ([install-support](bin/install-support)).
- Carry complete worker-delivery authority inside `BESTOFN-001` so the meta-orchestrator no longer cites unavailable `INVOCATION-001` ([BESTOFN-001](governance/policies/BESTOFN-001.json), [meta-orchestrator](library/cursor/agents/meta-orchestrator.md), [policies tests](tests/unit/policies.test.ts)).
- Continue enabled away-mode runs after each safe pending action until a real blocker or a terminal state ([AGENTS.md](AGENTS.md), [ORCH-001](governance/policies/ORCH-001.json), [orchestrator persona](library/personas/orchestrator.md)).
- Keep ordinary gate decisions with the supervisor and limit the hypervisor to agent health ([AWAY-001](governance/policies/AWAY-001.json), [hypervisor CLI test](tests/integration/hypervisor-cli.test.ts)).
- Accept a successful ship packet through deterministic away approval without commit, push, merge, publication, or deployment ([SHIP-001](governance/policies/SHIP-001.json), [away-mode](src/lib/away-mode.ts)).
- Record away authorship on applied away actions instead of operator authorship ([engine](src/lib/engine.ts)).

### Added

- Add a context-bloat disposition registry and a deterministic audit of agent-facing surfaces ([context_bloat_dispositions.json](governance/registries/context_bloat_dispositions.json)).
- Add a catch-all `unbound` governance-card context so ad-hoc agents receive universal policies plus `DELEGATE-001` ([governance-card.ts](src/lib/governance-card.ts), [policy_lookup_table.json](governance/registries/policy_lookup_table.json), [AGENTS.md](AGENTS.md), [policies tests](tests/unit/policies.test.ts)).
- Add `bin/run-built` so one root-scoped lock covers a build and its compiled-code consumer ([run-built](bin/run-built), [package.json](package.json)).
- Add decision kinds that separate budgeted evaluator records from deterministic ship approval ([away-mode](src/lib/away-mode.ts), [autonomy-state validator](src/lib/validators/autonomy-state.ts)).

### Fixed

- Restore the rtk wrap note, the chat-markdown check, and the source-to-target import boundary ([AGENTS.md](AGENTS.md)).
- Restore source-side target-installation safeguards: validate against an external target, read the target `AGENTS.md`, and never stage target contents from the Pancreator checkout ([AGENTS.md](AGENTS.md)).
- Restore `DELEGATE-001` on standalone shepherd so `pan-shepherd-reviewer` stays under subagent supervision ([policy_lookup_table.json](governance/registries/policy_lookup_table.json), [policies tests](tests/unit/policies.test.ts)).
- Replace a bare projection-token error with the shared invariant code `UNRESOLVED_PROJECTION_TOKEN` ([cursor-content.ts](src/lib/cursor-content.ts)).
- Resume the supervisor loop after one applied away decision so an enabled run does not stall ([dev-workflow test](tests/integration/dev-workflow.test.ts)).
- Reuse a same-root nested build-only call so the lock does not wait on its ancestor ([cli-help test](tests/integration/cli-help.test.ts)).

## [4.4.0] - 2026-08-24

### Changed

- Make live target PR templates and instructions authoritative over the Pancreator default PR format. Apply Pancreator fallback only when no target authority exists ([PR-001](governance/policies/PR-001.json), [write-pr-description skill](library/skills/write-pr-description.md), [pr-description](src/lib/pr-description.ts)).
- Classify an absent Chrome for Testing bundle as one browser readiness gap and stop emitting secondary isolation or executable-path defects for that absence ([browser-readiness](src/lib/browser-readiness.ts), [browser-readiness tests](tests/unit/browser-readiness.test.ts)).
- Allow generated LANG-001 rows to require supplemental language policies such as PY-001 and align librarian generation with repository validation ([target-language-handbooks validator](src/lib/validators/target-language-handbooks.ts), [librarian persona](library/personas/librarian.md)).
- Extend target `policy_lookup.d` loading with ownership, binding, duplicate, and conflict validation exposed as hard repository errors ([policies](src/lib/policies.ts), [validation](src/lib/validation.ts)).

### Added

- Add repository-wide secret lookup and model-catalog self-remediation before operator escalation through `CURSOR_API_KEY` and `Cursor.models.list()` ([AGENTS.md](AGENTS.md), [ASK-001](governance/policies/ASK-001.json), [orchestrator persona](library/personas/orchestrator.md)).
- Add `PR-DESCRIPTION-VALIDATE-001` to validate workflow and standalone PR bodies against resolved target authority, including required H2 order, optional section markers, and title placement ([pr-description validator](src/lib/validators/pr-description.ts), [validation registry](governance/registries/validation_registry.json)).
- Migrate legacy target `*_policy_rows.json` sources into preserved `policy_lookup.d` extension files during embedded install and update ([install-support](bin/install-support), [embedded-installation test](tests/integration/embedded-installation.test.ts)).
- Add `pan pr-description context` and ship invocation inputs that carry the live template, root and nearest target instructions, and structured PR context ([cli](src/cli.ts), [context](src/lib/context.ts), [engine](src/lib/engine.ts)).
- Block ship submission when the declared PR Markdown artifact is missing or violates resolved target authority ([dev-workflow test](tests/integration/dev-workflow.test.ts)).

### Fixed

- Pass structural PR validation through for instruction-only target authority that declares no template contract ([pr-description validator](src/lib/validators/pr-description.ts), [pr-description tests](tests/unit/pr-description.test.ts)).

## [4.3.0] - 2026-08-23

### Changed

- Snapshot resolved away-mode settings on new run creation and integrate hypervisor registration and completion hooks in the engine without changing delegation when away mode stays disabled ([engine](src/lib/engine.ts), [project-config](src/lib/project-config.ts)).
- Document hypervisor startup and away-mode configuration in the operator guide ([operator guide](docs/operator-guide.md)).

### Added

- Add a scheduled agent hypervisor with a fixed 900000-millisecond cadence, a registry of active agents and subagents, transcript-backed liveness classification, ordered recovery, and quarantine after a second matching failure ([hypervisor](src/lib/hypervisor.ts), [HYPERVISOR-001](governance/policies/HYPERVISOR-001.json), [hypervisor CLI](src/cli.ts), [hypervisor tests](tests/integration/hypervisor-cli.test.ts)).
- Add away mode with typed `config.json` guardrails, ranked blocker evaluation, rollback-gated selection, and an append-only decision ledger that stays disabled unless the operator enables it ([away-mode](src/lib/away-mode.ts), [AWAY-001](governance/policies/AWAY-001.json), [away-mode tests](tests/unit/away-mode.test.ts)).
- Expose registry-backed agent health on `pan list`, `pan status`, `pan hypervisor status`, and `pan away status`, and add a cursor-agent executor adapter for hypervisor remediation calls ([cli](src/cli.ts), [render](src/lib/render.ts), [cursor-agent](src/lib/executors/cursor-agent.ts)).
- Add the hypervisor persona, skill, and projected agent definition, plus autonomy-state validation for registry and ledger records ([hypervisor persona](library/personas/hypervisor.md), [autonomy-state validator](src/lib/validators/autonomy-state.ts)).

## [4.2.0] - 2026-08-21

### Changed

- Suppress workflow operator artifacts by default. New runs omit stage brief source JSON, rendered HTML, and workflow PR copy unless the operator requests them. Legacy runs without `operator_artifacts` state keep the previous enabled behavior ([engine](src/lib/engine.ts), [operator-artifacts](src/lib/operator-artifacts.ts), [operator-layout test](tests/integration/operator-layout.test.ts)).
- Make every workflow stage prompt and ship PR-description creation conditional on an explicit `operator_brief` contract. Resolve artifact-only validators such as OPERATOR-ARTIFACT-VALIDATE-001 and SIMPLIFIED-ENGLISH-VALIDATE-001 only when a brief is requested ([requirements/resolve](src/lib/requirements/resolve.ts), [policies](src/lib/policies.ts), [workflow prompts](library/workflows)).
- Update BRIEF-001, GLOBAL-001, STE-001, and PR-001 to govern optional generation without requiring default artifacts ([governance/policies](governance/policies)).

### Added

- Add `operator_artifacts` run state with `suppressed` and `requested` modes. Support `pan init --operator-artifacts` for run-wide requests and `pan prepare <run-id> --operator-artifacts` for the current stage and its retries ([state](src/lib/state.ts), [cli](src/cli.ts), [cli-help test](tests/integration/cli-help.test.ts)).
- Add `pan briefs generate --run <run-id> [--stage <slug>] [--force]` to build validated HTML briefs from canonical submitted stage records without rerunning workers ([operator-artifact-generation](src/lib/operator-artifact-generation.ts), [operator-artifact-profiles](src/lib/operator-artifact-profiles.ts), [operator-artifact-generation test](tests/unit/operator-artifact-generation.test.ts)).
- Propagate an explicit run-wide artifact request through best-of-N candidate and consolidation runs ([best-of-n](src/lib/best-of-n.ts), [best-of-n test](tests/integration/best-of-n.test.ts)).
- Document default suppression, on-demand options, the generation command, and PR-description boundaries in [AGENTS.md](AGENTS.md), [README.md](README.md), and [operator-guide](docs/operator-guide.md).

### Fixed

- Harden embedded install projection refresh against stale agent definitions ([install-support](bin/install-support), [projection test](tests/unit/projection.test.ts)).

## [4.1.0] - 2026-08-19

### Changed

- Run the workflow supervisor in the operator session instead of through a nested child agent. Documentation, commands, and projections now describe inline supervision, and a regression scan rejects nested-relay prose in README.md and docs ([AGENTS.md](AGENTS.md), [pan-start](library/cursor/commands/pan-start.md), [pan-resume](library/cursor/commands/pan-resume.md), [supervisor-entry-point-contract test](tests/regression/supervisor-entry-point-contract.test.ts)).
- Make the meta-orchestrator the sole supervisor for best-of-N candidate runs. Stop generating run-scoped orchestrator variants and omit unused supervisor paths from best-of-n init output ([meta-orchestrator](library/cursor/agents/meta-orchestrator.md), [best-of-n test](tests/integration/best-of-n.test.ts)).
- Extend operator note visibility in OPERATOR-001. Gate waivers stay required context while active, and a no-stage resume note replaces a prepared worker card or refuses attachment when no active card exists ([OPERATOR-001](governance/policies/OPERATOR-001.json), [operator-pause test](tests/integration/operator-pause.test.ts)).
- Always include approval directives that target a stage while keeping the numeric remediation-note limit for other notes ([context](src/lib/context.ts), [context test](tests/unit/context.test.ts)).
- Map release 4.0.0 to merge commit d67a8ebc in release/index.json ([release/index.json](release/index.json)).

### Added

- Add run-scoped model evidence for the unpinned supervisor and each Cursor worker. Record the supervisor effective model at run entry, probe each worker before launch, and enforce evidence only on cards that declare model_evidence_required ([engine](src/lib/engine.ts), [cursor-probe](src/lib/executors/cursor-probe.ts), [model-evidence test](tests/integration/model-evidence.test.ts)).
- Require an authenticated cursor-agent before a run can advance past supervisor model evidence. `/pan-start` step 4 records the supervisor effective model, which marks later worker cards. Marked cards need worker probe evidence from `./bin/pan models --probe`, and the supervisor stops with `CURSOR_MODEL_EVIDENCE_UNAVAILABLE` when cursor-agent is not authenticated ([pan-start](library/cursor/commands/pan-start.md), [model-evidence test](tests/integration/model-evidence.test.ts)).
- Resolve applicable AGENTS.md files from declared changed paths and validate target_instruction_evidence.read_paths at submission with TARGET_INSTRUCTION_COVERAGE_MISSING ([target-instructions](src/lib/target-instructions.ts), [stage-validators](src/lib/validators/stage-validators.ts), [target-instructions test](tests/unit/target-instructions.test.ts)).
- Merge target-owned policy lookup rows from governance/registries/policy_lookup.d/\*.json after the harness table with loud failures for malformed, duplicate, or unresolvable rows ([policies](src/lib/policies.ts), [embedded-installation test](tests/integration/embedded-installation.test.ts)).
- Deliver ENG-001, LANG-001, and PY-001 guidance on tech-lead plan cards and preserve generated language rows through embedded refresh ([policy_lookup_table.json](governance/registries/policy_lookup_table.json), [render test](tests/unit/render.test.ts)).

### Fixed

- Locate operator rejection feedback by decision and target stage instead of array position in ship-reject integration tests ([ship-reject test](tests/integration/ship-reject.test.ts)).
- Export snapshotEntryPath from git.ts and remove the duplicated helper in context.ts ([git](src/lib/git.ts), [context](src/lib/context.ts)).
- Remove the dead include_active_waivers stage-context flag after waiver inclusion became unconditional ([stage.schema.json](library/schemas/stage.schema.json), [workflow](src/lib/workflow.ts)).

## [4.0.0] - 2026-08-18

### Changed

- Capture pre-implementation repository-check baselines only for the profiles the run's verification level gates its source-mutating stages on, instead of every profile any stage references. The expensive `full` profile is never run before the coder starts — under the default level a dev run baselines `static` and `fast` in minutes instead of running integration and end-to-end suites for half an hour or more — and a gate whose profile was legitimately never baselined is judged on its own result instead of failing closed ([engine](src/lib/engine.ts), [validation](src/lib/validation.ts), [runtime-protocol](docs/runtime-protocol.md), [dev-workflow test](tests/integration/dev-workflow.test.ts)).
- Slim the invocation read attestation to its load-bearing fields — invocation id, effective model, contract path, whole-contract digest, and status — and stop scaffolding or requiring the per-section and per-guidance digest echoes, which re-proved what the contract digest already proves at 2–3 KB of transcription per attempt. Volunteered echoes from legacy scaffolds are still validated exactly ([validation](src/lib/validation.ts), [scaffold](src/lib/requirements/scaffold.ts), [render](src/lib/render.ts), [stage-output schema](library/schemas/stage-output.schema.json), [write-stage-output skill](library/skills/write-stage-output.md)).
- Read the intake product spec from the intake stage's own output when validating a plan, instead of requiring the plan document to carry a ~3.4 KB verbatim copy; an embedded copy remains a fallback for runs without an intake record, and the plan prompt now says not to duplicate the spec ([stage-validators](src/lib/validators/stage-validators.ts), [plan prompt](library/workflows/dev/prompts/plan.md)).
- Require criterion self-evaluation prose only where it informs: an explanation on `fail`/`not_applicable` verdicts and evidence on hard-criterion pass claims; soft-criterion passes need neither, and `risks`/`unknowns` are optional with absent meaning none to report ([validation](src/lib/validation.ts), [operator-artifact validator](src/lib/validators/operator-artifact.ts), [stage-output schema](library/schemas/stage-output.schema.json)).

### Added

- Add run verification levels: a `verification` block in `config.json` (built-ins `minimal`, `light`, `thorough`; default `light`) maps each shell gate to the repository-check profile it actually runs, or skips it. Runs snapshot the resolved level at init (`pan init --verification <level>`), the operator can change an in-flight run with `pan verification <run-id> set <level>`, and the `full` profile never runs unless the operator explicitly selects a level that names it — the team and CI own the heavier suites ([verification](src/lib/verification.ts), [engine](src/lib/engine.ts), [validation](src/lib/validation.ts), [cli](src/cli.ts), [config](config.json), [verification test](tests/unit/verification.test.ts)).
- Let intake and plan workers recommend a different verification level in `data.verification_recommendation` (`level`, `reason`); the next prepare pauses once with an operator decision naming the exact apply command, and resuming without applying declines it ([engine](src/lib/engine.ts), [stage-validators](src/lib/validators/stage-validators.ts), [intake prompt](library/workflows/dev/prompts/intake.md), [plan prompt](library/workflows/dev/prompts/plan.md)).
- Require stage delegation to launch from the top level of the agent hierarchy and cap agent nesting at two levels (top level → child agent → subagent, no further): experimentally confirmed, Cursor honors an agent definition's model mapping only for a top-level launch and ALWAYS assigns the platform default model to a spawn made from inside another subagent — the actual mechanism behind every silently wrong-model stage launch. Child agents may still spawn nested subagents for auxiliary non-delegation work (exploration, debugging, review-squad dimension charters) accepting the default model ([ORCH-001](governance/policies/ORCH-001.json), [DELEGATE-001](governance/policies/DELEGATE-001.json), [INVOCATION-001](governance/policies/INVOCATION-001.json), [render](src/lib/render.ts), [review-squad skill](library/skills/review-squad.md), [AGENTS.md](AGENTS.md)).
- Require stage delegation to launch the named projected agent the card's delegation block points at, never an ad-hoc subagent: only the named `.cursor/agents/pan-<persona>.md` definition carries the persona's model mapping, so an ad-hoc spawn silently runs the executor's default model (Sol's default variant is 1M Medium) while delivering the correct contract text. The delivery steps name the exact agent, the delegation artifact is labeled with the launched agent name, and ad-hoc subagents stay valid for auxiliary non-delegation work such as repository exploration ([INVOCATION-001](governance/policies/INVOCATION-001.json), [render](src/lib/render.ts), [engine](src/lib/engine.ts), [AGENTS.md](AGENTS.md)).
- Add `pan models --probe` (composable with `--sync`): launch one minimal cursor-agent call per distinct cursor-executor spec in the active config, read the variant the `system/init` event echoes, and fail loudly when it differs from the catalog-composed expectation (model display name plus per-value display fragments in declared parameter order). Static validation proves a spec is well-formed for the catalog snapshot; the probe proves what it launches today, which matters because Cursor's failure mode for an unusable spec is silent fallback to the model's default variant — Sol's default is 1M Medium ([cursor-probe](src/lib/executors/cursor-probe.ts), [cursor-catalog](src/lib/executors/cursor-catalog.ts), [cli](src/cli.ts)).
- Accept merge-patch revision submissions on retries: `{ "revises": "<prior invocation id>", "patch": { ... } }` applies an RFC 7386 JSON merge patch over the prior attempt's output, so fixing two defects in a 20 KB document costs a patch instead of a full re-emission. The merged document flows through every validation a full submission would, the history item records `revised_from`, and the retry card teaches the form with the prior invocation id filled in ([json-merge-patch](src/lib/json-merge-patch.ts), [engine](src/lib/engine.ts), [render](src/lib/render.ts), [dev-workflow test](tests/integration/dev-workflow.test.ts)).

### Fixed

- Validate bracket specs against the catalog's variant grid, not only its per-parameter value lists: valid combinations are not the full product of parameter values (gpt-5.6-sol offers `fast=true` only at `context=272k`), so a phantom combination such as `gpt-5.6-sol[context=1m,reasoning=high,fast=true]` previously passed validation and silently launched the default variant. Membership is judged by projection onto the keys the spec names, because a grid may carry hidden dimensions beyond the public parameters (claude-opus-5 declares a `cyber` axis its parameter list omits) ([cursor-catalog](src/lib/executors/cursor-catalog.ts), [cursor-catalog test](tests/unit/cursor-catalog.test.ts)).
- Propagate operator approval notes to the routed stage: `pan decide <run> approve --note <directive>` previously recorded the note only in the event log — `decideRun` recorded feedback for `revise` and `reject` but never `approve` — so a directive aimed at the next stage silently never reached it (HR-001, run 63322_Aug-18-1287_box-poller-p). A non-empty approval note now creates durable operator feedback targeted at the routed stage and arrives on that stage's next card as required input; terminal and paused routes keep the note as audit evidence, and an empty note remains a pure approval, per the note-semantics contract added to OPERATOR-001 ([engine](src/lib/engine.ts), [context](src/lib/context.ts), [OPERATOR-001](governance/policies/OPERATOR-001.json), [dev-workflow test](tests/integration/dev-workflow.test.ts)).
- Hand supervisor rejection feedback to the retry worker: a supervisor-failed attempt records `outcome: success`, so the retry card previously carried no failure reason at all and the assessment file was not among the worker's inputs. The prior-failure block now folds in the failing assessment's verdict, summary, and action items, and the assessment artifact is a required input on retry cards ([context](src/lib/context.ts), [render](src/lib/render.ts), [engine](src/lib/engine.ts)).

## [3.7.0] - 2026-08-17

### Changed

- Name the exact reviewer-remediation output fields in the review prompt — `resolution: resolved_in_review`, `remediation_stage: review`, and a non-empty `changed_files` array — because workers repeatedly disclosed repairs in prose while leaving `changed_files` empty, tripping the advisory REVIEW-VALIDATE-001 check ([review prompt](library/workflows/dev/prompts/review.md)).

### Added

- Grant the reviewer authority to amend acceptance criteria proven unimplementable, self-contradictory, unverifiable, or otherwise unworkable as written, recording each amendment in `data.review.criterion_amendments` with the original and amended text, a reason class, a justification, and reproduced evidence, with a lower amendment threshold when the operator-involvement profile ratified the specification without the human operator ([REVIEW-001](governance/policies/REVIEW-001.json), [review prompt](library/workflows/dev/prompts/review.md), [review-squad skill](library/skills/review-squad.md)).
- Validate criterion amendments in REVIEW-VALIDATE-001: an amendment must name a plan criterion, change the text, use a registered reason class, carry evidence, and be re-verified through a matching acceptance result ([stage-validators](src/lib/validators/stage-validators.ts), [stage-output-requirements](library/schemas/stage-output-requirements.json)).
- Disclose reviewer criterion amendments in the release packet alongside waivers and deferred acceptance criteria, and direct QA to test against amended criterion text ([SHIP-001](governance/policies/SHIP-001.json), [ship prompt](library/workflows/dev/prompts/ship.md), [test prompt](library/workflows/dev/prompts/test.md)).

### Fixed

- Stop rejecting and rewriting valid Cursor model specs. Cursor parameters are per-model — GPT families take `reasoning`, Claude/Grok/Gemini families take `effort`, and values differ per model — so the v3.5.0 grammar (rejecting `reasoning=`/`thinking=`, hardcoded model and effort enums, a `context` pattern predating the 1m window, and rewriting specs into a flat `<model>-<effort>` slug that is not a model id) refused or mangled strings Cursor itself accepts and projected specs Cursor silently degraded to default variants. Projection now emits the configured spec verbatim in Cursor's documented bracket grammar, canonical drift comparison no longer renames keys or collapses `model[]` into `model`, and the GPT rows in `config.json` are corrected from `effort=` to `reasoning=`. A bracketed spec must also specify every declared parameter of its model — the cursor-agent CLI rejects partial bracket specs such as `claude-fable-5[]` outright, verified by runtime probes that resolved every configured spec to exactly the requested variant — so the underspecified Claude rows are expanded to full specs ([cursor-catalog](src/lib/executors/cursor-catalog.ts), [mapping](src/lib/executors/mapping.ts), [projection](src/lib/projection.ts), [config](config.json), [best-of-n-config example](library/templates/best-of-n-config.example.json)).
- Stop REVIEW-VALIDATE-001 from flagging a pass verdict as inconsistent when the only unresolved findings are routed to the operator, matching the review contract's promise that defects outside the run's workspace do not fail the verdict or loop the workflow ([stage-validators](src/lib/validators/stage-validators.ts)).
- Support an optional account-local `governance/registries/cursor_model_catalog.json` file for strict model and parameter validation. The catalog is ignored by Git and excluded from installation payloads, so shared configurations remain grammar-only unless the current operator supplies their own catalog ([cursor-catalog](src/lib/executors/cursor-catalog.ts), [codec](src/lib/executors/cursor-catalog-codec.ts)).

## [3.6.0] - 2026-08-15

### Changed

- Derive run, best-of-N, and session directory suffixes from high-signal request keywords (12-character cap, ordinal deduplication, UUID fallback) instead of opaque hex fragments, and migrate existing hash-suffixed directories from persisted run state ([naming](src/lib/naming.ts), [state](src/lib/state.ts), [workflow-artifacts](src/lib/workflow-artifacts.ts), [naming test](tests/unit/naming.test.ts)).
- Standardize non-durable `runtime/inbox/` and `runtime/pr-descriptions/` file names onto the temporal prefix scheme used by `runtime/logs/workflows/`, recovering timestamps from legacy names or file modification time and rewriting persisted references ([workflow-artifacts](src/lib/workflow-artifacts.ts), [workflow-artifacts test](tests/unit/workflow-artifacts.test.ts)).
- Extend `pan archive` retention to best-of-N session directories and temporal inbox/PR-description files, moving items older than the window (default 7 days) into each directory's `archive/` child ([workflow-artifacts](src/lib/workflow-artifacts.ts), [runtime-archive-cli test](tests/integration/runtime-archive-cli.test.ts)).
- Reconcile the installed payload on refresh and update: local fixes to harness-owned files are superseded by the Pancreator source with an operator flag and a backup under `.pancreator/backups/payload/`, target-specific extensions are preserved through the swap, and locally deleted files are restored with a notice ([install](bin/install), [install-support](bin/install-support), [embedded-installation test](tests/integration/embedded-installation.test.ts)).
- Require `/pan-build-docs` to treat operator-customized configuration — harness `config.json`, `$operator` blocks and custom repository-check profiles, and operator-authored primer content — as durable input merged into regenerated documentation ([pan-build-docs](library/cursor/commands/pan-build-docs.md)).
- Exclude content-addressed artifacts from run-ID reference rewrites during workflow name migration so recorded digests stay valid ([workflow-artifacts](src/lib/workflow-artifacts.ts)).

### Added

- Record a `payload_files` manifest (schema version 4) in `install.json` hashing every release-owned payload file so updates can distinguish local fixes and target extensions from shipped content ([install-support](bin/install-support)).
- Add the `harness-workflow-qa` persona and `/pan-qa-workflow` command: drive a real or synthetic workflow as orchestrator to validate harness changes, with per-stage QA checklists, one-minute check-in cadence, remediation duties, and a logged pre-emptive operator waiver ([persona](library/personas/harness-workflow-qa.md), [command](library/cursor/commands/pan-qa-workflow.md)).
- Support a top-level `setup` command array in `runtime/repository-checks.json`: worktree-targeted runs execute it before pre-implementation baseline capture and pause with an operator decision when it fails, so a fresh worktree without dependencies can no longer hang or poison the baseline ([repository-checks](src/lib/repository-checks.ts), [engine](src/lib/engine.ts)).

### Fixed

- Resolve `pan repository-check` run inside a harness-managed worktree to the owning installation's `runtime/repository-checks.json` instead of silently falling back to the weaker template suite ([repository-checks](src/lib/repository-checks.ts), [repository-checks test](tests/unit/repository-checks.test.ts)).
- Accept the `path :: case name` convention in `implementation.tests_added` entries so IMPLEMENTATION-CLAIMS-VALIDATE-001 resolves the file portion instead of false-negating on annotated entries ([stage-validators](src/lib/validators/stage-validators.ts)).
- Add `remediation_stage: operator` for unresolved review findings whose defect lies outside the run's workspace, resolving the REVIEW-VALIDATE-001 conflict with the review contract's no-loop rule for harness defects ([stage-validators](src/lib/validators/stage-validators.ts), [stage-output-requirements](library/schemas/stage-output-requirements.json), [review prompt](library/workflows/dev/prompts/review.md)).
- Accept any executor-selected model in `invocation_attestation.model` when the card declares model `auto`, instead of demanding an exact match no worker can satisfy ([validation](src/lib/validation.ts)).
- Stop run-ID keyword derivation from ingesting the month token of an already-standardized request filename ([naming](src/lib/naming.ts)).
- Walk runtime trees iteratively during maintenance and exclude `runtime/worktrees/` from reference-rewrite scans: spreading a large subtree's file list into `push()` exceeded the engine argument limit and crashed installs onto targets whose worktrees carry installed dependencies ([workflow-artifacts](src/lib/workflow-artifacts.ts), [workflow-artifacts test](tests/unit/workflow-artifacts.test.ts)).

## [3.5.0] - 2026-08-14

### Changed

- Rebuild repository-check diagnostic extraction so only genuine failures form identities, cap embedded delta arrays at 100 entries per class, and rank real failures in gate explanations ([repository-checks](src/lib/repository-checks.ts), [repository-check-delta test](tests/regression/repository-check-delta.test.ts)).
- Move run state to schema version 2 with content-addressed delta references, revision events instead of state_after payloads, a default 1 MB state budget, and harness-owned compaction that never renames invocation records ([state](src/lib/state.ts), [state test](tests/unit/state.test.ts)).
- Resolve repository-check profile timeouts to the maximum applicable bound and reject timeout inversions during validation ([repository-checks](src/lib/repository-checks.ts), [repository-checks test](tests/unit/repository-checks.test.ts)).
- Route QA stages whose full-profile delta contains only timeout or collection artifacts on carried infrastructure to an environment-blocked operator pause instead of implementation ([engine](src/lib/engine.ts), [dev-workflow test](tests/integration/dev-workflow.test.ts)).
- Scope RELEASE-VALIDATE-001 to the declared worktree and compare change_list entries structurally ([stage-validators](src/lib/validators/stage-validators.ts), [release-validator test](tests/unit/validators-stage-validators.test.ts)).
- Translate Pancreator model specs into executor-native Cursor slugs in projected frontmatter and reject obsolete option keys reasoning and thinking with an error that names effort ([cursor-catalog](src/lib/executors/cursor-catalog.ts), [mapping](src/lib/executors/mapping.ts), [projection](src/lib/projection.ts)).
- Derive stage card output contracts and validator field requirements from one shared schema document ([stage-output-requirements](library/schemas/stage-output-requirements.json), [render](src/lib/render.ts)).
- Normalize trailing whitespace and final newlines in delegation.canonical_equality ([handlers](src/lib/requirements/handlers.ts), [delegation-equality test](tests/unit/delegation-equality.test.ts)).
- Run target-declared environment probes at worktree baseline capture, pausing before the first source-allowed stage when a probe fails ([engine](src/lib/engine.ts), [repository-checks](src/lib/repository-checks.ts)).
- Record invocation liveness timestamps and mark stale invocations in pan status ([state](src/lib/state.ts), [cli](src/cli.ts), [invocation-liveness test](tests/unit/state.test.ts)).

### Added

- Add `DELEGATE-001` for subagent supervision cadence and operator-conversation responsiveness ([DELEGATE-001](governance/policies/DELEGATE-001.json), [AGENTS.md](AGENTS.md)).
- Add `src/lib/executors/cursor-catalog.ts` as the Cursor model slug catalog and resolution layer ([cursor-catalog test](tests/unit/cursor-catalog.test.ts)).
- Add preserved audited-run fixtures under `tests/fixtures/harness-repair/` for regression coverage of findings HR-001 through HR-008 ([dev-workflow test](tests/integration/dev-workflow.test.ts)).
- Require `invocation_attestation.model` in stage output and prefill it from the invocation card model ([stage-output schema](library/schemas/stage-output.schema.json), [scaffold](src/lib/requirements/scaffold.ts)).

### Fixed

- Stop quoting PASSED or formatting lines as gate failure evidence when a suite passes under pytest-xdist reordering ([repository-checks](src/lib/repository-checks.ts)).
- Keep legacy version 1 runs with embedded deltas, state_after events, and renamed invocation prefixes readable without a rewrite ([state](src/lib/state.ts), [runtime-archive-cli test](tests/integration/runtime-archive-cli.test.ts)).

## [3.4.0] - 2026-08-14

### Changed

- Split new workflow run directories into `agent/` machine records and `operator/` narratives. Layout v1 runs keep the legacy flat tree, and status, resume, and archive commands work on both ([run-layout](src/lib/run-layout.ts), [RUNTIME-001](governance/policies/RUNTIME-001.json), [runtime-archive-cli test](tests/integration/runtime-archive-cli.test.ts)).
- Route operator feedback, stage-repair notes, pause ratifications, and gate waivers to `agent/decisions/` instead of `operator/`, so the operator directory holds only the request, stage HTML narratives, and ship-produced Markdown ([engine](src/lib/engine.ts), [operator-layout test](tests/integration/operator-layout.test.ts)).
- Delete the transient brief source JSON after a validated render. Retain it only when render or output validation fails, and record the source checksum in stage history before deletion ([engine](src/lib/engine.ts), [types](src/lib/types.ts)).
- Require supervisor chat reports to state the outcome, the consequence, and the next action in plain language, and to include a clickable rendered HTML path ([ORCH-001](governance/policies/ORCH-001.json), [STE-001](governance/policies/STE-001.json), [orchestrator persona](library/personas/orchestrator.md)).
- Extend release and PR-description guidance to resolve layout v1 and v2 artifact paths from run state ([write-pr-description](library/skills/write-pr-description.md), [release-steward persona](library/personas/release-steward.md)).

### Added

- Add `src/lib/run-layout.ts` as the single layout resolver for v1 and v2 path construction across engine, state, context, validation, requirements, and CLI code ([run-layout](src/lib/run-layout.ts), [run-layout test](tests/unit/run-layout.test.ts)).
- Add `operator_brief_html` to `pan submit` JSON output so the supervisor can link the rendered stage narrative without searching the run tree ([cli](src/cli.ts)).
- Add `library/skills/supervisor-recovery.md` for interrupted-session reconciliation before worker relaunch ([BESTOFN-001](governance/policies/BESTOFN-001.json)).
- Add layout-aware validation artifact paths, transient-source artifact rules, and scaffold behavior that omits the brief source from final artifacts ([validation](src/lib/validation.ts), [scaffold](src/lib/requirements/scaffold.ts), [validators-stage-output test](tests/unit/validators-stage-output.test.ts)).

### Fixed

- Stop throwing on a stray `artifacts/` directory during v2 finalization; ensure expected directories instead ([workflow-artifacts](src/lib/workflow-artifacts.ts), [artifact-finalization test](tests/integration/artifact-finalization.test.ts)).
- Cover all four operator control-record write branches in the operator-layout integration test so AC-3 regressions fail before review ([operator-layout test](tests/integration/operator-layout.test.ts)).

## [3.3.0] - 2026-08-12

### Changed

- Extend best-of-N session handling and meta-orchestrator guidance for foreground child supervision and consolidated remediation routing ([best-of-n](src/lib/best-of-n.ts), [BESTOFN-001](governance/policies/BESTOFN-001.json), [meta-orchestrator agent](library/cursor/agents/meta-orchestrator.md)).

### Added

- Add harness worktree management with a durable index, linked `git worktree` creation, removal safety, stale-record pruning, and reconcile into a recorded worktree or an existing branch, including a branch a checkout already holds ([worktrees](src/lib/worktrees.ts), [cli](src/cli.ts), [operator guide](docs/operator-guide.md)).
- Add `pan worktree resolve <name>` as the create-or-resolve entry for projected librarian and release-steward commands, and extend `--worktree <name>` to workflow starts through the orchestrator, standalone personas through governance cards, and workspace-aware CLI utilities ([cli](src/cli.ts), [orchestrator agent](library/cursor/agents/orchestrator.md), [projected commands](library/cursor/commands/pan-build-docs.md)).
- Run repository-check baselines, profile commands, and deterministic gate reruns inside the run workspace when a worktree is selected ([engine](src/lib/engine.ts), [repository-checks](src/lib/repository-checks.ts)).
- Add configurable `worktrees.setup` commands and source selection from branch, revision, or recorded worktree at creation ([project-config](src/lib/project-config.ts), [setup-commands](src/lib/setup-commands.ts), [config schema](library/schemas/config.schema.json)).

### Fixed

- Validate every reconcile source before creating or resolving a branch target so a dirty source cannot leave a recorded integration target ([worktrees](src/lib/worktrees.ts), [worktree-cli test](tests/integration/worktree-cli.test.ts)).

## [3.2.0] - 2026-08-11

### Added

- Add `ASK-001` and `QUESTION-TOOL-VALIDATE-001` so every Cursor-executor agent session is instructed to use `cursor/ask_question`, and canonical agent frontmatter cannot name or block the method ([ASK-001](governance/policies/ASK-001.json), [validation](src/lib/validation.ts), [handlers](src/lib/requirements/handlers.ts)).
- Require a chat fallback when `cursor/ask_question` is unavailable: the agent asks in its normal response channel and flags the unavailability, rather than assuming an answer, failing silently, or reporting `blocked` for the tool gap alone ([ASK-001](governance/policies/ASK-001.json)).
- Add an `Operator questions` section to `AGENTS.md` and matching sentences to both canonical Cursor rules so unbound agents receive the same instruction ([AGENTS.md](AGENTS.md), [pancreator-self-development.mdc](library/cursor/rules/pancreator-self-development.mdc), [pancreator-embedded.mdc](library/cursor/rules/pancreator-embedded.mdc)).

### Fixed

- Skip checksum capture when a harness validator targets the repository root `.`, so gate-phase checks run against the workspace without treating the directory as a file ([run.ts](src/lib/requirements/run.ts)).
- Derive embedded-installation and pipeline-config test expectations from fixture data instead of hard-coded persona models ([embedded-installation.test.ts](tests/integration/embedded-installation.test.ts), [pipeline-config.test.ts](tests/unit/pipeline-config.test.ts)).

## [3.1.0] - 2026-08-10

### Changed

- Extend `AGENTS.md`, embedded and detached templates, and the policy lookup table for best-of-N work mode, the meta-orchestrator start surface, and the run-scoped variant-agent rule ([AGENTS.md](AGENTS.md), [policy lookup table](governance/registries/policy_lookup_table.json)).

### Added

- Add best-of-N mode for the `dev` workflow: the operator invokes the projected `pan-meta-orchestrator` agent with a task and an N+1 configs file. `./bin/pan best-of-n` creates N autonomous `dev-candidate` runs in detached Git worktrees, then one `metacritic` consolidation run in the main workspace that reuses dev review, QA, and ship. Run-scoped Cursor agent variants carry per-candidate models, and `BESTOFN-001` governs the session ([best-of-n](src/lib/best-of-n.ts), [meta-orchestrator agent](library/cursor/agents/meta-orchestrator.md), [metacritic workflow](library/workflows/metacritic/workflow.json), [dev-candidate workflow](library/workflows/dev-candidate/workflow.json), [BESTOFN-001](governance/policies/BESTOFN-001.json), [docs/best-of-n.md](docs/best-of-n.md)).
- Add `./bin/pan best-of-n init|status|abandon|consolidate|clean` with session mutex serialization, recoverable initialization that writes state before the first worktree, child-run reconciliation on every session command, and refusal of `clean` while a candidate or consolidation run is still active unless `--force` ([cli](src/cli.ts), [best-of-n](src/lib/best-of-n.ts)).
- Add run-scoped agent variant projection: `projectPersonaVariants` renders `.cursor/agents/pan-<persona>--<suffix>.md` with override models, and drift validation excludes variants from active-config comparison ([projection](src/lib/projection.ts), [engine](src/lib/engine.ts)).
- Add `CreateRunOptions.pipelineOverride`, `cursorAgentSuffix`, and `useWorkflowDeclaredGates` so best-of-N can pin per-run models and workflow-declared gates without changing the dev workflow itself ([engine](src/lib/engine.ts), [pipeline-config](src/lib/pipeline-config.ts)).
- Attest referenced guidance reads in stage output. The contract manifest indexes every referenced guidance selection, the scaffold prefills one `invocation_attestation.guidance` entry per selection with status `pending`, and submission requires the worker to declare each entry `read`, `skipped` with the reason the trigger did not apply, or `reference_failed` with the concrete error ([render](src/lib/render.ts), [scaffold](src/lib/requirements/scaffold.ts), [validation](src/lib/validation.ts), [stage-output schema](library/schemas/stage-output.schema.json)).
- State the digest basis on every guidance reference: SHA-256 of the selected text after leading and trailing whitespace is trimmed ([policy-guidance](src/lib/policy-guidance.ts), [validation](src/lib/validation.ts)).

### Fixed

- Name the rejected value and the allowed vocabulary when an operator brief references an unknown brief type, section semantic, card type, or field semantic ([briefs](src/lib/briefs.ts)).

## [3.0.0] - 2026-08-04

### Changed

- Replace full guidance unrolling with a compact core contract and audited guidance references in workflow cards, standalone governance cards, and policy-backed Cursor rules. Each reference names the source path, selected range, content digest, and read trigger while the invocation JSON keeps the exact selected content for audit ([render](src/lib/render.ts), [policy-guidance](src/lib/policy-guidance.ts), [policies](src/lib/policies.ts), [AGENTS.md](AGENTS.md)).
- Write `invocation_attestation.status` as `pending` in the stage output scaffold until the worker confirms the contract read. Submission rejects `pending`, stale, and missing attestation states ([scaffold](src/lib/requirements/scaffold.ts), [validation](src/lib/validation.ts)).
- Record each persona's executor in `pipeline-config.snapshot.json`, on invocation cards (`stage.persona_executor`, rendered in the card header), and in `stage_history` per attempt. The `prepare` frontmatter-equality assertion now applies only to `cursor`-executor personas, and `pan models --sync` skips projecting external personas into `.cursor/` and removes a stale projected agent when a persona moves to an external executor. Runs created before this change prepare and resume unchanged ([pipeline config](src/lib/pipeline-config.ts), [projection](src/lib/projection.ts)).
- Reword the operating-card delegation rule from mechanism to outcome: named worker stages are delegated to the executor resolved from the run's pipeline snapshot. `INVOCATION-001` names harness-spawned external execution as a permitted delivery mechanism, and `ORCH-001` directs the supervisor to fulfill `invoke_agent` for an external stage by running `pan delegate` and awaiting its result ([INVOCATION-001](governance/policies/INVOCATION-001.json), [ORCH-001](governance/policies/ORCH-001.json), [embedded template](library/templates/embedded-AGENTS.md), [detached template](library/templates/detached-AGENTS.md)).

### Added

- Add the PR shepherd loop: `/pan-shepherd <pr>`, `SHEPHERD-001`, and the `shepherd-pr` skill. The shepherd watches one GitHub pull request in 60-second poll cycles; a watch window runs 15 cycles, extends until one quiet cycle when feedback is arriving, and a session runs at most 8 windows. Every feedback item lands in a durable session ledger with a recorded disposition, and bot feedback is judged against that bot's own review history — repeats keep their prior disposition, self-contradictions and induced findings are rejected as thrash instead of ping-ponged, and inter-bot conflicts are decided on the merits. Accepted items are implemented with proportionate tests and pushed to the PR head branch only after a local review-squad pass; a quiet window or a fully rejected batch ends the session. Invocation authorizes commits and pushes to that head branch only ([SHEPHERD-001](governance/policies/SHEPHERD-001.json), [shepherd-pr](library/skills/shepherd-pr.md), [pan-shepherd](library/cursor/commands/pan-shepherd.md), [governance card](src/lib/governance-card.ts)).
- Add the `shepherd-reviewer` persona so the shepherd's review squad runs on its own configured model, independent of the run-time `reviewer` mapping. The shepherd delegates each review round to the projected `pan-shepherd-reviewer` subagent, which coordinates the squad dimensions per `review-squad.md`, returns ranked findings with a pass or fail verdict, and edits nothing ([shepherd-reviewer persona](library/personas/shepherd-reviewer.md), [projected agent](library/cursor/agents/shepherd-reviewer.md), [config.json](config.json)).
- Add executor-qualified persona mappings so named worker stages can execute in Anthropic's Claude Code CLI while Cursor remains the sole orchestrator. A mapping may carry a prefix from a closed set — `cursor` (the default) or `claude-code`, as in `"reviewer": "claude-code:claude-opus-5[permission-mode=default,session-resume=true]"`. Any stage may be routed externally except the `orchestrator` persona; non-mutating stages run with file writes restricted to the harness runtime tree, and `scope.no_unapproved_changes` remains the gate of record ([mapping parser](src/lib/executors/mapping.ts), [config schema](library/schemas/config.schema.json), [executor test](tests/integration/claude-code-executor.test.ts)).
- Add `pan delegate <run-id>`: for an external-executor stage the harness — not the supervisor — pipes the complete canonical card to `claude -p --output-format json` in the run's workspace, so verbatim delivery is a property of code and the supervisor output ceiling stops applying. The harness authors the delegation audit itself: the delivered prompt byte for byte, plus an execution record with executor identity, argument vector, exit status, and session id. Executor stdout and stderr persist as run evidence under the OUTPUT-001 pattern ([engine](src/lib/engine.ts), [claude-code executor](src/lib/executors/claude-code.ts), [EXECUTOR-001](governance/policies/EXECUTOR-001.json)).
- Add fail-closed executor preflight: run creation verifies the `claude` binary and minimum version for external personas, and the first delegation of a run verifies credentials with a no-op invocation. A failed preflight pauses the run with an `operator_decision`; the harness never silently substitutes an executor, because that would falsify the model snapshot ([engine](src/lib/engine.ts), [EXECUTOR-001](governance/policies/EXECUTOR-001.json)).
- Add executor session continuity: a successful external delegation records the CLI `session_id` beside the invocation artifacts, and `pan decide <run-id> revise` resumes that session with the operator directive so a technical-director refinement round keeps the author's full context. A failed resume falls back to a fresh full-card delegation and is audited as such; a retry after a failed attempt never resumes ([engine](src/lib/engine.ts), [runtime protocol](docs/runtime-protocol.md)).
- Add `PolicyGuidanceReference` metadata with source bounds, content digest, and read trigger while preserving exact selected content in invocation JSON snapshots ([types](src/lib/types.ts), [policies](src/lib/policies.ts)).
- Add reference-integrity validation that rejects stale digests, leaked guidance bodies, and incomplete read attestation across workflow, standalone, and generated-rule surfaces ([validation](src/lib/validation.ts)).
- Add explicit `read_trigger` fields to checked-in policies and a test guard that rejects policies relying on generated fallback triggers ([governance/policies](governance/policies), [policies test](tests/unit/policies.test.ts)).

### Fixed

- Fix the quiet-command test to isolate `PAN_VERBOSE` so an inherited environment variable does not fail the suppression case ([quiet-command test](tests/unit/quiet-command.test.ts)).
- Align `TS-001` and `VERSION-001` read triggers with mandatory review and release assessment reads ([TS-001](governance/policies/TS-001.json), [VERSION-001](governance/policies/VERSION-001.json)).

## [2.20.0] - 2026-08-03

### Changed

- Move dev intake from supervisor-owned execution to the `intake-writer` worker persona. The stage keeps its operator gate, runtime-only workspace policy, and INTAKE-001 policy route. Design and prototype intake remain supervisor-owned ([dev intake stage](library/workflows/dev/stages/intake.json), [orchestrator agent](library/cursor/agents/orchestrator.md)).
- Replace the dev intake clarification-turn instruction with a revision-directive path for unresolved questions, because a delegated worker holds no operator dialogue channel ([dev intake prompt](library/workflows/dev/prompts/intake.md)).
- Narrow pipeline-config drift detection to compare only personas the run snapshot resolves. An additive persona mapping that the run never uses no longer blocks later stages, while a changed or removed resolved mapping still fails with `PIPELINE_CONFIG_DRIFT` and a `details.personas` list ([engine](src/lib/engine.ts), [run-friction regressions](tests/regression/run-friction.test.ts)).

### Added

- Add the `intake-writer` persona and canonical Cursor agent for faithful dev intake writing and revision. The persona maps to the existing orchestrator model in `config.json`, resolves INTAKE-001 on dev intake, and projects through the generic cursor-agents manifest ([intake-writer persona](library/personas/intake-writer.md), [intake-writer agent](library/cursor/agents/intake-writer.md), [policy lookup table](governance/registries/policy_lookup_table.json)).
- Add integration, unit, and regression coverage for intake delegation, operator revision, policy resolution, model projection, supervisor delivery contracts, and the narrowed drift guard ([dev workflow test](tests/integration/dev-workflow.test.ts), [policies test](tests/unit/policies.test.ts), [run-friction test](tests/regression/run-friction.test.ts)).

## [2.19.0] - 2026-08-03

### Changed

- Update `INVOCATION-001` for referenced delivery: the supervisor pastes a compact delivery prompt that names the canonical worker contract, its digest, and a flat per-section index. Verbatim delivery remains permitted. Workers declare a per-section read attestation at submit ([INVOCATION-001](governance/policies/INVOCATION-001.json), [render](src/lib/render.ts), [validation](src/lib/validation.ts)).
- Add a `How to read this PR` section to the `/pan-write-pr` output format, for a reviewer who is about to open the diff. The section applies when a change adds or removes an abstraction, alters a flow across components, or spans more than one subsystem. It uses four registered subheadings for core changes, architecture decisions, component changes, and end-to-end flows. `PR-001` bars an unevidenced reason, a reconstructed rejected alternative, and a benefit the delta does not show ([PR-001](governance/policies/PR-001.json), [write-pr-description](library/skills/write-pr-description.md)).
- Separate the universally applicable rules in `AGENTS.md` from the rules that bind only a workflow run. The operating loop now splits into **Always applicable** and **Inside a workflow run** subheadings. A new **Applicability** section names the four contexts that read the file. A standalone-mode agent and an unbound agent previously had to guess whether a rule such as ad-hoc Subagent model inheritance bound them ([AGENTS.md](AGENTS.md)).
- Scope the `AGENTS.md` role definitions to a workflow run, and state that supervisor and worker are neither exhaustive nor default. The section sat at the global level. An agent outside a run could read the two roles as the only options and adopt supervisor authority. An agent MUST now determine its context first, and delegating a governance card confers no run authority ([AGENTS.md](AGENTS.md)).

### Added

- Add `config.json.review_mode` and the `review-squad` skill, so independent review can gather its findings through one agent per review dimension instead of one reviewer over the whole change. `default` keeps the current single-reviewer method. `squad` activates a `review_mode`-scoped policy lookup row that loads `REVIEW-002`, which unrolls the charters, the finding shape, and the calibration bar into the reviewer's card. The core dimensions are correctness, security, architecture, simplification, and operations, and `frontend` activates only when the change touches that surface. A run resolves the mode once at `pan init [--review-mode <mode>]` and records it in `state.review_mode`, so a later configuration edit cannot change a run in flight. The mode selects the method only: `REVIEW-001` keeps the verdict, the reviewer remediation boundary, and routing to implementation, and a dimension agent never edits a file ([REVIEW-002](governance/policies/REVIEW-002.json), [review-squad](library/skills/review-squad.md), [config.json](config.json), [config schema](library/schemas/config.schema.json), [review mode test](tests/integration/review-mode.test.ts)).
- Add `STE-001` and the Simplified Technical English handbook. They adopt the ASD-STE100 Issue 9 writing rules for the artifacts an operator reads. The rules cover briefs, stage narratives, remediation records, pull-request descriptions, release notes, and changelog entries. Procedural writing becomes operator instructions at 20 words per sentence, and descriptive writing becomes explanation at 25. The `warning` and `caution` risk levels map onto irreversible and recoverable operator risk. This repository does not adopt the Part 2 dictionary as a gate, because it is licensed content that this repository cannot redistribute ([STE-001](governance/policies/STE-001.json), [handbook](governance/handbooks/writing/simplified-technical-english.md), [craft-operator-artifact](library/skills/craft-operator-artifact.md)).
- Add `SIMPLIFIED-ENGLISH-VALIDATE-001`, a deterministic advisory check for the countable rules. It counts words by the rules of the standard rather than by whitespace. An identifier, a path, a command, an inline code span, and a hyphenated word each count as one word. The check skips fenced code, tables, blockquoted evidence, and headings. It reports sentence length, paragraph length, semicolons, contractions, complex verb constructions, Latin abbreviations, gender-specific pronouns, and the substitution table. The check stays advisory, so an operator can calibrate the thresholds against real artifacts before they gate a run ([validator](src/lib/validators/simplified-english.ts), [validation registry](governance/registries/validation_registry.json), [validator test](tests/unit/simplified-english-validator.test.ts)).
- Add the `prototype` workflow — intake, approach, build, evaluate — for answering a technical question fast: an ungated thin approach stage, `static` as the only hard shell gate with `fast` reported as advisory evidence, declared shortcuts, and an operator-ratified verdict with a productionization gap ([prototype workflow](library/workflows/prototype/workflow.json), [PROTO-001](governance/policies/PROTO-001.json), [prototype workflow test](tests/integration/prototype-workflow.test.ts)).
- Add operator-involvement profiles so operators declare per-stage gating granularly. A run resolves one profile at `pan init [--involvement <profile>]`, rewrites the gates in its own workflow snapshot, and records the resolution, so later configuration edits cannot change a run in flight ([operator involvement](src/lib/operator-involvement.ts), [config.json](config.json), [config schema](library/schemas/config.schema.json), [involvement test](tests/integration/operator-involvement.test.ts)).
- Add the `technical_director` run contract and `DIRECTOR-001`: an interactive mode any workflow run abides by when active, attaching to stage `checkpoint` roles rather than slugs so one contract escalates `dev/plan`, `prototype/approach`, and `design/review` alike ([DIRECTOR-001](governance/policies/DIRECTOR-001.json), [stage schema](library/schemas/stage.schema.json), [workflow loader](src/lib/workflow.ts)).
- Add `pan decide <run-id> revise --note <directive>` for operator refinement of otherwise acceptable work. A revision re-runs the stage with the directive as required input and raises that stage's attempt ceiling instead of consuming failure retry budget ([engine](src/lib/engine.ts), [types](src/lib/types.ts)).
- Add pair-programming mode: `/pan-pair`, `PAIR-001`, and the `interactive` work mode, in which the operator directs changes turn by turn and the agent applies its persona's governance while bound to no workflow, stage contract, gate, or run contract ([PAIR-001](governance/policies/PAIR-001.json), [pan-pair](library/cursor/commands/pan-pair.md)).
- Add `pan governance card --mode <mode>` so every standalone mode resolves governance through the same policy applicability map the workflow path uses, and switch `/pan-spotfix`, `/pan-debug`, `/pan-repair`, and `/pan-decompose` onto it instead of hand-assembling policy text ([governance card](src/lib/governance-card.ts), [governance card test](tests/unit/governance-card.test.ts)).
- Add a `contract` dimension to the policy lookup table so run contracts stay inside the single policy applicability map rather than a second one that could drift from it ([policy lookup table](governance/registries/policy_lookup_table.json), [policies](src/lib/policies.ts)).
- Add `pan involvement` to list configured profiles ([CLI](src/cli.ts)).
- Add referenced invocation delivery with an `InvocationContractManifest` of per-section SHA-256 digests and a compact supervisor delivery prompt that stays bounded as the contract grows ([render](src/lib/render.ts), [engine](src/lib/engine.ts), [delegation contract test](tests/regression/supervisor-delegation-contract.test.ts)).
- Add `invocation_attestation` to stage output with `INVOCATION-ATTEST-VALIDATE-001`, so submit blocks a missing, partial, reordered, stale, or unreadable contract declaration ([stage-output schema](library/schemas/stage-output.schema.json), [validation](src/lib/validation.ts)).
- Add diagnostic-delta comparison for every baseline-covered repository-check gate, reporting structured `new`, `fixed`, and `carried` failure sets instead of requiring exit 0 when inherited failures remain ([repository checks](src/lib/repository-checks.ts), [repository checks test](tests/unit/repository-checks.test.ts)).
- Add `config.local.json`, an untracked per-checkout preference file merged over `config.json` by every harness configuration reader, so `active_config`, persona model overrides, and involvement selection no longer require editing the checked-in recommended defaults ([project config](src/lib/project-config.ts), [pipeline config](src/lib/pipeline-config.ts), [operator guide](docs/operator-guide.md)).

### Fixed

- Consume the whole Unreleased section when a test fixture prepares release metadata. The fixture replaced only the `## [Unreleased]` heading, so the group headings under it merged into the fixture release. A new `### Changed` group in the real changelog then broke five integration tests, and the ship stage paused with no stated cause ([test helpers](tests/helpers.ts)).
- Report an unrecognized `criteria[].result` as an explicit validation error instead of silently coercing it to `fail`, and render a **Why the previous attempt failed** section inlining the recorded hard criteria, deterministic failures, and validation errors on every retry card. A one-token vocabulary mistake previously became an unexplained failure whose reason no retry card disclosed, so the same defect was resubmitted verbatim until the circuit breaker paused the run ([validation](src/lib/validation.ts), [context](src/lib/context.ts), [render](src/lib/render.ts), [friction regressions](tests/regression/run-friction.test.ts)).
- Accept the minimal leading persona label that `INVOCATION-001` and the supervisor commands explicitly permit, which the byte-equality delegation validator had been rejecting on every delegated stage ([validation](src/lib/validation.ts)).
- Resolve `engineering_plan.files[].path` against the run's workspace root rather than the installation root, and reject `..` traversal segments. In a detached installation every natural path failed, and escaping the installation root was the workaround that made the validator pass while writing non-portable paths into a ratified plan ([stage validators](src/lib/validators/stage-validators.ts)).
- Capture pre-implementation baselines for every repository-check profile the run's workflow gates on, not only the profiles of the stage being prepared, so a terminal gate such as a QA stage's `full` profile has a baseline and pre-existing target breakage does not hard-fail the run ([engine](src/lib/engine.ts), [dev workflow test](tests/integration/dev-workflow.test.ts)).
- Bound `max_stage_attempts` to retries of the active stage rather than lifetime visits, and stop an invocation that was prepared but never submitted from consuming an attempt. A run was previously killed by a retry budget spent entirely on successful iterations ([engine](src/lib/engine.ts)).
- Scope `implementation.changed_files` disclosure to the attempt's own workspace delta instead of the cumulative `git diff HEAD`, which charged every attempt with the whole run's accumulated diff ([stage validators](src/lib/validators/stage-validators.ts)).
- Render the renderer's accepted brief card types and section semantics on the invocation card, and suppress the derivative missing-artifact diagnostics a failed render produced. The brief schema types both fields as open strings while the renderer enforces a closed registry, and workers are barred from running the renderer to discover the difference ([briefs](src/lib/briefs.ts), [render](src/lib/render.ts), [engine](src/lib/engine.ts)).
- Bound deterministic-gate evidence logs and repository-check baselines to a head-and-tail window with an explicit elision marker, writing the untruncated capture to a sibling artifact, so a multi-megabyte transcript is no longer promoted to required reading ([validation](src/lib/validation.ts), [repository checks](src/lib/repository-checks.ts)).
- Make `pan output scaffold` idempotent for an untouched scaffold instead of throwing, so a required automation's ordinary second invocation is no longer a hard error ([scaffold](src/lib/requirements/scaffold.ts)).
- Extend seven-day `RUNTIME-001` retention to standalone-mode session directories, which would otherwise accumulate for the life of the installation ([workflow artifacts](src/lib/workflow-artifacts.ts), [workflow artifacts test](tests/unit/workflow-artifacts.test.ts)).
- Scope the `STAGE-SCAFFOLD-001` automation requirement to workflow invocations, so standalone modes no longer resolve a scaffold requirement against an output path they do not have ([AUTO-001](governance/policies/AUTO-001.json)).
- Stop operator-gated stages before their success, failure, and blocked transitions, and apply the stored outcome on approval so a failed review cannot route backward without an operator decision ([engine](src/lib/engine.ts), [operator involvement test](tests/integration/operator-involvement.test.ts)).
- Return a successful skip from `pan output validate` when no agent-owned before_operation or pre_submit requirement resolves, instead of `INVALID_ARGUMENT` ([CLI](src/cli.ts), [requirements run test](tests/integration/requirements-run.test.ts)).
- Make large invocation cards deliverable without the supervisor model reproducing the full card body, which previously exceeded the output limit and made `INVOCATION-001` unsatisfiable ([render](src/lib/render.ts), [supervisor delegation contract test](tests/regression/supervisor-delegation-contract.test.ts)).

## [2.18.0] - 2026-07-29

### Changed

- Unroll `INVOCATION-001` onto every prepared worker invocation card as a resolved **Supervisor delivery procedure** section, so delegation compliance no longer depends on ambient recall of `AGENTS.md` during the continuation loop, and fail invocation validation when the section is absent ([render](src/lib/render.ts), [engine](src/lib/engine.ts), [validation](src/lib/validation.ts)).
- Extend `/pan-start` with the complete unrolled advance loop and card-delivery contract so a run continues past intake ratification without a separate `/pan-resume` invocation, and align `/pan-resume` on the same procedure ([pan-start](library/cursor/commands/pan-start.md), [pan-resume](library/cursor/commands/pan-resume.md)).
- Replace the buried, unlinked `INVOCATION-001` pointer in the operating card with the unrolled delegation steps, linked policies, and an explicit statement that "supervisor" and the `orchestrator` persona name one role ([AGENTS.md](AGENTS.md)).
- Deliver the supervisor brief through `ORCH-001` `guidance_sources` so `library/personas/orchestrator.md` reaches supervisor-owned cards instead of remaining a file nothing loads ([ORCH-001](governance/policies/ORCH-001.json), [orchestrator persona](library/personas/orchestrator.md)).
- Consolidate every browser-inspection and Visual QA rule into `BROWSER-001`, remove the divergent restatements from personas, Cursor agent cards, workflow prompts, handbooks, and docs, and reconcile the design-iteration capture fallback against the QA verdict prohibition ([BROWSER-001](governance/policies/BROWSER-001.json), [DESIGN-001](governance/policies/DESIGN-001.json), [qa-tester persona](library/personas/qa-tester.md), [design-qa persona](library/personas/design-qa.md)).
- Redesign ship prior-gates currency as an attempt-chain continuity proof, so retries no longer reconstruct QA state by subtracting a predicted release-metadata path set that false-failed whenever feature work left durable documentation dirty before version sync ([validation](src/lib/validation.ts), [git fingerprinting](src/lib/git.ts)).
- Detect workspace changes by per-path content hash in addition to Git status entries, so an edit to an already-dirty file is attributable instead of invisible to scope gates ([git fingerprinting](src/lib/git.ts), [types](src/lib/types.ts)).
- Report Visual QA readiness during installation and in `pan doctor`, and document Chrome for Testing as an installation requirement for targets with a web UI ([CLI](src/cli.ts), [install](bin/install), [embedded installation](docs/embedded-installation.md)).

### Added

- Add `BROWSER-001` and the `browser-inspection` skill as the single canonical browser contract, bound to the qa-tester, design-qa, designer, design-reviewer, and spotfixer personas ([BROWSER-001](governance/policies/BROWSER-001.json), [browser-inspection skill](library/skills/browser-inspection.md), [policy lookup table](governance/registries/policy_lookup_table.json)).
- Add a `policy-rule` projection transform that generates an always-apply Cursor rule from a governance policy, so work running outside the invocation-card machinery receives `BROWSER-001` from the same source ([projection](src/lib/projection.ts), [install-support](bin/install-support), [projection manifest](governance/registries/projection_manifest.json)).
- Add browser-automation readiness resolution for Chrome for Testing bundles and chrome-devtools MCP configuration across harness and target roots ([browser readiness](src/lib/browser-readiness.ts), [readiness tests](tests/unit/browser-readiness.test.ts)).
- Add regression coverage for the supervisor delivery contract, ship prior-gates chain continuity including the feature-dirty documentation case, and browser-guidance single-sourcing ([delegation contract test](tests/regression/supervisor-delegation-contract.test.ts), [release metadata scope test](tests/unit/release-metadata-scope.test.ts), [browser isolation contract test](tests/regression/browser-isolation-contract.test.ts)).

### Removed

- Remove the hand-maintained `visual-qa-isolation` Cursor rule template and its manifest entry, superseded by the rule generated from `BROWSER-001` ([projection manifest](governance/registries/projection_manifest.json)).
- Remove `gitWorkspaceFingerprintExcluding` and the release-metadata path allowlist from ship evidence reconstruction ([git fingerprinting](src/lib/git.ts), [validation](src/lib/validation.ts)).
- Remove the regression test that required all twelve browser-isolation tokens to be restated across six surfaces, which was itself enforcing the divergence it was meant to prevent ([browser isolation contract test](tests/regression/browser-isolation-contract.test.ts)).

### Fixed

- Fix directive-exemption and validation-registry lookups that probed `governance/` instead of `governance/registries/`, which silently disabled the exemption registry and all requirement-registry validation ([audit directives](src/lib/governance/audit-directives.ts), [validation](src/lib/validation.ts)).
- Fix content fingerprinting of staged renames, which hashed the literal `old -> new` status path and recorded the renamed file as missing ([git fingerprinting](src/lib/git.ts)).

## [2.17.0] - 2026-07-29

### Changed

- Rename the harness configuration file from `project.json` to `config.json`, migrate legacy installations on refresh, and retain superseded `project.json` backups for operator recovery ([config.json](config.json), [project config](src/lib/project-config.ts), [embedded installation test](tests/integration/embedded-installation.test.ts)).
- Make detached installations treat applicable target instruction surfaces as live target authority for target application work, with hard conflicts falling back to target policy while Pancreator retains harness runtime/state and operator-owned action boundaries ([detached operating card](library/templates/detached-AGENTS.md), [install](bin/install), [install-support](bin/install-support), [embedded rule](library/cursor/rules/pancreator-embedded.mdc)).
- Correct embedded-install governance so Pancreator-owned ignore patterns land in clone-local `.git/info/exclude` rather than the target `.gitignore`, preserve legacy tracked ignore lines byte-identical with an operator cleanup notice, and update `CONTRACT-001` to match the implemented invariant ([CONTRACT-001](governance/policies/CONTRACT-001.json), [embedded installation](docs/embedded-installation.md)).
- Extend external-target `/pan-build-docs` primers with relevance-gated frontend visual-inspection guidance and structured major workflow/data-flow walkthroughs whose steps document input shape, abbreviated source-derived logic, and output shape; self-development primers remain exempt ([PRIMER-001](governance/policies/PRIMER-001.json), [librarian persona](library/personas/librarian.md), [primer validator](src/lib/validators/target-repo-primer.ts)).
- Refresh target-repository primer guidance and embedded-install coexistence wording in the operating card and canonical Cursor surfaces ([target repo primer](docs/target-repo-primer.md), [AGENTS.md](AGENTS.md)).

### Added

- Add a detached-specific harness operating-card template and installer smoke assertions for target-authority semantics and gitignore preservation ([detached-AGENTS.md](library/templates/detached-AGENTS.md), [install smoke](bin/install)).
- Add external-only primer validation for frontend inspection subsections, major-flow step fields, explicit not-applicable outcomes, and named flows without steps ([target-repo-primer validator](src/lib/validators/target-repo-primer.ts), [validator tests](tests/unit/target-repo-primer-validator.test.ts)).
- Add harness-config unit coverage for legacy `project.json` detection, migration, and backup retention ([harness-config test](tests/unit/harness-config.test.ts)).

### Fixed

- Reject state-only frontend guidance and named major-flow sections that omit ordered steps after review found two false-positive validation paths ([target-repo-primer validator](src/lib/validators/target-repo-primer.ts)).

## [2.16.0] - 2026-07-20

### Changed

- Require chrome-devtools Visual QA host isolation across qa-tester and design-qa personas, matching Cursor agent cards, and dev/design test prompts, including isolated `new_page`/`close_page` lifecycle, personal-browser prohibitions, and intermittent full-suite timeout taxonomy ([personas](library/personas/qa-tester.md), [test prompts](library/workflows/dev/prompts/test.md)).
- Make chrome-devtools the projected self-development MCP default with `--isolated`, retaining Playwright only as explicit fallback language in docs and `library/cursor/mcp.json` ([mcp.json](library/cursor/mcp.json), [operator guide](docs/operator-guide.md), [ux guide](governance/handbooks/design/ux-guide.md)).
- Document Chrome for Testing, `--executablePath`, and `--isolated` hardening for operators and embedded targets without overwriting target-owned MCP configuration ([embedded installation](docs/embedded-installation.md)).
- Extend spotfix `diff_bounded` validation to honor WORK-001 documentation, test, and projection exemptions while scoping `.test.` filename checks to basenames only ([stage validators](src/lib/validators/stage-validators.ts)).
- Disambiguate `pan requirements run` duplicate registry matches by preferring `required` enforcement bindings ([CLI](src/cli.ts)).
- Ignore release-metadata-only workspace drift across ship retries when evaluating `ship.prior_gates_current` ([validation](src/lib/validation.ts), [git fingerprinting](src/lib/git.ts)).
- Remove stale Figma references from design workflow prompts and skills ([design prompts](library/workflows/design/prompts/design.md), [html-prototype skill](library/skills/html-prototype.md)).
- Refresh the target repository primer and embedded install persona merge behavior ([target repo primer](docs/target-repo-primer.md), [install-support](bin/install-support)).

### Added

- Add an always-apply `visual-qa-isolation` Cursor rule projected to self-development and embedded installs through the existing manifest channel ([rule template](library/cursor/rules/visual-qa-isolation.mdc), [projection manifest](governance/registries/projection_manifest.json)).
- Add a visual-qa-contract regression test and embedded-install packaging assertions so isolation tokens and rule projection cannot regress silently ([regression test](tests/regression/visual-qa-contract.test.ts), [embedded installation test](tests/integration/embedded-installation.test.ts)).

### Fixed

- Strengthen Visual QA contract regression coverage after review found assertions could pass with required host-safety clauses removed ([visual-qa-contract test](tests/regression/visual-qa-contract.test.ts)).

## [2.15.0] - 2026-07-20

### Changed

- Refactor `project.json` persona model mappings to inherit shared defaults across named configurations, reducing drift when adding personas ([project.json](project.json), [pipeline config](src/lib/pipeline-config.ts)).
- Merge embedded-install persona defaults during install projection so new and existing default personas resolve without manual target edits ([install-support](bin/install-support)).
- Document design-before-dev composition, Playwright MCP setup, and canonical `library/cursor/mcp.json` ownership in the operator guide ([operator guide](docs/operator-guide.md)).

### Added

- Add a standalone five-stage `design` predecessor workflow (intake, design, review, test, handoff) that produces a ratified design package for a separately started `dev` run ([design workflow](library/workflows/design/workflow.json)).
- Add a UX design handbook under `governance/handbooks/design/` with `DESIGN-001` policy unrolling, heuristic checklist, tokens guidance, and HTML mock-media rules ([ux guide](governance/handbooks/design/ux-guide.md), [DESIGN-001](governance/policies/DESIGN-001.json)).
- Add designer, design-reviewer, and design-qa personas with projected Cursor agents and default model mappings ([personas](library/personas/designer.md), [agents](library/cursor/agents/designer.md), [project.json](project.json)).
- Add design-spec, html-prototype, design-critique, and visual-design-iteration skills encoding tokens-first prototyping and the capture-score-fix iteration loop ([skills index](library/skills/index.md)).
- Add canonical Playwright MCP configuration projected to `.cursor/mcp.json` in self-development mode only ([mcp.json](library/cursor/mcp.json), [projection manifest](governance/registries/projection_manifest.json)).
- Add `design` and `handoff` operator-brief profiles and validation enforcing design-handbook policy coverage for design personas ([operator artifact profiles](src/lib/operator-artifact-profiles.ts), [validation](src/lib/validation.ts)).

## [2.14.0] - 2026-07-09

### Changed

- Document ad-hoc Subagent model inheritance so unnamed invocations omit `model` and inherit the parent unless the operator explicitly selects one; named persona routing continues through projected frontmatter and `project.json` ([operating card](AGENTS.md), [embedded rules](library/cursor/rules/pancreator-embedded.mdc)).
- Extend Git path utilities to prefer tracked source evidence for deterministic language detection in version-controlled workspaces ([git](src/lib/git.ts), [technologies](src/lib/technologies.ts)).
- Wire embedded `/pan-build-docs` to generate one target-derived handbook per detected language, maintain LANG-001 guidance sources and lookup rows, and preserve the marked bundle across install refreshes ([build-docs command](library/cursor/commands/pan-build-docs.md), [installer](bin/install)).

### Added

- Add `pan technologies detect --json` for sorted language detection with explicit unsupported evidence reporting ([CLI](src/cli.ts)).
- Add `TARGET-LANGUAGE-HANDBOOK-VALIDATE-001` and deterministic validator coverage for handbook paths, policy wiring, and stale-artifact rejection ([handbook validator](src/lib/validators/target-language-handbooks.ts)).
- Add the repo-technician persona and projected agent for target-repository performance, security, and functionality investigations ([repo-technician persona](library/personas/repo-technician.md)).
- Add optional shell `pan` alias configuration during install and update with walk-up resolution for embedded and self-development roots ([shell alias](src/lib/shell-alias.ts), [install-support](bin/install-support)).

## [2.13.0] - 2026-07-07

### Changed

- Adopt minute-level UTC workflow directory names and seven-day runtime retention. `pan archive` and embedded `install --yes` refreshes migrate recognized legacy names, update persisted references, and move older run directories into paired `archive/` locations without overwriting existing targets ([runtime naming](src/lib/naming.ts), [runtime maintenance](src/lib/workflow-artifacts.ts), [installer](bin/install)).
- Deliver handbook guidance directly in invocation context and add technology-scoped Python engineering rules, closing the gap where workers were expected to discover and read durable handbooks independently ([context unrolling](https://github.com/alenlukic/pancreator/commit/cbd03f5), [Python handbook](https://github.com/alenlukic/pancreator/commit/a30702f)).

### Added

- Add `/pan-summarize-context` to emit one copyable Markdown handoff containing the material current-conversation history, decisions, validation, open issues, and next actions for a fresh agent conversation ([command](library/cursor/commands/pan-summarize-context.md)).
- Add the transcript-aware harness technician and `/pan-repair` command for auditing workflow runs and producing validated Pancreator self-development intake without implementing the repair ([harness technician](https://github.com/alenlukic/pancreator/commit/4526c25)).
- Add `RUNTIME-001` governance for sortable workflow names, harness-owned archival, idempotence, collision handling, and installer migration behavior ([runtime policy](governance/policies/RUNTIME-001.json)).

### Fixed

- Preserve operator-selected persona model mappings across embedded refreshes while merging newly shipped personas into existing target configuration ([embedded configuration merge](https://github.com/alenlukic/pancreator/commit/365df13)).

## [2.12.0] - 2026-07-06

### Changed

- Replace recursive workspace tracking with protected-path-aware Git snapshots so harness checks never enumerate virtual environments, dependency trees, compiled outputs, caches, or package directories ([workspace snapshots](src/lib/git.ts), [protected paths](src/lib/workspace/protected-paths.ts)).
- Make invocation cards a literal artifact index: operator-brief source files are pre-created at invocation time, workers edit only the declared path, and submission performs rendering without repository discovery or duplicate renderer work ([brief runtime](src/lib/briefs.ts), [invocation rendering](src/lib/render.ts)).
- Route governance, validator, path-resolution, and operator-artifact defects to ship-stage release stewardship instead of implementation retries; ship repairs routine runtime defects and pauses only when operator review is warranted ([workflow engine](src/lib/engine.ts), [ship stage](library/workflows/dev/stages/ship.json)).
- Treat successful but slow repository checks as advisory timing information. A stage-declared timeout now overrides a profile default, while actual timeouts, hangs, and failing diagnostics remain blocking ([repository checks](src/lib/repository-checks.ts), [validation](src/lib/validation.ts)).

### Added

- Add a repository-wide protected-artifact rule forbidding agents and harness operations from touching or reasoning about compiled artifacts, third-party libraries, package directories, virtual environments, and generated caches ([GLOBAL-002](governance/policies/GLOBAL-002.json), [embedded operating card](library/templates/embedded-AGENTS.md)).
- Add profile-level progress output for long `pan next` and `pan submit` operations, measured-duration advisories, stale operation-lock recovery, and regression coverage for embedded path resolution and ship-stage governance escalation ([CLI](src/cli.ts), [operation locking](src/lib/io.ts), [dev workflow tests](tests/integration/dev-workflow.test.ts)).

### Removed

- Remove the obsolete workspace tracking commands, state, validators, workflow stage, gates, and acceptance flow. Embedded refreshes now delete all residual tracking data and stale operation locks ([installer](bin/install), [workflow definition](library/workflows/dev/workflow.json)).

### Fixed

- Resolve embedded implementation evidence paths from the target repository root consistently during direct validation and submission, eliminating false missing-file failures and invalid `../` retry rewrites ([validation](src/lib/validation.ts), [CLI](src/cli.ts)).
- Limit pre-implementation repository baselines to implementation-owned static and fast profiles instead of running full and configuration profiles before coding ([workflow engine](src/lib/engine.ts)).

## [2.11.1] - 2026-07-02

### Changed

- Migrate active development and preflight workflow-stage narratives from Markdown to the invocation-declared operator brief contract: schema-valid JSON source plus self-contained HTML, with HTML as artifact 0 and source JSON as artifact 1 ([workflow prompts](library/workflows/dev/prompts), [stage output skill](library/skills/write-stage-output.md)).
- Make invocation cards expose exact brief paths, renderer, schema, and profile, and prepopulate those references in stage-output scaffolds so workers no longer infer artifact format or location ([invocation rendering](src/lib/render.ts), [stage scaffold](src/lib/requirements/scaffold.ts)).

### Added

- Add shared embedded evidence-path resolution so target-repository paths and pytest node IDs resolve from the run workspace root while harness-relative `runtime/`, `library/`, and `governance/` paths still resolve from the installation root ([stage validators](src/lib/validators/stage-validators.ts)).
- Disclose whole-stage bypass conditions in gate waiver artifacts with an additive `whole_stage_bypass` field and operator-readable audit text when additional hard blockers are bypassed beyond the named criterion subset ([engine](src/lib/engine.ts), [render](src/lib/render.ts), [types](src/lib/types.ts)).
- Add focused regression coverage for nested exclusion matching, embedded evidence-path resolution, partial-criterion waiver disclosure, and macOS symlink-safe repository-check workspace assertions ([workspace tests](tests/unit/workspace-roots.test.ts), [validator tests](tests/unit/validators-stage-validators.test.ts), [gate-waiver tests](tests/integration/gate-waiver.test.ts)).

### Fixed

- Rerender each stage brief from its JSON source during submission and reject missing or invalid brief data, non-HTML primary artifacts, or artifact paths that drift from the invocation contract ([runtime engine](src/lib/engine.ts), [stage-output validation](src/lib/validation.ts)).
- Preserve and finalize `artifacts/html/` alongside JSON and explicit Markdown compatibility records, including embedded installations and legacy artifact-layout migration ([artifact finalizer](src/lib/workflow-artifacts.ts), [runtime protocol](docs/runtime-protocol.md)).
- Resolve embedded target evidence paths without requiring `../` escapes and apply consistent resolver semantics across implementation, QA, and release validators ([stage validators](src/lib/validators/stage-validators.ts)).

## [2.11.0] - 2026-07-02

### Changed

- Make schema-backed, self-contained semantic HTML the standard for new operator-facing narrative artifacts while retaining existing Markdown and canonical worker-control records as explicit compatibility exceptions ([BRIEF-001](governance/policies/BRIEF-001.json), [operator brief system](docs/operator-brief-system.md), [artifact validator](src/lib/validators/operator-artifact.ts)).
- Separate content semantics from presentation: briefs reference registered types and field placement, section emojis resolve from a repository-wide semantic registry, and shared/project CSS owns layout, color, spacing, dark mode, responsive behavior, and print output ([shared primitives](library/operator-briefs/primitives.json), [base design system](library/operator-briefs/base.css)).

### Added

- Add generic brief, section, card, field, item, status, urgency, and action contracts plus `pan briefs build|validate|render` for project scaffolding, consistency checks, and portable HTML generation ([brief schema](library/schemas/operator-brief.schema.json), [brief runtime](src/lib/briefs.ts), [CLI](src/cli.ts)).
- Add `/pan-build-briefs` and extend the librarian so fresh and legacy installations can derive a minimal project ontology and design-token layer from recurring target use cases without modifying shared Pancreator primitives ([command](library/cursor/commands/pan-build-briefs.md), [librarian persona](library/personas/librarian.md)).
- Add Pancreator-specific governance and installation brief extensions as the self-development project layer, with common workflow/release primitives remaining reusable across installed repositories ([project registry](docs/operator-briefs/project.json), [project CSS](docs/operator-briefs/project.css)).

### Fixed

- Preserve generated target brief systems across embedded refreshes while preventing Pancreator's self-development ontology and colors from leaking into fresh installations; shared primitives remain available before project generation ([installer](bin/install), [embedded installation guide](docs/embedded-installation.md)).
- Recognize and validate HTML operator artifacts in requirement routing, including the mandatory executive-summary lead and profile-specific headings, without weakening legacy Markdown validation ([requirement routing](src/lib/requirements/run.ts), [validation registry](governance/registries/validation_registry.json)).

## [2.10.0] - 2026-07-01

### Changed

- Establish explicit operator supremacy across repository and embedded governance: operator-owned actions describe decision origin, while agents must execute clear operator directives even when they override ordinary workflow policy ([OPERATOR-001](governance/policies/OPERATOR-001.json), [AGENTS.md](AGENTS.md), [embedded operating card](library/templates/embedded-AGENTS.md)).
- Redefine gate waivers as flexible audited directives rather than constrained exception contracts. Waivers can target current, historical, harness-owned, unattempted, or terminal stages; select any subset of criteria; route to an operator-selected destination; and remain valid across workspace drift ([WAIVER-001](governance/policies/WAIVER-001.json), [runtime engine](src/lib/engine.ts), [operator guide](docs/operator-guide.md)).
- Treat non-source-stage workspace cleanliness as an external-contamination check. Complete, explained path attribution to the active worker remains auditable but no longer blocks the run ([criteria catalog](governance/criteria/index.md), [stage output schema](library/schemas/stage-output.schema.json), [validation engine](src/lib/validation.ts)).

### Added

- Add `workspace_changes` attribution to stage outputs and waiver routing options for source stage and destination stage, with regression coverage for partial, malformed, pre-attempt, drifted, and terminal-run overrides ([stage output template](library/templates/stage-output.example.json), [gate waiver tests](tests/integration/gate-waiver.test.ts), [workspace mutation tests](tests/regression/read-only-mutation.test.ts)).

### Fixed

- Stop QA evidence validation from misclassifying pytest node IDs and slash-bearing prose observations as missing files; explicit `path:` or `file:` references and genuine path-shaped evidence remain existence-checked ([QA validator](src/lib/validators/stage-validators.ts), [validator tests](tests/unit/validators-stage-validators.test.ts)).
- Ensure fresh installations and refreshes of existing embedded installations receive the operator-authority policy, flexible waiver behavior, internal-change attribution contract, and corrected evidence validation ([embedded installation guide](docs/embedded-installation.md)).

## [2.9.0] - 2026-06-30

### Changed

- Generalize the same-reason circuit breaker to direct stage self-loops, including implementation retries, so a second consecutive hard failure with the same normalized signature pauses before a third attempt ([src/lib/engine.ts](src/lib/engine.ts), [ORCH-001](governance/policies/ORCH-001.json)).
- Require implementation retries to identify and remediate the prior loop cause with explicit evidence rather than resubmitting unchanged work or paperwork ([coder persona](library/personas/coder.md), [implementation prompt](library/workflows/dev/prompts/implement.md)).
- Make review source-allowed for bounded, local, low-risk remediation while routing major, structural, ambiguous, or high-blast-radius findings back to implementation ([reviewer persona](library/personas/reviewer.md), [review stage](library/workflows/dev/stages/review.json), [REVIEW-001](governance/policies/REVIEW-001.json)).

### Added

- Capture run-scoped static and fast repository-check baselines before the first coder invocation; unchanged pre-existing failures remain visible but non-blocking, while new or changed diagnostics still fail implementation gates ([src/lib/repository-checks.ts](src/lib/repository-checks.ts), [DEV-001](governance/policies/DEV-001.json)).
- Validate retry remediation records and reviewer-owned fixes, with integration coverage for same-reason pauses and baseline-aware repository gates ([tests/integration/dev-workflow.test.ts](tests/integration/dev-workflow.test.ts), [tests/unit/validators-stage-validators.test.ts](tests/unit/validators-stage-validators.test.ts)).

### Fixed

- Prevent implementation attempts from repeatedly consuming retry budget on known repository lint or unit-test debt and ensure fresh and refreshed embedded installations receive the updated governance, personas, workflow stages, and runtime enforcement ([bin/install](bin/install), [embedded installation guide](docs/embedded-installation.md)).

## [2.8.0] - 2026-06-30

### Changed

- Make the release steward the explicit owner of version selection, release-note generation, and synchronized metadata updates in self-development ship mode and standalone `/pan-release` execution ([7211533](https://github.com/alenlukic/pancreator/commit/72115335c0307ebca4b0d14af30ed7fb672f08c0)).
- Restrict ship-stage source mutations to release metadata and durable current-version documentation while preserving prior implementation evidence semantics ([7211533](https://github.com/alenlukic/pancreator/commit/72115335c0307ebca4b0d14af30ed7fb672f08c0), [2342efa](https://github.com/alenlukic/pancreator/commit/2342efa86ddaac407e619952a560d18188af5870)).
- Make embedded repository checks language- and technology-agnostic with explicit profile semantics (`fast`, optional `secondary`, and `full`) and target-owned command/probe definitions ([2342efa](https://github.com/alenlukic/pancreator/commit/2342efa86ddaac407e619952a560d18188af5870), [2a406c8](https://github.com/alenlukic/pancreator/commit/2a406c89eb620f553e58ecd6693c598277082765)).
- Scope self-development TypeScript/shell/npm conventions away from embedded target assumptions, while preserving compatibility translation for existing in-flight runs ([2342efa](https://github.com/alenlukic/pancreator/commit/2342efa86ddaac407e619952a560d18188af5870), [0c55859](https://github.com/alenlukic/pancreator/commit/0c5585962c8cdf135093c7cb242b940122f2bf09)).

### Added

- Add standalone `/pan-release` release preparation to regenerate an in-progress candidate or create one SemVer bump from the full post-baseline delta ([7211533](https://github.com/alenlukic/pancreator/commit/72115335c0307ebca4b0d14af30ed7fb672f08c0), [library/skills/update-release-metadata.md](library/skills/update-release-metadata.md)).
- Add repository-check templates and validation guardrails for embedded targets, including explicit profile shape and duplicate `fast`/`full` protection ([2342efa](https://github.com/alenlukic/pancreator/commit/2342efa86ddaac407e619952a560d18188af5870), [2a406c8](https://github.com/alenlukic/pancreator/commit/2a406c89eb620f553e58ecd6693c598277082765)).

### Removed

### Fixed

- Prevent incomparable validation evidence from ambiguous interpreter selection and avoid false npm-based failures in non-Node target repositories ([2342efa](https://github.com/alenlukic/pancreator/commit/2342efa86ddaac407e619952a560d18188af5870), [2a406c8](https://github.com/alenlukic/pancreator/commit/2a406c89eb620f553e58ecd6693c598277082765)).
- Remove embedded `/pan-validate` dependence on target-root npm scripts by routing validation through the installed Pancreator CLI entrypoints ([2342efa](https://github.com/alenlukic/pancreator/commit/2342efa86ddaac407e619952a560d18188af5870)).
- Include release metadata in embedded installation/refresh flows so `pan validate` and indexed updates can resolve `release/index.json` consistently ([2342efa](https://github.com/alenlukic/pancreator/commit/2342efa86ddaac407e619952a560d18188af5870)).
- Prevent generated `fast` profiles from silently running full suites by rejecting exact duplication and auto-disabling known-bad legacy duplicates with backups ([2342efa](https://github.com/alenlukic/pancreator/commit/2342efa86ddaac407e619952a560d18188af5870), [2a406c8](https://github.com/alenlukic/pancreator/commit/2a406c89eb620f553e58ecd6693c598277082765)).

## [2.7.0] - 2026-06-28

### Changed

- Adopt complete Semantic Versioning metadata and a curated Common Changelog release history ([VERSION](VERSION), [VERSION-001](governance/policies/VERSION-001.json))

### Added

- Expose release-steward PR description generation independently through `/pan-write-pr [base-ref]`, comparing committed and worktree changes against `main` by default ([f36ede0](https://github.com/alenlukic/pancreator/commit/f36ede0b6955d291ed67c92386cf5b6696756722), [pan-write-pr](library/cursor/commands/pan-write-pr.md))

## [2.6.0] - 2026-06-28

### Changed

- Install Pancreator as an embedded `.pancreator/` harness with canonical Cursor projections, ownership-aware refreshes, and indexed fast-forward updates ([7b555f9](https://github.com/alenlukic/pancreator/commit/7b555f99395b1f4d9c4f1548f7c8ce0ae0425713), [667ee3c](https://github.com/alenlukic/pancreator/commit/667ee3ca9c45322ad2462fd09dc27e76a5639975))

### Added

- Add a librarian persona and `/pan-build-docs` command for validated target-repository primers ([a8f3b42](https://github.com/alenlukic/pancreator/commit/a8f3b42bc29d2c9b49e40f1fcb49071bbb14f7ef))

### Fixed

- Correct embedded-installation ignore handling and deterministic installation validation ([72cf812](https://github.com/alenlukic/pancreator/commit/72cf812b9abe6ad9999e173e4f73311e40aa6f70), [2fac15d](https://github.com/alenlukic/pancreator/commit/2fac15dec77440f522e4875b0bb1626d1a712331))

## [2.5.0] - 2026-06-27

### Changed

- Govern executable migrations and remove superseded migration implementations ([7b5f5b5](https://github.com/alenlukic/pancreator/commit/7b5f5b5b6df0b7f91d994940d935f7b1d3e1e507), [3a5f6a0](https://github.com/alenlukic/pancreator/commit/3a5f6a04e847c1b2a65cb11e4cb9a1b396f6eee1))

### Added

- Add workflow-artifact contract coverage, bounded workflow circuit breakers, and conservative intake decomposition ([db925af](https://github.com/alenlukic/pancreator/commit/db925afb51ad0dabfd31f1b80129f185074ec2c5), [bc6d5b6](https://github.com/alenlukic/pancreator/commit/bc6d5b67e48e0751c33478206842eca2eba6364d), [cfee47c](https://github.com/alenlukic/pancreator/commit/cfee47c73591ee1fedc71f684ee887fd434d0bb4))

### Fixed

- Correct misplaced delegation evidence in generated workflow artifacts ([2745f78](https://github.com/alenlukic/pancreator/commit/2745f78a90641ee61c5ae2f246ae75d8fa3b84a8))

## [2.4.0] - 2026-06-26

### Changed

- Standardize durable workflow and artifact names, typed artifact directories, reverse execution ordering, and terminal compaction ([7d28760](https://github.com/alenlukic/pancreator/commit/7d287602fd1666a7a4e8408be5fda4aab96f0e36), [6547c73](https://github.com/alenlukic/pancreator/commit/6547c73fba2592bd01042db1e477606d5274feeb))
- Remove redundant record artifacts and bound invocation-context construction to relevant workflow history ([ea85d0c](https://github.com/alenlukic/pancreator/commit/ea85d0cb34493a2e29219140f29a0d62c6d49835), [e6d7c12](https://github.com/alenlukic/pancreator/commit/e6d7c12e59c92d2892defde7df2d877497d66991))

### Added

- Add quiet npm execution and Cursor-style SDK progress logging ([7134e0c](https://github.com/alenlukic/pancreator/commit/7134e0c2f5a7325fa4fd11924f4f598db5b0f4ae))

## [2.3.0] - 2026-06-25

### Changed

- Normalize governance ownership, policy lookup, and pipeline configuration around explicit scoped contracts ([ee27bbe](https://github.com/alenlukic/pancreator/commit/ee27bbef67821aa8be0a899089220a90ddd7f29b), [f1bb95f](https://github.com/alenlukic/pancreator/commit/f1bb95f0c8c8f6b96cad4efaf0ca3be1f63991f8), [9890613](https://github.com/alenlukic/pancreator/commit/989061331a092c97edae208762903307cfcad7df))

### Added

- Add policy-bound deterministic automation, validation registries, directive auditing, and repository contract checks ([4bf5558](https://github.com/alenlukic/pancreator/commit/4bf555885bb6527452d6e141f545074ad766efc1))

## [2.2.0] - 2026-06-24

### Changed

- Strengthen the runtime protocol, delegation enforcement, ship gates, project settings, and model synchronization ([9f662aa](https://github.com/alenlukic/pancreator/commit/9f662aa9fdca0eecbbf00e4b17528330c4ebcffc), [0082178](https://github.com/alenlukic/pancreator/commit/00821787da354d4c185c0adfdf163b20d48de62a), [6bb55f3](https://github.com/alenlukic/pancreator/commit/6bb55f3752467f96c6b253aa134ca5245e82e569))

### Added

- Add controlled change tracking, lightweight investigation and spot-fix execution, arbitrary stage repair, and operator pause controls ([fa9117a](https://github.com/alenlukic/pancreator/commit/fa9117a36b4debebb4713623ded505801eaed1b1), [cf9be68](https://github.com/alenlukic/pancreator/commit/cf9be689db4c681d56c51256a7eb7948b6b61047), [7cd9cca](https://github.com/alenlukic/pancreator/commit/7cd9ccaa7db3d291ad6eae2d3655b649543f8dee))
- Add the first embedded-installation update path for target repositories ([725b3eb](https://github.com/alenlukic/pancreator/commit/725b3eb02d7d05a87019ba0de0ce2b500f379b3b))

## [2.1.0] - 2026-06-23

### Changed

- Make pipeline configuration explicit and selectable across simple and complex execution profiles ([7b22b37](https://github.com/alenlukic/pancreator/commit/7b22b3790584bbec199a54265a5abaa26851ccfe), [5de65ee](https://github.com/alenlukic/pancreator/commit/5de65eedaed6c3cd9fd88e65d22e2c1771409b16))

### Added

- Add workspace-targeted workflow parameters so Pancreator can operate against an explicit target repository ([3c2225c](https://github.com/alenlukic/pancreator/commit/3c2225cf5230b03a5c21e524aa14861aba10d0f9))

## [2.0.1] - 2026-06-22

### Fixed

- Correct formatting, initialization, and first-run defects discovered after the clean rebuild ([2ff4c09](https://github.com/alenlukic/pancreator/commit/2ff4c0926732c8437b89cce4a7848489e2d50231), [612f825](https://github.com/alenlukic/pancreator/commit/612f82503bc08c2df59471a3bc1968e3f8a3bd50))

## [2.0.0] - 2026-06-22

### Changed

- **Breaking:** replace the legacy application and package layout with a dependency-free TypeScript CLI, file-backed workflow runtime, canonical library, and scoped governance model ([603f932](https://github.com/alenlukic/pancreator/commit/603f932f850abfc2be70a94441fdd63c9b764ec5), [377f309](https://github.com/alenlukic/pancreator/commit/377f3098db74ac3834fdb4750af757e1bd25b1c1))

## [1.3.0] - 2026-06-20

### Changed

- Split transient state, governance, feature-delivery configuration, and the Command Center into explicit repository boundaries ahead of the clean rebuild ([#69](https://github.com/alenlukic/pancreator/pull/69), [#70](https://github.com/alenlukic/pancreator/pull/70), [#71](https://github.com/alenlukic/pancreator/pull/71), [#72](https://github.com/alenlukic/pancreator/pull/72))

### Removed

- Remove the legacy context-usage calibration harness and token-telemetry tooling from the split architecture ([#69](https://github.com/alenlukic/pancreator/pull/69))

## [1.2.0] - 2026-06-19

### Changed

- Refine introspection runs and archive handling using evidence from the first production retrospective passes ([#67](https://github.com/alenlukic/pancreator/pull/67))

### Added

- Add operator-readable agent artifact contracts and consistent output sections ([#66](https://github.com/alenlukic/pancreator/pull/66))
- Add RTK-backed shell compression and explicit simple-task execution guidance ([#68](https://github.com/alenlukic/pancreator/pull/68))

## [1.1.0] - 2026-06-18

### Changed

- Consolidate and clean the Cursor command surface before exposing retrospective workflows ([6f8a1b4](https://github.com/alenlukic/pancreator/commit/6f8a1b463eba402ff72b12f5a04dcdef9a7a5b9d))

### Added

- Add the `/introspect` command and synchronized Cursor command projections for recurring workflow-miss analysis ([#65](https://github.com/alenlukic/pancreator/pull/65))

## [1.0.1] - 2026-06-18

### Changed

- Close governance and postmortem gaps and simplify Command Center maintenance behavior ([#62](https://github.com/alenlukic/pancreator/pull/62), [9b1f28f](https://github.com/alenlukic/pancreator/commit/9b1f28fd1885e9abcc3b176ca2c4ce1df6a1975e))

### Fixed

- Correct client lint and test failures, Command Center home behavior, and archive sweeping ([#63](https://github.com/alenlukic/pancreator/pull/63), [#64](https://github.com/alenlukic/pancreator/pull/64))

## [1.0.0] - 2026-06-16

### Changed

- Stabilize the legacy Pancreator architecture around governed feature delivery, explicit personas, durable memory, and an operator-facing Command Center ([#59](https://github.com/alenlukic/pancreator/pull/59), [#60](https://github.com/alenlukic/pancreator/pull/60))

### Added

- Add post-ship remediation and harden feature-delivery personas, governance, and CLI pipeline execution ([#59](https://github.com/alenlukic/pancreator/pull/59), [#60](https://github.com/alenlukic/pancreator/pull/60))

## [0.6.0] - 2026-06-11

### Changed

- Compress feature memory and its index to reduce retrieval cost while preserving navigability ([#58](https://github.com/alenlukic/pancreator/pull/58))

## [0.5.0] - 2026-06-11

### Changed

- Consolidate local Cursor projections and strengthen feature-delivery gates, repository hygiene, and pipeline contracts ([#50](https://github.com/alenlukic/pancreator/pull/50), [#54](https://github.com/alenlukic/pancreator/pull/54))

### Added

- Add build-mode inbox scaffolding and an explicit feature-delivery design workflow ([#46](https://github.com/alenlukic/pancreator/pull/46), [#48](https://github.com/alenlukic/pancreator/pull/48))
- Add a redesigned operator cockpit, design-system governance, and mission-control workflow surfaces ([#51](https://github.com/alenlukic/pancreator/pull/51), [#55](https://github.com/alenlukic/pancreator/pull/55))
- Add kickoff automations and Command Center polish ([#56](https://github.com/alenlukic/pancreator/pull/56), [#57](https://github.com/alenlukic/pancreator/pull/57))

## [0.4.0] - 2026-06-04

### Changed

- Consolidate operator surfaces around a Command Center and mission-control experience ([#33](https://github.com/alenlukic/pancreator/pull/33), [#36](https://github.com/alenlukic/pancreator/pull/36))
- Move feature-delivery execution to a fully automated Cursor SDK pipeline with stronger context-economy calibration ([#43](https://github.com/alenlukic/pancreator/pull/43), [#44](https://github.com/alenlukic/pancreator/pull/44))

### Added

- Add model escalation, SDK progress pulses, and context-usage integration coverage ([#37](https://github.com/alenlukic/pancreator/pull/37), [#39](https://github.com/alenlukic/pancreator/pull/39))
- Add a second-generation context-economy contract and consistent archival behavior ([#42](https://github.com/alenlukic/pancreator/pull/42), [#45](https://github.com/alenlukic/pancreator/pull/45))

## [0.3.0] - 2026-05-31

### Changed

- Refactor the repository around a project-root Pancreator package and retire bootstrap-only structure ([#32](https://github.com/alenlukic/pancreator/pull/32))

### Added

- Add the Tess feature-delivery pipeline, named-agent delegation, and general-purpose agent execution ([#9](https://github.com/alenlukic/pancreator/pull/9), [#11](https://github.com/alenlukic/pancreator/pull/11))
- Add independent QA execution and feature-delivery automation ([#24](https://github.com/alenlukic/pancreator/pull/24), [#27](https://github.com/alenlukic/pancreator/pull/27))
- Add automated PR description drafting for completed workflow runs ([#31](https://github.com/alenlukic/pancreator/pull/31))

## [0.2.0] - 2026-05-10

### Changed

- Introduce bounded context retrieval, active-memory tiers, and inbox conventions to reduce token overhead ([#1](https://github.com/alenlukic/pancreator/pull/1), [#2](https://github.com/alenlukic/pancreator/pull/2))
- Strengthen governance compliance and operator-facing workflow clarity ([#4](https://github.com/alenlukic/pancreator/pull/4), [#8](https://github.com/alenlukic/pancreator/pull/8))

### Added

- Add tiered persona performance profiles and model-selection guidance ([#3](https://github.com/alenlukic/pancreator/pull/3))

## [0.1.0] - 2026-04-27

_First functional release._

### Added

- Add the original self-building workflow harness, governed personas, compliance hooks, durable memory, and bootstrap documentation ([c9c5def](https://github.com/alenlukic/pancreator/commit/c9c5def2ccd2a0a9c27d5c6707c963cb2621518a))

[2.16.0]: https://github.com/alenlukic/pancreator/compare/814fdf025f3cd4932dbf448262ecc36b0cd44754...HEAD
[2.15.0]: https://github.com/alenlukic/pancreator/compare/ca4298bb6168b18afebe864e07db3f40c29de612...814fdf025f3cd4932dbf448262ecc36b0cd44754
[2.14.0]: https://github.com/alenlukic/pancreator/compare/7c942cd52889e86e2654dbde8b26b825b3b9f0d4...ca4298bb6168b18afebe864e07db3f40c29de612
[2.13.0]: https://github.com/alenlukic/pancreator/compare/6fd00e4e9493f8ac898b757842ce28db82cbc07d...7c942cd52889e86e2654dbde8b26b825b3b9f0d4
[2.12.0]: https://github.com/alenlukic/pancreator/compare/7d86b1257b839217317f568d802fe5e836b8bebf...6fd00e4e9493f8ac898b757842ce28db82cbc07d
[2.11.1]: https://github.com/alenlukic/pancreator/compare/7d86b1257b839217317f568d802fe5e836b8bebf...HEAD
[2.11.0]: https://github.com/alenlukic/pancreator/compare/c0a1a4cc6964261a970038578b41de71c5de1204...7d86b1257b839217317f568d802fe5e836b8bebf
[2.10.0]: https://github.com/alenlukic/pancreator/compare/992da4018692bda9e5b963f43d2e55ce37021c6c...c0a1a4cc6964261a970038578b41de71c5de1204
[2.9.0]: https://github.com/alenlukic/pancreator/compare/5f1a87704fa1601cc2f1c74e77d37268de0ce0cd...HEAD
[2.8.0]: https://github.com/alenlukic/pancreator/compare/5f4953e321544a9a28b2614cbf5a1fa2f6882a99...HEAD
[2.7.0]: https://github.com/alenlukic/pancreator/compare/a8f3b42bc29d2c9b49e40f1fcb49071bbb14f7ef...5f4953e321544a9a28b2614cbf5a1fa2f6882a99
[2.6.0]: https://github.com/alenlukic/pancreator/compare/cfee47c73591ee1fedc71f684ee887fd434d0bb4...a8f3b42bc29d2c9b49e40f1fcb49071bbb14f7ef
[2.5.0]: https://github.com/alenlukic/pancreator/compare/e6d7c12e59c92d2892defde7df2d877497d66991...cfee47c73591ee1fedc71f684ee887fd434d0bb4
[2.4.0]: https://github.com/alenlukic/pancreator/compare/4bf555885bb6527452d6e141f545074ad766efc1...e6d7c12e59c92d2892defde7df2d877497d66991
[2.3.0]: https://github.com/alenlukic/pancreator/compare/6bb55f3752467f96c6b253aa134ca5245e82e569...4bf555885bb6527452d6e141f545074ad766efc1
[2.2.0]: https://github.com/alenlukic/pancreator/compare/5de65eedaed6c3cd9fd88e65d22e2c1771409b16...6bb55f3752467f96c6b253aa134ca5245e82e569
[2.1.0]: https://github.com/alenlukic/pancreator/compare/612f82503bc08c2df59471a3bc1968e3f8a3bd50...5de65eedaed6c3cd9fd88e65d22e2c1771409b16
[2.0.1]: https://github.com/alenlukic/pancreator/compare/377f3098db74ac3834fdb4750af757e1bd25b1c1...612f82503bc08c2df59471a3bc1968e3f8a3bd50
[2.0.0]: https://github.com/alenlukic/pancreator/compare/8e946911ba3628ec1c7827c9745cce72f77bb0e5...377f3098db74ac3834fdb4750af757e1bd25b1c1
[1.3.0]: https://github.com/alenlukic/pancreator/compare/d68154aa9125bad6e3627fe10382c77e78d3fcaf...8e946911ba3628ec1c7827c9745cce72f77bb0e5
[1.2.0]: https://github.com/alenlukic/pancreator/compare/20a156731d3f3993f0031f95c4a1e76d2eb23c1f...d68154aa9125bad6e3627fe10382c77e78d3fcaf
[1.1.0]: https://github.com/alenlukic/pancreator/compare/86d846fce6bc0c4d40e2c6c1d656446000f262d4...20a156731d3f3993f0031f95c4a1e76d2eb23c1f
[1.0.1]: https://github.com/alenlukic/pancreator/compare/521362061e4ca02470e87b7164db4493cc88e2bb...86d846fce6bc0c4d40e2c6c1d656446000f262d4
[1.0.0]: https://github.com/alenlukic/pancreator/compare/b650d4b0e7605c292e76beaee870ea7e6543fff8...521362061e4ca02470e87b7164db4493cc88e2bb
[0.6.0]: https://github.com/alenlukic/pancreator/compare/da5309d818c6b43070496cc8edd5b8e54a855fc2...b650d4b0e7605c292e76beaee870ea7e6543fff8
[0.5.0]: https://github.com/alenlukic/pancreator/compare/b2da6ca4a7e2b9e154f3765e16363af3cb69e40d...da5309d818c6b43070496cc8edd5b8e54a855fc2
[0.4.0]: https://github.com/alenlukic/pancreator/compare/4f3d186dc3910bd7bf84e45cbf04d783155b118f...b2da6ca4a7e2b9e154f3765e16363af3cb69e40d
[0.3.0]: https://github.com/alenlukic/pancreator/compare/fe20c6c3bfa46a1950798b2c58ab96960afa851c...4f3d186dc3910bd7bf84e45cbf04d783155b118f
[0.2.0]: https://github.com/alenlukic/pancreator/compare/c9c5def2ccd2a0a9c27d5c6707c963cb2621518a...fe20c6c3bfa46a1950798b2c58ab96960afa851c
[0.1.0]: https://github.com/alenlukic/pancreator/tree/c9c5def2ccd2a0a9c27d5c6707c963cb2621518a
