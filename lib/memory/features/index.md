# Feature memory index

Use this file as the first stop for shipped feature context. Open the category index first, then the smallest set of per-feature `index.json` files needed for the task.

## Bootstrap and repository operations (`bootstrap-repo-ops/`)

Use for bootstrap closure, repository layout, embedded install, and one-time migration history.

| Feature | Status | Why it matters | Path |
|---|---|---|---|
| `bootstrap-cruft-cleanup-batch-stub-feature-folders-and-cursor-agent-variants` | indexed | Work package A normalized 20 pancreator-* feature folders by prepending YAML frontmatter to each spec.md, creating stub delivery-report.md and… | `lib/memory/features/bootstrap-repo-ops/bootstrap-cruft-cleanup-batch-stub-feature-folders-and-cursor-agent-variants/index.json` |
| `bootstrap-de-hacking-pass-simplify-ops-docs-and-memory-layout` | indexed | This pass centralized operator workflow into OPERATION.md, routed the repo's entry points to that guide, tightened operator-output conformance… | `lib/memory/features/bootstrap-repo-ops/bootstrap-de-hacking-pass-simplify-ops-docs-and-memory-layout/index.json` |
| `bootstrap-phase-0a-closure` | ready-for-review | Phase 0a delivered the M1 primitive package skeleton under lib/internal/packages/@pancreator/, the unscoped meta package at… | `lib/memory/features/bootstrap-repo-ops/bootstrap-phase-0a-closure/index.json` |
| `bootstrap-phase-5-m1-exit-close-docs-bootstrap` | indexed | This feature delivered the WP1 greenfield evidence contract, the deterministic in-repo evaluator, the WP2 knowledge-curation cron-seed guidance, and… | `lib/memory/features/bootstrap-repo-ops/bootstrap-phase-5-m1-exit-close-docs-bootstrap/index.json` |
| `embedded-harness-install-project-root-pancreator-and-fresh-install-manifest` | indexed | This feature delivered embedded-install project-root resolution for the Pancreator harness, including the shared @pancreator/core resolver, CLI… | `lib/memory/features/bootstrap-repo-ops/embedded-harness-install-project-root-pancreator-and-fresh-install-manifest/index.json` |
| `embedded-install-cursor-agent-sync-init-content-seeding-and-inbox-path-bugs` | indexed | This feature delivered the embedded-install fixes for cursor-agent sync, init content seeding, and inbox path resolution. The shipped scope promotes… | `lib/memory/features/bootstrap-repo-ops/embedded-install-cursor-agent-sync-init-content-seeding-and-inbox-path-bugs/index.json` |
| `repository-layout-restructure-and-archive-migration` | indexed | This feature completed the repository topology migration to the post-restructure layout. The canonical archive tree now lives under .pan/archive/… | `lib/memory/features/bootstrap-repo-ops/repository-layout-restructure-and-archive-migration/index.json` |

## Command Center UX and operator surfaces (`command-center/`)

Use when planning or reviewing Command Center UI, operator mission control, automation views, or design-craft work.

| Feature | Status | Why it matters | Path |
|---|---|---|---|
| `command-center-active-memory-craft-enforcement` | indexed | This feature closes design-craft gates #2, #3, #9, #11, and #12 on the Command Center Pipeline Active memory panel while retaining F-05 expand toggle… | `lib/memory/features/command-center/command-center-active-memory-craft-enforcement/index.json` |
| `command-center-active-memory-inbox-triage-multi-run-view` | indexed | This feature delivery ships Command Center Pipeline orientation surfaces: active-memory and inbox triage read APIs, a guarded pan execute route, and… | `lib/memory/features/command-center/command-center-active-memory-inbox-triage-multi-run-view/index.json` |
| `command-center-active-memory-operator-craft-revalidation` | indexed | This feature revalidates the Command Center Pipeline Active memory panel under tightened design-craft gates 1, 2, 3, 5, 9, and 11 while restoring… | `lib/memory/features/command-center/command-center-active-memory-operator-craft-revalidation/index.json` |
| `command-center-active-memory-operator-readability` | indexed | This feature refines the Command Center Pipeline sidebar Active memory panel for operator readability, addressing design audit findings F-01, F-02… | `lib/memory/features/command-center/command-center-active-memory-operator-readability/index.json` |
| `command-center-app-shell-navigation-rail-and-operator-theme-tokens` | indexed | Compressed memory record for Command Center app shell, navigation rail, and operator theme tokens. | `lib/memory/features/command-center/command-center-app-shell-navigation-rail-and-operator-theme-tokens/index.json` |
| `command-center-automation-registry-and-management-ui` | indexed | This feature delivery ships a Pancreator-native automation registry and Command Center Automations management UI. The @pancreator/scheduler package… | `lib/memory/features/command-center/command-center-automation-registry-and-management-ui/index.json` |
| `command-center-automations-list-and-run-history-under-ten-surface-shell` | indexed | This Feature SHALL re-home Command Center automations list, create wizard, and run history into the ten-surface shell at route /automations per… | `lib/memory/features/command-center/command-center-automations-list-and-run-history-under-ten-surface-shell/index.json` |
| `command-center-command-center-operational-state-surface` | indexed | This feature delivery ships Command Center Command Center as the default operator landing inside the ten-surface shell. The client redirects / to… | `lib/memory/features/command-center/command-center-command-center-operational-state-surface/index.json` |
| `command-center-craft-polish-pass` | indexed | This feature delivery closes design-audit blocker B1 and majors M1–M6 in Command Center through a bounded craft-polish pass limited to… | `lib/memory/features/command-center/command-center-craft-polish-pass/index.json` |
| `command-center-feature-delivery-mission-control-run-detail` | indexed | This feature delivery ships FD Mission Control at /mission-control as a single-run inspection surface inside the Command Center shell. The module… | `lib/memory/features/command-center/command-center-feature-delivery-mission-control-run-detail/index.json` |
| `command-center-live-run-refresh-and-stage-artifact-drawer` | indexed | This feature delivery adds live run observation to the Command Center Pipeline module. The client polls GET /api/run-state every 7.5 seconds while… | `lib/memory/features/command-center/command-center-live-run-refresh-and-stage-artifact-drawer/index.json` |
| `command-center-local-scheduler-tick-and-run-history` | indexed | This feature delivery ships local automation execution and append-only JSONL run history for Command Center. The @pancreator/scheduler package gains… | `lib/memory/features/command-center/command-center-local-scheduler-tick-and-run-history/index.json` |
| `command-center-maintenance-toolkit-compliance-tests` | indexed | This feature delivery replaces the Command Center Maintenance placeholder with a full operator toolkit for compliance audits, allowlisted test-suite… | `lib/memory/features/command-center/command-center-maintenance-toolkit-compliance-tests/index.json` |
| `command-center-module-tab-accessibility` | indexed | This feature delivery closes design-audit findings F-01 and F-09 by refactoring DashboardModuleShell module navigation to the WAI-ARIA tabs pattern… | `lib/memory/features/command-center/command-center-module-tab-accessibility/index.json` |
| `command-center-pipeline-command-center-and-human-gate-queue` | indexed | This feature delivery ships the Command Center Pipeline command center: run-state field split, enriched task envelopes, a read-only config API… | `lib/memory/features/command-center/command-center-pipeline-command-center-and-human-gate-queue/index.json` |
| `command-center-post-ship-remediation` | indexed | Terminal-status filtering for Command Center attention reconciliation; artifact_index links acceptance-criteria sources, gate evidence, audit logs, and compliance history. | `lib/memory/features/command-center/command-center-post-ship-remediation/index.json` |
| `command-center-rebuild` | indexed | This feature delivery rebuilds the Pancreator Command Center as five URL destinations with a reconciled attention model, receipt-backed mutations… | `lib/memory/features/command-center/command-center-rebuild/index.json` |
| `command-center-unified-work-intake-and-kickoff-flow` | indexed | This Feature SHALL deliver the Command Center Work Intake / Kickoff surface at route /work-intake so operators start feature-delivery without… | `lib/memory/features/command-center/command-center-unified-work-intake-and-kickoff-flow/index.json` |
| `command-center-ux-philosophy-information-architecture-and-user-stories` | indexed | This Feature ratifies documentation-only successor UX authority for Command Center before production React or API code lands. The implement stage… | `lib/memory/features/command-center/command-center-ux-philosophy-information-architecture-and-user-stories/index.json` |
| `command-center-ux-spec-and-information-architecture` | indexed | This feature delivery ratifies documentation-only UX authority for Command Center before any production React or API code lands. The implement stage… | `lib/memory/features/command-center/command-center-ux-spec-and-information-architecture/index.json` |
| `surface-opt-p10-dashboard-safe-editing` | indexed | This feature delivery hardens the dashboard file-editor modal inside DashboardPage. Every open starts read-only with an explicit Edit affordance… | `lib/memory/features/command-center/surface-opt-p10-dashboard-safe-editing/index.json` |
| `surface-opt-p9-dashboard-operator-command-center` | indexed | This feature delivery ships a read-only dashboard Command Center. The default view renders one 9-stage grid and a run-event timeline per active… | `lib/memory/features/command-center/surface-opt-p9-dashboard-operator-command-center/index.json` |
| `v0-ui-dashboard-subordinate-feature-pipeline-qa` | indexed | The subordinate run delivered a complete v0 client/ dashboard with path-safe file APIs, reverse-chronological activity evidence, and operator-local… | `lib/memory/features/command-center/v0-ui-dashboard-subordinate-feature-pipeline-qa/index.json` |

## Feature-delivery pipeline and run operations (`delivery-pipeline/`)

Use when changing feature-delivery stages, SDK progress, inbox kickoff, QA/review gates, or run lifecycle semantics.

| Feature | Status | Why it matters | Path |
|---|---|---|---|
| `batch-feature-delivery-runs-sequential-parallel` | indexed | This feature ships pnpm -w exec pan batch run as a batch orchestrator over existing startFeatureDelivery SDK sub-runs on isolated worktree branches… | `lib/memory/features/delivery-pipeline/batch-feature-delivery-runs-sequential-parallel/index.json` |
| `build-mode-inbox-scaffolding` | indexed | This feature closes the gap between Cursor Build mode and the Pancreator inbox queue. The implement stage verified pre-existing shared intake… | `lib/memory/features/delivery-pipeline/build-mode-inbox-scaffolding/index.json` |
| `cli-operator-tooling-batch-deferral-protocol-intake-scaffolder-active-memory-ref` | indexed | This batch delivered the three operator-facing affordances called for in the feature spec: | `lib/memory/features/delivery-pipeline/cli-operator-tooling-batch-deferral-protocol-intake-scaffolder-active-memory-ref/index.json` |
| `fd-pipeline-sdk-mode-retry-model-escalation-tiers` | indexed | This delivery adds declarative SDK model escalation tiers for feature-delivery retries. Operators configure pancreator-model-escalation.yaml at the… | `lib/memory/features/delivery-pipeline/fd-pipeline-sdk-mode-retry-model-escalation-tiers/index.json` |
| `feature-delivery-harness-wire-cursorrunner-through-run-and-advance` | indexed | This delivery wires feature-delivery to an opt-in Cursor SDK path shared by run and advance, while manual mode remains the default operator flow. It… | `lib/memory/features/delivery-pipeline/feature-delivery-harness-wire-cursorrunner-through-run-and-advance/index.json` |
| `inbox-convention-migration` | indexed | This re-entry slice hardens the standalone inbox convention migration tool and extends legacy thread discovery so nested layout is handled safely… | `lib/memory/features/delivery-pipeline/inbox-convention-migration/index.json` |
| `phase-4-dogfood-proof-bundle-evidence-index` | pending-human-ratification | This slice ships the Phase 4 dogfood proof-bundle evidence index as a documentation-only contract. It defines a real seven-stage nested… | `lib/memory/features/delivery-pipeline/phase-4-dogfood-proof-bundle-evidence-index/index.json` |
| `phase-4-intervention-probe-pause-resume-abort` | pending-human-ratification | This feature ships a bounded Phase 4 intervention probe that captures empirical pause, resume, and abort evidence while the run sits at live plan… | `lib/memory/features/delivery-pipeline/phase-4-intervention-probe-pause-resume-abort/index.json` |
| `surface-opt-track-o-cli-engine` | indexed | Compressed memory record for surface-opt Track O — CLI/runner engine pass. | `lib/memory/features/delivery-pipeline/surface-opt-track-o-cli-engine/index.json` |
| `us-1-dogfood-phase-4-exit` | human-ratified | This phase-4 exit slice ships the scaffold for the dogfood proof bundle, not the empirical proof itself. It adds the nested proof-bundle-index… | `lib/memory/features/delivery-pipeline/us-1-dogfood-phase-4-exit/index.json` |

## Memory, context economy, and retrieval (`memory-context/`)

Use when changing active memory, feature indexes, Cursor retrieval, context budget, token economy, or memory MCP behavior.

| Feature | Status | Why it matters | Path |
|---|---|---|---|
| `active-memory-context-economy-pass-2` | shipped | This Feature shipped a five-tier memory model, an lib/memory/active/ operator surface, a slimmer AGENTS.md routing card, narrowed Cursor rule… | `lib/memory/features/memory-context/active-memory-context-economy-pass-2/index.json` |
| `context-usage-test-harness` | indexed | The context-usage-test-harness Feature ships a manual-only runtime probe under tests/context-usage/ that copies a synthetic eight-tier sandbox… | `lib/memory/features/memory-context/context-usage-test-harness/index.json` |
| `cursor-token-economy` | shipped | This Feature reduces default Cursor cache-read volume while preserving explicit access to canonical repo surfaces. It adds a root… | `lib/memory/features/memory-context/cursor-token-economy/index.json` |
| `pancreator-memory` | indexed | Bootstrap slice 54615_0849_bootstrap-cruft-cleanup-batch-stub-feature-folders-and-cursor-agent-variants indexed this Phase-2 engineering-spec folder… | `lib/memory/features/memory-context/pancreator-memory/index.json` |
| `sampled-token-audit` | indexed | The sampled-token-audit Feature adds phase-1 token observability to feature-delivery SDK invocations. The implementation SHALL expose… | `lib/memory/features/memory-context/sampled-token-audit/index.json` |
| `surface-opt-p1-fix-mcp-memory-path` | indexed | This remediation pass implements the missing P1 behavior in code: the memory:// handler now resolves under lib/memory, and a regression test asserts… | `lib/memory/features/memory-context/surface-opt-p1-fix-mcp-memory-path/index.json` |
| `surface-opt-p2-fix-mcp-work-run-log-path` | indexed | The work-run-log://<taskId> resource now resolves run logs through a day-aware search that matches the runtime layout, the resource description now… | `lib/memory/features/memory-context/surface-opt-p2-fix-mcp-work-run-log-path/index.json` |
| `surface-opt-p3-cap-current-md-shipped-features-ledger` | indexed | The refresh pipeline now caps the current.md shipped-Features ledger at 10 rows, trims trailing blank lines on assembly, and keeps the committed… | `lib/memory/features/memory-context/surface-opt-p3-cap-current-md-shipped-features-ledger/index.json` |
| `surface-opt-p4-tighten-cursor-agents-retrieval-contracts` | indexed | This report SHALL record the delivery state for surface-opt P4. R1-R3 implementation work is complete, and AC4 is now satisfied by the… | `lib/memory/features/memory-context/surface-opt-p4-tighten-cursor-agents-retrieval-contracts/index.json` |
| `token-economy-calibration-hardening` | indexed | The token-economy-calibration-hardening Feature hardens the shipped prototype calibration harness under tests/compliance/context-usage/ without… | `lib/memory/features/memory-context/token-economy-calibration-hardening/index.json` |
| `token-economy-prototype` | indexed | The token-economy-prototype Feature replaces the legacy context-usage harness under tests/compliance/context-usage/ with a 2×2 prototype matrix… | `lib/memory/features/memory-context/token-economy-prototype/index.json` |

## Pancreator package substrate (`platform-substrate/`)

Use when changing @pancreator package boundaries, package contracts, CLI/MCP substrate, policy, runner, or storage packages.

| Feature | Status | Why it matters | Path |
|---|---|---|---|
| `m1-substrate-runtime-batch-harness-loop-install-paths-library-mode-phoenix-confo` | indexed | This batch shipped the harness-loop core and the operator surfaces around it: a LangGraph-backed pipeline compiler and execution path, SDK-flagged… | `lib/memory/features/platform-substrate/m1-substrate-runtime-batch-harness-loop-install-paths-library-mode-phoenix-confo/index.json` |
| `pancreator-adopter-scan` | indexed | Bootstrap slice 54615_0849_bootstrap-cruft-cleanup-batch-stub-feature-folders-and-cursor-agent-variants indexed this Phase-2 engineering-spec folder… | `lib/memory/features/platform-substrate/pancreator-adopter-scan/index.json` |
| `pancreator-checkpointer-fs` | indexed | Bootstrap slice 54615_0849_bootstrap-cruft-cleanup-batch-stub-feature-folders-and-cursor-agent-variants indexed this Phase-2 engineering-spec folder… | `lib/memory/features/platform-substrate/pancreator-checkpointer-fs/index.json` |
| `pancreator-cli` | indexed | Bootstrap slice 54615_0849_bootstrap-cruft-cleanup-batch-stub-feature-folders-and-cursor-agent-variants indexed this Phase-2 engineering-spec folder… | `lib/memory/features/platform-substrate/pancreator-cli/index.json` |
| `pancreator-contract` | indexed | Bootstrap slice 54615_0849_bootstrap-cruft-cleanup-batch-stub-feature-folders-and-cursor-agent-variants indexed this Phase-2 engineering-spec folder… | `lib/memory/features/platform-substrate/pancreator-contract/index.json` |
| `pancreator-contract-runner-llm-judge` | indexed | Bootstrap slice 54615_0849_bootstrap-cruft-cleanup-batch-stub-feature-folders-and-cursor-agent-variants indexed this Phase-2 engineering-spec folder… | `lib/memory/features/platform-substrate/pancreator-contract-runner-llm-judge/index.json` |
| `pancreator-contract-runner-rego` | indexed | Bootstrap slice 54615_0849_bootstrap-cruft-cleanup-batch-stub-feature-folders-and-cursor-agent-variants indexed this Phase-2 engineering-spec folder… | `lib/memory/features/platform-substrate/pancreator-contract-runner-rego/index.json` |
| `pancreator-contract-style` | indexed | Bootstrap slice 54615_0849_bootstrap-cruft-cleanup-batch-stub-feature-folders-and-cursor-agent-variants indexed this Phase-2 engineering-spec folder… | `lib/memory/features/platform-substrate/pancreator-contract-style/index.json` |
| `pancreator-core` | indexed | Bootstrap slice 54615_0849_bootstrap-cruft-cleanup-batch-stub-feature-folders-and-cursor-agent-variants indexed this Phase-2 engineering-spec folder… | `lib/memory/features/platform-substrate/pancreator-core/index.json` |
| `pancreator-env-isolation` | indexed | Bootstrap slice 54615_0849_bootstrap-cruft-cleanup-batch-stub-feature-folders-and-cursor-agent-variants indexed this Phase-2 engineering-spec folder… | `lib/memory/features/platform-substrate/pancreator-env-isolation/index.json` |
| `pancreator-inbox` | indexed | Bootstrap slice 54615_0849_bootstrap-cruft-cleanup-batch-stub-feature-folders-and-cursor-agent-variants indexed this Phase-2 engineering-spec folder… | `lib/memory/features/platform-substrate/pancreator-inbox/index.json` |
| `pancreator-intervention` | indexed | Bootstrap slice 54615_0849_bootstrap-cruft-cleanup-batch-stub-feature-folders-and-cursor-agent-variants indexed this Phase-2 engineering-spec folder… | `lib/memory/features/platform-substrate/pancreator-intervention/index.json` |
| `pancreator-mcp-server` | indexed | Bootstrap slice 54615_0849_bootstrap-cruft-cleanup-batch-stub-feature-folders-and-cursor-agent-variants indexed this Phase-2 engineering-spec folder… | `lib/memory/features/platform-substrate/pancreator-mcp-server/index.json` |
| `pancreator-notifier` | indexed | Bootstrap slice 54615_0849_bootstrap-cruft-cleanup-batch-stub-feature-folders-and-cursor-agent-variants indexed this Phase-2 engineering-spec folder… | `lib/memory/features/platform-substrate/pancreator-notifier/index.json` |
| `pancreator-persona` | indexed | Bootstrap slice 54615_0849_bootstrap-cruft-cleanup-batch-stub-feature-folders-and-cursor-agent-variants indexed this Phase-2 engineering-spec folder… | `lib/memory/features/platform-substrate/pancreator-persona/index.json` |
| `pancreator-pipeline` | indexed | Bootstrap slice 54615_0849_bootstrap-cruft-cleanup-batch-stub-feature-folders-and-cursor-agent-variants indexed this Phase-2 engineering-spec folder… | `lib/memory/features/platform-substrate/pancreator-pipeline/index.json` |
| `pancreator-policy` | indexed | Bootstrap slice 54615_0849_bootstrap-cruft-cleanup-batch-stub-feature-folders-and-cursor-agent-variants indexed this Phase-2 engineering-spec folder… | `lib/memory/features/platform-substrate/pancreator-policy/index.json` |
| `pancreator-run-logger` | indexed | Bootstrap slice 54615_0849_bootstrap-cruft-cleanup-batch-stub-feature-folders-and-cursor-agent-variants indexed this Phase-2 engineering-spec folder… | `lib/memory/features/platform-substrate/pancreator-run-logger/index.json` |
| `pancreator-runner-cursor` | indexed | Bootstrap slice 54615_0849_bootstrap-cruft-cleanup-batch-stub-feature-folders-and-cursor-agent-variants indexed this Phase-2 engineering-spec folder… | `lib/memory/features/platform-substrate/pancreator-runner-cursor/index.json` |
| `pancreator-worktree` | indexed | Bootstrap slice 54615_0849_bootstrap-cruft-cleanup-batch-stub-feature-folders-and-cursor-agent-variants indexed this Phase-2 engineering-spec folder… | `lib/memory/features/platform-substrate/pancreator-worktree/index.json` |

## Quality, compliance, and governance (`quality-governance/`)

Use when changing compliance tests, JSON/timestamp policy, operator verification, CI expectations, contract style, or QA gates.

| Feature | Status | Why it matters | Path |
|---|---|---|---|
| `ci-best-practices-batch` | indexed | ci-best-practices-batch shipped four coordinated updates: root CI test aggregation, a descriptor-driven compliance runner, deterministic citation… | `lib/memory/features/quality-governance/ci-best-practices-batch/index.json` |
| `compliance-tests` | indexed | This slice ships the canonical compliance-test surface under tests/compliance/, the first-slice manual runbook, severity routing, run-template… | `lib/memory/features/quality-governance/compliance-tests/index.json` |
| `json-formatting` | indexed | The json-formatting feature ships a canonical JSON formatting policy across all Round-02 R1 surfaces: repository .json artifacts, Markdown-embedded… | `lib/memory/features/quality-governance/json-formatting/index.json` |
| `operator-verification-and-reopen` | indexed | Require an operator-facing verification pack at pipeline and ad-hoc close, gate archival on its presence, and provide pan reopen to unarchive closed… | `lib/memory/features/quality-governance/operator-verification-and-reopen/index.json` |
| `timestamp-naming-conventions` | intake-closed | The Feature defines a UTC-only naming policy for in-scope temporal artifacts, migrates existing paths with a dry-run-first workflow, and rewrites… | `lib/memory/features/quality-governance/timestamp-naming-conventions/index.json` |
