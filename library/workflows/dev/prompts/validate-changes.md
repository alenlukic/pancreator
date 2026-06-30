## Objective

This stage is harness-owned and deterministic. The runtime validates the run
baseline, accepted workspace index, current filesystem snapshot, and scope
configuration before release preparation.

## Notes

- No worker action is required.
- Persistent per-file locks and the per-edit modification ledger are not used.
- Ordinary source changes made by source-allowed stages are adopted into the
  accepted checksum index.
- The harness records `passed` or `operator-review-required` for scope/index
  integrity defects.
- On anomalies, the workflow pauses for explicit operator adjudication.
