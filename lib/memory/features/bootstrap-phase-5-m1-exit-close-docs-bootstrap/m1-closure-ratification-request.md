# M1 bootstrap closure — ratification request

## Purpose

Request explicit human ratification that Bootstrap Phase 5 / M1 MVP scope is
complete and the repository MAY transition to M2 planning. This packet satisfies
WP5 of `bootstrap-phase-5-m1-exit-close-docs-bootstrap` after the xeremia-sandbox
US-9 PoC and embedded-install AC8 smoke passed without operator workarounds.

## Go / no-go recommendation

**Recommend: GO** — M1 bootstrap deliverables are satisfied; residual items are
explicitly deferred with backlog owners and do not block closure.

## Evidence bundle

| Item | Path | Status |
| --- | --- | --- |
| US-9 greenfield evidence (xeremia) | `lib/memory/features/bootstrap-phase-5-m1-exit-close-docs-bootstrap/xeremia-greenfield-evidence.json` | evaluator `pass` |
| US-9 evaluator stdout | `lib/memory/features/bootstrap-phase-5-m1-exit-close-docs-bootstrap/xeremia-greenfield-evidence-evaluator.json` | exit 0 |
| AC8 SDK smoke (no workarounds) | `lib/memory/features/bootstrap-phase-5-m1-exit-close-docs-bootstrap/xeremia-ac8-smoke-evidence.json` | `pass` |
| Embedded harness install | `lib/memory/features/embedded-harness-install-project-root-pancreator-and-fresh-install-manifest/index.json` | indexed |
| Embedded install gap closure | `lib/memory/features/embedded-install-cursor-agent-sync-init-content-seeding-and-inbox-path-bugs/index.json` | indexed |
| Phase 4 US-1 dogfood exit | `lib/memory/features/us-1-dogfood-phase-4-exit/phase-4-proof-bundle.md` | ratified 2026-05-19 |
| KPI baseline input | `lib/memory/features/bootstrap-phase-5-m1-exit-close-docs-bootstrap/kpi-baseline-evidence.json` | captured |
| Greenfield evaluator | `lib/internal/tools/evaluate-greenfield-evidence.mjs` | fixture + live pass |

## M1 scope checklist (PRD section 11)

| MVP item | Outcome | Notes |
| --- | --- | --- |
| US-1 feature-delivery (basic) | done | Phase 4 dogfood + SDK mode on daedaline and xeremia |
| US-8 package boundaries | done | ESLint no-horizontal-deps; attw/publint gates |
| US-9 install paths | done | Embedded adopt on xeremia; greenfield evidence kit |
| US-10 pause/abort (minimum) | done | Phase 4 intervention probe evidence |
| 8 MVP personas + projections | done | Roster + `.cursor/agents` sync on embedded init |
| feature-delivery + knowledge-curation pipelines | done | YAML definitions; feature-delivery runtime wired |
| init-greenfield + adopt pipelines | partial | Definitions + adopt scaffold; `pan run init-greenfield` deferred exit 125 |
| Delivery report + feature index | done | Per-feature folders indexed |
| SDK feature-delivery | done | `runner.cursor.invocation: sdk`; xeremia AC8 smoke |

## Residual gaps (non-blocking)

| Gap | Owner | Routing |
| --- | --- | --- |
| Phoenix external trace verification | `@pancreator/run-logger` / pancreator-engineer | `lib/memory/features/us-1-dogfood-phase-4-exit/phoenix-trace-evidence.md` |
| `lib/memory/adr/0002-m1-baseline.md` ADR prose | tech-writer | deferred; KPI input in `kpi-baseline-evidence.json` |
| Handbook `stability: stable` promotions | librarian | WP4 deferred per policy-compliance |
| `pan run init-greenfield` runtime | pancreator-engineer | deferred exit 125 |
| `chat-with-persona` runtime | M2 backlog | `lib/memory/backlog/index.yaml` |
| Content-hash refresh pass | librarian | `bootstrap-content-hash-refresh` backlog item |
| Archived JSON formatting offender | librarian | `json-formatting` maintenance path |

## Human ratification procedure

1. Review the evidence table above and spot-check xeremia-sandbox state if desired.
2. Record decision in the table below.
3. After **GO**, update `pancreator.yaml` `bootstrap.status` to `m1-ratified` (or
   equivalent operator-chosen stable value) and open M2 planning via inbox.

## Decision record

| Field | Value |
| --- | --- |
| Reviewer | human operator |
| Date (UTC) | 2026-05-31 |
| Decision | GO |
| Notes | N/A |
