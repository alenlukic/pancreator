# ADR Draft — Operator-Local Next.js Dashboard for Subordinate QA

## Context

The subordinate Feature SHALL produce QA evidence for the parent feature-delivery harness by executing one realistic dashboard directive through the feature-delivery pipeline. The dashboard must expose repository relationships, file inspection, file editing, and reverse-chronological activity without changing pipeline runtime code. Citation: `{kind: lines, path: lib/memory/features/v0-ui-dashboard-subordinate-feature-pipeline-qa/spec.md, range: [91, 99], contentHash: 199faf3}`.

Pancreator already treats the repository substrate as the current operator-facing system boundary. ADR-0002 separates current repository assets from future runtime automation, so this dashboard SHALL read current files directly and SHALL NOT imply production runtime readiness. Citation: `{kind: lines, path: lib/memory/adr/0002-system-architecture-map.md, range: [132, 151], contentHash: e037427}`.

ADR-0005 defines reverse-chronological temporal artifact naming across `work/` and `lib/inbox/`. The dashboard activity feed SHALL preserve that operator expectation when it renders repository events. Citation: `{kind: lines, path: lib/memory/adr/0005-timestamp-naming-conventions.md, range: [35, 60], contentHash: 0573437}`.

## Decision

Pancreator SHALL implement the v0 dashboard as a new top-level `client/` pnpm workspace package that uses Next.js App Router, TypeScript, React >= 18, and one maintained React component-library dependency.

When the dashboard serves repository content, server-side code SHALL resolve every requested path against the repository root before file I/O. The file API SHALL reject traversal, symlink escapes, and `lib/inbox/notes/**` with HTTP 403.

When the dashboard renders relationships, the UI SHALL model five repository domains as first-class navigation nodes: `lib/inbox/`, `lib/memory/`, `lib/personas/`, `work/`, and `lib/internal/packages/`.

When the implementation writes files, it SHALL persist changes only through `POST /api/file` and SHALL emit one structured log line for each successful write.

## Status

Status is proposed for the subordinate plan stage on 2026-05-29. The acting agent ratifies it for implement-stage delegation after `touch-set.json` is accepted.

## Consequences

- Positive: The parent harness gains realistic full-stack evidence without coupling the proof to pipeline runtime internals.
- Positive: The operator receives one local dashboard that surfaces repository relationships and stage artifacts.
- Positive: Path safety rules keep the human-only notes sandbox outside the dashboard read and write surface.
- Negative: The new `client/` workspace adds dependency and lockfile churn that reviewer and QA personas must inspect.
- Negative: File editing is local-operator tooling only and does not provide authentication, authorization, or production hardening.
- Neutral: The decision does not change `lib/pipelines/feature-delivery.yaml`, persona semantics, or parent harness code.

## Documentation Impact

```yaml
documentation_impact:
  applies: true
  rationale: The decision creates a new operator-facing client workspace and local operation guide.
  changed-surfaces:
    - client/README.md
    - work/172977_05-29-26/68034_0506_v0-ui-dashboard-subordinate-feature-pipeline-qa/implementation-report.md
    - lib/memory/features/v0-ui-dashboard-subordinate-feature-pipeline-qa/delivery-report.md
  deferred-items: []
```
