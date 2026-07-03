# Governance registries

The terms **MUST**, **MUST NOT**, **SHOULD**, **SHOULD NOT**, and **MAY** in this document indicate requirement levels as defined by RFC 2119 and RFC 8174.

Canonical governance data that is shared across policies and runtime validation
lives in this directory:

- `policy_lookup_table.json` selects policies by persona, workflow, stage, and optional detected workspace technology.
- `validation_registry.json` defines durable automation and validator handlers.
- `directive_exemptions.json` records reviewed directive-audit exemptions.
- `projection_manifest.json` declares generated projections from canonical `library/` or `src/` files into disposable local surfaces such as `.cursor/`.

Policy modules remain under `governance/policies/`; handbooks remain under
`governance/handbooks/`.
