# Changelog

## [2.0.0] - 2026-06-28

### Changed

- **Breaking:** replace the legacy application and package layout with a dependency-free TypeScript CLI, file-backed workflow runtime, canonical library, and scoped governance model ([603f932](https://github.com/alenlukic/pancreator/commit/603f932f850abfc2be70a94441fdd63c9b764ec5), [377f309](https://github.com/alenlukic/pancreator/commit/377f3098db74ac3834fdb4750af757e1bd25b1c1))
- **Breaking:** install Pancreator as an embedded `.pancreator/` harness with canonical Cursor projections, ownership-aware refreshes, and indexed fast-forward updates ([7b555f9](https://github.com/alenlukic/pancreator/commit/7b555f99395b1f4d9c4f1548f7c8ce0ae0425713), [667ee3c](https://github.com/alenlukic/pancreator/commit/667ee3ca9c45322ad2462fd09dc27e76a5639975))
- Standardize durable workflow and artifact names, typed artifact directories, reverse execution ordering, and terminal compaction ([7d28760](https://github.com/alenlukic/pancreator/commit/7d287602fd1666a7a4e8408be5fda4aab96f0e36), [6547c73](https://github.com/alenlukic/pancreator/commit/6547c73fba2592bd01042db1e477606d5274feeb))
- Adopt complete Semantic Versioning metadata and a curated Common Changelog release history ([VERSION](VERSION), [VERSION-001](governance/policies/VERSION-001.json))

### Added

- Add workspace-targeted workflows, model snapshots, controlled change tracking, operator pause and repair, and fingerprint-bound gate waivers ([3c2225c](https://github.com/alenlukic/pancreator/commit/3c2225cf5230b03a5c21e524aa14861aba10d0f9), [4bf5558](https://github.com/alenlukic/pancreator/commit/4bf555885bb6527452d6e141f545074ad766efc1))
- Add policy-bound deterministic automation, validation registries, directive auditing, and repository contract checks ([ee27bbe](https://github.com/alenlukic/pancreator/commit/ee27bbef67821aa8be0a899089220a90ddd7f29b), [4bf5558](https://github.com/alenlukic/pancreator/commit/4bf555885bb6527452d6e141f545074ad766efc1))
- Add lightweight investigation and spot-fix workflows, conservative intake decomposition, and workflow circuit breakers ([cf9be68](https://github.com/alenlukic/pancreator/commit/cf9be689db4c681d56c51256a7eb7948b6b61047), [cfee47c](https://github.com/alenlukic/pancreator/commit/cfee47c73591ee1fedc71f684ee887fd434d0bb4))
- Add bounded invocation-context construction, quiet npm commands, and Cursor-style SDK progress logging ([e6d7c12](https://github.com/alenlukic/pancreator/commit/e6d7c12e59c92d2892defde7df2d877497d66991), [7134e0c](https://github.com/alenlukic/pancreator/commit/7134e0c2f5a7325fa4fd11924f4f598db5b0f4ae))
- Add a librarian persona and `/pan-build-docs` command for validated target-repository primers ([a8f3b42](https://github.com/alenlukic/pancreator/commit/a8f3b42bc29d2c9b49e40f1fcb49071bbb14f7ef))
- Add release-steward PR description generation and expose it independently through `/pan-write-pr [base-branch]` ([f36ede0](https://github.com/alenlukic/pancreator/commit/f36ede0b6955d291ed67c92386cf5b6696756722), [pan-write-pr](library/cursor/commands/pan-write-pr.md))

### Fixed

- Correct misplaced delegation evidence and deterministic embedded-installation validation ([2745f78](https://github.com/alenlukic/pancreator/commit/2745f78a90641ee61c5ae2f246ae75d8fa3b84a8), [2fac15d](https://github.com/alenlukic/pancreator/commit/2fac15dec77440f522e4875b0bb1626d1a712331))

## [1.0.0] - 2026-06-20

### Changed

- Stabilize the legacy Pancreator architecture around governed feature delivery, explicit personas, durable memory, and an operator-facing command center ([#59](https://github.com/alenlukic/pancreator/pull/59), [#60](https://github.com/alenlukic/pancreator/pull/60))
- Split transient state, governance, feature-delivery configuration, and client surfaces into explicit repository boundaries ahead of the clean rebuild ([#69](https://github.com/alenlukic/pancreator/pull/69), [#72](https://github.com/alenlukic/pancreator/pull/72))

### Added

- Add post-ship remediation, hardened pipeline personas, and improved command-center workflow health visibility ([#59](https://github.com/alenlukic/pancreator/pull/59), [#72](https://github.com/alenlukic/pancreator/pull/72))
- Add introspection commands and operator-readable agent artifacts for detecting recurring workflow misses ([#65](https://github.com/alenlukic/pancreator/pull/65), [#66](https://github.com/alenlukic/pancreator/pull/66))
- Add RTK-backed shell compression and explicit simple-task execution guidance ([#68](https://github.com/alenlukic/pancreator/pull/68))

### Fixed

- Correct command-center application behavior and close governance and postmortem gaps before the architecture split ([#63](https://github.com/alenlukic/pancreator/pull/63), [#64](https://github.com/alenlukic/pancreator/pull/64))

## [0.5.0] - 2026-06-11

### Changed

- Consolidate local Cursor projections and strengthen feature-delivery gates, repository hygiene, and pipeline contracts ([#50](https://github.com/alenlukic/pancreator/pull/50), [#54](https://github.com/alenlukic/pancreator/pull/54))

### Added

- Add a redesigned operator cockpit, design-system governance, and mission-control workflow surfaces ([#51](https://github.com/alenlukic/pancreator/pull/51), [#55](https://github.com/alenlukic/pancreator/pull/55))
- Add kickoff automations and compressed feature-memory organization ([#56](https://github.com/alenlukic/pancreator/pull/56), [#58](https://github.com/alenlukic/pancreator/pull/58))
- Add build-mode inbox scaffolding and an explicit feature-delivery design workflow ([#46](https://github.com/alenlukic/pancreator/pull/46), [#48](https://github.com/alenlukic/pancreator/pull/48))

## [0.4.0] - 2026-06-04

### Changed

- Consolidate operator surfaces around a command center and mission-control experience ([#33](https://github.com/alenlukic/pancreator/pull/33), [#36](https://github.com/alenlukic/pancreator/pull/36))
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

[2.0.0]: https://github.com/alenlukic/pancreator/compare/8e946911ba3628ec1c7827c9745cce72f77bb0e5...HEAD
[1.0.0]: https://github.com/alenlukic/pancreator/tree/8e946911ba3628ec1c7827c9745cce72f77bb0e5
[0.5.0]: https://github.com/alenlukic/pancreator/tree/da5309d818c6b43070496cc8edd5b8e54a855fc2
[0.4.0]: https://github.com/alenlukic/pancreator/tree/b2da6ca4a7e2b9e154f3765e16363af3cb69e40d
[0.3.0]: https://github.com/alenlukic/pancreator/tree/4f3d186dc3910bd7bf84e45cbf04d783155b118f
[0.2.0]: https://github.com/alenlukic/pancreator/tree/fe20c6c3bfa46a1950798b2c58ab96960afa851c
[0.1.0]: https://github.com/alenlukic/pancreator/tree/c9c5def2ccd2a0a9c27d5c6707c963cb2621518a
