# Active work

`work/` is the active run workspace. New or in-progress pipeline artifacts live
here while an operator or agent is still using them.

Completed run artifacts move to `archive/work/` during librarian
maintenance. Operators should not need to inspect `archive/work/` for
routine system operation; read archived runs only by explicit path when
reconstructing history, debugging a past run, or repairing citations.

## Out-of-band work

When work lives under `work/<day>/<task-id>/` without a feature-delivery
`state.json` (for example a compliance audit or migration dry-run), add
`out-of-band.manifest.json` to that task directory so repository structure
checks skip it:

```json
{
  "schema_version": "1",
  "reason": "Compliance audit artifacts without feature-delivery ledger"
}
```

The `reason` field MUST be a non-empty string of at least 12 characters.
Remove the manifest after the work is archived or after `pan repair-state`
creates a ledger.
