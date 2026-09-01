Author one target-owned command, skill, or persona from `$ARGUMENTS`.

1. Read `{{PANCREATOR_HARNESS_PATH}}AGENTS.md`.
2. Run `{{PANCREATOR_PAN_COMMAND}} governance card --mode author` and read the complete card.
3. Stop when `config.json.installation_mode` is `self_development`.
4. Read `{{PANCREATOR_HARNESS_PATH}}library/schemas/target-authoring.schema.json`.
5. Select one lowercase hyphenated extension id from `$ARGUMENTS`, or ask the operator for it.
6. When the extension exists, run `{{PANCREATOR_PAN_COMMAND}} author validate --extension <id> --json` and retain its manifest digest.
7. Write one complete draft to `{{PANCREATOR_HARNESS_PATH}}runtime/inbox/target-authoring/<id>.json`.
8. For a command, include `$ARGUMENTS` and `governance card --mode target --extension <id>` in its Markdown content.
9. For a persona, include `Responsibilities` and `Boundaries` sections and select one Cursor model.
10. Set `policy_persona` to the persona whose existing policy set governs the artifact. Add only existing policy ids to `policies`.
11. When the draft changes an existing extension, set `expected_manifest_sha256` to the digest from step 6.
12. Run `{{PANCREATOR_PAN_COMMAND}} author apply --input runtime/inbox/target-authoring/<id>.json --json`.
13. Run `{{PANCREATOR_PAN_COMMAND}} author validate --extension <id> --json`.
14. Report the canonical path, policy binding, Cursor projection, resolved policy ids, and validation result.
15. Do not write a target-tracked file, target `.gitignore`, Pancreator library authoring path, workflow, verification profile, or policy document.
