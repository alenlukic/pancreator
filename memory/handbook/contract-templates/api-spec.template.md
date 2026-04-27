---
template: api-spec
slug: api-spec
stability: experimental
phase: 0b
allowed-in-milestones: [M1 (rego over OpenAPI JSON), M2 (schemathesis), M3+]
purpose: |
  Scaffold for API-spec contract clauses. M1 gates structural OpenAPI
  invariants via `kind: rego` over `openapi.json`. M2 swaps in deterministic
  Schemathesis runs against the live service.
references:
  - kind: lines
    path: /memory/handbook/contract-format.md
    range: [1, 1]
    contentHash: cb3f91d54eee30e53e35b2b99905f70f169ed549fd78909d3dac2defc9ed8d3b
    note: "Wrapper schema reference."
  - kind: lines
    path: /memory/handbook/contract-style.md
    range: [1, 1]
    contentHash: cb3f91d54eee30e53e35b2b99905f70f169ed549fd78909d3dac2defc9ed8d3b
    note: "Layer 2 (schemathesis) requirements."
external:
  - https://schemathesis.io
  - https://spec.openapis.org/oas/v3.1.0
---

# Template — API-Spec contract

Use this template for clauses gating an HTTP API's structural conformance,
authentication behavior, error envelope, or content-type handling. The
clause lives alongside the service's OpenAPI document.

## Slot map

| Slot | Required | Notes |
|---|---|---|
| `id` | yes | Reverse-DNS. Convention: `<feature>.api.<assertion>`. |
| `kind` | yes | M1: `rego`. M2+: `schemathesis`. |
| `severity` | yes | Auth and 4xx clauses default `block`. |
| `applies_to` | yes | Default discriminator: `artifact-symbol` against the OpenAPI document. |
| `owner` | yes | `tech-lead` or `appsec`. |
| `description` | yes | EARS, atomic, quantified (status codes, latency). |
| `references` | yes | Cite the OpenAPI section and the upstream RFC (e.g., RFC 7235 for auth). |
| `runtime` | yes | Per-kind payload. |
| `metadata.tesseract.openapi-operation-id` | yes | Operation ID being gated. |

## M1 scaffold (`kind: rego` over OpenAPI JSON)

```yaml
id: <feature>.api.401-on-missing-token
kind: rego
severity: block
applies_to:
  kind: artifact-symbol
  path: apis/<service>/openapi.yaml
  symbol: "paths./checkout.post.responses.401"
  contentHash: <sha256>
owner: appsec
description: |
  When the OpenAPI document declares a `POST /checkout` operation, the
  operation SHALL declare a `401` response whose schema MUST reference the
  shared `#/components/schemas/AuthError` envelope.
references:
  - kind: lines
    path: apis/<service>/openapi.yaml
    range: [<start>, <end>]
    contentHash: <sha256>
    note: "POST /checkout declaration."
spec: /memory/features/<id>/contracts/401-on-missing-token.rego
runtime:
  package: tesseract.api.checkout
  query: data.tesseract.api.checkout.deny
metadata:
  tesseract.contract_id: <feature>.api.401-on-missing-token
  tesseract.applies_to: artifact-symbol:apis/<service>/openapi.yaml#paths./checkout.post.responses.401
  tesseract.openapi-operation-id: createCheckout
```

Sidecar `401-on-missing-token.rego`:

```rego
# METADATA
# title: POST /checkout declares 401 with AuthError envelope
# description: |
#   When the OpenAPI document declares a `POST /checkout` operation, the
#   operation SHALL declare a `401` response whose schema MUST reference
#   the shared `#/components/schemas/AuthError` envelope.
# severity: block
# references:
#   - "/memory/handbook/contract-templates/api-spec.template.md"
# custom:
#   tesseract.contract_id: <feature>.api.401-on-missing-token
#   tesseract.applies_to: artifact-symbol:apis/<service>/openapi.yaml#paths./checkout.post.responses.401
package tesseract.api.checkout

import rego.v1

deny contains msg if {
  not input.paths["/checkout"].post.responses["401"]
  msg := "When the OpenAPI document declares a `POST /checkout` operation, the operation SHALL declare a `401` response whose schema MUST reference the shared `#/components/schemas/AuthError` envelope."
}

deny contains msg if {
  ref := input.paths["/checkout"].post.responses["401"].content["application/json"].schema["$ref"]
  ref != "#/components/schemas/AuthError"
  msg := "When the OpenAPI document declares a `POST /checkout` operation, the operation SHALL declare a `401` response whose schema MUST reference the shared `#/components/schemas/AuthError` envelope."
}
```

## M2 scaffold (`kind: schemathesis`)

```yaml
id: <feature>.api.401-on-missing-token
kind: schemathesis
severity: block
applies_to:
  kind: artifact-symbol
  path: apis/<service>/openapi.yaml
  symbol: "paths./checkout.post"
  contentHash: <sha256>
owner: sdet
description: |
  When the live `POST /checkout` endpoint receives a request without an
  `Authorization` header, the service SHALL respond `401` within 200 ms and
  SHALL emit a body matching `#/components/schemas/AuthError`.
references:
  - kind: lines
    path: apis/<service>/openapi.yaml
    range: [<start>, <end>]
    contentHash: <sha256>
    note: "POST /checkout operation declaration."
runtime:
  openapi: apis/<service>/openapi.yaml
  endpoint: "POST /checkout"
  examples:
    pass: |
      curl -X POST http://localhost:<port>/checkout
      # expects: 401 with AuthError envelope
    fail: |
      curl -X POST http://localhost:<port>/checkout -H "Authorization: Bearer valid"
      # expects: 200; failing this test means the auth check is broken
metadata:
  tesseract.contract_id: <feature>.api.401-on-missing-token
  tesseract.applies_to: artifact-symbol:apis/<service>/openapi.yaml#paths./checkout.post
  tesseract.openapi-operation-id: createCheckout
```

## Failure-handling

API-spec failures route to `tech-lead` (structural) or `coder` (live). The
clause's `description` quote propagates to the `ContractFailure.message`,
making run-log search by EARS phrase a primary triage tool.
