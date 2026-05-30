---
title: Compliance Remediation Summary
task_id: 69180_0447_broad-sweep-compliance
day: 172981_05-25-26
auditor: compliance-auditor-standard
created: 2026-05-25T04:47:00Z
---

# Compliance Remediation Summary

## Files changed by auto-remediation

| File | Change | Finding |
|---|---|---|
| `src/memory/features/json-formatting/index.json` | `deferred_backlog_ids` primitive string array reformatted from multi-line to inline canonical layout | B-01 (resolved) |
| `src/personas/compliance-auditor.md` | `references[2].range` updated `[1, 260]` → `[1, 115]`; `contentHash` refreshed. `references[4].range` updated `[1, 221]` → `[1, 220]`; `contentHash` refreshed. | M-02 (resolved) |

## Unresolved findings checklist

- [x] **M-01 (Major)** — `src/memory/active/current.md` stale: resolved by archiving `src/inbox/in/172983_05-23-26/74280_0322_intake-json-formatting-ratification.md` to `src/inbox/archive/in/172983_05-23-26/74280_0322_intake-json-formatting-ratification.md` and reconciling active-memory state.
- [x] **m-01 (Minor)** — `src/memory/active/current.md` lines 15, 20 `TBD-on-commit` placeholders resolved to concrete abbreviated hashes during active-memory rotation.
- [ ] **m-02 (Minor)** — 501 `TBD-on-commit` contentHash placeholders across ADRs, feature specs, handbook files. Pre-existing documented debt; backlog-tracked.
- [x] **m-03 (Minor)** — `src/memory/active/current.md` shipped-feature table rotated to include `json-formatting`.
- [ ] **n-01 (Note)** — No `pnpm test` script defined. Proposal P-01 deferred to `pancreator-engineer`.
- [x] **n-02 (Note)** — stale ratification request archived after operator-confirmed closure; no pending gate remains for this inbox item.

## Next-owner routing

| Finding | Next owner | Required action |
|---|---|---|
| M-01, m-01, m-03 | Completed | Archived stale ratification request and updated `src/memory/active/current.md` (Active Feature, hashes, shipped-feature table). |
| m-02 | `librarian` | Bulk contentHash refresh pass against citation-rot-scan inventory; run `pan lint contracts` when available. |
| n-01 / P-01 | `pancreator-engineer` | Add unified `pnpm test` script to `package.json`. |
| n-02 | Completed | No further action; stale ratification request archived post-closure. |
| P-02 (deferred) | `tech-lead` | Plan `knowledge-curation` active-memory rotation automation for M4+ scheduler wiring. |

## Gate status

```
compliance_passes: true

Reason: Stale ratification-request references are archived and reconciled.
All block/major findings are resolved (B-01, M-01, M-02). Non-blocking debt
items remain tracked separately. All test suites pass.
```
