## Objective

This stage is harness-owned and deterministic. The runtime validates baseline,
ledger, index, filesystem, and lock consistency before release preparation.

## Notes

- No worker action is required.
- The harness records `passed` or `operator-review-required`.
- On anomalies, the workflow pauses for explicit operator adjudication.
