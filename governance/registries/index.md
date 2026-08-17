# Governance registries

The terms **MUST**, **MUST NOT**, **SHOULD**, **SHOULD NOT**, and **MAY** in this document indicate requirement levels as defined by RFC 2119 and RFC 8174.

Canonical governance data that is shared across policies and runtime validation
lives in this directory:

- `policy_lookup_table.json` selects policies by persona, workflow, stage, and optional detected workspace technology.
- `validation_registry.json` defines durable automation and validator handlers.
- `directive_exemptions.json` records reviewed directive-audit exemptions.
- `projection_manifest.json` declares generated projections from canonical `library/` or `src/` files into disposable local surfaces such as `.cursor/`.
- `cursor_model_catalog.json` records observed Cursor model identifiers and persona-mapping parameters with the provenance of each entry. It is the authoritative source for what Pancreator knows about Cursor's grammar. An entry MUST cite a direct observation to be recorded as `verified` or `rejected`; absence from the catalog means unverified, never invalid, so an unlisted model or value MUST NOT be rejected. Agents MUST NOT introduce a Cursor model or parameter constraint anywhere else in the repository.

Policy modules remain under `governance/policies/`; handbooks remain under
`governance/handbooks/`.
