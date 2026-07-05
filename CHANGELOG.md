# Changelog

## [2.11.1] - 2026-07-02

### Changed

- Migrate active development and preflight workflow-stage narratives from Markdown to the invocation-declared operator brief contract: schema-valid JSON source plus self-contained HTML, with HTML as artifact 0 and source JSON as artifact 1 ([workflow prompts](library/workflows/dev/prompts), [stage output skill](library/skills/write-stage-output.md)).
- Make invocation cards expose exact brief paths, renderer, schema, and profile, and prepopulate those references in stage-output scaffolds so workers no longer infer artifact format or location ([invocation rendering](src/lib/render.ts), [stage scaffold](src/lib/requirements/scaffold.ts)).
- Apply glob-aware workspace exclusion matching with automatic nested generated-directory detection for well-known names such as `node_modules`, `dist`, and `coverage`, while preserving existing literal exclusions ([workspace roots](src/lib/workspace/roots.ts), [workspace index](src/lib/workspace/index.ts)).

### Added

- Add shared embedded evidence-path resolution so target-repository paths and pytest node IDs resolve from the run workspace root while harness-relative `runtime/`, `library/`, and `governance/` paths still resolve from the installation root ([stage validators](src/lib/validators/stage-validators.ts)).
- Disclose whole-stage bypass conditions in gate waiver artifacts with an additive `whole_stage_bypass` field and operator-readable audit text when additional hard blockers are bypassed beyond the named criterion subset ([engine](src/lib/engine.ts), [render](src/lib/render.ts), [types](src/lib/types.ts)).
- Add focused regression coverage for nested exclusion matching, embedded evidence-path resolution, partial-criterion waiver disclosure, and macOS symlink-safe repository-check workspace assertions ([workspace tests](tests/unit/workspace-roots.test.ts), [validator tests](tests/unit/validators-stage-validators.test.ts), [gate-waiver tests](tests/integration/gate-waiver.test.ts)).

### Fixed

- Rerender each stage brief from its JSON source during submission and reject missing or invalid brief data, non-HTML primary artifacts, or artifact paths that drift from the invocation contract ([runtime engine](src/lib/engine.ts), [stage-output validation](src/lib/validation.ts)).
- Preserve and finalize `artifacts/html/` alongside JSON and explicit Markdown compatibility records, including embedded installations and legacy artifact-layout migration ([artifact finalizer](src/lib/workflow-artifacts.ts), [runtime protocol](docs/runtime-protocol.md)).
- Stop nested generated files under dependency directories from polluting workspace fingerprints and triggering false `scope.no_unapproved_changes` failures on read-only and release-metadata-only stages ([workspace index tests](tests/unit/workspace-index.test.ts)).
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

- Remove persistent workspace locks, active-workflow leases, and per-edit ledgers; retain `pan changes begin|commit|cancel` as compatibility no-ops for upgraded operators ([2342efa](https://github.com/alenlukic/pancreator/commit/2342efa86ddaac407e619952a560d18188af5870)).

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
