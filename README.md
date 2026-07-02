# Pancreator v2.10.0

Pancreator v2.10.0 is a workflow harness that helps teams use Cursor agents like an engineering workflow instead of a one-off chat. It brings structure, repeatability, and operator control to planning, implementation, review, QA, and release preparation without asking you to leave your repository.

It is built for teams that want faster agent-assisted delivery without turning approvals, validation, or release decisions into a black box.

## Why Pancreator

- Keep a human operator in control of high-impact decisions.
- Give agents durable repository context before they start changing code.
- Separate planning, implementation, review, and QA so one agent is not grading its own work.
- Resume work cleanly when a task spans multiple turns, sessions, or handoffs.
- Bring the same governed workflow into other repositories with an embedded install.

## What It Does

Pancreator adds a set of Cursor commands, supporting agents, and repository-aware workflow tools that help you:

- turn broad requests into scoped, reviewable work;
- run implementation through explicit validation and QA gates;
- debug issues with a bounded investigation path;
- prepare release notes and version metadata with the operator still owning the release action;
- generate durable repository orientation docs so future agent work starts with better context.

## Requirements

- Node.js 22 or newer
- Git
- Cursor with project commands and subagents enabled
- Optional MCP servers configured in Cursor for teams that want them

## Quick Start In Cursor

1. Sync the local Cursor projection:

   ```sh
   ./bin/pan models --sync
   ```

2. Open or reload the repository in Cursor, then validate the setup:

   ```sh
   /pan-validate
   ```

3. Build repository orientation so agents start from accurate local context:

   ```sh
   /pan-build-docs
   ```

4. Choose the workflow that matches the job:

   - Use `/pan-start <request>` for normal delivery work.
   - Use `/pan-debug <problem>` when you need root-cause analysis first.
   - Use `/pan-spotfix <request>` for an explicitly small, bounded change.
   - Use `/pan-release` when you want Pancreator to prepare release metadata.

5. Continue the run with `/pan-resume <run-id>` whenever Pancreator pauses for the next operator decision.

## Install Into Another Repository

Use Pancreator from this source checkout to install the workflow harness into a target repository:

```sh
./bin/install --target /path/to/your-project
cd /path/to/your-project
./.pancreator/bin/pan doctor
./.pancreator/bin/pan validate
```

Pancreator installs into `.pancreator/` and projects its Cursor commands and agents into the target repository, so the workflow travels with the codebase you actually want to manage.

For indexed release updates:

```sh
./bin/update --target /path/to/your-project
```

## Common Entry Points

- `/pan-start`: start a governed delivery run for a new request
- `/pan-debug`: investigate a problem and recommend the right work mode
- `/pan-build-docs`: generate or refresh repository orientation for future agent work
- `/pan-release`: prepare version metadata and release notes
- `/pan-write-pr [base-branch]`: draft a pull request description from the current branch

## Learn More

- [`docs/operator-guide.md`](docs/operator-guide.md) for day-to-day operation and remediation
- [`docs/embedded-installation.md`](docs/embedded-installation.md) for installation boundaries and update behavior
- [`docs/workflow-authoring.md`](docs/workflow-authoring.md) for defining or extending workflows
- [`CHANGELOG.md`](CHANGELOG.md) for release history
