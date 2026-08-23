# Changelog

## [4.2.0] - 2026-08-23

### Changed

- Snapshot resolved away-mode settings on new run creation and integrate hypervisor registration and completion hooks in the engine without changing delegation when away mode stays disabled ([engine](src/lib/engine.ts), [project-config](src/lib/project-config.ts)).
- Document hypervisor startup and away-mode configuration in the operator guide ([operator guide](docs/operator-guide.md)).

### Added

- Add a scheduled agent hypervisor with a fixed 900000-millisecond cadence, a registry of active agents and subagents, transcript-backed liveness classification, ordered recovery, and quarantine after a second matching failure ([hypervisor](src/lib/hypervisor.ts), [HYPERVISOR-001](governance/policies/HYPERVISOR-001.json), [hypervisor CLI](src/cli.ts), [hypervisor tests](tests/integration/hypervisor-cli.test.ts)).
- Add away mode with typed `config.json` guardrails, ranked blocker evaluation, rollback-gated selection, and an append-only decision ledger that stays disabled unless the operator enables it ([away-mode](src/lib/away-mode.ts), [AWAY-001](governance/policies/AWAY-001.json), [away-mode tests](tests/unit/away-mode.test.ts)).
- Expose registry-backed agent health on `pan list`, `pan status`, `pan hypervisor status`, and `pan away status`, and add a cursor-agent executor adapter for hypervisor remediation calls ([cli](src/cli.ts), [render](src/lib/render.ts), [cursor-agent](src/lib/executors/cursor-agent.ts)).
- Add the hypervisor persona, skill, and projected agent definition, plus autonomy-state validation for registry and ledger records ([hypervisor persona](library/personas/hypervisor.md), [autonomy-state validator](src/lib/validators/autonomy-state.ts)).

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

- Stop rejecting and rewriting valid Cursor model specs. Cursor parameters are per-model — GPT families take `reasoning`, Claude/Grok/Gemini families take `effort`, and values differ per model — so the v3.5.0 grammar (rejecting `reasoning=`/`thinking=`, hardcoded model and effort enums, a `context` pattern predating the 1m window, and rewriting specs into a flat `<model>-<effort>` slug that is not a model id) refused or mangled strings Cursor itself accepts and projected specs Cursor silently degraded to default variants. Projection now emits the configured spec verbatim in Cursor's documented bracket grammar, canonical drift comparison no longer renames keys or collapses `model[]` into `model`, and the GPT rows in `config.json` are corrected from `effort=` to `reasoning=`. A bracketed spec must also specify every declared parameter of its model — the cursor-agent CLI rejects partial bracket specs such as `claude-fable-5[]` outright, verified by runtime probes that resolved every configured spec to exactly the requested variant — so the underspecified Claude rows are expanded to full specs ([cursor-catalog](src/lib/executors/cursor-catalog.ts), [mapping](src/lib/executors/mapping.ts), [projection](src/lib/projection.ts), [config](config.json), [best-of-n-config](best-of-n-config.json)).
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
