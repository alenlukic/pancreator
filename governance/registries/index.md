# Governance registries

The terms **MUST**, **MUST NOT**, **SHOULD**, **SHOULD NOT**, and **MAY** in this document indicate requirement levels as defined by RFC 2119 and RFC 8174.

Canonical governance data that is shared across policies and runtime validation
lives in this directory:

- `policy_lookup_table.json` selects policies by persona, workflow, stage, and optional detected workspace technology.
- `validation_registry.json` defines durable automation and validator handlers.
- `directive_exemptions.json` records reviewed directive-audit exemptions.
- `command_governance.json` declares how each canonical Cursor command receives governance: a `pan governance card --mode <mode>` step, the supervisor card, or an explicit read-only allowlist entry. `pan validate` fails a command that does neither.
- `projection_manifest.json` declares generated projections from canonical `library/` or `src/` files into disposable local surfaces such as `.cursor/`.
- `harness_repair_categories.json` is the `REPAIR-001`-owned authoritative list of harness repair audit categories.
- `host_tools.json` maps each neutral tool term (question tool, platform await, subagent launch, shell) to each host's tool names.
- `platform_guidance_catalog.json` lists known platform-authored strings per host, each with its redline category, injection surface, pinned source, and the harness authority that governs it. The redline record copies the declaring host's entries, and `pan validate` checks each entry names a redline category.
- `cursor_model_catalog.json` is an optional operator-local catalog. It validates only the current Cursor account's models and is never tracked or installed.

Policy modules remain under `governance/policies/`; handbooks remain under
`governance/handbooks/`.
