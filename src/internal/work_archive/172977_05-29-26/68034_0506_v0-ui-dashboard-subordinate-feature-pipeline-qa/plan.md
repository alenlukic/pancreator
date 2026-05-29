# Plan — v0 UI Dashboard Subordinate QA

## Architecture Summary

The implementation SHALL add one operator-local Next.js App Router application under `client/` and wire it into the existing pnpm workspace without changing feature-delivery runtime code. The app SHALL expose repository activity and file operations through server-side API routes that resolve paths against the repository root, deny traversal and `src/inbox/notes/**`, and feed a relationship-oriented dashboard that links inbox, memory, personas, work, and internal package areas. This plan satisfies the ratified spec work packages for subordinate lifecycle evidence, QA-context hygiene, dashboard UI, repository APIs, tests, and final evidence reporting. Citations: `{kind: lines, path: src/memory/features/v0-ui-dashboard-subordinate-feature-pipeline-qa/spec.md, range: [113, 159], contentHash: 199faf3}`; `{kind: lines, path: src/pipelines/feature-delivery.yaml, range: [25, 66], contentHash: a247fa7}`.

## Implementation Tasks

1. Preserve subordinate QA context. The coder SHALL keep `src/memory/features/v0-ui-dashboard-subordinate-feature-pipeline-qa/spec.md` front matter as the hygiene authority and SHALL treat this run directory plus `client/**` as declared subordinate evidence. Citation: `{kind: lines, path: src/memory/features/v0-ui-dashboard-subordinate-feature-pipeline-qa/spec.md, range: [120, 124], contentHash: 199faf3}`.

2. Add workspace wiring. The coder SHALL add `client` to `pnpm-workspace.yaml`, update root workspace metadata only as required by pnpm, and keep existing `src/internal/packages/**` workspace entries unchanged. Citation: `{kind: lines, path: src/memory/features/v0-ui-dashboard-subordinate-feature-pipeline-qa/spec.md, range: [126, 130], contentHash: 199faf3}`.

3. Scaffold `client/`. The coder SHALL create a TypeScript Next.js App Router project with React >= 18, hot reload via `next dev`, and one modern component library dependency. The coder SHOULD prefer a small local UI layer plus a maintained library such as Radix UI primitives or shadcn-compatible Radix packages to limit lockfile churn. Citation: `{kind: lines, path: src/memory/features/v0-ui-dashboard-subordinate-feature-pipeline-qa/spec.md, range: [126, 135], contentHash: 199faf3}`.

4. Implement repository path services. The coder SHALL create shared server utilities that locate the repository root, normalize repo-relative paths, reject traversal, reject symlink escapes, and deny `src/inbox/notes/**` before any read or write. Citation: `{kind: lines, path: src/memory/features/v0-ui-dashboard-subordinate-feature-pipeline-qa/spec.md, range: [137, 143], contentHash: 199faf3}`.

5. Implement API routes. The coder SHALL add `GET /api/activity`, `GET /api/file`, and `POST /api/file`; successful writes SHALL log `path`, `bytes_written`, and timestamp in one structured line. Citation: `{kind: lines, path: src/memory/features/v0-ui-dashboard-subordinate-feature-pipeline-qa/spec.md, range: [137, 143], contentHash: 199faf3}`.

6. Build the dashboard UI. The coder SHALL render relationship navigation for `src/inbox/`, `src/memory/`, `src/personas/`, `src/work/`, and `src/internal/packages/`; file selection SHALL open a collapsible inline modal with read and edit affordances; saves SHALL update the view without a full reload. Citation: `{kind: lines, path: src/memory/features/v0-ui-dashboard-subordinate-feature-pipeline-qa/spec.md, range: [131, 134], contentHash: 199faf3}`.

7. Centralize design tokens. The coder SHALL define the palette tokens `ink-black`, `celadon`, `brown-red`, and `amber-flame` once and reference those names in UI styling. Citation: `{kind: lines, path: src/memory/features/v0-ui-dashboard-subordinate-feature-pipeline-qa/spec.md, range: [134, 135], contentHash: 199faf3}`.

8. Add tests. The coder SHALL add API tests for activity ordering, read success, write success, and traversal denial; UI tests SHALL cover five-domain navigation, modal file content, and reverse-chronological feed rendering. Citation: `{kind: lines, path: src/memory/features/v0-ui-dashboard-subordinate-feature-pipeline-qa/spec.md, range: [145, 154], contentHash: 199faf3}`.

9. Document local operation. The coder SHALL add `client/README.md` with one startup command, test commands, and v0 limitations. Citation: `{kind: lines, path: src/memory/features/v0-ui-dashboard-subordinate-feature-pipeline-qa/spec.md, range: [145, 154], contentHash: 199faf3}`.

10. Emit implementation evidence. The coder SHALL write `implementation-report.md` with changed paths, validation outcomes, ratification notes, and any deferred items; later personas SHALL use it for review, QA, and delivery reporting. Citation: `{kind: lines, path: src/memory/features/v0-ui-dashboard-subordinate-feature-pipeline-qa/spec.md, range: [155, 159], contentHash: 199faf3}`.

## Validation

The implementation stage SHALL run these checks when dependencies are installed:

```bash
pnpm --filter client lint
pnpm --filter client test
pnpm --filter client build
node --test tests/*.test.mjs
node src/internal/tools/check-phase-0a-scaffold.mjs
node src/internal/tools/context-budget-report.mjs
```

## Documentation Impact

```yaml
documentation_impact:
  applies: true
  rationale: The plan introduces a new operator-local dashboard application and required operation notes under client/README.md.
  changed-surfaces:
    - client/README.md
    - pnpm-workspace.yaml
    - package.json
    - pnpm-lock.yaml
    - src/work/172977_05-29-26/68034_0506_v0-ui-dashboard-subordinate-feature-pipeline-qa/implementation-report.md
    - src/memory/features/v0-ui-dashboard-subordinate-feature-pipeline-qa/delivery-report.md
  deferred-items: []
```

## Human Ratification

The acting agent ratifies this planning bundle for subordinate QA execution. The next stage SHALL be `implement` after the operator accepts `touch-set.json` as the stage artifact.

## Subordinate hygiene exception

This subordinate run disables the normal touch-set / worktree hygiene gate (`touch-set.json` `worktreeHygieneGate: disabled`). Review and test stages SHALL advance when `client/**` implementation and feature-specific validation pass; they SHALL NOT loop to `implement` for sibling work dirs, parent-branch diffs, or pipeline-generated paths outside this task's `paths[]`.
