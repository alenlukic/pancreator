# Pancreator v4 operating card

The terms **MUST**, **MUST NOT**, **SHOULD**, **SHOULD NOT**, and **MAY** use RFC 2119 and RFC 8174 meanings.

Pancreator is a Cursor-native workflow harness. Cursor supplies model execution and MCP access. Repository code owns workflow state, validation, retries, and audit records.

## Authority and context

This file is the universal bootstrap for supervisors, workflow workers, standalone-mode agents, and unbound agents.

Authority uses this order:

1. An explicit operator directive.
2. The active invocation or standalone governance card.
3. This operating card.
4. The run snapshots.
5. The policies resolved for the active context.

An operator directive is final for its covered action. Do not infer or broaden an override.

Before repository exploration, read `docs/target-repo-primer.md` and `runtime/repository-checks.json`. Read a primer reference only for a task-specific need.

A workflow worker MUST read its complete invocation contract before other repository context. The invocation supplies its policies, guidance references, inputs, output contract, checks, and boundaries.

Read each target instruction path declared by the invocation before you edit a covered file. Resolve more target instructions when the final changed paths expand.

## Role routing

A supervisor runs only in the operator session started by `/pan-start` or `/pan-resume`. It follows `library/personas/orchestrator.md` and the resolved supervisor policies.

Do not launch `pan-orchestrator` for an ordinary run. A nested supervisor loses the model mapping of each stage worker.

A workflow worker follows its named persona and invocation. It writes only the declared output and permitted evidence.

A standalone mode follows the card from `./bin/pan governance card --mode <mode>`. It holds no workflow run, stage contract, or gate.

An unbound agent handles an ad-hoc operator request outside every run and named mode. Before substantive repository work, it MUST take its governance from `./bin/pan governance card --mode unbound`.

Best-of-N uses the projected `pan-meta-orchestrator` agent. That agent directly supervises each child run and delegates only run-scoped workers.

Ad-hoc Subagent calls MUST omit `model` to inherit the parent model unless the operator explicitly selects a model. Named personas use projected mappings.

## Repository and runtime boundaries

Use `./bin/pan` for every workflow lifecycle action. Do not edit generated run state or workflow records by hand.

Respect the active workspace policy. Do not inspect or change compiled output, caches, virtual environments, dependency trees, or third-party code.

Do not commit, push, merge, publish, deploy, rewrite history, delete branches, or destructively reset without explicit operator authorization.

Source-allowed stages can edit tracked files within their declared scope. Report interrupted edits and workspace changes that you cannot attribute.

The operator owns approvals, waivers, stage changes, pauses, and irreversible decisions. Run the corresponding command when the operator explicitly directs it.

Do not run concurrent mutating workflows against one workspace. Pancreator enforces this rule through governance, not persistent locks.

## Governance and projections

Normative behavior belongs in policy JSON. Role judgment belongs in personas. Task procedure belongs in stage prompts or referenced skills.

Policy applicability belongs only in `governance/registries/policy_lookup_table.json`. Requirements derive from the resolved policy set.

Canonical Cursor sources live under `library/cursor/`. The projection manifest declares every Pancreator-owned target under `.cursor/`.

Treat the local `.cursor/` tree as ignored and disposable. Run `./bin/pan models --sync` after a canonical projection or mapped-model change.

TypeScript and TSX changes MUST apply the normative sections referenced by `TS-001`. Do not inspect formatter-owned appendices during ordinary work.

Durable operator artifacts MUST apply `STE-001`. Repository documentation and source code remain outside that writing policy.

## Target installations

An embedded harness lives at `<target>/.pancreator`. A detached harness records an absolute workspace root outside the target.

The target repository owns application source, Git state, target instructions, and target-authored agent tooling. Pancreator owns harness state and stage contracts.

Do not import target application code into Pancreator source. Do not make target application code depend on Pancreator internals.

Installation MUST NOT change a target-tracked file or the target `.gitignore`. The installer manages clone-local exclusions in `.git/info/exclude`.

Use `isTargetInstallation` for behavior shared by embedded and detached modes. Use `isEmbeddedInstallation` only for location-specific behavior.

Validate embedded installation against an external target repository with `./bin/install --target <path>`.

Read the target repository's `AGENTS.md` before you change that target.

Do not stage, commit, or otherwise track target-repository contents from the Pancreator source checkout.

## Release boundary

Only a self-development ship stage or `/pan-release` can change Pancreator release metadata. The release steward owns the version decision and synchronized metadata.

Do not edit `release/index.json` before the release commit exists. Commit, push, publication, and deployment still need explicit operator authorization.

## Shell and chat output

The `rtk` wrapper can summarize or truncate Cursor shell output. Rerun a command with explicit bounded capture when exact bytes matter.

Validate multi-line fenced chat Markdown with `npm run validate:chat-markdown` before you send it. Correct every reported issue before you send the text.

## Validation

Use `runtime/repository-checks.json` as command authority. Do not infer a package manager, interpreter, runtime, or verification profile.

The harness reruns deterministic gates and judges baselined checks by diagnostic delta. A new or worsened diagnostic fails its gate.

Required structured outputs must pass their resolved policy-bound validators. Report missing evidence and uncertainty instead of manufacturing completion.
