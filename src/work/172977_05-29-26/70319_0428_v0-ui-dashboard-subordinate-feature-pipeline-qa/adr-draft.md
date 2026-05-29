# ADR Draft — Build subordinate v0 dashboard in top-level client app

## Status

Draft for ratification at the `plan` stage.

## Context

The subordinate QA run previously advanced without implementing the requested v0 dashboard. The corrective objective is to prove the feature-delivery pipeline can move from plan through implementation and verification with real artifacts, not placeholder reports.

The intake and feature spec require a top-level `client/` Next.js full-stack dashboard with API routes for activity and file operations, interactive repository navigation, inline modal file editing, and a reverse-chronological human-readable activity feed.

## Decision

The implementation stage SHALL create a standalone Next.js App Router project in `client/`, wired into the repository workspace, and SHALL implement:

1. API routes for activity listing, file read, and file write.
2. A modern component-library UI using the required four-color palette.
3. Core operator interactions: navigate repo domains, inspect/edit files in collapsible modals, and observe reverse-chron feed updates.
4. Automated tests for API and UI core behavior, plus successful local build/start commands.

## Consequences

- Positive: Produces concrete subordinate run evidence that implementation, review, and QA stages can be completed correctly.
- Positive: Creates an extensible `client/` baseline for follow-up UI increments.
- Negative: Introduces a new top-level app surface and workspace dependency cost.
- Negative: Requires additional runtime guardrails for filesystem-safe file editing APIs.

## Rejected alternatives

- **Mock-only stage evidence without app implementation.** Rejected because it fails intake/spec outcomes and does not validate the harness correction.
- **Embed dashboard UI into existing internal package paths.** Rejected because scope explicitly requires a new top-level `client/` directory.
- **Skip edit APIs and provide read-only preview.** Rejected because edit capability is a required user story.
