# Intake Clarifications - compliance-tests - Round 02

Please reply to the remaining question so the intake spec can be finalized for
`human_approval`:

- For high-severity compliance failures, which existing gate identifiers MUST be
  blocked by default?

  **Answer (interim canonical fallback for intake unblock):** Block
  `review_passes` and `human_approval` by default for the affected run until a
  remediation change-set is staged and one rerun reports zero `high` findings.
  This fallback is canonical for this feature now so intake can proceed.

  **Bounded follow-up:** By the next contract-corpus pass, define and ratify a
  repo-wide gate-catalog contract that enumerates all gate identifiers and
  default high-severity block behavior.
