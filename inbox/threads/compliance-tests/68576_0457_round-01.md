# Intake Clarifications - compliance-tests - Round 01

Please reply to each question so the intake spec can be finalized for
`human_approval`:

- Which canonical path SHOULD contain the compliance test schema, and how
  SHOULD schema versioning work? **Answer**: Contain a new top-level directory named `tests`. All internal testing assets should be placed here. Initial structure:

  tests
  |__compliance
    |___schemas  # Most revent version always named latest.yaml
          latest.yaml
          v0.yaml
          v1.yaml
      compliance_test_1.yaml  # Not necessarily this naming convention
      compliance_test_2.yaml
         
- What default schedule SHOULD run when no explicit cadence is configured
  (for example, every 4 hours)? **Answer**: Every 4 hours. This should be deferred to the backlog until scheduled automations for Tesseract are implemented. Initially, only manual invocation by the operator or by an agent will be supported.

- Which change events SHOULD trigger structure-change compliance runs? **Answer**: Adding, modifying, or deleting a persona, skill, pipeline definition, or any other primitive involved in operations which must be documented and referenced in Tesseract; any changes to testing/validation infrastructure; any changes to operator interfaces (e.g. inbox, invokable commands); as the last step in the ratification process of any milestone defined in PRD.md.

- For high-severity failures, which gate identifiers MUST be blocked? **Answer**: Please clarify which gate identifiers currently exist and what they do.

- For medium-severity failures, SHOULD escalation to operator default to `on`
  or `off`? **Answer**: Off by default.

- For low-severity failures, SHOULD warnings be emitted to `console`, `inbox`,
  or both by default? **Answer**: Both by defaut.
