# Proposal: formalize compliance tests
- Schema (e.g. YAML)-based tests which formalize e.g. input, steps, expected output
- Cadence
    - Scheduled (e.g. every 4 hours)
    - Triggered (e.g. changes to harness structure)
    - On-demand/operator-invoked
- Follow-ups: severity-based
    - High/blocker: invoke remediation pipeline (e.g. failures -> contract writer -> Daedaline engineer); if gating agent activity, then gate is blocked until remediation in place
    - Medium: add to backlog and/or escalate to operator (can be configured)
    - Low: add to backlog, surface warning in console or inbox
