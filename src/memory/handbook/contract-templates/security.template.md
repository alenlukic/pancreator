---
template: security
slug: security
stability: experimental
phase: 0b
allowed-in-milestones: [M1 (rego + llm-judge), M2 (+ schemathesis), M3+ (+ semgrep)]
purpose: |
  Scaffold for security and threat-model contract clauses. Pairs a STRIDE
  category with an OWASP-ASVS reference, an EARS assertion, and a numeric
  likelihood × impact score. M1 gates structural invariants via `rego` and
  qualitative mitigations via `llm-judge`. M3 adds `semgrep` for code-level
  patterns.
references:
  - kind: lines
    path: /src/memory/handbook/contract-format.md
    range: [1, 1]
    contentHash: cb3f91d54eee30e53e35b2b99905f70f169ed549fd78909d3dac2defc9ed8d3b
    note: "Wrapper schema reference."
  - kind: lines
    path: /src/memory/handbook/contract-style.md
    range: [1, 1]
    contentHash: cb3f91d54eee30e53e35b2b99905f70f169ed549fd78909d3dac2defc9ed8d3b
    note: "Layer 2 (security) requirements: STRIDE + ASVS + EARS + score."
external:
  - https://owasp.org/www-project-application-security-verification-standard/
  - https://learn.microsoft.com/en-us/azure/security/develop/threat-modeling-tool-threats
---

# Template — Security contract

Use this template for clauses gating threat-model mitigations, secrets
handling, dependency-CVE caps, SAST severity caps, and auth-flow invariants.
The clause SHOULD live alongside `threat-model.md` in the feature folder.

## Slot map

| Slot | Required | Notes |
|---|---|---|
| `id` | yes | Reverse-DNS. Convention: `<feature>.security.<assertion>`. |
| `kind` | yes | M1: `rego` (structural) or `llm-judge` (qualitative). M3+: `semgrep`. |
| `severity` | yes | Security clauses default `block`. |
| `applies_to` | yes | Default discriminator: `artifact-symbol` against `threat-model.md`, or `file-path` for code patterns. |
| `owner` | yes | `appsec`. |
| `description` | yes | EARS, atomic, mitigation-named. |
| `references` | yes | OWASP-ASVS reference plus the threat-model section. |
| `runtime` | yes | Per-kind payload. |
| `metadata.pancreator.stride` | yes | One of `spoofing`, `tampering`, `repudiation`, `information-disclosure`, `denial-of-service`, `elevation-of-privilege`. |
| `metadata.pancreator.asvs` | yes | OWASP-ASVS section ID. |
| `metadata.pancreator.likelihood` | yes | 1–5. |
| `metadata.pancreator.impact` | yes | 1–5. |
| `metadata.pancreator.cwe` | optional | Comma-separated CWE IDs. |

## M1 scaffold (`kind: rego` — structural mitigation)

```yaml
id: <feature>.security.spoofing.session-token-rotation
kind: rego
severity: block
applies_to:
  kind: file-path
  glob: "config/auth/session.yaml"
owner: appsec
description: |
  When the auth-config module declares a `session_token_ttl_seconds`, the
  value MUST be at most 3600 seconds and the `rotate_on_privilege_change`
  flag MUST be `true`.
references:
  - kind: lines
    path: /src/memory/features/<id>/threat-model.md
    range: [<start>, <end>]
    contentHash: <sha256>
    note: "STRIDE-Spoofing mitigation #2."
spec: /src/memory/features/<id>/contracts/session-token-rotation.rego
runtime:
  package: pancreator.security.session
  query: data.pancreator.security.session.deny
metadata:
  pancreator.contract_id: <feature>.security.spoofing.session-token-rotation
  pancreator.applies_to: file-path:config/auth/session.yaml
  pancreator.stride: spoofing
  pancreator.asvs: V3.3.1
  pancreator.likelihood: 3
  pancreator.impact: 4
  pancreator.cwe: "CWE-613, CWE-384"
```

## M1 scaffold (`kind: llm-judge` — qualitative mitigation)

Use when the assertion is qualitative (e.g., review of auth-flow narrative
diagrams) and no deterministic check applies.

```yaml
id: <feature>.security.repudiation.audit-log-coverage
kind: llm-judge
severity: block
applies_to:
  kind: artifact-symbol
  path: /src/memory/features/<id>/threat-model.md
  symbol: "STRIDE: Repudiation"
  contentHash: <sha256>
owner: appsec
description: |
  When the threat-model document enumerates a Repudiation threat, the
  document SHALL declare an audit-log mitigation that names the persisted
  fields, the retention window, and the tamper-evidence strategy.
references:
  - kind: lines
    path: /src/memory/features/<id>/threat-model.md
    range: [<start>, <end>]
    contentHash: <sha256>
    note: "STRIDE-Repudiation section."
runtime:
  rubric:
    scale: [1.0, 0.5, 0.0]
    threshold: 0.75
    examples:
      good:
        - text: |
            Audit log persists `user_id`, `tenant_id`, `event_ts`,
            `ip_address`, `action`, `resource`, `result`. Retention 365
            days. WORM via S3 Object Lock.
          rationale: All required fields named; window quantified;
            tamper-evidence strategy declared.
      bad:
        - text: "We log all relevant events for an appropriate period."
          rationale: Weasel words; no fields, no window, no tamper-evidence.
    references:
      - https://owasp.org/www-project-application-security-verification-standard/
  panel:
    quorum: 2-of-3
    judges: [haiku, haiku, sonnet]
    seed: 42
    cost_ceiling_usd: 0.50
metadata:
  pancreator.contract_id: <feature>.security.repudiation.audit-log-coverage
  pancreator.applies_to: artifact-symbol:/src/memory/features/<id>/threat-model.md#STRIDE-Repudiation
  pancreator.stride: repudiation
  pancreator.asvs: V8.3.1
  pancreator.likelihood: 3
  pancreator.impact: 4
```

## M3 scaffold (`kind: semgrep` — code-level pattern)

```yaml
id: <feature>.security.tampering.no-eval-on-user-input
kind: semgrep
severity: block
applies_to:
  kind: file-path
  glob: "src/**/*.ts"
owner: appsec
description: |
  When user-controlled input flows to a JavaScript `eval` or `Function`
  constructor invocation, the code SHALL be rejected and the violation
  SHALL be reported with the path and line of the call.
references:
  - kind: lines
    path: /src/memory/features/<id>/threat-model.md
    range: [<start>, <end>]
    contentHash: <sha256>
    note: "STRIDE-Tampering mitigation #5."
spec: /src/memory/features/<id>/contracts/no-eval-on-user-input.semgrep.yaml
runtime:
  rules: ["pancreator.security.no-eval-on-user-input"]
metadata:
  pancreator.contract_id: <feature>.security.tampering.no-eval-on-user-input
  pancreator.applies_to: file-path:src/**/*.ts
  pancreator.stride: tampering
  pancreator.asvs: V5.2.4
  pancreator.likelihood: 4
  pancreator.impact: 5
  pancreator.cwe: "CWE-95"
```

## Failure-handling

Security failures route to `appsec`. `severity: block` failures trigger an
inbox item to the human (M1) or to `ombudsperson` (M5+). The
`ContractFailure.evidence` SHALL include the attack-vector trace from the
threat-model and the failing input fixture.
