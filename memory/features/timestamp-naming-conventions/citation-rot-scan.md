# Timestamp Naming Conventions Citation Rot Scan

## Summary
When the index stage scans structured dual-anchor citations, the report MUST record 0 block findings, 19 warn findings, 1 info finding, and the accepted `TBD-on-commit` placeholder count of 501 placeholders. When a citation uses `contentHash: TBD-on-commit`, the scan MUST NOT refresh the hash in this pass.

## Findings By Severity

### Block
- None. When the scan checks structured citation paths, each concrete cited path MUST exist.

### Warn
- `memory/features/timestamp-naming-conventions/delivery-report.md` line 10 cites `inbox/threads/timestamp-naming-conventions/round-01-clarify.md` range `[1, 97]`, but the target has 96 lines. {kind: lines, path: memory/features/timestamp-naming-conventions/delivery-report.md, range: [10, 10], contentHash: TBD-on-commit}
- `memory/features/timestamp-naming-conventions/delivery-report.md` line 11 cites `work/timestamp-naming-conventions/plan.md` range `[1, 36]`, but the target has 35 content lines. {kind: lines, path: memory/features/timestamp-naming-conventions/delivery-report.md, range: [11, 11], contentHash: TBD-on-commit}
- `inbox/out/2026-04-27-timestamp-naming-conventions-delivery-report.md` line 10 cites `inbox/threads/timestamp-naming-conventions/round-01-clarify.md` range `[1, 97]`, but the target has 96 lines. {kind: lines, path: inbox/out/2026-04-27-timestamp-naming-conventions-delivery-report.md, range: [10, 10], contentHash: TBD-on-commit}
- `inbox/out/2026-04-27-timestamp-naming-conventions-delivery-report.md` line 11 cites `work/timestamp-naming-conventions/plan.md` range `[1, 36]`, but the target has 35 content lines. {kind: lines, path: inbox/out/2026-04-27-timestamp-naming-conventions-delivery-report.md, range: [11, 11], contentHash: TBD-on-commit}
- `work/timestamp-naming-conventions/review.md` line 128 cites `tests/compliance/timestamp-naming-conventions.yaml` range `[1, 18]`, but the target has 17 content lines. {kind: lines, path: work/timestamp-naming-conventions/review.md, range: [128, 128], contentHash: TBD-on-commit}
- `memory/features/compliance-tests/spec.md` line 30 cites `inbox/threads/compliance-tests/round-01.md` range `[1, 30]`, but the target has 29 lines. {kind: lines, path: memory/features/compliance-tests/spec.md, range: [30, 30], contentHash: TBD-on-commit}
- `memory/features/compliance-tests/spec.md` line 35 cites `inbox/threads/compliance-tests/round-02.md` range `[1, 17]`, but the target has 16 lines. {kind: lines, path: memory/features/compliance-tests/spec.md, range: [35, 35], contentHash: TBD-on-commit}
- `memory/features/compliance-tests/spec.md` line 40 cites `inbox/threads/compliance-tests/round-03-approval.md` range `[1, 8]`, but the target has 7 lines. {kind: lines, path: memory/features/compliance-tests/spec.md, range: [40, 40], contentHash: TBD-on-commit}
- `memory/features/compliance-tests/spec.md` line 45 cites `inbox/threads/compliance-tests/round-04-human-reject.md` range `[1, 17]`, but the target has 16 lines. {kind: lines, path: memory/features/compliance-tests/spec.md, range: [45, 45], contentHash: TBD-on-commit}
- `memory/features/bootstrap-phase-0a-closure/spec.md` line 10 cites `inbox/in/bootstrap-phase-0a-closure.md` range `[1, 33]`, but the target has 32 lines. {kind: lines, path: memory/features/bootstrap-phase-0a-closure/spec.md, range: [10, 10], contentHash: TBD-on-commit}
- `memory/handbook/documentation-impact-contract.md` line 14 cites `memory/adr/0004-documentation-impact-contract.md` range `[66, 100]`, but the target has 91 lines. {kind: lines, path: memory/handbook/documentation-impact-contract.md, range: [14, 14], contentHash: TBD-on-commit}
- `inbox/threads/timestamp-naming-conventions/round-01-clarify.md` line 14 cites `memory/features/timestamp-naming-conventions/spec.md` range `[1, 166]`, but the target has 133 content lines. {kind: lines, path: inbox/threads/timestamp-naming-conventions/round-01-clarify.md, range: [14, 14], contentHash: TBD-on-commit}
- `work/timestamp-naming-conventions/review.md` line 13 cites `work/timestamp-naming-conventions/plan.md` range `[1, 36]`, but the target has 35 content lines. {kind: lines, path: work/timestamp-naming-conventions/review.md, range: [13, 13], contentHash: TBD-on-commit}
- `work/compliance-tests/adr-draft.md` line 31 cites `inbox/threads/compliance-tests/round-04-human-reject.md` range `[8, 17]`, but the target has 16 lines. {kind: lines, path: work/compliance-tests/adr-draft.md, range: [31, 31], contentHash: TBD-on-commit}
- `work/compliance-tests/plan.md` line 37 cites `inbox/threads/compliance-tests/round-04-human-reject.md` range `[8, 17]`, but the target has 16 lines. {kind: lines, path: work/compliance-tests/plan.md, range: [37, 37], contentHash: TBD-on-commit}
- `personas/compliance-auditor.md` line 67 cites `/memory/handbook/documentation-impact-contract.md` range `[1, 260]`, but the target has 115 lines. {kind: lines, path: personas/compliance-auditor.md, range: [67, 67], contentHash: TBD-on-commit}
- `personas/compliance-auditor.md` line 77 cites `/memory/handbook/run-log-schema.md` range `[1, 221]`, but the target has 220 lines. {kind: lines, path: personas/compliance-auditor.md, range: [77, 77], contentHash: TBD-on-commit}
- `.cursor/agents/compliance-auditor.md` line 67 cites `/memory/handbook/documentation-impact-contract.md` range `[1, 260]`, but the target has 115 lines. {kind: lines, path: .cursor/agents/compliance-auditor.md, range: [67, 67], contentHash: TBD-on-commit}
- `.cursor/agents/compliance-auditor.md` line 77 cites `/memory/handbook/run-log-schema.md` range `[1, 221]`, but the target has 220 lines. {kind: lines, path: .cursor/agents/compliance-auditor.md, range: [77, 77], contentHash: TBD-on-commit}

### Info
- `memory/handbook/index.md` has no `Decisions` family. When the routing map lacks that family, the librarian MUST NOT improvise a new route in this pass. {kind: lines, path: memory/handbook/index.md, range: [52, 68], contentHash: TBD-on-commit}
