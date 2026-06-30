Start a Pancreator workflow from the operator request in `$ARGUMENTS`.

1. Read `AGENTS.md`.
2. Preserve `$ARGUMENTS` verbatim in a uniquely named Markdown file under `runtime/inbox/`. Keep its harness-relative path (for example `runtime/inbox/request-<id>.md`) for CLI arguments.
3. Read the preserved request file and derive init options:
   - By default, omit `--workspace` so `project.json.workspace_root` remains authoritative, and use no `gates` override.
   - If the preserved request is JSON containing `workspace_root` (for example a prior run state payload), use it as `--workspace`.
   - If the preserved request is JSON containing `gate_overrides`, write that object to a uniquely named JSON file under `runtime/inbox/` and pass its harness-relative path as `--gates`.
4. Run `./bin/pan init --workflow dev --request <harness-relative-request> [--workspace <workspace>] [--gates <harness-relative-gates-file>]`, then `./bin/pan prepare <run-id>`.
5. Read the generated invocation Markdown. Intake is owned by the current supervisor: perform only that card, write its declared JSON output, and run `./bin/pan submit`.
6. Present the product specification and current run status to the operator. Stop for ratification; do not call `./bin/pan decide ... approve` yourself.
