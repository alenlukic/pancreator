---
title: "v0-ui-dashboard-subordinate-feature-pipeline-qa"
feature_id: "v0-ui-dashboard-subordinate-feature-pipeline-qa"
stage: intake
owner: "intake-analyst"
status: open
created_at: "2026-05-29T04:27:34.273Z"
references: []
---

# v0-ui-dashboard-subordinate-feature-pipeline-qa

## Problem

The parent feature `feature-delivery-harness-wire-cursorrunner-through-run-and-advance`
needs QA evidence that the automated feature-delivery runner/harness can execute a realistic
subordinate directive without falsely classifying expected artifacts as worktree-hygiene
violations.

## Goal

Exercise a subordinate feature-delivery run for a `v0-ui-dashboard` while the acting agent
stands in for human operator choices and ratification points required by the current
automation design.

## Required outcomes

- Create and execute a subordinate feature-delivery task for `v0-ui-dashboard`.
- Mark this directive as subordinate QA harness exercise context so expected generated run
  artifacts do not trigger incorrect hygiene flags.
- Implement a v0 full-stack Next.js dashboard in a new top-level `client/` directory with:
  - navigation across core repo components (inbox, memory, personas, work, related areas),
  - relationship-focused UI/UX structure and interactions,
  - collapsible inline modal views for core component files,
  - file editing support,
  - reverse-chronological human-readable repo activity feed.
- Use API endpoints for live feed and file read/edit operations.
- Use modern package versions and a modern React component library.
- Use palette values:
  - `#05031B` (Ink Black),
  - `#BBD8B3` (Celadon),
  - `#A22C29` (Brown Red),
  - `#FFB400` (Amber Flame).
- Ensure the app starts with one command and supports hot reload.
- Add tests that cover core behavior.

## Acceptance criteria

- `pnpm -w exec pan run feature-delivery <day-bucket>/<intake-file>.md` starts a valid run
  for this subordinate directive.
- Stage artifacts and transitions are recorded without false-positive hygiene failures tied
  to known subordinate QA context or expected generated files.
- Stage-reached implementation and tests satisfy the v0 dashboard outcomes listed above.
- QA reporting explicitly states pass/fail/deferred outcomes and blockers.
- Artifacts are sufficient evidence for the parent harness QA stage decision.

## Out of scope

- Production deployment and non-v0 polish beyond baseline operator usability.
- Work unrelated to proving subordinate automation behavior for the parent harness feature.
- Manual gate bypasses that would invalidate automation test evidence.
